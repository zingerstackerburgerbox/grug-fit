// Unit test of the Worker's fetch handler in plain Node (mock KV + mock upstream). Run: node test/unit.mjs
import worker from '../src/index.js';
import { startMock } from './mock-upstream.mjs';
let failed = 0; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) failed++; };
const kv = new Map(); const KV = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } };
const { srv, seen } = await startMock(8788);
const env = (o = {}) => ({ COACH_KV: KV, XAI_API_KEY: 'sk-test', OWNER_TOKEN: 'owner-secret', UPSTREAM_URL: 'http://127.0.0.1:8788/v1/chat/completions', DEVICE_DAILY_CAP: '3', GLOBAL_DAILY_CAP: '5', ...o });
const DEV = '3f0b6a8e-1c2d-4e5f-8a9b-0c1d2e3f4a5b', DEV2 = '7a1b2c3d-4e5f-4a6b-9c8d-7e6f5a4b3c2d';
const ORIGIN = 'https://zingerstackerburgerbox.github.io';
const req = (path, { method = 'POST', origin = ORIGIN, device = DEV, owner, body, ip } = {}) => new Request('https://proxy.test' + path, { method, headers: { ...(ip ? { 'CF-Connecting-IP': ip } : {}), ...(origin ? { Origin: origin } : {}), ...(device ? { 'X-Device-Id': device } : {}), ...(owner ? { 'X-Owner-Token': owner } : {}), 'Content-Type': 'application/json' }, body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
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
// per-network (IP) cap: clearing storage = new device id, but same network → still capped
kv.clear(); const ipEnv = env({ DEVICE_DAILY_CAP: '30', IP_DAILY_CAP: '2', GLOBAL_DAILY_CAP: '100', IP_SALT: 'pepper' });
const D3 = '11111111-2222-4333-8444-555555555555', D4 = '66666666-7777-4888-9999-aaaaaaaaaaaa';
r = await call(req('/chat', { device: D3, ip: '203.0.113.7', body: chat() }), ipEnv); ok(r.res.status === 200 && r.res.headers.get('x-coach-remaining') === '1', 'IP cap 2: 1st message, remaining 1 (min of device/IP/global)');
r = await call(req('/chat', { device: D4, ip: '203.0.113.7', body: chat() }), ipEnv); ok(r.res.status === 200, '"new device" (cleared storage / incognito) on the same network: 2nd message');
r = await call(req('/chat', { device: '99999999-2222-4333-8444-555555555555', ip: '203.0.113.7', body: chat() }), ipEnv); ok(r.res.status === 429 && r.j.error === 'ip_limit' && /this network/.test(r.j.message), 'third device id, same IP → 429 ip_limit "for this network"');
r = await call(req('/status', { method: 'GET', device: '99999999-2222-4333-8444-555555555555', ip: '203.0.113.7' }), ipEnv); ok(r.j.remaining === 0 && r.j.network.used === 2 && r.j.network.cap === 2, '/status: remaining 0 for a fresh device on a capped network');
r = await call(req('/chat', { device: D3, ip: '198.51.100.9', body: chat() }), ipEnv); ok(r.res.status === 200, 'other network not affected');
r = await call(req('/chat', { device: D4, ip: '203.0.113.7', owner: 'owner-secret', body: chat() }), ipEnv); ok(r.res.status === 200 && r.res.headers.get('x-coach-remaining') === 'unlimited', 'owner token bypasses the IP cap');
const keys = [...kv.keys()]; ok(!keys.some((k) => k.includes('203.0.113') || k.includes('198.51.100')), 'raw IPs never stored in KV: ' + keys.filter((k) => k.startsWith('i:')).join(', '));
const I = await import('../src/index.js'); const k1 = await I.ipKey(req('/x', { ip: '203.0.113.7' }), { IP_SALT: 'pepper' }), k2 = await I.ipKey(req('/x', { ip: '203.0.113.7' }), { IP_SALT: 'salt2' });
ok(/^[0-9a-f]{32}$/.test(k1) && k1 !== k2, 'IP key = salted SHA-256 (salt changes the key)');
// rate-limit binding (10/min): refused when the binding says no
const rl = { calls: 0, limit: async ({ key }) => { rl.calls++; rl.key = key; return { success: rl.calls <= 1 }; } };
kv.clear(); r = await call(req('/chat', { ip: '203.0.113.7', body: chat() }), env({ COACH_RL: rl })); ok(r.res.status === 200 && rl.key === await I.ipKey(req('/x', { ip: '203.0.113.7' }), env({ COACH_RL: rl })), 'rate limiter keyed on the hashed IP');
r = await call(req('/chat', { ip: '203.0.113.7', body: chat() }), env({ COACH_RL: rl })); ok(r.res.status === 429 && r.j.error === 'rate_limited', 'rate limiter → 429 rate_limited');
r = await call(req('/chat', { ip: '203.0.113.7', owner: 'owner-secret', body: chat() }), env({ COACH_RL: rl })); ok(r.res.status === 200, 'owner bypasses the rate limiter');
ok([...kv.keys()].every((k) => /^(d|g|i|est|esti|estg):\d{4}-\d\d-\d\d/.test(k)), 'KV keys are per-day counters only (no message content stored)');
// ---------- v1.10.0 Smart Estimate: separate daily cap (1/device, 3/network), only successes count, owner bypass ----------
kv.clear(); const E = env({ IP_SALT: 'pepper', DEVICE_DAILY_CAP: '30', GLOBAL_DAILY_CAP: '100' }); const EIP = '203.0.113.50';
const est = (o = {}) => ({ text: '2 eggs scrambled with butter, 2 slices toast', ...o });
r = await call(req('/estimate', { ip: EIP, body: est({ text: 'EST_FAIL' }) }), E); ok(r.res.status === 502 && r.j.error === 'upstream_error', 'estimate: upstream failure → 502');
r = await call(req('/estimate', { ip: EIP, body: est({ text: 'EST_BADJSON' }) }), E); ok(r.res.status === 502 && r.j.error === 'bad_estimate', 'estimate: invalid JSON from the model → 502 bad_estimate');
r = await call(req('/estimate', { ip: EIP, body: est({ text: 'EST_NOTFOOD' }) }), E); ok(r.res.status === 422 && r.j.error === 'no_food', 'estimate: not food → 422 no_food');
r = await call(req('/estimate', { ip: EIP, body: est({ text: 'EST_SLOW' }) }), env({ IP_SALT: 'pepper', EST_TIMEOUT_MS: '300' })); ok(r.res.status === 504, 'estimate: timeout → 504');
ok(![...kv.keys()].some((k) => k.startsWith('est:') || k.startsWith('esti:')), 'failures/timeouts/invalid JSON did not consume the daily estimate');
r = await call(req('/status', { method: 'GET', ip: EIP }), E); ok(r.j.estimate.remaining === 1 && r.j.estimate.cap === 1, '/status: 1 estimate left today');
r = await call(req('/estimate', { ip: EIP, body: est() }), E);
ok(r.res.status === 200 && r.j.items.length === 2 && r.j.items[0].kcal === 180 && r.j.items[1].fibre === 3 && r.j.confidence === 'med' && r.j.note === 'Assumed 5 g butter.' && r.j.remaining === 0, 'estimate: fenced JSON parsed + normalised (medium → med), remaining 0');
ok(r.res.headers.get('x-est-remaining') === '0' && /X-Est-Remaining/.test(r.res.headers.get('access-control-expose-headers')), 'X-Est-Remaining header exposed');
const upE = seen.at(-1); ok(/^You estimate/.test(upE.body.messages[0].content) && upE.body.stream === false && /Meal: 2 eggs/.test(upE.body.messages[1].content), 'prompt built server-side');
ok(!kv.has(`d:${new Date().toISOString().slice(0, 10)}:${DEV}`), 'estimate does NOT consume a coach message');
r = await call(req('/estimate', { ip: EIP, body: est() }), E); ok(r.res.status === 429 && r.j.error === 'est_limit' && r.j.resetAt, 'second estimate same day → 429 est_limit');
r = await call(req('/chat', { ip: EIP, body: chat() }), E); ok(r.res.status === 200, 'coach chat still works after the estimate is used');
r = await call(req('/estimate', { ip: EIP, owner: 'owner-secret', body: est() }), E); ok(r.res.status === 200 && r.j.remaining === null && r.res.headers.get('x-est-remaining') === 'unlimited', 'owner token bypasses the estimate cap');
// network cap: 1 x 3 per network; incognito / cleared storage = new device id, same network
const devs = ['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000003'];
r = await call(req('/estimate', { device: devs[0], ip: EIP, body: est() }), E); ok(r.res.status === 200, 'network: 2nd device on the same Wi-Fi ok');
r = await call(req('/estimate', { device: devs[1], ip: EIP, body: est() }), E); ok(r.res.status === 200, 'network: 3rd device on the same Wi-Fi ok');
r = await call(req('/estimate', { device: devs[2], ip: EIP, body: est() }), E); ok(r.res.status === 429 && r.j.error === 'est_ip_limit', 'network: 4th fresh device id on the same network → 429 est_ip_limit');
r = await call(req('/estimate', { device: devs[2], ip: '198.51.100.77', body: est() }), E); ok(r.res.status === 200, 'other network not affected');
r = await call(req('/estimate', { ip: '198.51.100.78', body: est() }), E); ok(r.res.status === 429 && r.j.error === 'est_limit', 'device still capped on a new network');
kv.clear(); r = await call(req('/estimate', { ip: EIP, body: est() }), env({ EST_DAILY_CAP: '2' })); r = await call(req('/estimate', { ip: EIP, body: est() }), env({ EST_DAILY_CAP: '2' })); ok(r.res.status === 200 && r.j.remaining === 0 && r.j.cap === 2, 'EST_DAILY_CAP=2 → two a day');
// validation
r = await call(req('/estimate', { ip: EIP, body: { text: '' } }), E); ok(r.res.status === 400, 'empty description rejected');
r = await call(req('/estimate', { ip: EIP, body: est({ image: 'data:text/html;base64,AAAA' }) }), E); ok(r.res.status === 400 && r.j.error === 'bad_image', 'non-image data URL rejected');
kv.clear(); r = await call(req('/estimate', { ip: EIP, body: est({ image: 'data:image/jpeg;base64,' + 'A'.repeat(4000) }) }), E); const upI = seen.at(-1).body.messages[1].content;
ok(r.res.status === 200 && Array.isArray(upI) && upI[0].type === 'image_url' && upI[1].type === 'text', 'photo forwarded as image_url part');
ok(![...kv.values()].some((v) => String(v).length > 20), 'photo/description never stored in KV');
const P = I.parseEstimate; ok(P('{"items":[{"name":"x","kcal":"abc","protein":1,"carbs":1,"fat":1}]}') === null && P('nope') === null && P('{"items":[{"name":"x","kcal":-5,"protein":1,"carbs":1,"fat":1}]}') === null, 'parseEstimate rejects bad numbers');
srv.close(); if (failed) { console.error(failed + ' failed'); process.exit(1); } console.log('PROXY UNIT TESTS PASSED');
