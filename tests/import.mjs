// v1.8.0 Settings › Import data: tutorial, multi-file pick, preview, import, dedupe on re-import, undo per source.
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const FX = ['hevy_workouts_kg.csv', 'hevy_workouts_lbs.csv', 'cronometer_servings.csv', 'cronometer_dailysummary.csv', 'cronometer_biometrics.csv', 'cronometer_exercises.csv', 'random.csv'].map((f) => new URL('./fixtures/' + f, import.meta.url).pathname);
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark', timezoneId: 'Australia/Sydney' }); const page = await ctx.newPage(); page.setDefaultTimeout(15000);
page.on('pageerror', (e) => fail('pageerror ' + e.message)); page.on('dialog', (d) => d.accept());
const uploads = []; page.on('request', (r) => { if (r.method() !== 'GET') uploads.push(r.url()); });
await page.goto(BASE); await page.fill('[data-testid=ob-username]', 'grug_tester').then(() => page.click('[data-testid=ob-next]')).then(() => page.click('[data-testid=ob-skip]')); await page.waitForSelector("text=Today's nutrition");
const idb = (src, arg) => page.evaluate(async ([src, arg]) => {
  const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); });
  const tx = (store, mode = 'readonly') => d.transaction(store, mode).objectStore(store);
  const p = (req) => new Promise((r, j) => { req.onsuccess = () => r(req.result); req.onerror = () => j(req.error); });
  const res = await new Function('tx', 'p', 'arg', `return (async () => { ${src} })()`)(tx, p, arg); d.close(); return res;
}, [src, arg]);
const counts = () => idb(`const [w, d, b, e] = await Promise.all(['workouts','diary','bodyweight','exercises'].map((s) => p(tx(s).getAll())));
  return { workouts: w.length, hevyW: w.filter((x) => x.importSource === 'hevy').length, acts: w.filter((x) => x.importSource === 'cronometer').length, diary: d.length, bw: b.length, bwImp: b.filter((x) => x.importSource).length, custom: e.filter((x) => x.importSource === 'hevy').length };`);
// a weigh-in the user logged themselves on 21 Oct: must win over Cronometer and survive undo
await idb(`await p(tx('bodyweight','readwrite').put({ id: 'bw2026-10-21', date: '2026-10-21', kg: 85.5 }));`);

await page.goto(BASE + '#/settings'); await page.waitForSelector('[data-testid=import-section]');
await page.click('[data-testid=tut-hevy] summary'); await page.click('[data-testid=tut-cron] summary');
const tut = await page.textContent('[data-testid=import-section]'); log('Hevy steps:', (await page.locator('[data-testid=tut-hevy] li').allTextContents()).join(' | '));
if (!/Export Workouts/.test(tut) || !/Export Food & Recipe Entries/.test(tut) || !/Menus may vary by app version/.test(tut) || (await page.locator('[data-testid=tut-cron] li').count()) !== 5) fail('tutorial text');
if (!/Then tap Choose files here/.test(tut)) fail('tutorial should end with "Then tap Choose files here"');
await page.locator('[data-testid=import-section]').scrollIntoViewIfNeeded(); await page.locator('[data-testid=import-section]').screenshot({ path: 'screenshots/42-import-tutorial.png' });
await page.click('[data-testid=tut-hevy] summary'); await page.click('[data-testid=tut-cron] summary');

