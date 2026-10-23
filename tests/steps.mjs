// v1.9.1 manual steps: Workout-tab card (quick log, goal bar, step kcal), #/steps page (any date, 7-day chart, recent days),
// Settings goal, burned-today = resting + workouts + steps, Trends, Backup round-trip, legacy automatic-step data cleaned up,
// and no trace of automatic step counting / the Android app anywhere in the UI.
import { chromium, devices } from 'playwright'; import { readFileSync } from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const b = await chromium.launch(); const opts = { ...devices['Pixel 7'], colorScheme: 'dark', locale: 'en-AU', timezoneId: 'Australia/Sydney' };
const ctx = await b.newContext(opts); const page = await ctx.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', (e) => fail('pageerror ' + e.message)); page.on('dialog', (d) => d.accept());
const idb = (src) => page.evaluate(async (src) => { const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); });
  const tx = (s, m = 'readonly') => d.transaction(s, m).objectStore(s); const p = (q) => new Promise((r, j) => { q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
  const res = await new Function('tx', 'p', `return (async () => { ${src} })()`)(tx, p); d.close(); return res; }, src);
const f = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = f(new Date()); const Y = new Date(); Y.setDate(Y.getDate() - 1); const YEST = f(Y);
const BANNED = /android app|android version|grug fit android|get the android|\bapk\b|step counter|step sensor|counted automatically|physical activity permission|health connect|google fit/i;

await page.goto(BASE); await page.fill('[data-testid=ob-username]', 'grug_tester').then(() => page.click('[data-testid=ob-next]')).then(() => page.click('[data-testid=ob-skip]')); await page.waitForSelector("text=Today's nutrition");
// profile (male, 180 cm, 80 kg) + leftovers from the removed automatic counter (device cache + Home-card toggle), schema back to 5
await idb(`const s = await p(tx('kv').get('settings')); await p(tx('kv','readwrite').put({ ...s, stepsCard: 'off', profile: { heightCm: 180, sex: 'male', birthYear: 1990, goal: 'maintain' } }));
  await p(tx('bodyweight','readwrite').put({ id: 'bw1', date: '${TODAY}', kg: 80 })); await p(tx('kv','readwrite').put({ id: 'steps', v: { days: { '${TODAY}': 15000 }, segs: [], synced: Date.now() } }));
  await p(tx('kv','readwrite').put({ id: 'schema', v: 5 }));`);
