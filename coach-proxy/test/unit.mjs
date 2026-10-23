// Unit test of the Worker's fetch handler in plain Node (mock KV + mock upstream). Run: node test/unit.mjs
import worker from '../src/index.js';
import { startMock } from './mock-upstream.mjs';
let failed = 0; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) failed++; };
const kv = new Map(); const KV = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } };
const { srv, seen } = await startMock(8788);
const env = (o = {}) => ({ COACH_KV: KV, XAI_API_KEY: 'sk-test', OWNER_TOKEN: 'owner-secret', UPSTREAM_URL: 'http://127.0.0.1:8788/v1/chat/completions', DEVICE_DAILY_CAP: '3', GLOBAL_DAILY_CAP: '5', ...o });
const DEV = '3f0b6a8e-1c2d-4e5f-8a9b-0c1d2e3f4a5b', DEV2 = '7a1b2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d';
const ORIGIN = 'https://zingerstackerburgerbox.github.io';
const req = (path, { method = 'POST', origin = ORIGIN, device = DEV, owner, body } = {}) => new Request('https://proxy.test' + path, { method, headers: { ...(origin ? { Origin: origin } : {}), ...(device ? { 'X-Device-Id': device } : {}), ...(owner ? { 'X-Owner-Token': owner } : {}), 'Content-Type': 'application/json' }, body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
const chat = (o = {}) => ({ messages: [{ role: 'system', content: 'You are a coach' }, { role: 'user', content: 'hi' }], ...o });
const call = async (r, e = env()) => { const res = await worker.fetch(r, e, {}); let j = null; const t = await res.text(); try { j = JSON.parse(t); } catch {} return { res, j, t }; };

let r = await call(req('/chat', { origin: 'https://evil.example', body: chat() })); ok(r.res.status === 403 && r.j.error === 'origin_not_allowed', 'foreign Origin rejected');
r = await call(req('/chat', { origin: null, body: chat() })); ok(r.res.status === 403, 'missing Origin rejected (curl/scripts)');
r = await call(req('/chat', { method: 'OPTIONS' })); ok(r.res.status === 204 && r.res.headers.get('access-control-allow-origin') === ORIGIN && /X-Device-Id/.test(r.res.headers.get('access-control-allow-headers')), 'CORS preflight for allowed origin');
r = await call(req('/chat', { body: chat() }), env({ KILL_SWITCH: 'true' })); ok(r.res.status === 503 && r.j.error === 'disabled', 'KILL_SWITCH → 503 disabled');
r = await call(req('/chat', { device: 'not-a-uuid', body: chat() })); ok(r.res.status === 400 && r.j.error === 'bad_device', 'invalid device id rejected');
r = await call(req('/chat', { body: '{nope' })); ok(r.res.status === 400 && r.j.error === 'bad_request', 'bad JSON rejected');
r = await call(req('/chat', { body: chat({ messages: [{ role: 'user', content: 'x'.repeat(30000) }] }) })); ok(r.res.status === 413 && r.j.error === 'too_long', 'oversized input → 413');
r = await call(req('/chat', { body: chat({ messages: [{ role: 'tool', content: 'x' }] }) })); ok(r.res.status === 400, 'unknown role rejected');
// sanitising: extra fields stripped, model allowlisted, max_tokens forced
r = await call(req('/chat', { body: chat({ model: 'some-expensive-model', max_tokens: 99999, temperature: 2, tools: [{}], user: 'x', messages: [{ role: 'user', content: 'hi', name: 'x', extra: 1 }] }) }));
const up = seen.at(-1); ok(r.res.status === 200 && r.j.choices[0].message.content.startsWith('Mock'), 'non-stream reply passed through');
ok(up.auth === 'Bearer sk-test', 'upstream gets the secret key (never the client)');
ok(JSON.stringify(Object.keys(up.body).sort()) === JSON.stringify(['max_tokens', 'messages', 'model', 'stream']) && up.body.model === 'grok-4.7' && up.body.max_tokens === 1200 && JSON.stringify(up.body.messages) === '[{"role":"user","content":"hi"}]', 'body stripped to messages/model/stream + capped max_tokens: ' + JSON.stringify(up.body));
ok(r.res.headers.get('x-coach-remaining') === '2', 'remaining header after 1 message = 2 (cap 3)');
// streaming passthrough
r = await worker.fetch(req('/chat', { body: chat({ stream: true }) }), env(), {}); const sse = await r.text();
ok(r.status === 200 && /text\/event-stream/.test(r.headers.get('content-type')) && sse.includes('data: [DONE]') && sse.includes('"delta"'), 'SSE stream passthrough');
// device cap: 3rd message ok, 4th refused
r = await call(req('/chat', { body: chat() })); ok(r.res.status === 200 && r.res.headers.get('x-coach-remaining') === '0', '3rd message allowed, remaining 0');
r = await call(req('/chat', { body: chat() })); ok(r.res.status === 429 && r.j.error === 'device_limit' && r.j.remaining === 0, 'per-device daily cap → 429 device_limit');
r = await call(req('/status', { method: 'GET' })); ok(r.j.remaining === 0 && r.j.cap === 3 && r.j.used === 3, '/status reports remaining 0');
// owner bypass
r = await call(req('/chat', { owner: 'owner-secret', body: chat() })); ok(r.res.status === 200 && r.res.headers.get('x-coach-remaining') === 'unlimited', 'OWNER_TOKEN bypasses the device cap');
r = await call(req('/chat', { owner: 'wrong', body: chat() })); ok(r.res.status === 429, 'wrong owner token does not bypass');
// global cap (5): 4 counted so far (3 device + 1 owner)
r = await call(req('/chat', { device: DEV2, body: chat() })); ok(r.res.status === 200, 'second device allowed (global 5th)');
r = await call(req('/chat', { device: DEV2, body: chat() })); ok(r.res.status === 429 && r.j.error === 'global_limit', 'global daily cap → 429 global_limit');
// upstream error mapping
kv.clear(); r = await call(req('/chat', { body: chat({ messages: [{ role: 'user', content: 'UPSTREAM_FAIL' }] }) })); ok(r.res.status === 502 && r.j.error === 'upstream_error' && r.j.upstreamStatus === 500, 'upstream 500 → 502 upstream_error');
r = await call(req('/chat', { body: chat() }), env({ XAI_API_KEY: '' })); ok(r.res.status === 500 && r.j.error === 'misconfigured', 'missing secret → misconfigured');
ok([...kv.keys()].every((k) => /^(d|g):\d{4}-\d\d-\d\d/.test(k)), 'KV keys are per-day counters only (no message content stored)');
srv.close(); if (failed) { console.error(failed + ' failed'); process.exit(1); } console.log('PROXY UNIT TESTS PASSED');
