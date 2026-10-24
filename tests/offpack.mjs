// v1.13.0 fast Australian lookups, end to end against the built app:
//  1) local pack hit before the background download (one ~100 kB shard fetched on demand, no Open Food Facts / Worker call)
//  2) background/“Download” of the whole pack → Settings line (count + data date), About credit with pack date
//  3) text search over the pack ("weet-bix" instant even while the online search is slow)
//  4) cache hit: rescanning is served from saved foods with zero network
//  5) Worker fallback for a pack miss (REAL coach-proxy food code in-process, Open Food Facts upstream stubbed) and the
//     direct-OFF fallback when the Worker is down
//  6) offline: pack scans + pack search work, an unknown code shows the offline not-found card
import { chromium, devices } from 'playwright';
import worker from '../coach-proxy/src/index.js';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const kv = new Map(); const KV = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } };
const ENV = { COACH_KV: KV, IP_SALT: 'test-salt', ALLOWED_ORIGINS: 'http://127.0.0.1:4173,http://localhost:4173' }; const ORIGIN = new URL(BASE).origin;
// Open Food Facts as seen by the Worker (Node side): one product the pack doesn't have
const MISS = '9399999999995'; const DIRECT = '9399999999988';
const upstream = []; const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => { const u = String(url); upstream.push(u);
  if (u.includes(`/product/${MISS}`)) return Response.json({ status: 1, product: { code: MISS, product_name: 'Grug Test Protein Bar', brands: 'Lunk Labs', serving_size: '60 g', serving_quantity: 60, countries_tags: ['en:australia'], nutriments: { 'energy-kcal_100g': 380, proteins_100g: 33, carbohydrates_100g: 30, fat_100g: 12, fiber_100g: 8 } } });
  if (u.includes('/product/')) return Response.json({ status: 0 }, { status: 404 });
  if (u.includes('search')) { await new Promise((r) => setTimeout(r, 4000)); return Response.json({ products: [{ code: '9300000000017', product_name: 'Weet-Bix Online Only', brands: 'Sanitarium', countries_tags: ['en:australia'], nutriments: { 'energy-kcal_100g': 350, proteins_100g: 12 } }] }); }
  return realFetch(url, init); };
