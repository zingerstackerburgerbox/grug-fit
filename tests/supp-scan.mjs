// v1.16.0 supplement barcodes in Doses › add supplement: Scan barcode (manual code entry in the shared Scanner) →
// REAL coach-proxy /supp/barcode in-process (OFF / NIH DSLD / Open Products Facts upstream stubbed) → form prefilled
// (name, brand, form, dose from the key ingredient, nutrients, notes) → user confirms with Save; device cache (no second
// network call); not-found card → manual entry → barcode remembered → next scan finds it with no network; offline pack path.
import { chromium, devices } from 'playwright';
import worker from '../coach-proxy/src/index.js';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/'; const SHOTS = process.env.SHOTS;
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const kv = new Map(); const KV = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } };
const ENV = { COACH_KV: KV, IP_SALT: 'test-salt', ALLOWED_ORIGINS: 'http://127.0.0.1:4173,http://localhost:4173' }; const ORIGIN = new URL(BASE).origin;
const PRE = '9300000000123', CRE = '733739020307', MISS = '9311111111116', PACK = '9300652010794';
const upstream = []; const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => { const u = String(url); upstream.push(u);
  if (u.includes(`openfoodfacts.org/api/v2/product/${PRE}`)) return Response.json({ status: 1, product: { code: PRE, product_name: 'Pre Workout Blast', brands: 'Lunk Labs', serving_size: '1 scoop (10 g)', serving_quantity: 10, nutriments: { caffeine_serving: 0.2 } } });
  if (u.includes('/api/v2/product/')) return Response.json({ status: 0 }, { status: 404 });
  if (u.includes('/dsld/v9/search-filter')) return Response.json(u.includes(encodeURIComponent('"7 33739 02030 7"')) ? { hits: [{ _id: '205180', _source: { upcSku: '7 33739 02030 7' } }] } : { hits: [] });
  if (u.includes('/dsld/v9/label/205180')) return Response.json({ id: 205180, fullName: 'Creatine Monohydrate', brandName: 'NOW Sports', upcSku: '7 33739 02030 7', physicalState: { langualCodeDescription: 'Powder' },
    servingSizes: [{ order: 1, minQuantity: 1, unit: 'Scoop(s)' }], ingredientRows: [{ name: 'Calories', quantity: [{ quantity: 0, unit: 'kcal' }] }, { name: 'Creatine Monohydrate', quantity: [{ servingSizeOrder: 1, quantity: 5, unit: 'Gram(s)' }] }] });
  return realFetch(url, init); };
const wpaths = []; let down = false;
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, colorScheme: 'dark', timezoneId: 'Australia/Sydney' });
await ctx.addInitScript(() => { localStorage.setItem('coachProxyUrl', 'https://coach.test'); localStorage.setItem('offpackAuto', '0'); });
const page = await ctx.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', (e) => fail('pageerror ' + e.message));
await ctx.route('https://coach.test/**', async (r) => { const q = r.request(); const u = new URL(q.url()); wpaths.push(u.pathname + u.search);
  if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
  if (down) return r.abort('internetdisconnected');
  const res = await worker.fetch(new Request(q.url(), { method: q.method(), headers: { ...q.headers(), origin: ORIGIN } }), ENV, {});
  return r.fulfill({ status: res.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: await res.text() }); });
await page.goto(BASE); await page.fill('[data-testid=ob-username]', 'grug_tester'); await page.click('[data-testid=ob-next]'); await page.click('[data-testid=ob-skip]'); await page.waitForSelector("text=Today's nutrition");
const open = async () => { await page.goto(BASE + '#/'); await page.waitForSelector("text=Today's nutrition"); await page.goto(BASE + '#/supp/new'); await page.waitForSelector('[data-testid=supp-scan]'); };
const scan = async (code) => { await page.click('[data-testid=supp-scan]'); const inp = page.locator('input[aria-label="Barcode number"]'); const btn = page.locator('button:has-text("Look up")');
  for (let i = 0; i < 20 && !(await btn.isEnabled()); i++) { await inp.fill(code); await page.waitForTimeout(150); } // the scanner clears the box as the camera starts
  await btn.click();
  return Promise.race([page.waitForSelector('[data-testid=supp-found]').then(() => 'found'), page.waitForSelector('[data-testid=supp-notfound]').then(() => 'none'), page.waitForSelector('[data-testid=supp-saved]').then(() => 'saved')]); };
