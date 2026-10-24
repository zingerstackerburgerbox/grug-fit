/**
 * Lunk AI Coach (Grug) + Smart Estimate proxy (Cloudflare Worker).
 * Holds the xAI API key as a Worker secret and forwards sanitised chat requests to xAI, with abuse controls:
 * Origin allowlist + CORS, per-device, per-network (salted SHA-256 of CF-Connecting-IP; raw IPs are never stored) and global
 * daily caps (Workers KV), an optional per-minute rate limit (Workers Rate Limiting binding COACH_RL), input/output size caps, a kill switch,
 * and an optional OWNER_TOKEN bypass. Only `messages`, `model` (allowlisted) and `stream` are taken from the client.
 * v1.10.0: POST /estimate (Smart Estimate for the Food tab): the prompt is built here (the client only sends a description,
 * an optional portion note and an optional photo as a data URL), the reply is validated as strict JSON, and a SEPARATE daily cap
 * applies (EST_DAILY_CAP per device, EST_DAILY_CAP x EST_NETWORK_MULT per network; same UTC day as the coach caps). Only successful
 * estimates are counted; estimates never use coach messages. Photos are forwarded to xAI and never stored.
 * v1.11.0: POST /review (Grug's weekly review: client sends a compact 7-day summary, the prompt + strict-JSON validation live here,
 * REVIEW_WEEKLY_CAP per device and x REVIEW_NETWORK_MULT per network per Sydney week (Mon 00:00 Australia/Sydney), only successes count).
 * Admin code: POST /admin {code} checks SHA-256(ADMIN_SALT + ':' + normalised code) against the ADMIN_CODE_HASH secret (constant time,
 * 5 attempts/hour per device and per network). Success issues a random per-device admin token (only its SHA-256 is kept in KV) that
 * the app sends as X-Admin-Token; it bypasses every cap like OWNER_TOKEN. POST /admin/remove revokes it. The code is never in this repo.
 * Chat caps lowered in v1.11.0: 5 per device / 15 per network per UTC day.
 * v1.12.0: leaderboard (opt-in). POST /leaderboard/submit {deviceId, username, kind:'training' (v1.12.1), daily:{score,date}, weekly:{score,weekKey}},
 * POST /leaderboard/leave, GET /leaderboard?period=weekly|daily (top 50 + the caller's own rank). KV `lb:e:<device>`; submits are
 * rate-limited per device and per hashed network per hour. Viewing never counts against chat, estimate or review limits.
 * v1.13.0: GET /food/barcode?code= and GET /food/search?q= (src/food.js): Open Food Facts lookups with trimmed fields, a 6 s timeout,
 * barcode variants in parallel and isolate + KV caching (`food:b:` / `food:s:` keys). No xAI key, no coach counters.
 */
import { food } from './food.js';
export { food };
const DEFAULTS = {
  MODEL: 'grok-4.7',
  UPSTREAM_URL: 'https://api.x.ai/v1/chat/completions',
  ALLOWED_ORIGINS: 'https://zingerstackerburgerbox.github.io,http://localhost:5173,http://localhost:4173,http://127.0.0.1:5173,http://127.0.0.1:4173',
  DEVICE_DAILY_CAP: '5',
  IP_DAILY_CAP: '15',
  GLOBAL_DAILY_CAP: '500',
  MAX_INPUT_CHARS: '24000',
  MAX_MESSAGES: '40',
  MAX_TOKENS: '1200',
  EST_DAILY_CAP: '3',
  EST_NETWORK_MULT: '3',
  EST_MAX_IMAGE_CHARS: '1500000',
  EST_MAX_TOKENS: '1500',
  EST_TIMEOUT_MS: '90000',
  EST_REASONING: 'low',
  REVIEW_WEEKLY_CAP: '1',
  REVIEW_NETWORK_MULT: '3',
  REVIEW_MAX_INPUT_CHARS: '16000',
  REVIEW_MAX_TOKENS: '3000',
  REVIEW_TIMEOUT_MS: '100000',
  ADMIN_ATTEMPTS_PER_HOUR: '5'
};
const cfg = (env, k) => (env[k] != null && String(env[k]).trim() !== '' ? String(env[k]).trim() : DEFAULTS[k]);
const int = (env, k) => Math.max(0, parseInt(cfg(env, k), 10) || 0);
const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v || '').trim());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES = new Set(['system', 'user', 'assistant']);

export const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10); // caps reset at 00:00 UTC
const resetAt = (now = Date.now()) => { const d = new Date(now); d.setUTCHours(24, 0, 0, 0); return d.toISOString(); };

