// v1.13.0 food proxy: trimming, variants in parallel, KV + memory caching, timeouts, no xAI key / counters touched.
import worker from '../src/index.js';
import { trimProduct, barcodeVariants, cleanQuery, _clearFoodMem, _clearFoodBurst, FOOD_PER_MIN } from '../src/food.js';
let failed = 0; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) failed++; };
const kv = new Map(); const ttls = new Map();
const KV = { get: async (k) => kv.get(k) ?? null, put: async (k, v, o = {}) => { kv.set(k, v); ttls.set(k, o.expirationTtl); }, delete: async (k) => { kv.delete(k); } };
const ORIGIN = 'https://zingerstackerburgerbox.github.io'; const DEV = 'eeeeeeee-0000-4000-8000-000000000001';
const env = { COACH_KV: KV, IP_SALT: 'pepper' }; // no XAI_API_KEY on purpose
const req = (path, ip = '203.0.113.9') => new Request('https://proxy.test' + path, { headers: { Origin: ORIGIN, 'X-Device-Id': DEV, 'CF-Connecting-IP': ip } });
let calls = []; let mode = 'ok';
const PRODUCT = { code: '9300652010794', product_name: 'Weet-Bix', brands: 'Sanitarium', serving_size: '2 biscuits (33 g)', serving_quantity: 33, quantity: '1.2 kg', countries_tags: ['en:australia'],
  categories_tags: ['en:breakfasts', 'en:cereals'], nutriments: { 'energy-kcal_100g': 353, proteins_100g: 12.4, carbohydrates_100g: 65.9, fat_100g: 1.3, fiber_100g: 12.9, 'nova-group': 1, 'energy-kcal': 353, junk_100g: 'x' }, ingredients_text: 'x'.repeat(5000), images: { a: 1 } };
globalThis.fetch = async (url, init) => {
  calls.push(String(url));
  if (mode === 'slow') return new Promise((_, rej) => init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); }));
  if (mode === 'down') return new Response('busy', { status: 503 });
  const u = new URL(url);
  if (u.pathname.startsWith('/api/v2/product/')) { const c = u.pathname.split('/').pop().replace('.json', ''); return c === '9300652010794' || c === '0049000028911' ? Response.json({ status: 1, product: { ...PRODUCT, code: c } }) : Response.json({ status: 0 }, { status: 404 }); }
  if (u.pathname === '/cgi/search.pl') return mode === 'cgi503' ? new Response('busy', { status: 503 }) : Response.json({ products: [PRODUCT, { code: '1', product_name: '' }] });
  if (u.hostname === 'search.openfoodfacts.org') return Response.json({ hits: [PRODUCT] });
  return new Response('?', { status: 500 });
};
const call = async (path, ip) => { const res = await worker.fetch(req(path, ip), env, {}); return { res, j: await res.json() }; };

const t = trimProduct(PRODUCT);
ok(!t.ingredients_text && !t.images && t.nutriments['energy-kcal_100g'] === 353 && !('nova-group' in t.nutriments) && !('junk_100g' in t.nutriments) && JSON.stringify(t).length < 600, 'trimProduct keeps only mapped fields (' + JSON.stringify(t).length + ' bytes)');
ok(barcodeVariants('049000028911').join() === '049000028911,0049000028911' && barcodeVariants('0049000028911').join() === '0049000028911,049000028911' && barcodeVariants('9300652010794').length === 1, 'UPC-A/EAN-13 variants');
ok(cleanQuery('  Weet-Bix  ') === 'weet-bix' && cleanQuery('a') === null && cleanQuery('x'.repeat(99)).length === 60, 'query normalised');

let r = await call('/food/barcode?code=9300652010794');
ok(r.res.status === 200 && r.j.status === 'found' && r.j.product.product_name === 'Weet-Bix' && r.res.headers.get('X-Food-Cache') === 'origin', 'barcode found via OFF (origin)');
ok(calls.length === 1 && calls[0].includes('fields=') && !calls[0].includes('ingredients'), 'one upstream call with a trimmed field list');
ok(ttls.get('food:b:9300652010794') === 7 * 86400, 'found product cached in KV for 7 days');
calls = []; r = await call('/food/barcode?code=9300652010794');
ok(r.j.status === 'found' && r.res.headers.get('X-Food-Cache') === 'mem' && calls.length === 0, 'second lookup served from isolate cache, no upstream call');
_clearFoodMem(); calls = []; r = await call('/food/barcode?code=9300652010794');
ok(r.j.status === 'found' && r.res.headers.get('X-Food-Cache') === 'kv' && calls.length === 0, 'cold isolate served from KV');
calls = []; r = await call('/food/barcode?code=049000028911');
ok(r.j.status === 'found' && r.j.product.code === '0049000028911' && calls.length === 2, 'UPC-A code: both variants fetched in parallel, EAN-13 hit returned');
calls = []; r = await call('/food/barcode?code=9999999999994');
ok(r.j.status === 'none' && ttls.get('food:b:9999999999994') === 86400, 'not found → {status:none}, cached 1 day');
mode = 'down'; r = await call('/food/barcode?code=9300000000001');
ok(r.res.status === 502 && r.j.error === 'upstream_error' && !kv.has('food:b:9300000000001'), 'OFF 503 → 502 upstream_error, not cached');
mode = 'slow'; const t0 = Date.now(); r = await call('/food/barcode?code=9300000000002');
ok(r.res.status === 502 && r.j.error === 'upstream_timeout' && Date.now() - t0 < 7500, `upstream timeout after ~6 s (${Date.now() - t0} ms)`);
mode = 'ok'; r = await call('/food/barcode?code=12ab');
ok(r.res.status === 400 && r.j.error === 'bad_code', 'bad code rejected');
calls = []; r = await call('/food/search?q=Weet-Bix');
ok(r.j.status === 'ok' && r.j.products.length === 1 && r.j.products[0].product_name === 'Weet-Bix' && calls[0].includes('/cgi/search.pl') && kv.has('food:s:weet-bix'), 'search via OFF cgi, nameless hits dropped, cached');
mode = 'cgi503'; _clearFoodMem(); kv.delete('food:s:weet-bix'); calls = []; r = await call('/food/search?q=weet-bix');
ok(r.j.products.length === 1 && calls.length === 2 && calls[1].includes('search.openfoodfacts.org'), 'search falls back to search-a-licious when cgi is busy');
mode = 'ok';
ok(![...kv.keys()].some((k) => /^(d|i|g|e|ed|ei):/.test(k)), 'no coach / estimate counters written');
_clearFoodBurst(); let last;
for (let i = 0; i <= FOOD_PER_MIN; i++) last = await call('/food/barcode?code=9300652010794', '198.51.100.7');
ok(last.res.status === 429, `burst guard: request ${FOOD_PER_MIN + 1} in a minute from one network → 429`);
r = await worker.fetch(new Request('https://proxy.test/food/barcode?code=9300652010794', { headers: { Origin: 'https://evil.test', 'X-Device-Id': DEV } }), env, {});
ok(r.status === 403, 'foreign origin rejected');
console.log(failed ? `\n${failed} FAILED` : '\nall food proxy tests passed'); process.exit(failed ? 1 : 0);