const form = () => page.evaluate(() => { const v = (sel) => document.querySelector(sel)?.value; const sels = [...document.querySelectorAll('.page select')].map((x) => x.value);
  const dose = document.querySelector('.page .grid3 input')?.value; return { name: v('[data-testid=supp-name]'), brand: v('[data-testid=supp-brand]'), dose, unit: sels[0], form: sels[1], notes: v('[data-testid=supp-notes]') }; });
const saved = () => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('grugfit'); r.onsuccess = () => { const q = r.result.transaction('supplements').objectStore('supplements').getAll(); q.onsuccess = () => res(q.result); }; }));

// 1) OFF hit: pre-workout, caffeine 200 mg
await open(); let o = await scan(PRE); let f = await form(); log('pre-workout scan:', o, JSON.stringify(f), '| ingredients:', await page.textContent('[data-testid=supp-ingredients]').catch(() => ''));
if (o !== 'found' || f.name !== 'Pre Workout Blast' || f.brand !== 'Lunk Labs' || f.dose !== '200' || f.unit !== 'mg' || f.form !== 'Powder' || !/Caffeine 200 mg/.test(f.notes)) fail('OFF prefill');
if (!wpaths.some((p) => p.startsWith('/supp/barcode?code=' + PRE)) || !kv.has('supp:b:' + PRE)) fail('worker + edge cache');
if ((await saved()).length) fail('nothing saved before the user taps Save');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/v1160-supp-found.png` });
await page.locator('button:has-text("Save")').first().click(); await page.waitForURL(/#\/supps/); let l = await saved(); log('saved after confirm:', l.map((x) => `${x.name} ${x.doseAmount} ${x.unit} [${x.barcode}]`).join('; ')); if (l[0]?.barcode !== PRE) fail('barcode stored');
// 2) DSLD hit: creatine 5 g; rescan from device cache, no network
await open(); o = await scan(CRE); f = await form(); log('creatine scan (DSLD):', o, f.name, f.dose, f.unit, f.form); if (o !== 'found' || f.name !== 'Creatine Monohydrate' || f.dose !== '5' || f.unit !== 'g') fail('DSLD prefill');
if (!/NIH Dietary Supplement/.test(await page.textContent('[data-testid=supp-found]'))) fail('source credit');
wpaths.length = 0; await open(); o = await scan(CRE); log('rescan creatine:', o, '| worker calls', wpaths.length); if (o !== 'found' || wpaths.length) fail('device cache');
// 3) already saved → "already in your doses"
await open(); o = await scan(PRE); log('scan of a saved dose:', o); if (o !== 'saved') fail('saved detection');
// 4) not found → manual entry → remembered
await open(); o = await scan(MISS); log('unknown barcode:', o, (await page.textContent('[data-testid=supp-notfound]')).trim().slice(0, 120));
if (o !== 'none') fail('not-found card');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/v1160-supp-notfound.png` });
await page.fill('[data-testid=supp-name]', 'Gym Bro Magnesium'); await page.locator('button:has-text("Save")').first().click(); await page.waitForURL(/#\/supps/);
l = await saved(); const mg = l.find((x) => x.name === 'Gym Bro Magnesium'); if (mg?.barcode !== MISS) fail('manual barcode stored'); else log('manual entry saved with barcode', mg.barcode);
await page.evaluate((id) => new Promise((res) => { const r = indexedDB.open('grugfit'); r.onsuccess = () => { const st = r.result.transaction('supplements', 'readwrite').objectStore('supplements'); const q = st.get(id); q.onsuccess = () => { st.put({ ...q.result, archived: true }).onsuccess = res; }; }; }), mg.id);
wpaths.length = 0; await open(); o = await scan(MISS); f = await form(); log('rescan after deleting it:', o, f.name, '| worker calls', wpaths.length); if (o !== 'found' || f.name !== 'Gym Bro Magnesium' || wpaths.length) fail('remembered barcode');
// 5) Worker unreachable: the offline AU pack still gives name/brand; unknown → not-found with the offline note
down = true;
await open(); o = await scan(PACK); f = await form(); log('worker unreachable, pack scan:', o, f.name, '/', f.brand); if (o !== 'found' || !/Weet-Bix/i.test(f.name)) fail('pack fallback');
await open(); o = await scan('9322222222220'); const nf = await page.textContent('[data-testid=supp-notfound]').catch(() => ''); log('worker unreachable, unknown:', o, /offline/.test(nf) ? '(offline note shown)' : ''); if (o !== 'none' || !/offline/.test(nf)) fail('offline not-found');
down = false;
if (/\bAI\b/.test(await page.textContent('body'))) fail('"AI" in copy');
await b.close();
if (failed) { console.error(failed, 'FAILURES'); process.exit(1); } console.log('SUPP SCAN TESTS PASSED');