let workerDown = false; const wpaths = []; const offDirect = []; const shardReq = [];
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark', timezoneId: 'Australia/Sydney' });
await ctx.addInitScript(() => { localStorage.setItem('coachProxyUrl', 'https://coach.test'); if (!localStorage.getItem('offpackAutoSet')) { localStorage.setItem('offpackAuto', '0'); localStorage.setItem('offpackAutoSet', '1'); } });
const page = await ctx.newPage(); page.setDefaultTimeout(15000);
page.on('pageerror', (e) => fail('pageerror ' + e.message));
page.on('request', (r) => { const u = r.url(); if (/\/offpack\/au-/.test(u)) shardReq.push(u.match(/au-[0-9a-f]/)[0]); });
await ctx.route('https://coach.test/**', async (r) => {
  const q = r.request(); const u = new URL(q.url()); wpaths.push(u.pathname + u.search);
  if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
  if (workerDown) return r.fulfill({ status: 502, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"error":"upstream_error"}' });
  const res = await worker.fetch(new Request(q.url(), { method: q.method(), headers: { ...q.headers(), origin: ORIGIN } }), ENV, {});
  return r.fulfill({ status: res.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'x-food-cache': res.headers.get('X-Food-Cache') || '' }, body: await res.text() });
});
await ctx.route(/openfoodfacts\.org/, (r) => { offDirect.push(r.request().url());
  if (r.request().url().includes(`/product/${DIRECT}`)) return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ status: 1, product: { code: DIRECT, product_name: 'Direct Path Muesli', brands: 'Lunk Labs', countries_tags: ['en:australia'], nutriments: { 'energy-kcal_100g': 400, proteins_100g: 10, carbohydrates_100g: 60, fat_100g: 9 } } }) });
  return r.fulfill({ status: 404, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"status":0}' }); });
await ctx.route(/api\.nal\.usda\.gov/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"foods":[]}' }));

await page.goto(BASE); await page.fill('[data-testid=ob-username]', 'grug_tester'); await page.click('[data-testid=ob-next]'); await page.click('[data-testid=ob-skip]'); await page.waitForSelector("text=Today's nutrition");
const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
const typeCode = async (code) => { await page.goto(BASE + '#/'); await page.waitForSelector("text=Today's nutrition"); await page.goto(BASE + `#/food/add/${today}/breakfast`); await page.fill('input[type=search]', code); const t0 = Date.now(); await page.click('button[aria-label=Search]'); return t0; };
const outcome = (ms = 20000) => Promise.race([page.waitForSelector('.amount-sheet', { timeout: ms }).then(() => 'found'), page.waitForSelector('[data-testid=notfound]', { timeout: ms }).then(() => 'notfound')]).catch(() => 'timeout');
const title = () => page.locator('.sheet h2').textContent();
const timings = {};

// 1) pack hit before the full pack is on the device: only this code's shard is fetched
let t0 = await typeCode('9300652010794'); let o = await outcome(); timings.packFirst = Date.now() - t0;
const units = o === 'found' ? await page.locator('.amount-sheet [role=radio]').allTextContents() : [];
log('Weet-Bix (pack, on-demand shard):', o, await title().catch(() => ''), timings.packFirst + ' ms', 'shards', shardReq.join(','), '| units', units.join(' | '));
if (o !== 'found' || (await title()) !== 'Weet-Bix') fail('pack lookup failed'); if (shardReq.join() !== 'au-e') fail('expected exactly shard au-e (…94 → 94 % 16 = 14), got ' + shardReq.join());
if (!units.some((u) => /33 g/.test(u))) fail('label serving (33 g) missing');
if (wpaths.some((p) => p.startsWith('/food/')) || offDirect.length) fail('pack hit went to the network: ' + [...wpaths, ...offDirect].join(','));
if (timings.packFirst > 3000) fail('pack hit too slow');

// 2) Settings: not complete yet → Download → ready with count + date; About credit carries the pack date
await page.goto(BASE + '#/settings'); await page.waitForSelector('[data-testid=offpack-status]');
log('Settings before:', (await page.textContent('[data-testid=offpack-status] span')).trim());
const td = Date.now(); await page.click('[data-testid=offpack-refresh]'); await page.waitForSelector('[data-testid=offpack-status][data-state=ready]', { timeout: 60000 }); timings.fullDownload = Date.now() - td;
const line = (await page.textContent('[data-testid=offpack-status] span')).trim(); log('Settings after:', line, `(${timings.fullDownload} ms for ${new Set(shardReq).size} shards)`);
if (!/^Offline food pack: 30,000 Australian products on this device · data 24 Oct 2026$/.test(line)) fail('pack status line: ' + line);
const credit = (await page.textContent('[data-testid=off-credit]')).trim(); log('About credit:', credit); if (!/Open Food Facts, ODbL · offline pack data 24 Oct 2026/.test(credit)) fail('credit/date missing');
const settingsText = await page.textContent('body'); if (/\bAI\b/.test(settingsText)) fail('"AI" in Settings copy');
const stored = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('grugfit-offpack'); r.onsuccess = () => { const tx = r.result.transaction('products'); const q = tx.objectStore('products').count(); q.onsuccess = () => res(q.result); }; }));
if (stored !== 30000) fail('IDB rows ' + stored); else log('IndexedDB grugfit-offpack rows:', stored);

// 3) text search: pack results appear at once even though the online search takes 4 s
await page.goto(BASE + `#/food/add/${today}/breakfast`); await page.fill('input[type=search]', 'weet-bix'); t0 = Date.now(); await page.click('button[aria-label=Search]');
await page.waitForSelector('.list .item'); timings.packSearch = Date.now() - t0;
const first = await page.locator('.list .item .ell').first().textContent(); log('search weet-bix: first result', first, timings.packSearch + ' ms');
if (!/^Weet-Bix/.test(first) || timings.packSearch > 1500) fail('pack search not instant/wrong');
await page.waitForSelector('text=Weet-Bix Online Only', { timeout: 15000 }); log('…online result appended after', Date.now() - t0, 'ms; total rows', await page.locator('.list .item').count());
await page.fill('input[type=search]', 'weetbix'); await page.click('button[aria-label=Search]'); await page.waitForSelector('.list .item'); if (!/Weet-Bix/i.test(await page.locator('.list .item .ell').first().textContent())) fail('"weetbix" search');