// pick all files at once (multiple)
await page.setInputFiles('[data-testid=import-input]', FX); await page.waitForSelector('[data-testid=import-preview]');
const kinds = await page.locator('[data-testid=import-file]').evaluateAll((l) => l.map((x) => x.dataset.kind)); log('detected:', kinds.join(', '));
if (kinds.length !== 7 || !kinds.includes('unknown') || kinds.filter((k) => k === 'hevy').length !== 2) fail('file detection');
const tot = (await page.textContent('[data-testid=import-totals]')).replace(/\s+/g, ' '); log('totals:', tot);
if (!/5 workouts/.test(tot) || !/23 sets/.test(tot) || !/9 food entries/.test(tot) || !/3 weigh-ins/.test(tot) || !/3 new exercises/.test(tot) || !/0 activities/.test(tot)) fail('preview totals');
log('created:', await page.textContent('[data-testid=import-created]'));
await page.click('[data-testid=import-cronex]'); await page.waitForFunction(() => /2 activities/.test(document.querySelector('[data-testid=import-totals]').textContent));
await page.click('[data-testid=import-cronex]'); await page.waitForFunction(() => /0 activities/.test(document.querySelector('[data-testid=import-totals]').textContent));
await page.locator('[data-testid=import-preview]').scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
await page.locator('[data-testid=import-preview]').screenshot({ path: 'screenshots/43-import-preview.png' });
await page.click('[data-testid=import-go]'); await page.waitForSelector('[data-testid=import-done]');
log('done:', await page.textContent('[data-testid=import-done]'));
let c = await counts(); log('after import:', JSON.stringify(c));
if (c.hevyW !== 5 || c.diary !== 9 || c.bwImp !== 3 || c.bw !== 4 || c.custom !== 3 || c.acts !== 0) fail('imported counts');
if ((await idb(`return (await p(tx('bodyweight').get('bw2026-10-21'))).kg`)) !== 85.5) fail("user's own weigh-in was overwritten");

// re-import the same files → nothing new
await page.setInputFiles('[data-testid=import-input]', FX); await page.waitForSelector('[data-testid=import-preview]');
const sk = await page.textContent('[data-testid=import-skipped]'); log('re-import:', sk, '| button:', await page.textContent('[data-testid=import-go]'));
if (!/5 workouts/.test(sk) || !/9 food entries/.test(sk) || !(await page.locator('[data-testid=import-go]').isDisabled())) fail('dedupe on re-import');
await page.click('text=Cancel');
if (JSON.stringify(await counts()) !== JSON.stringify(c)) fail('counts changed after re-import preview');

// imported data shows in the app
await page.goto(BASE + '#/history'); await page.waitForSelector('[data-testid=card-kcal]'); await page.waitForFunction(() => /\d/.test(document.querySelector('[data-testid=card-kcal]')?.textContent || ''), null, { timeout: 5000 }).catch(() => {}); const cards = await page.locator('[data-testid=card-kcal]').count(); log('history cards:', cards); if (cards !== 5) fail('history should list 5 workouts');
await page.goto(BASE + '#/food/2026-10-20'); await page.waitForSelector('text=Oats, Rolled, Dry'); const diary = await page.textContent('.page');
if (!/1 cup · from Cronometer/.test(diary) || !/50 g/.test(diary)) fail('diary amounts'); else log('diary 20 Oct shows Cronometer entries');
await page.goto(BASE + '#/food/2026-10-19'); await page.waitForSelector('text=Cronometer daily total'); log('19 Oct: daily total entry shown');
await page.screenshot({ path: 'screenshots/44-import-diary.png' });

// undo per source
await page.goto(BASE + '#/settings'); await page.waitForSelector('[data-testid=import-undo-hevy]'); log('undo buttons:', (await page.locator('[data-testid^=import-undo]').allTextContents()).join(' | '));
await page.click('[data-testid=import-undo-hevy]'); await page.waitForTimeout(500); c = await counts(); log('after removing Hevy:', JSON.stringify(c));
if (c.hevyW !== 0 || c.custom !== 0 || c.diary !== 9) fail('Hevy undo');
await page.click('[data-testid=import-undo-cronometer]'); await page.waitForTimeout(500); c = await counts(); log('after removing Cronometer:', JSON.stringify(c));
if (c.diary !== 0 || c.bwImp !== 0 || c.bw !== 1) fail('Cronometer undo (own weigh-in must stay)');
if (await page.locator('[data-testid^=import-undo]').count()) fail('undo buttons should disappear');
if (uploads.length) fail('unexpected uploads: ' + uploads.join(', ')); else log('no network uploads during import');
await b.close();
if (failed) { console.log(`IMPORT TEST FAILED (${failed})`); process.exit(1); } console.log('IMPORT TEST PASSED');