function corsHeaders(origin) {
  return { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Device-Id, X-Owner-Token, X-Admin-Token', 'Access-Control-Expose-Headers': 'X-Coach-Remaining, X-Coach-Cap, X-Coach-Reset, X-Est-Remaining, X-Est-Cap, X-Review-Remaining, X-Food-Cache, Server-Timing', 'Access-Control-Max-Age': '86400' };
}
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
const err = (status, error, message, cors, extra = {}) => json(status, { error, message, ...extra }, cors);

/** Constant-time string compare (avoid leaking the owner token through timing). */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b); let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}
/** Keep only {role, content:string} messages; enforce count and total size. */
export function sanitise(body, env) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.messages)) return { error: ['bad_request', 'Body must be JSON with a messages array.'] };
  const max = int(env, 'MAX_MESSAGES'); const msgs = body.messages.slice(-max);
  const messages = []; let chars = 0;
  for (const m of msgs) {
    if (!m || !ROLES.has(m.role) || typeof m.content !== 'string') return { error: ['bad_request', 'Each message needs role (system|user|assistant) and string content.'] };
    chars += m.content.length; messages.push({ role: m.role, content: m.content });
  }
  if (!messages.length || !messages.some((m) => m.role === 'user')) return { error: ['bad_request', 'No user message.'] };
  if (chars > int(env, 'MAX_INPUT_CHARS')) return { error: ['too_long', `Conversation too long (${chars} chars, max ${int(env, 'MAX_INPUT_CHARS')}). Clear the chat and try again.`], status: 413 };
  const allowed = (env.ALLOWED_MODELS ? String(env.ALLOWED_MODELS) : cfg(env, 'MODEL')).split(',').map((s) => s.trim()).filter(Boolean);
  const model = typeof body.model === 'string' && allowed.includes(body.model) ? body.model : cfg(env, 'MODEL');
  return { out: { model, messages, stream: body.stream === true, max_tokens: int(env, 'MAX_TOKENS') } };
}
async function counts(env, device, ip, day) {
  const [d, i, g] = await Promise.all([env.COACH_KV.get(`d:${day}:${device}`), env.COACH_KV.get(`i:${day}:${ip}`), env.COACH_KV.get(`g:${day}`)]);
  return { d: parseInt(d || '0', 10), i: parseInt(i || '0', 10), g: parseInt(g || '0', 10) };
}
/** Network key: SHA-256(IP_SALT + ip), truncated. The raw IP is never stored or logged. */
export async function ipKey(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const salt = String(env.IP_SALT || 'grug-coach-unsalted'); // IP_SALT is a Worker secret in production
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}\u0000${ip}`)));
  return [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- Smart Estimate ----------
export const EST_PROMPT = `You estimate the nutrition of a meal for a food diary. Reply with ONLY one JSON object, no prose, no code fences:
{"items":[{"name":string,"qty":string,"grams":number,"kcal":number,"protein":number,"carbs":number,"fat":number,"fibre":number}],"confidence":"low"|"med"|"high","note":string}
Rules: one item per distinct food or drink (split mixed plates into components; cooking fats/oils/sauces as their own items when likely). qty = short human amount (e.g. "2 large eggs"). grams = estimated edible weight (ml for drinks). kcal in kilocalories; protein/carbs/fat/fibre in grams; carbs = TOTAL carbohydrate including fibre. Use typical Australian portions and standard food-composition values when the amount isn't given. confidence: how sure you are overall (portion uncertainty, hidden fats). note: ONE short line with the main assumptions (e.g. "Assumed 10 g butter and white bread"). If the input is not food or drink, return {"items":[],"confidence":"low","note":"<why>"}.`;
const n0 = (v, max) => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? Math.min(Math.round(x * 10) / 10, max) : null; };
/** Validate/normalise the model's reply. Returns null if it isn't usable JSON. */
export function parseEstimate(text) {
  if (typeof text !== 'string') return null;
  const a = text.indexOf('{'), b = text.lastIndexOf('}'); if (a < 0 || b <= a) return null;
  let j; try { j = JSON.parse(text.slice(a, b + 1)); } catch { return null; }
  if (!j || !Array.isArray(j.items)) return null;
  const items = [];
  for (const it of j.items.slice(0, 20)) {
    if (!it || typeof it.name !== 'string' || !it.name.trim()) return null;
    const kcal = n0(it.kcal, 5000), protein = n0(it.protein, 500), carbs = n0(it.carbs, 1000), fat = n0(it.fat, 500);
    if (kcal == null || protein == null || carbs == null || fat == null) return null;
    items.push({ name: it.name.trim().slice(0, 80), qty: typeof it.qty === 'string' ? it.qty.trim().slice(0, 60) : '', grams: n0(it.grams, 5000) || 0, kcal, protein, carbs, fat, fibre: Math.min(n0(it.fibre, 200) || 0, carbs) });
  }
  const confidence = ['low', 'med', 'high'].includes(j.confidence) ? j.confidence : j.confidence === 'medium' ? 'med' : 'low';
  return { items, confidence, note: typeof j.note === 'string' ? j.note.trim().slice(0, 200) : '' };
}
const DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
async function estimate(request, env, cors, ctx0) {
  const { device, ip, day, owner } = ctx0;
  const cap = int(env, 'EST_DAILY_CAP'), capNet = cap * Math.max(1, int(env, 'EST_NETWORK_MULT')), capG = int(env, 'GLOBAL_DAILY_CAP');
  const [d, i, g] = (await Promise.all([env.COACH_KV.get(`est:${day}:${device}`), env.COACH_KV.get(`esti:${day}:${ip}`), env.COACH_KV.get(`estg:${day}`)])).map((x) => parseInt(x || '0', 10));
  const remaining = owner ? null : Math.max(0, Math.min(cap - d, capNet - i));
  const h = { ...cors, 'X-Est-Remaining': owner ? 'unlimited' : String(remaining), 'X-Est-Cap': owner ? 'unlimited' : String(cap), 'X-Coach-Reset': resetAt() };
  const raw = await request.text();
  if (raw.length > int(env, 'EST_MAX_IMAGE_CHARS') + 8000) return err(413, 'too_long', 'Photo too large.', h);
  let body; try { body = JSON.parse(raw); } catch { return err(400, 'bad_request', 'Body is not valid JSON.', h); }
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 1000) : ''; const portion = typeof body?.portion === 'string' ? body.portion.trim().slice(0, 300) : '';
  const image = typeof body?.image === 'string' && body.image ? body.image : null;
  if (image && (image.length > int(env, 'EST_MAX_IMAGE_CHARS') || !DATA_URL.test(image))) return err(400, 'bad_image', 'Photo must be a JPEG/PNG/WebP under ~1 MB.', h);
  if (!text && !image) return err(400, 'bad_request', 'Describe what you ate (or add a photo).', h);
  if (!owner) {
    if (d >= cap) return err(429, 'est_limit', cap === 1 ? `You've used today's Smart Estimate.` : `You've used today's Smart Estimates.`, h, { remaining: 0, cap, resetAt: resetAt() });
    if (i >= capNet) return err(429, 'est_ip_limit', `Today's Smart Estimates for this network are used up.`, h, { remaining: 0, cap: capNet, resetAt: resetAt() });
    if (g >= capG) return err(429, 'global_limit', 'Smart Estimate is busy today. Try again tomorrow.', h, { remaining: 0, resetAt: resetAt() });
    if (env.COACH_RL) { const { success } = await env.COACH_RL.limit({ key: ip }).catch(() => ({ success: true })); if (!success) return err(429, 'rate_limited', 'Too many requests in a short time – wait a minute and try again.', h, { retryAfter: 60 }); }
  }
  const userText = [text ? `Meal: ${text}` : 'Meal: (see photo)', portion ? `Portion note: ${portion}` : ''].filter(Boolean).join('\n');
  const content = image ? [{ type: 'image_url', image_url: { url: image, detail: 'high' } }, { type: 'text', text: userText }] : userText;
  const out = { model: cfg(env, 'MODEL'), messages: [{ role: 'system', content: EST_PROMPT }, { role: 'user', content }], stream: false, max_tokens: int(env, 'EST_MAX_TOKENS') };
  if (cfg(env, 'EST_REASONING') !== 'none') out.reasoning_effort = cfg(env, 'EST_REASONING'); // 'low' keeps photo estimates ~5-15 s instead of 45-60 s
  let up;
  try { up = await fetch(cfg(env, 'UPSTREAM_URL'), { method: 'POST', signal: AbortSignal.timeout(int(env, 'EST_TIMEOUT_MS')), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.XAI_API_KEY}` }, body: JSON.stringify(out) }); }
  catch (e) { return err(504, 'upstream_unreachable', 'The estimation service did not answer in time. Nothing was used up – try again.', h); }
  if (!up.ok) { const detail = (await up.text().catch(() => '')).slice(0, 300); return err(502, 'upstream_error', `The estimation service returned HTTP ${up.status}. Nothing was used up.`, h, { upstreamStatus: up.status, detail }); }
  let reply = ''; try { reply = (await up.json())?.choices?.[0]?.message?.content || ''; } catch {}
  const est = parseEstimate(reply);
  if (!est) return err(502, 'bad_estimate', "Couldn't read the estimate. Nothing was used up – try again.", h);
  if (!est.items.length) return err(422, 'no_food', est.note || "That doesn't look like food or drink.", h);
  // only successful estimates count
  await Promise.all([owner ? null : bump(env, `est:${day}:${device}`, d + 1), owner ? null : bump(env, `esti:${day}:${ip}`, i + 1), bump(env, `estg:${day}`, g + 1)]);
  if (!owner) h['X-Est-Remaining'] = String(Math.max(0, remaining - 1));
  return json(200, { ...est, remaining: owner ? null : Math.max(0, remaining - 1), cap: owner ? null : cap, resetAt: resetAt(), owner }, h);
}
async function estStatus(env, device, ip, day, owner) {
  const cap = int(env, 'EST_DAILY_CAP'), capNet = cap * Math.max(1, int(env, 'EST_NETWORK_MULT'));
  const [d, i] = (await Promise.all([env.COACH_KV.get(`est:${day}:${device}`), env.COACH_KV.get(`esti:${day}:${ip}`)])).map((x) => parseInt(x || '0', 10));
  return { remaining: owner ? null : Math.max(0, Math.min(cap - d, capNet - i)), cap, used: d, network: { used: i, cap: capNet } };
}

// ---------- Sydney week (Grug's Review cap) ----------
const SYD = 'Australia/Sydney';
function sydParts(ts) { const o = {}; for (const p of new Intl.DateTimeFormat('en-CA', { timeZone: SYD, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ts))) o[p.type] = p.value; return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, mi: +o.minute }; }
const tzOffset = (ts) => { const p = sydParts(ts); return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - ts) / 60000) * 60000; };
/** Monday (Sydney local date) of the week containing `now`, plus when the next week starts (Mon 00:00 Sydney) as an ISO instant. */
export function sydWeek(now = Date.now()) {
  const p = sydParts(now); const local = Date.UTC(p.y, p.m - 1, p.d); const dow = (new Date(local).getUTCDay() + 6) % 7; // 0 = Monday
  const mon = local - dow * 86400000; const next = mon + 7 * 86400000;
  const nextUtc = next - tzOffset(next - 11 * 3600000);
  return { week: new Date(mon).toISOString().slice(0, 10), nextMonday: new Date(next).toISOString().slice(0, 10), resetAt: new Date(nextUtc).toISOString() };
}

// ---------- Grug's Review ----------
export const REVIEW_PROMPT = `You are Grug, the caveman fitness coach inside Lunk (a workout, nutrition and supplement tracker). Write a weekly review of the user's last 7 days from DATA (JSON, the user's own logs, already summarised).
Reply with ONLY one JSON object, no prose, no code fences:
{"scores":{"overall":n,"training":n,"nutrition":n,"consistency":n},"headline":string,"quote":string,"summary":string,"went_well":[string],"slipped":[string],"tips":[{"icon":string,"title":string,"data":string,"body":string,"action":ACTION|null}]}
- scores: 0-10 with one decimal. Anchor training and nutrition on DATA.stars.training.score/10 and DATA.stars.nutrition.score/10 (adjust by at most 1 point, only for something the stars miss). consistency = how regularly they trained (vs DATA.goals.workoutsPerWeek), logged food, hit steps and took doses. overall = a fair blend of the three.
- headline: 2-3 words, e.g. "Strong week", "Solid start", "Rough week". If DATA.prevReview exists you may compare.
- quote: one short line in Grug voice for the Home card, max 70 characters.
- summary: 2-4 short sentences in Grug caveman voice (simple words, "Grug see ...", "You lift heavy rock 4 times"), warm, specific to the numbers in DATA. No insults, no body shaming, no medical claims.
- went_well and slipped: 2-4 short tags each (max 40 characters) with concrete numbers from DATA, plain English (not caveman), e.g. "4 of 4 planned workouts", "Bench 80 → 82.5 kg × 5", "Protein hit 3/7 days". Empty array if nothing fits.
- tips: 3-5, most important first, each specific to DATA. icon = one emoji. title max 32 characters. data = one line with the user's numbers behind the tip. body = 1-2 sentences of practical advice in plain English (may start "Grug say:").
- action: at most ONE per tip, only one of these exact shapes, or null when none truly fits (never invent other types, routines or exercises; never propose something that is already the case):
  {"type":"add_food","label":"Add to tomorrow's snacks","day":"tomorrow","meal":"snacks","foods":[{"name":string,"grams":n,"kcal":n,"protein":n,"carbs":n,"fat":n}]}  (1-4 realistic options; values for that amount; carbs = total carbohydrate; day "today" or "tomorrow"; meal breakfast|lunch|dinner|snacks)
  {"type":"add_routine_set","label":"Add set to \u201cLegs A\u201d","routine":"<exact name from DATA.routines>","exercise":"<exact exercise name from that routine or DATA.workouts>","sets":1,"reps":8,"kg":90}  (kg null for bodyweight; adds that many sets of reps x kg to the routine)
  {"type":"update_targets","label":"Set protein to 170 g","kcal":n,"protein":n,"carbs":n,"fat":n}  (include only fields to change; carbs = net carbs; grams and kcal)
  {"type":"set_step_goal","label":"Set step goal to 7,000","steps":n}
  {"type":"set_workout_goal","label":"Plan 4 workouts a week","perWeek":n}
- Use DATA.units for weights/energy in text. Australian English. If there is little data, say so kindly and focus tips on logging and getting started.`;
const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const num = (v, lo, hi) => { const x = Number(v); return Number.isFinite(x) && x >= lo && x <= hi ? x : null; };
const MEALS = new Set(['breakfast', 'lunch', 'dinner', 'snacks']);
export function validAction(a) {
  if (!a || typeof a !== 'object') return null; const label = str(a.label, 48);
  if (a.type === 'add_food') {
    const foods = (Array.isArray(a.foods) ? a.foods : []).slice(0, 4).map((f) => { const name = str(f?.name, 60), grams = num(f?.grams, 1, 2000), kcal = num(f?.kcal, 0, 3000), protein = num(f?.protein, 0, 300), carbs = num(f?.carbs, 0, 500), fat = num(f?.fat, 0, 300);
      return name && grams != null && kcal != null && protein != null && carbs != null && fat != null ? { name, grams, kcal, protein, carbs, fat } : null; }).filter(Boolean);
    if (!foods.length) return null;
    return { type: 'add_food', label: label || 'Add to tomorrow\u2019s snacks', day: a.day === 'today' ? 'today' : 'tomorrow', meal: MEALS.has(a.meal) ? a.meal : 'snacks', foods };
  }
  if (a.type === 'add_routine_set') { const routine = str(a.routine, 80), exercise = str(a.exercise, 80), sets = num(a.sets, 1, 5), reps = num(a.reps, 1, 30); const kg = a.kg == null ? null : num(a.kg, 0, 500);
    if (!routine || !exercise || sets == null || reps == null || (a.kg != null && kg == null)) return null; return { type: 'add_routine_set', label: label || `Add set to \u201c${routine}\u201d`, routine, exercise, sets: Math.round(sets), reps: Math.round(reps), kg }; }
  if (a.type === 'update_targets') { const o = { type: 'update_targets', label: label || 'Update targets' }; let any = false;
    for (const [k, lo, hi] of [['kcal', 800, 6000], ['protein', 20, 400], ['carbs', 0, 800], ['fat', 10, 300]]) if (a[k] != null) { const v = num(a[k], lo, hi); if (v == null) return null; o[k] = Math.round(v); any = true; }
    return any ? o : null; }
  if (a.type === 'set_step_goal') { const v = num(a.steps, 1000, 50000); return v == null ? null : { type: 'set_step_goal', label: label || `Set step goal to ${Math.round(v)}`, steps: Math.round(v / 100) * 100 }; }
  if (a.type === 'set_workout_goal') { const v = num(a.perWeek, 1, 7); return v == null ? null : { type: 'set_workout_goal', label: label || `Plan ${Math.round(v)} workouts a week`, perWeek: Math.round(v) }; }
  return null;
}
export function parseReview(text) {
  if (typeof text !== 'string') return null;
  const a = text.indexOf('{'), b = text.lastIndexOf('}'); if (a < 0 || b <= a) return null;
  let j; try { j = JSON.parse(text.slice(a, b + 1)); } catch { return null; }
  if (!j || typeof j !== 'object' || !j.scores) return null;
  const sc = {}; for (const k of ['overall', 'training', 'nutrition', 'consistency']) { const v = num(j.scores[k], 0, 10); if (v == null) return null; sc[k] = Math.round(v * 10) / 10; }
  const summary = str(j.summary, 700); if (!summary) return null;
  const tags = (x) => (Array.isArray(x) ? x : []).map((t) => str(t, 60)).filter(Boolean).slice(0, 5);
  const tips = (Array.isArray(j.tips) ? j.tips : []).slice(0, 5).map((t) => { const title = str(t?.title, 48), body = str(t?.body, 400); return title && body ? { icon: str(t.icon, 8) || '💡', title, data: str(t.data, 200) || '', body, action: validAction(t.action) } : null; }).filter(Boolean);
  if (!tips.length) return null;
  return { scores: sc, headline: str(j.headline, 40) || 'Your week', quote: str(j.quote, 90) || '', summary, went_well: tags(j.went_well), slipped: tags(j.slipped), tips };
}
async function review(request, env, cors, ctx0) {
  const { device, ip, owner } = ctx0; const w = sydWeek();
  const cap = int(env, 'REVIEW_WEEKLY_CAP'), capNet = cap * Math.max(1, int(env, 'REVIEW_NETWORK_MULT')), capG = int(env, 'GLOBAL_DAILY_CAP'), day = today();
  const [d, i, g] = (await Promise.all([env.COACH_KV.get(`rv:${w.week}:${device}`), env.COACH_KV.get(`rvi:${w.week}:${ip}`), env.COACH_KV.get(`rvg:${day}`)])).map((x) => parseInt(x || '0', 10));
  const remaining = owner ? null : Math.max(0, Math.min(cap - d, capNet - i));
  const h = { ...cors, 'X-Review-Remaining': owner ? 'unlimited' : String(remaining) };
  const meta = { cap, resetAt: w.resetAt, nextMonday: w.nextMonday, week: w.week };
  const raw = await request.text();
  if (raw.length > int(env, 'REVIEW_MAX_INPUT_CHARS') + 2000) return err(413, 'too_long', 'Too much data for one review.', h);
  let body; try { body = JSON.parse(raw); } catch { return err(400, 'bad_request', 'Body is not valid JSON.', h); }
  if (!body || typeof body.data !== 'object' || body.data == null) return err(400, 'bad_request', 'Missing data.', h);
  const data = JSON.stringify(body.data); if (data.length > int(env, 'REVIEW_MAX_INPUT_CHARS')) return err(413, 'too_long', 'Too much data for one review.', h);
  if (!owner) {
    if (d >= cap) return err(429, 'review_limit', "You've used this week's free review.", h, { remaining: 0, ...meta });
    if (i >= capNet) return err(429, 'review_ip_limit', "This week's free reviews for this network are used up.", h, { remaining: 0, ...meta, cap: capNet });
    if (g >= capG) return err(429, 'global_limit', 'Grug is busy today. Try again tomorrow.', h, { remaining: 0, ...meta });
    if (env.COACH_RL) { const { success } = await env.COACH_RL.limit({ key: ip }).catch(() => ({ success: true })); if (!success) return err(429, 'rate_limited', 'Too many requests in a short time – wait a minute and try again.', h, { retryAfter: 60 }); }
  }
  const out = { model: cfg(env, 'MODEL'), messages: [{ role: 'system', content: REVIEW_PROMPT }, { role: 'user', content: `DATA:\n${data}` }], stream: false, max_tokens: int(env, 'REVIEW_MAX_TOKENS') };
  if (cfg(env, 'EST_REASONING') !== 'none') out.reasoning_effort = cfg(env, 'EST_REASONING');
  let up;
  try { up = await fetch(cfg(env, 'UPSTREAM_URL'), { method: 'POST', signal: AbortSignal.timeout(int(env, 'REVIEW_TIMEOUT_MS')), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.XAI_API_KEY}` }, body: JSON.stringify(out) }); }
  catch (e) { return err(504, 'upstream_unreachable', 'Grug took too long. Nothing was used up – try again.', h); }
  if (!up.ok) { const detail = (await up.text().catch(() => '')).slice(0, 300); return err(502, 'upstream_error', `The review service returned HTTP ${up.status}. Nothing was used up.`, h, { upstreamStatus: up.status, detail }); }
  let reply = ''; try { reply = (await up.json())?.choices?.[0]?.message?.content || ''; } catch {}
  const rv = parseReview(reply);
  if (!rv) return err(502, 'bad_review', "Grug's notes came out scrambled. Nothing was used up – try again.", h);
  await Promise.all([owner ? null : bump(env, `rv:${w.week}:${device}`, d + 1, 9), owner ? null : bump(env, `rvi:${w.week}:${ip}`, i + 1, 9), bump(env, `rvg:${day}`, g + 1)]);
  if (!owner) h['X-Review-Remaining'] = String(Math.max(0, remaining - 1));
  return json(200, { review: rv, remaining: owner ? null : Math.max(0, remaining - 1), owner, ...meta }, h);
}
async function reviewStatus(env, device, ip, owner) {
  const w = sydWeek(); const cap = int(env, 'REVIEW_WEEKLY_CAP'), capNet = cap * Math.max(1, int(env, 'REVIEW_NETWORK_MULT'));
  const [d, i] = (await Promise.all([env.COACH_KV.get(`rv:${w.week}:${device}`), env.COACH_KV.get(`rvi:${w.week}:${ip}`)])).map((x) => parseInt(x || '0', 10));
  return { remaining: owner ? null : Math.max(0, Math.min(cap - d, capNet - i)), cap, used: d, network: { used: i, cap: capNet }, week: w.week, nextMonday: w.nextMonday, resetAt: w.resetAt };
}