// 4) cache hit: rescanning Weet-Bix comes from saved foods, no network at all
wpaths.length = 0; offDirect.length = 0; shardReq.length = 0;
t0 = await typeCode('9300652010794'); o = await outcome(); timings.cacheHit = Date.now() - t0;
log('rescan (saved food):', o, timings.cacheHit + ' ms'); if (o !== 'found' || wpaths.length || offDirect.length || shardReq.length) fail('rescan touched the network');

// 5) pack miss → Worker (real food proxy code) → saved; second scan is local; Worker down → direct OFF
upstream.length = 0; t0 = await typeCode(MISS); o = await outcome(); timings.workerCold = Date.now() - t0;
log('pack miss via Worker:', o, await title().catch(() => ''), timings.workerCold + ' ms', '| worker', wpaths.join(','), '| upstream', upstream.length, '| direct OFF', offDirect.length);
if (o !== 'found' || (await title()) !== 'Grug Test Protein Bar' || !wpaths.some((p) => p.startsWith('/food/barcode')) || offDirect.length) fail('worker fallback');
if (!kv.has('food:b:' + MISS)) fail('worker did not cache the product');
wpaths.length = 0; t0 = await typeCode(MISS); o = await outcome(); log('second scan of it:', o, Date.now() - t0, 'ms, worker calls', wpaths.length); if (o !== 'found' || wpaths.length) fail('device cache after worker hit');
workerDown = true; t0 = await typeCode(DIRECT); o = await outcome(); log('Worker down → direct OFF:', o, await title().catch(() => ''), Date.now() - t0, 'ms', offDirect.map((u) => u.match(/product\/(\d+)/)?.[1]).join(','));
if (o !== 'found' || (await title()) !== 'Direct Path Muesli') fail('direct fallback'); workerDown = false;

// 6) offline: another pack product, pack search, unknown code
await ctx.setOffline(true);
t0 = await typeCode('9300652010374'); o = await outcome(); log('offline pack scan:', o, await title().catch(() => ''), Date.now() - t0, 'ms'); if (o !== 'found') fail('offline pack scan');
await page.goto(BASE + '#/'); await page.waitForSelector("text=Today's nutrition"); await page.goto(BASE + `#/food/add/${today}/breakfast`); await page.fill('input[type=search]', 'vegemite'); await page.click('button[aria-label=Search]'); await page.waitForSelector('.list .item');
const n = await page.locator('.list .item').count(); log('offline search vegemite:', n, 'results, first', await page.locator('.list .item .ell').first().textContent()); if (!n) fail('offline search');
if (await page.locator('text=search failed').count()) fail('offline search showed an error despite pack results');
await typeCode('9399999999971'); o = await outcome(); const nf = o === 'notfound' ? await page.textContent('[data-testid=notfound]') : ''; log('offline unknown code:', o, /offline/.test(nf) ? '(offline message)' : nf.slice(0, 80));
if (o !== 'notfound' || !/offline/.test(nf)) fail('offline miss card');
await ctx.setOffline(false);
// 7) fresh install, default settings: the pack downloads by itself in the background a few seconds after start-up
const c2 = await b.newContext({ ...devices['Pixel 7'] }); const p2 = await c2.newPage(); const tb = Date.now();
await p2.goto(BASE); await p2.fill('[data-testid=ob-username]', 'grug_two'); await p2.click('[data-testid=ob-next]'); await p2.click('[data-testid=ob-skip]'); await p2.waitForSelector("text=Today's nutrition");
const packCount = () => p2.evaluate(async () => { if (!(await indexedDB.databases()).some((d) => d.name === 'grugfit-offpack')) return 0; return new Promise((res) => { const r = indexedDB.open('grugfit-offpack'); r.onsuccess = () => { try { const q = r.result.transaction('meta').objectStore('meta').get('pack'); q.onsuccess = () => { r.result.close(); res(q.result && q.result.installed.length === q.result.shards ? q.result.count : 0); }; } catch { r.result.close(); res(0); } }; r.onerror = () => res(0); }); }).catch(() => 0);
let auto = 0; for (let i = 0; i < 45 && !auto; i++) { await p2.waitForTimeout(1000); auto = await packCount(); }
log('background download on a fresh install:', auto, 'products after', Date.now() - tb, 'ms'); if (auto !== 30000) fail('background pack download'); await c2.close();
console.log('TIMINGS', JSON.stringify(timings));
await b.close();
if (failed) { console.error(failed, 'failure(s)'); process.exit(1); } console.log('OFFPACK E2E PASSED');
