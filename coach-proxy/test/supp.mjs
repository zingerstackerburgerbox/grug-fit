// v1.16.0 /supp/barcode: OFF → NIH DSLD → Open Products Facts, normalised record, KV + memory cache, not-found not cached while a source is down.
import worker from '../src/index.js';
import { _clearFoodMem, _clearFoodBurst } from '../src/food.js';
import { fromDsld, upcSpaced, normUnit, formOf } from '../src/supp.js';
let failed = 0; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) failed++; };
const kv = new Map(); const ttls = new Map();
const env = { COACH_KV: { get: async (k) => kv.get(k) ?? null, put: async (k, v, o = {}) => { kv.set(k, v); ttls.set(k, o.expirationTtl); } }, IP_SALT: 'pepper' };
const req = (p) => new Request('https://proxy.test' + p, { headers: { Origin: 'https://zingerstackerburgerbox.github.io', 'X-Device-Id': 'eeeeeeee-0000-4000-8000-000000000001', 'CF-Connecting-IP': '203.0.113.7' } });
let calls = []; let dsldDown = false;
const LABEL = { id: 205180, fullName: 'Creatine Monohydrate', brandName: 'NOW Sports', upcSku: '7 33739 02030 7', physicalState: { langualCodeDescription: 'Powder' },
  servingSizes: [{ order: 1, minQuantity: 5, unit: 'Gram(s)' }], ingredientRows: [{ name: 'Calories', quantity: [{ quantity: 0, unit: 'kcal' }] }, { name: 'Creatine Monohydrate', quantity: [{ servingSizeOrder: 1, quantity: 5, unit: 'Gram(s)' }] }] };
globalThis.fetch = async (url) => { const u = String(url); calls.push(u);
  if (u.includes('openfoodfacts.org/api/v2/product/9300000000123')) return Response.json({ status: 1, product: { code: '9300000000123', product_name: 'Pre Workout Blast', brands: 'Lunk Labs, Other', serving_size: '1 scoop (10 g)', serving_quantity: 10, nutriments: { caffeine_serving: 0.2, proteins_serving: 0 } } });
  if (u.includes('openproductsfacts.org/api/v2/product/9300000000222')) return Response.json({ status: 1, product: { code: '9300000000222', product_name: 'Fish Oil 1000', brands: 'Reef', serving_size: '1 capsule' } });
  if (u.includes('/api/v2/product/')) return Response.json({ status: 0 }, { status: 404 });
  if (u.includes('/dsld/v9/search-filter')) { if (dsldDown) return new Response('x', { status: 503 }); return Response.json(u.includes(encodeURIComponent('"7 33739 02030 7"')) ? { hits: [{ _id: '205180', _source: { upcSku: '7 33739 02030 7', entryDate: '2020-01-01' } }] } : { hits: [] }); }
  if (u.includes('/dsld/v9/label/205180')) return Response.json(LABEL);
  return new Response('?', { status: 500 }); };
const call = async (p) => { const res = await worker.fetch(req(p), env, {}); return { res, j: await res.json() }; };

ok(upcSpaced('733739020307') === '7 33739 02030 7' && upcSpaced('9300000000123') === null, 'UPC printed form for DSLD');
ok(normUnit('Gram(s)') === 'g' && normUnit('mcg') === 'µg' && normUnit('IU') === 'IU' && formOf('Softgels') === 'Softgel' && formOf('Whey protein') === 'Powder', 'units and forms normalised');
const d = fromDsld(LABEL); ok(d.ingredients.length === 1 && d.ingredients[0].unit === 'g' && d.serving.unit === 'g' && d.form === 'Powder', 'DSLD label → creatine 5 g, calories dropped');

let r = await call('/supp/barcode?code=9300000000123');
ok(r.j.status === 'found' && r.j.src === 'off' && r.j.brand === 'Lunk Labs' && r.j.ingredients.length === 1 && r.j.ingredients[0].name === 'Caffeine' && r.j.ingredients[0].amount === 200 && r.j.ingredients[0].unit === 'mg', 'OFF hit: caffeine 200 mg per serving, brand trimmed');
ok(!calls.some((u) => u.includes('dsld')), 'OFF hit stops there (EAN-13: DSLD not asked)');
ok(ttls.get('supp:b:9300000000123') === 14 * 86400, 'found cached in KV for 14 days');
calls = []; r = await call('/supp/barcode?code=9300000000123'); ok(r.res.headers.get('X-Food-Cache') === 'mem' && !calls.length, 'second lookup from isolate cache');
calls = []; r = await call('/supp/barcode?code=733739020307');
ok(r.j.status === 'found' && r.j.src === 'dsld' && r.j.name === 'Creatine Monohydrate' && r.j.ingredients[0].amount === 5, 'OFF miss → DSLD by UPC (creatine 5 g)');
ok(calls.some((u) => u.includes('/label/205180')), 'DSLD label fetched');
r = await call('/supp/barcode?code=9300000000222'); ok(r.j.status === 'found' && r.j.src === 'opf' && r.j.form === 'Capsule', 'OFF + DSLD miss → Open Products Facts');
r = await call('/supp/barcode?code=012345678905'); ok(r.j.status === 'none' && ttls.get('supp:b:012345678905') === 2 * 86400, 'nowhere → none, cached 2 days');
dsldDown = true; _clearFoodMem(); r = await call('/supp/barcode?code=012345678912'); ok(r.res.status === 502 && !kv.has('supp:b:012345678912'), 'a source down → 502, not-found not cached'); dsldDown = false;
r = await call('/supp/barcode?code=abc'); ok(r.res.status === 400, 'bad code 400');
r = await call('/supp/barcode?code=000000000000'); ok(r.res.status === 400, 'all-zero code rejected');
ok(![...kv.keys()].some((k) => /^(d|i|g|e):/.test(k)), 'no coach / estimate counters touched');
_clearFoodBurst();
if (failed) { console.error(failed, 'failed'); process.exit(1); } console.log('SUPP PROXY TESTS PASSED');