// ---------- admin code ----------
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
export const normaliseCode = (c) => String(c || '').trim().toUpperCase();
export const adminCodeHash = (salt, code) => sha256(`${salt}:${normaliseCode(code)}`);
/** Is X-Admin-Token a live token issued to this device? */
async function isAdmin(request, env, device) {
  const t = request.headers.get('X-Admin-Token') || ''; if (!/^[0-9a-f]{64}$/.test(t) || !env.COACH_KV) return false;
  const rec = await env.COACH_KV.get(`adm:tok:${await sha256(t)}`); if (!rec) return false;
  try { return JSON.parse(rec).device === device; } catch { return false; }
}
async function admin(request, env, cors, url, device, ip) {
  let body = {}; try { body = JSON.parse((await request.text()).slice(0, 2000) || '{}'); } catch {}
  if (url.pathname === '/admin/remove') {
    const t = request.headers.get('X-Admin-Token') || ''; if (/^[0-9a-f]{64}$/.test(t)) { const k = `adm:tok:${await sha256(t)}`; const rec = await env.COACH_KV.get(k); if (rec && JSON.parse(rec).device === device) await env.COACH_KV.delete(k); }
    return json(200, { removed: true }, cors);
  }
  if (!env.ADMIN_CODE_HASH || !env.ADMIN_SALT) return err(503, 'admin_off', 'Admin codes are not set up.', cors);
  const hr = new Date().toISOString().slice(0, 13); const max = int(env, 'ADMIN_ATTEMPTS_PER_HOUR');
  const kd = `adm:try:${hr}:d:${device}`, ki = `adm:try:${hr}:i:${ip}`;
  const [nd, ni] = (await Promise.all([env.COACH_KV.get(kd), env.COACH_KV.get(ki)])).map((x) => parseInt(x || '0', 10));
  if (nd >= max || ni >= max) return err(429, 'too_many_attempts', 'Too many attempts. Try again in an hour.', cors, { retryAfter: 3600 });
  await Promise.all([env.COACH_KV.put(kd, String(nd + 1), { expirationTtl: 7200 }), env.COACH_KV.put(ki, String(ni + 1), { expirationTtl: 7200 })]);
  const code = typeof body.code === 'string' ? body.code.slice(0, 200) : '';
  const ok = !!code.trim() && safeEqual(await adminCodeHash(String(env.ADMIN_SALT), code), String(env.ADMIN_CODE_HASH).trim().toLowerCase());
  if (!ok) return err(401, 'bad_code', 'Code not recognised.', cors);
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  await env.COACH_KV.put(`adm:tok:${await sha256(token)}`, JSON.stringify({ device, created: Date.now() }), { expirationTtl: 400 * 86400 });
  return json(200, { token, admin: true }, cors);
}
// ---------- v1.12.0 Leaderboard ----------
// One KV key per opted-in device: `lb:e:<deviceId>`. The entry (username + this Sydney day's and week's Grug rating) is stored as the
// value AND as KV metadata, so GET /leaderboard is a single list() call. Only a username and two 0-100 integers are ever stored.
// Scores are computed on the phone (same maths as the Home stars), so the server can only check shape and range, not truth.
// v1.12.1: the board ranks the TRAINING score only. Entries live under a new prefix, so v1.12.0 combined (training+nutrition) entries
// under `lb:e:` are never read again (they expire via their TTL); submits must say kind:"training", older app versions' submits are
// acknowledged but not stored, so they can't mix combined scores into the board.
export const LB_PREFIX = 'lb2:e:';
export const LB_OLD_PREFIX = 'lb:e:';
export const LB_KIND = 'training';
const pad2 = (n) => String(n).padStart(2, '0');
const addDaysStr = (d, n) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
/** Sydney local date (YYYY-MM-DD). */
export const sydDay = (now = Date.now()) => { const p = sydParts(now); return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`; };
/** Current and previous leaderboard periods (Sydney day; Sydney week = its Monday). */
export function lbPeriods(now = Date.now()) { const day = sydDay(now), week = sydWeek(now).week; return { day, prevDay: addDaysStr(day, -1), week, prevWeek: addDaysStr(week, -7) }; }
// control chars (C0/C1), zero-width, bidi overrides/isolates, line/paragraph separators, BOM
const LB_CTRL = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g;
/** Trim, strip control/invisible characters, collapse spaces; 1–20 characters or null. */
export function cleanLbName(v) {
  if (typeof v !== 'string') return null;
  const s = v.normalize('NFC').replace(LB_CTRL, '').replace(/\s+/g, ' ').trim(); const n = [...s].length;
  return n >= 1 && n <= 20 ? s : null;
}
const lbScore = (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100 ? v : null);
export const lbStars = (score) => (score >= 90 ? 5 : score >= 75 ? 4 : score >= 60 ? 3 : score >= 40 ? 2 : 1); // same as the app's starsFor
const YMD = /^\d{4}-\d\d-\d\d$/;
/** Validate a submit body. Returns { error } or { name, daily: {date, score}|null, weekly: {week, score}|null }. */
export function validSubmit(body, device, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Body must be a JSON object.' };
  if (body.deviceId != null && body.deviceId !== device) return { error: 'deviceId does not match X-Device-Id.' };
  const allowed = new Set(['deviceId', 'username', 'daily', 'weekly', 'kind']); for (const k of Object.keys(body)) if (!allowed.has(k)) return { error: `Unexpected field "${k}".` };
  if (body.kind != null && body.kind !== LB_KIND) return { error: 'kind must be "training".' };
  const name = cleanLbName(body.username); if (!name) return { error: 'Username must be 1–20 characters.' };
  const P = lbPeriods(now); let daily = null, weekly = null;
  if (body.daily != null) {
    const d = body.daily; if (typeof d !== 'object' || Object.keys(d).some((k) => k !== 'score' && k !== 'date')) return { error: 'daily must be {score, date}.' };
    const sc = lbScore(d.score); if (sc == null) return { error: 'daily.score must be an integer 0–100.' };
    if (typeof d.date !== 'string' || !YMD.test(d.date) || (d.date !== P.day && d.date !== P.prevDay)) return { error: 'daily.date must be today or yesterday (Sydney).' };
    daily = { date: d.date, score: sc };
  }
  if (body.weekly != null) {
    const w = body.weekly; if (typeof w !== 'object' || Object.keys(w).some((k) => k !== 'score' && k !== 'weekKey')) return { error: 'weekly must be {score, weekKey}.' };
    const sc = lbScore(w.score); if (sc == null) return { error: 'weekly.score must be an integer 0–100.' };
    if (typeof w.weekKey !== 'string' || !YMD.test(w.weekKey) || (w.weekKey !== P.week && w.weekKey !== P.prevWeek)) return { error: 'weekly.weekKey must be this or last week (Sydney Monday).' };
    weekly = { week: w.weekKey, score: sc };
  }
  if (!daily && !weekly) return { error: 'Send daily and/or weekly.' };
  return { name, daily, weekly };
}
/** Merge a valid submit into the stored entry (never replaces a newer period with an older one). Entry: {u, d:[date,score]|null, w:[week,score]|null, t}. */
export function mergeEntry(old, sub, now = Date.now()) {
  const e = { u: sub.name, d: old?.d || null, w: old?.w || null, t: now };
  if (sub.daily && (!e.d || sub.daily.date >= e.d[0])) e.d = [sub.daily.date, sub.daily.score];
  if (sub.weekly && (!e.w || sub.weekly.week >= e.w[0])) e.w = [sub.weekly.week, sub.weekly.score];
  return e;
}
/** Rank rows ({id, u, score}) for one period: score desc, ties share a rank (1,1,3) and are listed by name; duplicate names get a short tag. */
export function rankRows(rows, tagOf) {
  const sorted = [...rows].sort((a, b) => b.score - a.score || a.u.localeCompare(b.u, 'en', { sensitivity: 'base' }) || (a.id < b.id ? -1 : 1));
  const count = new Map(); for (const r of sorted) { const k = r.u.toLocaleLowerCase('en'); count.set(k, (count.get(k) || 0) + 1); }
  let rank = 0, prev = null;
  return sorted.map((r, i) => { if (r.score !== prev) { rank = i + 1; prev = r.score; } const dup = count.get(r.u.toLocaleLowerCase('en')) > 1;
    return { id: r.id, rank, name: dup ? `${r.u} #${tagOf(r.id)}` : r.u, score: r.score, stars: lbStars(r.score) }; });
}
const LB_DEFAULTS = { LB_SUBMITS_PER_HOUR: 20, LB_NETWORK_SUBMITS_PER_HOUR: 60, LB_TOP: 50, LB_TTL_DAYS: 21 };
const lbInt = (env, k) => { const v = parseInt(env[k], 10); return Number.isFinite(v) && v >= 0 ? v : LB_DEFAULTS[k]; };
let lbCache = null; // per-isolate cache of the full list (KV list() is itself eventually consistent, ~60 s)
async function lbListAll(env) {
  if (lbCache && Date.now() - lbCache.at < 15000) return lbCache.rows;
  const rows = []; let cursor;
  for (let page = 0; page < 10; page++) {
    const res = await env.COACH_KV.list({ prefix: LB_PREFIX, cursor, limit: 1000 });
    for (const k of res.keys) if (k.metadata && typeof k.metadata.u === 'string') rows.push({ id: k.name.slice(LB_PREFIX.length), ...k.metadata });
    if (res.list_complete || !res.cursor) break; cursor = res.cursor;
  }
  lbCache = { at: Date.now(), rows }; return rows;
}
async function lbRate(env, device, ip, owner) {
  if (owner) return null;
  const hr = new Date().toISOString().slice(0, 13); const kd = `lbs:${hr}:d:${device}`, ki = `lbs:${hr}:i:${ip}`;
  const [nd, ni] = (await Promise.all([env.COACH_KV.get(kd), env.COACH_KV.get(ki)])).map((x) => parseInt(x || '0', 10));
  if (nd >= lbInt(env, 'LB_SUBMITS_PER_HOUR')) return 'lb_rate_limited';
  if (ni >= lbInt(env, 'LB_NETWORK_SUBMITS_PER_HOUR')) return 'lb_ip_rate_limited';
  await Promise.all([env.COACH_KV.put(kd, String(nd + 1), { expirationTtl: 7200 }), env.COACH_KV.put(ki, String(ni + 1), { expirationTtl: 7200 })]);
  return null;
}
async function leaderboard(request, env, cors, url, device, ip, owner) {
  const key = LB_PREFIX + device; const now = Date.now();
  if (url.pathname === '/leaderboard/submit' && request.method === 'POST') {
    const raw = await request.text(); if (raw.length > 2000) return err(413, 'too_long', 'Request too large.', cors);
    let body; try { body = JSON.parse(raw); } catch { return err(400, 'bad_request', 'Body is not valid JSON.', cors); }
    const v = validSubmit(body, device, now); if (v.error) return err(400, 'bad_request', v.error, cors);
    // v1.12.0 clients send combined scores without `kind`: accept quietly (so they don't retry) but never store them
    if (body.kind !== LB_KIND) return json(200, { ok: true, joined: false, stored: false, reason: 'outdated_app', kind: LB_KIND }, cors);
    const lim = await lbRate(env, device, ip, owner); if (lim) return err(429, lim, lim === 'lb_ip_rate_limited' ? 'Too many leaderboard updates from this network. Try again later.' : 'Too many leaderboard updates. Try again later.', cors, { retryAfter: 3600 });
    let old = null; try { old = JSON.parse((await env.COACH_KV.get(key)) || 'null'); } catch {}
    const e = mergeEntry(old, v, now);
    const same = old && old.u === e.u && JSON.stringify(old.d) === JSON.stringify(e.d) && JSON.stringify(old.w) === JSON.stringify(e.w) && now - (old.t || 0) < 86400000;
    if (!same) { const s = JSON.stringify(e); await env.COACH_KV.put(key, s, { metadata: e, expirationTtl: lbInt(env, 'LB_TTL_DAYS') * 86400 }); lbCache = null; }
    return json(200, { ok: true, joined: true, stored: true, kind: LB_KIND, entry: { username: e.u, daily: e.d && { date: e.d[0], score: e.d[1] }, weekly: e.w && { weekKey: e.w[0], score: e.w[1] } } }, cors);
  }
  if (url.pathname === '/leaderboard/leave' && request.method === 'POST') { await Promise.all([env.COACH_KV.delete(key), env.COACH_KV.delete(LB_OLD_PREFIX + device)]); lbCache = null; return json(200, { ok: true, joined: false }, cors); }
  if (url.pathname === '/leaderboard' && request.method === 'GET') {
    const period = url.searchParams.get('period') || 'weekly'; if (period !== 'weekly' && period !== 'daily') return err(400, 'bad_request', 'period must be weekly or daily.', cors);
    const P = lbPeriods(now); const pk = period === 'weekly' ? P.week : P.day; const f = period === 'weekly' ? 'w' : 'd';
    const all = (await lbListAll(env)).filter((r) => r.id !== device);
    // the caller's own entry is read directly (fresher than list()), so their row is right straight after a submit or leave
    let mine = null; try { mine = JSON.parse((await env.COACH_KV.get(key)) || 'null'); } catch {}
    if (mine) all.push({ id: device, ...mine });
    const rows = all.filter((r) => Array.isArray(r[f]) && r[f][0] === pk && lbScore(r[f][1]) != null && cleanLbName(r.u)).map((r) => ({ id: r.id, u: cleanLbName(r.u), score: r[f][1] }));
    const salt = String(env.IP_SALT || 'grug-coach-unsalted'); const tags = new Map();
    for (const r of rows) tags.set(r.id, (await sha256(`lbtag\u0000${salt}\u0000${r.id}`)).slice(0, 4));
    const ranked = rankRows(rows, (id) => tags.get(id));
    const out = (r) => ({ rank: r.rank, name: r.name, score: r.score, stars: r.stars, ...(r.id === device ? { me: true } : {}) });
    const meRow = ranked.find((r) => r.id === device);
    return json(200, { period, kind: LB_KIND, key: pk, total: ranked.length, top: ranked.slice(0, lbInt(env, 'LB_TOP')).map(out), me: meRow ? out(meRow) : null, joined: !!mine,
      ...(period === 'weekly' ? { resetAt: sydWeek(now).resetAt } : {}) }, cors);
  }
  return err(404, 'not_found', 'Use GET /leaderboard?period=weekly|daily, POST /leaderboard/submit or /leaderboard/leave.', cors);
}
const bump = (env, key, v, days = 3) => env.COACH_KV.put(key, String(v), { expirationTtl: days * 86400 });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url); const origin = request.headers.get('Origin') || '';
    const allow = cfg(env, 'ALLOWED_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean);
    if (!origin || !allow.includes(origin)) return err(403, 'origin_not_allowed', 'This proxy only serves the Lunk app.', {});
    const cors = corsHeaders(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (truthy(env.KILL_SWITCH)) return err(503, 'disabled', 'The coach is switched off for now.', cors);
    if (!env.COACH_KV) return err(500, 'misconfigured', 'KV namespace COACH_KV is not bound.', cors);

    const device = request.headers.get('X-Device-Id') || '';
    if (!UUID.test(device)) return err(400, 'bad_device', 'Missing or invalid X-Device-Id (random UUID).', cors);
    const ownerTok = !!env.OWNER_TOKEN && safeEqual(request.headers.get('X-Owner-Token') || '', String(env.OWNER_TOKEN));
    const adminTok = !ownerTok && await isAdmin(request, env, device);
    const owner = ownerTok || adminTok; // admin tokens bypass every cap exactly like the owner token
    const day = today(); const capD = int(env, 'DEVICE_DAILY_CAP'), capI = int(env, 'IP_DAILY_CAP'), capG = int(env, 'GLOBAL_DAILY_CAP');
    const ip = await ipKey(request, env);
    if ((url.pathname === '/admin' || url.pathname === '/admin/remove') && request.method === 'POST') return admin(request, env, cors, url, device, ip);
    // v1.12.0 leaderboard: never touches chat / estimate / review counters and needs no xAI key
    if (url.pathname === '/leaderboard' || url.pathname.startsWith('/leaderboard/')) return leaderboard(request, env, cors, url, device, ip, owner);
    // v1.13.0 food lookups (Open Food Facts, edge-cached): no xAI key, no coach counters
    if (url.pathname.startsWith('/food/')) return food(request, env, cors, url, ip, owner);
    const c = await counts(env, device, ip, day);
    const remaining = owner ? null : Math.max(0, Math.min(capD - c.d, capI - c.i, capG - c.g));
    const limitHeaders = { 'X-Coach-Remaining': owner ? 'unlimited' : String(remaining), 'X-Coach-Cap': owner ? 'unlimited' : String(capD), 'X-Coach-Reset': resetAt() };

    if (url.pathname === '/status' && request.method === 'GET')
      return json(200, { enabled: true, owner, remaining: owner ? null : remaining, cap: capD, used: c.d, network: { used: c.i, cap: capI }, resetAt: resetAt(), model: cfg(env, 'MODEL'), admin: adminTok, estimate: await estStatus(env, device, ip, day, owner), review: await reviewStatus(env, device, ip, owner) }, { ...cors, ...limitHeaders });
    if (!['/chat', '/estimate', '/review'].includes(url.pathname) || request.method !== 'POST') return err(404, 'not_found', 'Use POST /chat, /estimate, /review, /admin, GET /status or /leaderboard.', cors);
    if (!env.XAI_API_KEY) return err(500, 'misconfigured', 'XAI_API_KEY secret is not set.', cors);
    if (url.pathname === '/estimate') return estimate(request, env, cors, { device, ip, day, owner });
    if (url.pathname === '/review') return review(request, env, cors, { device, ip, owner });

    const raw = await request.text();
    if (raw.length > int(env, 'MAX_INPUT_CHARS') * 2 + 4000) return err(413, 'too_long', 'Request too large.', cors);
    let body; try { body = JSON.parse(raw); } catch { return err(400, 'bad_request', 'Body is not valid JSON.', cors); }
    const s = sanitise(body, env); if (s.error) return err(s.status || 400, s.error[0], s.error[1], cors);

    if (!owner) {
      if (c.d >= capD) return err(429, 'device_limit', `Daily limit reached (${capD} messages). It resets at midnight UTC.`, { ...cors, ...limitHeaders }, { remaining: 0, cap: capD, resetAt: resetAt() });
      if (c.i >= capI) return err(429, 'ip_limit', `Daily coach limit reached for this network (${capI} messages). It resets at midnight UTC.`, { ...cors, ...limitHeaders }, { remaining: 0, cap: capI, resetAt: resetAt() });
      if (c.g >= capG) return err(429, 'global_limit', 'The coach is busy today (shared daily limit reached). Try again tomorrow.', { ...cors, ...limitHeaders }, { remaining: 0, resetAt: resetAt() });
    }
    if (!owner && env.COACH_RL) { // Workers Rate Limiting binding: short-burst protection per network
      const { success } = await env.COACH_RL.limit({ key: ip }).catch(() => ({ success: true }));
      if (!success) return err(429, 'rate_limited', 'Too many messages in a short time – wait a minute and try again.', { ...cors, ...limitHeaders }, { retryAfter: 60 });
    }
    // count before forwarding (KV is eventually consistent, so caps are approximate under bursts; see README)
    await Promise.all([owner ? null : bump(env, `d:${day}:${device}`, c.d + 1), owner ? null : bump(env, `i:${day}:${ip}`, c.i + 1), bump(env, `g:${day}`, c.g + 1)]);
    if (!owner) limitHeaders['X-Coach-Remaining'] = String(Math.max(0, remaining - 1));

    let up;
    try {
      up = await fetch(cfg(env, 'UPSTREAM_URL'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.XAI_API_KEY}` }, body: JSON.stringify(s.out) });
    } catch (e) { return err(502, 'upstream_unreachable', 'Could not reach xAI.', { ...cors, ...limitHeaders }); }
    if (!up.ok) {
      const detail = (await up.text().catch(() => '')).slice(0, 300);
      return err(502, 'upstream_error', `xAI returned HTTP ${up.status}.`, { ...cors, ...limitHeaders }, { upstreamStatus: up.status, detail });
    }
    if (s.out.stream) return new Response(up.body, { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', ...cors, ...limitHeaders } });
    return new Response(up.body, { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors, ...limitHeaders } });
  }
};
