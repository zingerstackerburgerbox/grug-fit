// v1.8.4: the Workout tab lists ALL workouts (native + imported, newest first, month headers, batched rendering) below Routines;
// no separate History button/page (old #/history links redirect); import summary / Home / auto-end links lead to the list;
// cards open the existing detail (repeat / save as routine / edit / delete); back restores the scroll position.
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const FX = new URL('./fixtures/hevy_real_style.csv', import.meta.url).pathname;
const NOW = new Date('2026-10-23T21:00:00+11:00');
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark', timezoneId: 'Australia/Sydney', locale: 'en-AU' }); await ctx.clock.install({ time: NOW });
const page = await ctx.newPage(); page.setDefaultTimeout(15000);
page.on('pageerror', (e) => fail('pageerror ' + e.message)); page.on('dialog', (d) => d.accept());
const idb = (src, arg) => page.evaluate(async ([src, arg]) => {
  const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); });
  const tx = (store, mode = 'readonly') => d.transaction(store, mode).objectStore(store);
  const p = (req) => new Promise((r, j) => { req.onsuccess = () => r(req.result); req.onerror = () => j(req.error); });
  const res = await new Function('tx', 'p', 'arg', `return (async () => { ${src} })()`)(tx, p, arg); d.close(); return res;
}, [src, arg]);
const cards = () => page.locator('[data-testid=workout-list] a.card');
const hideToast = () => page.addStyleTag({ content: '.toast{display:none!important}' });
await page.goto(BASE); await page.click('[data-testid=ob-skip]'); await page.waitForSelector("text=Today's nutrition");
await idb(`await p(tx('kv','readwrite').put({ id: 'bodyweight-seeded', v: 1 })); await p(tx('bodyweight','readwrite').put({ id: 'bw1', date: '2026-01-01', kg: 82 }));`).catch(() => {});
// empty state
await page.goto(BASE + '#/workouts?list=1'); await page.waitForSelector('[data-testid=workout-list]');
const btns = await page.locator('.grid2 a.btn').allTextContents(); log('buttons:', btns.join(' | '), '| empty:', (await page.textContent('[data-testid=workout-list]')).slice(0, 40));
if (btns.join() !== 'Exercises,Body weight' || await page.locator('a.btn:text-is("History")').count()) fail('History button should be gone, Exercises + Body weight kept');
// Erik's native workout today (9 × Bicep Curl) + his Hevy export
const t0 = NOW.getTime() - 3 * 3600e3;
await idb(`await p(tx('workouts','readwrite').put(arg));`, { id: 'native-today', name: 'Workout', start: t0, end: t0 + 77 * 60e3, exercises: [{ id: 'e', exerciseId: 'ex039', restSec: 90, sets: Array.from({ length: 9 }, (_, i) => ({ id: 's' + i, type: 'N', kg: 17.5, reps: 12, done: true })) }], prs: [] });
await page.goto(BASE + '#/settings'); await page.setInputFiles('[data-testid=import-input]', FX); await page.waitForSelector('[data-testid=import-preview]');
await page.click('[data-testid=import-go]'); await page.waitForSelector('[data-testid=import-done]');
const done = await page.textContent('[data-testid=import-done]'); const toast = await page.textContent('.toast').catch(() => ''); log('summary:', done.trim(), '| toast:', toast);
if (!/Imported 63 workouts from 05\/01\/2026 to 03\/07\/2026/.test(done) || !/Workout tab/.test(toast)) fail('import summary/toast');
// summary → Workout tab, scrolled to the list
await page.click('[data-testid=import-view-history]'); await page.waitForSelector('[data-testid=workout-list] a.card'); await page.waitForTimeout(400);
const top = await page.evaluate(() => document.getElementById('workout-list').getBoundingClientRect().top); log('after "View workouts":', page.url().split('#')[1], '| list heading at y =', Math.round(top));
if (!/^\/workouts/.test(page.url().split('#')[1]) || top > 120 || top < 0) fail('View workouts should land on the list');
const head = await page.textContent('#workout-list'); const n0 = await cards().count(); const months0 = await page.locator('[data-testid=month]').allTextContents();
log(head, '| rendered first:', n0, '| months:', months0.join(' | ')); if (!/· 64/.test(head) || n0 !== 20 || months0[0] !== 'October 2026 · 1 workout' || months0[1] !== 'July 2026 · 2 workouts') fail('first batch / month headers');
await page.evaluate(() => scrollTo(0, 0)); await hideToast(); await page.screenshot({ path: 'screenshots/53-workout-tab-list.png' });
await page.evaluate(() => document.querySelector('[data-testid=month]:nth-of-type(3)')?.scrollIntoView({ block: 'start' }) || scrollBy(0, 1400)); await page.evaluate(() => scrollBy(0, -70)); await page.waitForTimeout(300);
await page.screenshot({ path: 'screenshots/54-workout-tab-list-imported.png' });
// scrolling loads the rest, newest first, every month present
for (let i = 0; i < 10 && (await page.locator('[data-testid=list-more]').count()); i++) { await page.locator('[data-testid=list-more]').scrollIntoViewIfNeeded(); await page.waitForTimeout(250); }
const all = await cards().evaluateAll((l) => l.map((a) => a.getAttribute('href')));
const order = await idb(`return (await p(tx('workouts').getAll())).filter((w) => w.end).sort((a, b) => b.start - a.start).map((w) => '#/history/' + w.id)`);
const months = await page.locator('[data-testid=month]').allTextContents(); log('after scrolling:', all.length, 'cards |', months.length, 'months, last', months.at(-1));
if (all.length !== 64 || all.join() !== order.join() || months.length !== 8 || months.at(-1) !== 'January 2026 · 10 workouts') fail('full list in date order');
// open a card deep in the list → detail with actions → back restores position
const target = cards().nth(40); const href = await target.getAttribute('href'); await target.scrollIntoViewIfNeeded(); const y0 = await page.evaluate(() => scrollY); const topBefore = await target.evaluate((e) => e.getBoundingClientRect().top);
await target.click(); await page.waitForSelector('[data-testid=delete-workout]');
const actions = await page.locator('button, a.btn').allTextContents(); log('detail', href, 'actions:', actions.filter((t) => /Repeat|routine|Edit|Delete/i.test(t)).join(' | '));
if (!['Repeat', 'routine', 'Edit', 'Delete'].every((k) => actions.some((t) => t.includes(k)))) fail('detail actions');
await page.goBack(); await page.waitForSelector('[data-testid=workout-list] a.card'); await page.waitForTimeout(500); const y1 = await page.evaluate(() => scrollY);
const topAfter = await page.locator(`a.card[href="${href}"]`).evaluate((e) => e.getBoundingClientRect().top).catch(() => -1e9);
log('scroll before', y0, 'after back', y1, '| tapped card at y', Math.round(topBefore), '→', Math.round(topAfter)); if (Math.abs(topAfter - topBefore) > 30 || !(await page.locator(`a.card[href="${href}"]`).count())) fail('scroll restore after back');
// delete from detail → gone from list; save as routine → appears in Routines
await page.locator(`a.card[href="${href}"]`).click(); await page.click('[data-testid=delete-workout]'); await page.waitForSelector('[data-testid=workout-list]'); await page.waitForTimeout(400);
const head2 = await page.textContent('#workout-list'); log('after delete:', head2); if (!/· 63/.test(head2) || await page.locator(`a.card[href="${href}"]`).count()) fail('delete');
await page.goto(BASE + '#/history/native-today'); await page.click('text=Save as routine'); await page.goto(BASE + '#/workouts?list=1'); await page.waitForSelector('text=Start routine');
// old #/history link, Home link
await page.goto(BASE + '#/history'); await page.waitForURL(/#\/workouts\?list=1&at=all/); await page.waitForSelector('[data-testid=workout-list] a.card'); log('#/history redirects →', page.url().split('#')[1]);
await page.goto(BASE + '#/'); await page.click('[data-testid=home-all-workouts]'); await page.waitForURL(/#\/workouts/); await page.waitForSelector('[data-testid=workout-list] a.card'); log('Home "All workouts" →', page.url().split('#')[1]);
// performance: 600 workouts
await idb(`const st = tx('workouts','readwrite'); for (let i = 0; i < 600; i++) { const s = arg - (i + 2) * 864e5 * 0.9; await p(st.put({ id: 'bulk' + i, name: 'Bulk ' + i, start: s, end: s + 3600e3, exercises: [{ id: 'e', exerciseId: 'ex001', restSec: 90, sets: [{ id: 's', type: 'N', kg: 60, reps: 5, done: true }] }], prs: [] })); }`, t0);
await page.goto(BASE + '#/'); await page.waitForSelector("text=Today's nutrition");
const tA = Date.now(); await page.evaluate(() => { location.hash = '#/workouts?list=1'; }); await page.waitForSelector('[data-testid=workout-list] a.card'); const ms = Date.now() - tA;
const nBig = await cards().count(); const headBig = await page.textContent('#workout-list'); log(`663 workouts: list shown in ${ms} ms, ${nBig} cards in the DOM`, headBig);
if (nBig !== 20 || !/· 663/.test(headBig) || ms > 3000) fail('large list should render one batch quickly');
await b.close();
if (failed) { console.error(failed + ' FAILURES'); process.exit(1); } console.log('WORKOUT LIST TESTS PASSED');
