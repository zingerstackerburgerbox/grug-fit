// v1.13.0 live check on the deployed site + Worker: background pack download on a fresh device, pack hit, cold Worker hit (pack miss),
// device-cache rescan, Worker edge-cache hit from a second fresh device, direct-OFF timings for comparison (the pre-v1.13 path),
// screenshots (390x844, dark): scan result + Settings pack line. Adds nothing server-side except Worker cache entries.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'https://zingerstackerburgerbox.github.io/grug-fit/';
const OUT = process.env.OUT || '/cursor/stores/store-ba4c5ff4-98dd-4ddd-94fb-5537ced61e1d/screenshots';
const COLD = process.env.COLD || '7622210449283'; // not in the AU pack (pack miss → Worker)
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const b = await chromium.launch(); const T = {};
const fresh = async (name) => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark', timezoneId: 'Australia/Sydney' });
  const page = await ctx.newPage(); page.setDefaultTimeout(30000); const food = [];
  page.on('response', (r) => { if (r.url().includes('/food/')) food.push(`${new URL(r.url()).pathname} ${r.status()} cache=${r.headers()['x-food-cache'] || '?'}`); });
  await page.goto(BASE); await page.fill('[data-testid=ob-username]', name); await page.click('[data-testid=ob-next]'); await page.click('[data-testid=ob-skip]'); await page.waitForSelector("text=Today's nutrition");
  const nn = page.locator('text=Not now'); if (await nn.count()) await nn.first().click().catch(() => {});
  return { ctx, page, food };
};
const today = (page) => page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
const scan = async (page, code) => { const d = await today(page); await page.goto(BASE + '#/'); await page.waitForSelector("text=Today's nutrition"); await page.goto(BASE + `#/food/add/${d}/breakfast`);
  await page.fill('input[type=search]', code); const t0 = Date.now(); await page.click('button[aria-label=Search]');
  const o = await Promise.race([page.waitForSelector('.amount-sheet').then(() => 'found'), page.waitForSelector('[data-testid=notfound]').then(() => 'notfound')]).catch(() => 'timeout');
  return { o, ms: Date.now() - t0, title: o === 'found' ? await page.locator('.sheet h2').textContent() : '' }; };
const packState = (page) => page.evaluate(async () => { if (!(await indexedDB.databases()).some((d) => d.name === 'grugfit-offpack')) return null;
  return new Promise((res) => { const r = indexedDB.open('grugfit-offpack'); r.onsuccess = () => { try { const q = r.result.transaction('meta').objectStore('meta').get('pack'); q.onsuccess = () => { r.result.close(); res(q.result || null); }; } catch { r.result.close(); res(null); } }; }); }).catch(() => null);
try {
  const A = await fresh('grug_live_a'); const tb = Date.now();
  const ver = await A.page.evaluate(() => document.documentElement.innerHTML.length); void ver;
  let st = null; for (let i = 0; i < 60; i++) { st = await packState(A.page); if (st && st.installed.length === st.shards) break; await A.page.waitForTimeout(1000); }
  T.packDownloadMs = Date.now() - tb; log('background pack:', st ? `${st.count} products, version ${st.version}, ${st.installed.length}/${st.shards} shards` : 'none', `after ${T.packDownloadMs} ms from start`);
  if (!st || st.installed.length !== st.shards) fail('pack not downloaded');
  // the pre-v1.13 path for comparison: direct Open Food Facts v2 with the old full field list, from this browser
  const old = await A.page.evaluate(async (codes) => { const F = 'code,product_name,product_name_en,brands,nutriments,serving_size,serving_quantity,serving_quantity_unit,product_quantity,product_quantity_unit,quantity,nutrition_data_per,countries_tags,categories_tags,drained_weight,image_small_url,image_front_small_url'; const out = [];
    for (const c of codes) { const t0 = performance.now(); let s = 0; try { const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${c}.json?fields=${F}`, { cache: 'no-store' }); s = r.status; await r.text(); } catch { s = -1; } out.push([c, s, Math.round(performance.now() - t0)]); } return out; }, ['9300652010794', '9300652010374', COLD]);
  log('direct OFF (old path), per request:', old.map(([c, s, ms]) => `${c}=${s} ${ms}ms`).join(', ')); T.directOff = old.map((x) => x[2]);
  let r = await scan(A.page, '9300652010794'); T.packHit = r.ms; log('pack hit Weet-Bix:', r.o, r.title, r.ms + ' ms', '| worker calls:', A.food.length); if (r.o !== 'found' || A.food.length) fail('pack hit');
  await A.page.waitForTimeout(400); await A.page.screenshot({ path: `${OUT}/v1130-scan-result.png` });
  A.food.length = 0; r = await scan(A.page, COLD); T.workerCold = r.ms; log('pack miss → Worker:', r.o, r.title, r.ms + ' ms', A.food.join(' ; ')); if (r.o !== 'found') fail('worker lookup');
  A.food.length = 0; r = await scan(A.page, COLD); T.deviceCache = r.ms; log('rescan (device cache):', r.o, r.ms + ' ms', 'worker calls', A.food.length);
  const d = await today(A.page); await A.page.goto(BASE + '#/'); await A.page.goto(BASE + `#/food/add/${d}/breakfast`); await A.page.fill('input[type=search]', 'weet-bix'); let t0 = Date.now(); await A.page.click('button[aria-label=Search]');
  await A.page.waitForSelector('.list .item'); T.packSearch = Date.now() - t0; log('search weet-bix first results:', T.packSearch + ' ms', await A.page.locator('.list .item .ell').first().textContent());
  await A.page.goto(BASE + '#/settings'); await A.page.waitForSelector('[data-testid=offpack-status][data-state=ready]');
  const line = (await A.page.textContent('[data-testid=offpack-status] span')).trim(); const v = (await A.page.textContent('[data-testid=app-version]')).trim();
  log('Settings:', line, '| About: v' + v, '|', (await A.page.textContent('[data-testid=off-credit]')).trim()); if (v !== '1.13.0') fail('live version ' + v);
  if (/\bAI\b/.test(await A.page.textContent('body'))) fail('"AI" in Settings');
  await A.page.locator('h2:has-text("Food lookup")').scrollIntoViewIfNeeded(); await A.page.evaluate(() => { const h = [...document.querySelectorAll('h2')].find((x) => x.textContent === 'Food lookup'); window.scrollBy(0, h.getBoundingClientRect().top - 70); });
  await A.page.waitForTimeout(300); await A.page.screenshot({ path: `${OUT}/v1130-settings-pack.png` });
  // second fresh device: the same pack-miss code is now an edge-cache hit at the Worker
  const B = await fresh('grug_live_b'); await B.page.evaluate(() => localStorage.setItem('offpackAuto', '0'));
  r = await scan(B.page, COLD); T.workerCached = r.ms; log('2nd device, Worker cache:', r.o, r.ms + ' ms', B.food.join(' ; '));
  const w = await B.page.evaluate(async (c) => { const t0 = performance.now(); const x = await fetch(`https://grug-coach-proxy.grug-fitgrug-fitgrug-fit.workers.dev/food/barcode?code=${c}`, { headers: { 'X-Device-Id': localStorage.getItem('coachDevice') }, cache: 'no-store' }); await x.text(); return [Math.round(performance.now() - t0), x.headers.get('x-food-cache')]; }, COLD);
  log('raw Worker cached fetch from browser:', w.join(' ms, cache='));
} finally { await b.close(); }
console.log('TIMINGS', JSON.stringify(T));
if (failed) { console.error(failed, 'failure(s)'); process.exit(1); } console.log('V1130 LIVE PASSED');
