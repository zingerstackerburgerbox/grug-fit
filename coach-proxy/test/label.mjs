// v1.17.0 POST /supp/label: strict-schema request (vision, low reasoning), JSON validation/cleaning, per-network hourly
// rate limit (no daily cap), image cap, no coach/estimate counters, nothing stored but the hourly counter.
import worker from '../src/index.js';
import { parseLabel, normLabelUnit, NUTRIENT_KEYS, LABEL_SCHEMA } from '../src/label.js';
let failed = 0; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) failed++; };
const kv = new Map(); const env = { COACH_KV: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } }, IP_SALT: 'pepper', XAI_API_KEY: 'test-key-not-real' };
const IMG = 'data:image/jpeg;base64,' + 'A'.repeat(4000);
let sent = null; let reply = null; let status = 200;
globalThis.fetch = async (url, init) => { sent = { url: String(url), body: JSON.parse(init.body) }; if (status !== 200) return new Response('{"error":"x"}', { status }); return Response.json({ choices: [{ message: { content: reply } }] }); };
const GOOD = { name: 'Multivitamin for Men', brand: 'Nutricost', form: 'Capsule', serving: { text: '2 capsules', qty: 2, unit: 'Capsules' }, servingsPerContainer: 60,
  ingredients: [{ key: 'vitD', name: 'Vitamin D3', amount: 3000, unit: 'IU' }, { key: 'b12', name: 'Vitamin B12', amount: 60, unit: 'mcg' }, { key: 'zinc', name: 'Zinc', amount: 30, unit: 'mg' },
    { key: 'nonsense', name: 'Maca Root Powder', amount: 100, unit: 'mg' }, { key: 'iron', name: 'Iron', amount: 0, unit: 'mg' }], note: '' };
const call = async (body, ip = '203.0.113.20', hdr = {}) => { const res = await worker.fetch(new Request('https://proxy.test/supp/label', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://zingerstackerburgerbox.github.io', 'X-Device-Id': 'eeeeeeee-0000-4000-8000-000000000002', 'CF-Connecting-IP': ip, ...hdr }, body: typeof body === 'string' ? body : JSON.stringify(body) }), env, {}); return { res, j: await res.json() }; };

ok(normLabelUnit('mcg') === 'µg' && normLabelUnit('mcg DFE') === 'µg' && normLabelUnit('billion CFU') === 'bn CFU' && normLabelUnit('IU') === 'IU', 'units cleaned');
const p = parseLabel('```json\n' + JSON.stringify(GOOD) + '\n```');
ok(p && p.ingredients.length === 4 && p.ingredients[1].unit === 'µg' && p.ingredients[3].key === 'custom' && p.serving.unit === 'capsules' && p.servingsPerContainer === 60, 'parse: fences stripped, unknown key → custom, zero amounts dropped');
ok(parseLabel('not json') === null, 'garbage → null');
ok(LABEL_SCHEMA.properties.ingredients.items.properties.key.enum.length === NUTRIENT_KEYS.length + 1, 'schema enum = nutrient keys + custom');

reply = JSON.stringify(GOOD); let r = await call({ image: IMG });
ok(r.res.status === 200 && r.j.name === 'Multivitamin for Men' && r.j.ingredients.length === 4 && typeof r.j.ms === 'number', 'label read returned (200)');
ok(sent.body.model === 'grok-4.7' && sent.body.reasoning_effort === 'low' && sent.body.response_format?.type === 'json_schema' && sent.body.response_format.json_schema.strict === true, 'grok-4.7, low reasoning, strict JSON schema');
ok(sent.body.messages[1].content[0].type === 'image_url' && sent.body.messages[1].content[0].image_url.url === IMG, 'image forwarded as image_url');
ok(![...kv.keys()].some((k) => /^(d|i|g|est|esti|estg|rv):/.test(k)), 'no coach / estimate / review counters');
ok([...kv.keys()].every((k) => k.startsWith('lbl:')) && ![...kv.values()].some((v) => String(v).includes('AAAA')), 'only the hourly counter is stored, never the image');
reply = JSON.stringify({ ...GOOD, name: '', ingredients: [], note: 'This is a cat.' }); r = await call({ image: IMG }); ok(r.res.status === 422 && /cat/.test(r.j.message), 'not a label → 422 with the reason');
reply = 'sorry'; r = await call({ image: IMG }); ok(r.res.status === 502 && r.j.error === 'bad_label', 'unreadable reply → 502');
status = 500; r = await call({ image: IMG }); ok(r.res.status === 502 && r.j.error === 'upstream_error', 'upstream error → 502'); status = 200;
r = await call({ image: 'data:text/plain;base64,AAAA' }); ok(r.res.status === 400, 'non-image rejected');
r = await call({ image: 'data:image/jpeg;base64,' + 'A'.repeat(2_600_000) }); ok(r.res.status === 413, 'image size cap (413)');
reply = JSON.stringify(GOOD); let last; for (let i = 0; i < 31; i++) last = await call({ image: IMG }, '198.51.100.9');
ok(last.res.status === 429 && last.j.error === 'rate_limited', '31st read in an hour from one network → 429 (30/hour)');
r = await call({ image: IMG }, '198.51.100.10'); ok(r.res.status === 200, 'another network unaffected');
const noKey = { ...env }; delete noKey.XAI_API_KEY; const rr = await worker.fetch(new Request('https://proxy.test/supp/label', { method: 'POST', headers: { Origin: 'https://zingerstackerburgerbox.github.io', 'X-Device-Id': 'eeeeeeee-0000-4000-8000-000000000002' }, body: JSON.stringify({ image: IMG }) }), noKey, {});
ok(rr.status === 503, 'no xAI key → 503 disabled');
if (failed) { console.error(failed, 'failed'); process.exit(1); } console.log('LABEL PROXY TESTS PASSED');
