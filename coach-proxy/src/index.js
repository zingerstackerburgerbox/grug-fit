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
 */
const DEFAULTS = {
  MODEL: 'grok-4.7',
  UPSTREAM_URL: 'https://api.x.ai/v1/chat/completions',
  ALLOWED_ORIGINS: 'https://zingerstackerburgerbox.github.io,http://localhost:5173,http://localhost:4173,http://127.0.0.1:5173,http://127.0.0.1:4173',
  DEVICE_DAILY_CAP: '30',
  IP_DAILY_CAP: '60',
  GLOBAL_DAILY_CAP: '500',
  MAX_INPUT_CHARS: '24000',
  MAX_MESSAGES: '40',
  MAX_TOKENS: '1200',
  EST_DAILY_CAP: '3',
  EST_NETWORK_MULT: '3',
  EST_MAX_IMAGE_CHARS: '1500000',
  EST_MAX_TOKENS: '1500',
  EST_TIMEOUT_MS: '90000',
  EST_REASONING: 'low'
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
    'Access-Control-Allow-Headers': 'Content-Type, X-Device-Id, X-Owner-Token', 'Access-Control-Expose-Headers': 'X-Coach-Remaining, X-Coach-Cap, X-Coach-Reset, X-Est-Remaining, X-Est-Cap', 'Access-Control-Max-Age': '86400' };
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
const bump = (env, key, v) => env.COACH_KV.put(key, String(v), { expirationTtl: 3 * 86400 });

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
    const owner = !!env.OWNER_TOKEN && safeEqual(request.headers.get('X-Owner-Token') || '', String(env.OWNER_TOKEN));
    const day = today(); const capD = int(env, 'DEVICE_DAILY_CAP'), capI = int(env, 'IP_DAILY_CAP'), capG = int(env, 'GLOBAL_DAILY_CAP');
    const ip = await ipKey(request, env); const c = await counts(env, device, ip, day);
    const remaining = owner ? null : Math.max(0, Math.min(capD - c.d, capI - c.i, capG - c.g));
    const limitHeaders = { 'X-Coach-Remaining': owner ? 'unlimited' : String(remaining), 'X-Coach-Cap': owner ? 'unlimited' : String(capD), 'X-Coach-Reset': resetAt() };

    if (url.pathname === '/status' && request.method === 'GET')
      return json(200, { enabled: true, owner, remaining: owner ? null : remaining, cap: capD, used: c.d, network: { used: c.i, cap: capI }, resetAt: resetAt(), model: cfg(env, 'MODEL'), estimate: await estStatus(env, device, ip, day, owner) }, { ...cors, ...limitHeaders });
    if (!['/chat', '/estimate'].includes(url.pathname) || request.method !== 'POST') return err(404, 'not_found', 'Use POST /chat, POST /estimate or GET /status.', cors);
    if (!env.XAI_API_KEY) return err(500, 'misconfigured', 'XAI_API_KEY secret is not set.', cors);
    if (url.pathname === '/estimate') return estimate(request, env, cors, { device, ip, day, owner });

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