await page.reload(); await page.waitForSelector('[data-testid=burn-split]'); await page.waitForTimeout(300);
const legacy = await idb(`return [!!(await p(tx('kv').get('steps'))), 'stepsCard' in (await p(tx('kv').get('settings'))), (await p(tx('kv').get('schema'))).v]`);
const split0 = (await page.textContent('[data-testid=burn-split]')).trim(); const burned0 = parseInt((await page.textContent('[data-testid=burned]')).replace(/\D/g, ''));
log('legacy automatic-step data after migration (cache, toggle, schema):', JSON.stringify(legacy), '| burned', burned0, '=', split0);
if (legacy[0] || legacy[1] || legacy[2] !== 6) fail('legacy cleanup'); if (/steps/.test(split0)) fail('old automatic steps still counted');
if (await page.locator('[data-testid=steps-card]').count()) fail('steps card on Home (should be on the Workout tab)');
// Workout tab: quick log
await page.goto(BASE + '#/workouts'); await page.waitForSelector('[data-testid=steps-card]');
log('Workout tab card (empty):', (await page.textContent('[data-testid=steps-card]')).replace(/\s+/g, ' ').trim());
await page.click('[data-testid=steps-log]'); await page.fill('[data-testid=steps-input]', '12,000'); await page.click('[data-testid=steps-save]'); await page.waitForTimeout(400);
const card = (await page.textContent('[data-testid=steps-card]')).replace(/\s+/g, ' ').trim(); log('after logging 12,000:', card);
if ((await page.textContent('[data-testid=steps-today]')) !== '12,000' || !/\/ 8,000/.test(card) || !/\+299 kcal/.test(card)) fail('card after logging');
await page.screenshot({ path: 'screenshots/80-workout-tab-steps.png' });
// burned-today = resting + workouts + steps
await page.goto(BASE); await page.waitForSelector('[data-testid=burn-split]'); await page.waitForTimeout(300);
const split1 = (await page.textContent('[data-testid=burn-split]')).trim(); const burned1 = parseInt((await page.textContent('[data-testid=burned]')).replace(/\D/g, ''));
log('Home burned-today:', burned1, '=', split1); if (burned1 !== burned0 + 299 || !/\+ 299 steps/.test(split1)) fail('burned-today with steps');
// #/steps page: past day via date picker, chart, recent list, explanation
await page.goto(BASE + '#/steps'); await page.waitForSelector('[data-testid=steps-chart]');
await page.fill('[data-testid=steps-date-input]', YEST); await page.waitForFunction(() => document.querySelector('[data-testid=steps-date]').textContent === 'Yesterday');
await page.fill('[data-testid=steps-input]', '6500'); await page.click('[data-testid=steps-save]'); await page.waitForTimeout(300);
const sum = await page.textContent('[data-testid=steps-day-summary]'); log('yesterday:', sum); if (!/6,500 steps · 81% of goal/.test(sum)) fail('past-day entry');
const rec = (await page.locator('[data-testid=steps-recent] .item').allTextContents()).slice(0, 3); log('recent days:', rec.join(' | ')); if (!/Today12,000 ✓/.test(rec[0]) || !/Yesterday6,500/.test(rec[1])) fail('recent list');
if (!/counted twice/.test(await page.textContent('[data-testid=steps-explain]'))) fail('double-count note');
await page.locator('[data-testid=steps-recent] .item').first().click(); await page.waitForTimeout(300); await page.screenshot({ path: 'screenshots/81-steps-page.png' });
const stored = await idb(`return (await p(tx('kv').get('stepLog'))).days`); log('stored:', JSON.stringify(stored)); if (stored[TODAY] !== 12000 || stored[YEST] !== 6500) fail('stored log');
// clearing a day
await page.fill('[data-testid=steps-date-input]', YEST); await page.waitForFunction(() => document.querySelector('[data-testid=steps-input]').value === '6500'); await page.fill('[data-testid=steps-input]', ''); await page.click('[data-testid=steps-save]'); await page.waitForTimeout(300);
if ((await idb(`return (await p(tx('kv').get('stepLog'))).days`))[YEST] !== undefined) fail('clear day'); else log('empty + Save clears the day');
await page.fill('[data-testid=steps-input]', '6500'); await page.click('[data-testid=steps-save]'); await page.waitForTimeout(200);
// Settings goal: 10,000 then none
await page.goto(BASE + '#/settings'); await page.waitForSelector('[data-testid=step-goal]'); await page.fill('[data-testid=step-goal]', '10000'); await page.click('[data-testid=step-goal-save]'); await page.waitForTimeout(200);
await page.goto(BASE + '#/workouts'); await page.waitForSelector('[data-testid=steps-card]'); await page.waitForFunction(() => /\/ 10,000/.test(document.querySelector('[data-testid=steps-card]').textContent), null, { timeout: 5000 }).catch(() => {}); if (!/\/ 10,000/.test(await page.textContent('[data-testid=steps-card]'))) fail('goal 10,000');
await page.goto(BASE + '#/settings'); await page.waitForFunction(() => document.querySelector('[data-testid=step-goal]')?.value === '10000'); await page.fill('[data-testid=step-goal]', ''); await page.click('[data-testid=step-goal-save]'); await page.waitForTimeout(200);
await page.goto(BASE + '#/workouts'); await page.waitForSelector('[data-testid=steps-card]'); await page.waitForFunction(() => !/\//.test(document.querySelector('[data-testid=steps-card]').textContent), null, { timeout: 5000 }).catch(() => {}); if (/\//.test(await page.textContent('[data-testid=steps-card]')) || await page.locator('[data-testid=steps-card] .bar').count()) fail('no goal'); else log('goal 10,000 shown, then "no goal" hides the bar');
// Trends
await page.goto(BASE + '#/food/trends'); const tr = await page.waitForSelector('[data-testid=trends-steps]').then(() => page.textContent('[data-testid=trends-steps]')).catch(() => '');
log('Trends:', tr.replace(/\s+/g, ' ').slice(0, 90)); if (!/Average 9,250 steps on 2 logged days/.test(tr)) fail('trends steps');
// nowhere mentions automatic counting / the Android app; #/android is gone
for (const r of ['#/', '#/workouts', '#/food', '#/supps', '#/coach', '#/settings', '#/steps']) { await page.goto(BASE + r); await page.waitForTimeout(400); const t = await page.textContent('body'); const m = t.match(BANNED); if (m) fail(`"${m[0]}" on ${r}`); }
await page.goto(BASE + '#/android'); await page.waitForTimeout(300); log('#/android →', await page.evaluate(() => location.hash || '(home)')); if (/android/.test(await page.evaluate(() => location.hash))) fail('#/android still routed');
log('no automatic-step / Android wording on any page');
// Backup round-trip
await page.goto(BASE + '#/settings'); const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Export all data')]); const file = await dl.path();
const bj = JSON.parse(readFileSync(file, 'utf8')); const bl = bj.data.kv.find((r) => r.id === 'stepLog'); log('backup stepLog:', JSON.stringify(bl?.days)); if (bl?.days?.[TODAY] !== 12000) fail('backup has steps');
const ctx2 = await b.newContext(opts); const p2 = await ctx2.newPage(); p2.on('dialog', (d) => d.accept());
await p2.goto(BASE); await p2.fill('[data-testid=ob-username]', 'grug_tester').then(() => p2.click('[data-testid=ob-next]')).then(() => p2.click('[data-testid=ob-skip]')); await p2.waitForSelector("text=Today's nutrition"); await p2.goto(BASE + '#/settings'); await p2.waitForSelector('text=Import (replace)');
const [fc] = await Promise.all([p2.waitForEvent('filechooser'), p2.click('text=Import (replace)')]); await fc.setFiles(file); await p2.waitForSelector('text=Backup restored'); await p2.waitForTimeout(300);
await p2.goto(BASE + '#/workouts'); await p2.waitForSelector('[data-testid=steps-today]'); await p2.waitForFunction(() => document.querySelector('[data-testid=steps-today]').textContent !== '–', null, { timeout: 5000 }).catch(() => {}); const r2 = await p2.textContent('[data-testid=steps-today]'); log('restored on a fresh device:', r2); if (r2 !== '12,000') fail('restore');
await ctx2.close();
await b.close(); if (failed) { console.error(failed + ' FAILURES'); process.exit(1); } console.log('STEPS TESTS PASSED');
