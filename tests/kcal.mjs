// v1.6.1: workout calories come from completed sets (reps × weight × bodyweight), never from elapsed/rest time.
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const MIN = 60e3;
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark', timezoneId: 'Australia/Sydney' }); const page = await ctx.newPage(); page.setDefaultTimeout(12000);
page.on('pageerror', (e) => fail('pageerror ' + e.message)); page.on('dialog', (d) => d.accept());
await page.goto(BASE); await page.click('[data-testid=ob-skip]'); await page.waitForSelector("text=Today's nutrition");
const idb = (src, arg) => page.evaluate(async ([src, arg]) => {
  const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); });
  const tx = (store, mode = 'readonly') => d.transaction(store, mode).objectStore(store);
  const p = (req) => new Promise((r, j) => { req.onsuccess = () => r(req.result); req.onerror = () => j(req.error); });
  const res = await new Function('tx', 'p', 'arg', `return (async () => { ${src} })()`)(tx, p, arg); d.close(); return res;
}, [src, arg]);
const now = Date.now();
const sets = (t0, gap) => [1, 2, 3].map((i) => ({ id: 'b' + i, type: 'N', kg: 80, reps: 10, done: true, doneAt: t0 + i * gap }));
const ymd = new Date(now).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
await idb(`await p(tx('bodyweight','readwrite').put({ id: 'bw' + arg.ymd, date: arg.ymd, kg: 85 }));
  // yesterday: same 3×10 @ 80 kg bench + 60 s plank with SHORT rests (12 min session)
  await p(tx('workouts','readwrite').put({ id: 'wShort', name: 'Short rests', start: arg.now - 864e5, end: arg.now - 864e5 + 12 * 60e3,
    exercises: [{ id: 'e1', exerciseId: 'ex001', restSec: 60, sets: [] }, { id: 'e2', exerciseId: 'ex074', restSec: 0, sets: [{ id: 'p', type: 'N', kg: null, reps: 60, done: true }] }] }));
  // in progress now: identical sets with LONG rests (started 75 min ago, 20 min between sets)
  await p(tx('kv','readwrite').put({ id: 'active', w: { id: 'wLong', name: 'Long rests', start: arg.now - 75 * 60e3, lastActivityAt: arg.now,
    exercises: [{ id: 'e1', exerciseId: 'ex001', restSec: 300, sets: [] }, { id: 'e2', exerciseId: 'ex074', restSec: 0, sets: [{ id: 'p', type: 'N', kg: null, reps: 60, done: true }, { id: 'p2', type: 'N', kg: null, reps: 60, done: false }] }] } }));`,
  { now, ymd });
// (functions can't cross into evaluate: build the sets here)
await idb(`const a = await p(tx('kv').get('active')); a.w.exercises[0].sets = arg.l; await p(tx('kv','readwrite').put(a));
  const w = await p(tx('workouts').get('wShort')); w.exercises[0].sets = arg.s; await p(tx('workouts','readwrite').put(w));`, { l: sets(now - 75 * MIN, 20 * MIN), s: sets(now - 864e5, MIN) });
await idb(`const s = await p(tx('kv').get('settings')); s.profile = { heightCm: 180, birthYear: 1990, sex: 'male', goal: 'maintain' }; await p(tx('kv','readwrite').put(s));`);
await page.goto(BASE + '#/workout/active'); await page.waitForSelector('[data-testid=live-kcal]'); await page.waitForTimeout(300);
const live = (await page.textContent('[data-testid=live-kcal]')).trim(); log('live estimate (75 min, long rests):', live);
if (live !== '31') fail(`live kcal ${live}, want 31 (3×8.74 bench + 4.76 plank)`);
const heads = await page.locator('table.sets thead').nth(1).textContent(); log('plank columns:', heads); if (!/Sec/.test(heads)) fail('plank should log seconds');
await page.click('text=Finish'); await page.click('text=Finish (discard unticked sets)');
await page.waitForSelector('[data-testid=workout-kcal-value]'); await page.waitForTimeout(400);
const sum = (await page.textContent('[data-testid=workout-kcal-value]')).trim(); log('summary:', sum, '|', await page.textContent('[data-testid=kcal-breakdown]'));
if (sum !== '31 kcal') fail('summary kcal ' + sum);
if (!/Rest time isn't counted/.test(await page.textContent('[data-testid=kcal-explain]'))) fail('explanation missing');
await page.screenshot({ path: 'screenshots/40-kcal-summary.png' });
await page.goto(BASE + '#/history'); await page.waitForSelector('[data-testid=card-kcal]'); await page.waitForFunction(() => /\d/.test(document.querySelector('[data-testid=card-kcal]')?.textContent || ''), null, { timeout: 5000 }).catch(() => {}); await page.waitForTimeout(300);
const cards = await page.locator('[data-testid=card-kcal]').allTextContents(); log('history cards:', cards.join(' | '));
if (cards.length !== 2 || !cards.every((c) => /🔥 31 kcal/.test(c))) fail('long-rest and short-rest workouts should both be 31 kcal');
await page.goto(BASE + '#/'); await page.waitForSelector('[data-testid=burn-split]'); await page.waitForTimeout(400);
const split = await page.textContent('[data-testid=burn-split]'); log('header today:', split); if (!/\+ 31 (kcal )?workout/.test(split)) fail('header should add 31 kcal workout');
await page.goto(BASE + '#/settings'); await page.waitForSelector('[data-testid=kcal-method]'); log('settings note:', await page.textContent('[data-testid=kcal-method]'));
await b.close();
if (failed) { console.log(`KCAL TEST FAILED (${failed})`); process.exit(1); } console.log('KCAL TEST PASSED');
