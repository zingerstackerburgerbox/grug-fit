/**
 * Grug Fit AI Coach proxy (Cloudflare Worker).
 * Holds the xAI API key as a Worker secret and forwards sanitised chat requests to xAI, with abuse controls:
 * Origin allowlist + CORS, per-device, per-network (salted SHA-256 of CF-Connecting-IP; raw IPs are never stored) and global
 * daily caps (Workers KV), an optional per-minute rate limit (Workers Rate Limiting binding COACH_RL), input/output size caps, a kill switch,
 * and an optional OWNER_TOKEN bypass. Only `messages`, `model` (allowlisted) and `stream` are taken from the client.
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
  MAX_TOKENS: '1200'
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
    'Access-Control-Allow-Headers': 'Content-Type, X-Device-Id, X-Owner-Token', 'Access-Control-Expose-Headers': 'X-Coach-Remaining, X-Coach-Cap, X-Coach-Reset', 'Access-Control-Max-Age': '86400' };
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
const bump = (env, key, v) => env.COACH_KV.put(key, String(v), { expirationTtl: 3 * 86400 });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url); const origin = request.headers.get('Origin') || '';
    const allow = cfg(env, 'ALLOWED_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean);
    if (!origin || !allow.includes(origin)) return err(403, 'origin_not_allowed', 'This proxy only serves the Grug Fit app.', {});
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
      return json(200, { enabled: true, owner, remaining: owner ? null : remaining, cap: capD, used: c.d, network: { used: c.i, cap: capI }, resetAt: resetAt(), model: cfg(env, 'MODEL') }, { ...cors, ...limitHeaders });
    if (url.pathname !== '/chat' || request.method !== 'POST') return err(404, 'not_found', 'Use POST /chat or GET /status.', cors);
    if (!env.XAI_API_KEY) return err(500, 'misconfigured', 'XAI_API_KEY secret is not set.', cors);

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
