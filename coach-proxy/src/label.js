// v1.17.0 POST /supp/label { image }: read the back of a supplement bottle with the xAI vision model (strict JSON schema,
// low reasoning effort) and return name / brand / form / serving / servings per container / ingredients mapped onto the app's
// nutrient keys (unknowns as custom). No usage limit for now (owner's call); abuse protection = image size cap + a per-network
// hourly rate limit. The photo is forwarded once and never stored. Counters for chat / estimate / review are not touched.
export const NUTRIENT_KEYS = ['vitA', 'b1', 'b2', 'b3', 'b5', 'b6', 'b7', 'folate', 'b12', 'vitC', 'vitD', 'vitE', 'vitK1', 'vitK2',
  'calcium', 'magnesium', 'zinc', 'iron', 'potassium', 'sodium', 'phosphorus', 'selenium', 'iodine', 'copper', 'manganese', 'chromium', 'molybdenum', 'boron', 'chloride', 'fluoride',
  'epa', 'dha', 'creatine', 'caffeine', 'theanine', 'betaAlanine', 'citrulline', 'ashwagandha', 'coq10', 'collagen', 'glucosamine', 'melatonin', 'probiotics', 'protein', 'fibre', 'kcal', 'carbs', 'sugar', 'fat'];
export const LABEL_FORMS = ['Capsule', 'Tablet', 'Softgel', 'Powder', 'Liquid', 'Gummy', 'Other'];
export const LABEL_UNITS = ['mg', 'µg', 'g', 'IU', 'ml', 'bn CFU', 'CFU', 'kcal'];
export const LABEL_DEFAULTS = { LABEL_PER_HOUR: '30', LABEL_MAX_IMAGE_CHARS: '2500000', LABEL_MAX_TOKENS: '2500', LABEL_TIMEOUT_MS: '90000', LABEL_REASONING: 'low' };
export const LABEL_PROMPT = `You read the supplement facts / nutrition panel in a photo of a supplement or medication label for a dose tracker.
Return ONLY the JSON object the schema describes. Rules:
- name: product name as printed (no marketing claims); brand: brand/manufacturer, or "" if not visible.
- form: one of ${LABEL_FORMS.join(', ')} ("Other" if unclear).
- serving: the serving size as printed in text (e.g. "2 capsules", "1 scoop (5 g)"), plus qty (number) and unit (the counted thing: capsule, tablet, softgel, gummy, scoop, g, ml, drop).
- servingsPerContainer: number, or 0 if not printed.
- ingredients: every active ingredient line PER SERVING with its amount and unit exactly as printed, converted only in spelling: use "µg" for mcg/μg, "bn CFU" for billion CFU.
  key = the best match from: ${NUTRIENT_KEYS.join(', ')}; use "custom" for anything else (herbs, extracts, amino acids not listed) and give its printed name.
  Vitamin B9 / folic acid / folate → folate (prefer the µg DFE figure if both are shown). Vitamin K without a number → vitK1; MK-7/menaquinone → vitK2. Fish oil: split EPA and DHA when listed; total omega-3 otherwise as custom.
  If the label lists a compound with an element amount (e.g. "Zinc (as zinc citrate) 15 mg") use the element key and that amount. Skip lines with no amount; skip % daily value columns.
- If the photo is not a supplement/nutrition label or is unreadable, return name "" and an empty ingredients list and say why in note.
- note: one short sentence about anything unclear (blur, cut-off text), or "".`;
export const LABEL_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['name', 'brand', 'form', 'serving', 'servingsPerContainer', 'ingredients', 'note'],
  properties: {
    name: { type: 'string' }, brand: { type: 'string' }, form: { type: 'string', enum: LABEL_FORMS },
    serving: { type: 'object', additionalProperties: false, required: ['text', 'qty', 'unit'], properties: { text: { type: 'string' }, qty: { type: 'number' }, unit: { type: 'string' } } },
    servingsPerContainer: { type: 'number' },
    ingredients: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['key', 'name', 'amount', 'unit'],
      properties: { key: { type: 'string', enum: [...NUTRIENT_KEYS, 'custom'] }, name: { type: 'string' }, amount: { type: 'number' }, unit: { type: 'string' } } } },
    note: { type: 'string' },
  },
};
const s = (v, n = 80) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, n) : '');
const UNIT_FIX = { mcg: 'µg', 'μg': 'µg', ug: 'µg', 'billion cfu': 'bn CFU', 'bn cfu': 'bn CFU', cfu: 'CFU', iu: 'IU', 'mg dfe': 'µg' };
export function normLabelUnit(u) { const t = s(u, 16); const l = t.toLowerCase(); if (l === 'mcg dfe' || l === 'µg dfe') return 'µg'; if (/^mg\s*(ne|ate|α-te|alpha-te)$/.test(l)) return 'mg'; if (/^µg\s*rae$|^mcg\s*rae$|^µg re$/.test(l)) return 'µg'; return UNIT_FIX[l] || t; }
/** validate + clean the model's JSON (never trust it): returns null when unusable */
export function parseLabel(text) {
  let j; try { j = JSON.parse(String(text || '').replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { const m = String(text || '').match(/\{[\s\S]*\}/); if (!m) return null; try { j = JSON.parse(m[0]); } catch { return null; } }
  if (!j || typeof j !== 'object') return null;
  const ingredients = [];
  for (const x of Array.isArray(j.ingredients) ? j.ingredients.slice(0, 60) : []) {
    const amount = +x?.amount; if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) continue;
    const key = NUTRIENT_KEYS.includes(x?.key) ? x.key : 'custom'; const name = s(x?.name, 60) || key;
    ingredients.push({ key, name, amount: Math.round(amount * 1000) / 1000, unit: normLabelUnit(x?.unit) || 'mg' });
  }
  const q = +j?.serving?.qty;
  return { name: s(j.name, 100), brand: s(j.brand, 60), form: LABEL_FORMS.includes(j.form) ? j.form : 'Other',
    serving: { text: s(j?.serving?.text, 60), qty: Number.isFinite(q) && q > 0 ? q : 0, unit: s(j?.serving?.unit, 16).toLowerCase() },
    servingsPerContainer: Number.isFinite(+j.servingsPerContainer) && +j.servingsPerContainer > 0 ? Math.round(+j.servingsPerContainer) : 0, ingredients, note: s(j.note, 200) };
}
const DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const hourKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 13);
export async function label(request, env, cors, ip, owner, cfgFn, fetcher = fetch) {
  const c = (k) => (env[k] != null && String(env[k]).trim() !== '' ? String(env[k]).trim() : LABEL_DEFAULTS[k]);
  const n = (k) => Math.max(0, parseInt(c(k), 10) || 0);
  const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors, ...extra } });
  const err = (status, error, message, extra = {}) => json(status, { error, message }, extra);
  if (request.method !== 'POST') return err(405, 'method', 'Use POST.');
  if (!env.XAI_API_KEY) return err(503, 'disabled', 'Label reading is not set up yet.');
  const raw = await request.text();
  if (raw.length > n('LABEL_MAX_IMAGE_CHARS') + 2000) return err(413, 'too_large', 'Photo too large. Try again (the app shrinks photos first).');
  let body; try { body = JSON.parse(raw); } catch { return err(400, 'bad_request', 'Body is not valid JSON.'); }
  const image = typeof body?.image === 'string' ? body.image : '';
  if (!image || !DATA_URL.test(image)) return err(400, 'bad_image', 'Send a JPEG, PNG or WebP photo.');
  const rk = `lbl:${hourKey()}:${ip}`; const used = parseInt((await env.COACH_KV.get(rk).catch(() => null)) || '0', 10) || 0;
  if (!owner && used >= n('LABEL_PER_HOUR')) return err(429, 'rate_limited', 'Lots of label reads from this network this hour. Try again in a bit.', { 'Retry-After': '900' });
  await env.COACH_KV.put(rk, String(used + 1), { expirationTtl: 3700 }).catch(() => {}); // counted on arrival (abuse guard, not a quota)
  const out = { model: cfgFn('MODEL'), messages: [{ role: 'system', content: LABEL_PROMPT }, { role: 'user', content: [{ type: 'image_url', image_url: { url: image, detail: 'high' } }, { type: 'text', text: 'Read this supplement label.' }] }],
    stream: false, max_tokens: n('LABEL_MAX_TOKENS'), response_format: { type: 'json_schema', json_schema: { name: 'supplement_label', strict: true, schema: LABEL_SCHEMA } } };
  if (c('LABEL_REASONING') !== 'none') out.reasoning_effort = c('LABEL_REASONING');
  const t0 = Date.now(); let up;
  try { up = await fetcher(cfgFn('UPSTREAM_URL'), { method: 'POST', signal: AbortSignal.timeout(n('LABEL_TIMEOUT_MS')), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.XAI_API_KEY}` }, body: JSON.stringify(out) }); }
  catch { return err(504, 'upstream_unreachable', 'The label reader did not answer in time. Try again.'); }
  if (!up.ok) { const detail = (await up.text().catch(() => '')).slice(0, 300); return json(502, { error: 'upstream_error', message: `The label reader returned HTTP ${up.status}. Try again.`, upstreamStatus: up.status, detail }); }
  let reply = ''; try { reply = (await up.json())?.choices?.[0]?.message?.content || ''; } catch {}
  const l = parseLabel(reply); const ms = Date.now() - t0;
  if (!l) return err(502, 'bad_label', "Couldn't make sense of that read. Try again.");
  if (!l.name && !l.ingredients.length) return json(422, { error: 'no_label', message: l.note || "Couldn't find a supplement label in that photo." });
  return json(200, { ...l, ms }, { 'Server-Timing': `label;dur=${ms}` });
}
