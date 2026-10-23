// v1.6.0: Workout tab opens the active workout; mini-bar; stale workouts auto-end at the last completed set after 2 h idle; review modal.
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const b = await chromium.launch();
const MIN = 60e3, H = 3600e3;
const newPage = async (time) => {
  const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark', timezoneId: 'Australia/Melbourne' }); const page = await ctx.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', (e) => fail('pageerror ' + e.message)); page.on('dialog', (d) => d.accept());
  if (time) await page.clock.install({ time });
  await page.goto(BASE); await page.click('[data-testid=ob-skip]'); await page.waitForSelector("text=Today's nutrition"); return page;
};
const idb = (page, src, arg) => page.evaluate(async ([src, arg]) => {
  const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); });
  const tx = (store, mode = 'readonly') => d.transaction(store, mode).objectStore(store);
  const p = (req) => new Promise((r, j) => { req.onsuccess = () => r(req.result); req.onerror = () => j(req.error); });
  const res = await new Function('tx', 'p', 'arg', `return (async () => { ${src} })()`)(tx, p, arg); d.close(); return res;
}, [src, arg]);
const put = (page, store, v) => idb(page, `await p(tx('${store}','readwrite').put(arg));`, v);
const getv = (page, store, id) => idb(page, `return await p(tx('${store}').get(arg));`, id);
const route = (page) => page.evaluate(() => location.hash);

// ---------- 1. Workout tab → active workout; minimize; mini-bar; scroll kept ----------
{
  const page = await newPage();
  await page.goto(BASE + '#/workouts'); await page.waitForSelector('text=+ Start empty workout'); await page.click('text=+ Start empty workout');
  await page.waitForSelector('text=+ Add exercise'); await page.click('text=+ Add exercise');
  for (const n of ['Bench Press (Barbell)', 'Deadlift (Barbell)', 'Squat (Barbell)', 'Pull Up']) await page.locator('.sheet .item', { hasText: n }).first().click();
  await page.click('.sheet button.btn.p.grow'); await page.waitForTimeout(300);
  await page.locator('input[aria-label=Weight]').first().fill('60'); await page.locator('input[aria-label=Reps]').first().fill('8'); await page.locator('[aria-label="Complete set"]').first().click();
  await page.evaluate(() => window.scrollTo(0, 400)); await page.waitForTimeout(300); const y0 = await page.evaluate(() => window.scrollY);
  // dispatch the tap directly: Playwright's click would scroll the page itself when the rest-timer toast briefly overlaps the nav
  await page.locator('nav.tabs a:has-text("Home")').dispatchEvent('click'); await page.waitForSelector('[data-testid=minibar]');
  const mb = await page.textContent('[data-testid=minibar]'); log('mini-bar on Home:', mb); if (!/Workout in progress · \d+:\d\d/.test(mb)) fail('mini-bar text');
  await page.screenshot({ path: 'screenshots/37-minibar.png' });
  await page.locator('nav.tabs a:has-text("Workout")').dispatchEvent('click'); await page.waitForSelector('[data-testid=minimize]'); log('nav tab →', await route(page));
  if (await route(page) !== '#/workout/active') fail('Workout tab did not open the active workout');
  await page.waitForTimeout(400); const y1 = await page.evaluate(() => window.scrollY); log('scroll kept:', y0, '→', y1); if (Math.abs(y1 - y0) > 30) fail('scroll position not preserved');
  if (await page.locator('[data-testid=minibar]').count()) fail('mini-bar shown on the workout itself');
  await page.click('[data-testid=minimize]'); await page.waitForSelector('[data-testid=resume-active]'); log('minimize →', await route(page));
  await page.click('[data-testid=minibar]'); await page.waitForSelector('[data-testid=minimize]'); log('mini-bar tap → active');
  await page.goto(BASE + '#/food'); await page.goto(BASE + '#/workouts'); await page.waitForSelector('[data-testid=minimize]'); log('deep link #/workouts →', await route(page));
  await page.goto(BASE + '#/workouts'); await page.reload(); await page.waitForSelector('[data-testid=minimize]'); log('launch onto Workout tab →', await route(page));
  const a = await getv(page, 'kv', 'active'); const st = a.w.exercises[0].sets[0];
  log('activity stamps: lastActivityAt', !!a.w.lastActivityAt, 'doneAt', !!st.doneAt); if (!a.w.lastActivityAt || !st.doneAt) fail('activity not tracked');
  await page.context().close();
}

// ---------- 2. stale workout: no auto-end at 1h59m idle; auto-end at 2h while open, at the last completed set ----------
const T0 = Date.parse('2026-10-22T18:00:00+11:00'); // 6 pm Melbourne
const mkActive = (t0, o = {}) => ({ id: 'wA' + t0, name: 'Push Day', start: t0, lastActivityAt: t0 + 45 * MIN, intensity: 'moderate', ...o, exercises: [
  { id: 'e1', exerciseId: 'ex001', restSec: 90, sets: [
    { id: 's1', type: 'N', kg: 80, reps: 5, done: true, doneAt: t0 + 10 * MIN },
    { id: 's2', type: 'N', kg: 85, reps: 5, done: true, doneAt: t0 + 40 * MIN },
    { id: 's3', type: 'N', kg: 120, reps: 5, done: false }, // filled, never ticked: kept, no volume/PR
    { id: 's4', type: 'N', kg: null, reps: null, done: false }] }, // empty: dropped
  { id: 'e2', exerciseId: 'ex012', restSec: 90, sets: [{ id: 's5', type: 'N', kg: null, reps: null, done: false }] }] });
const prior = { id: 'wPrev', name: 'Push Day', start: T0 - 3 * 864e5, end: T0 - 3 * 864e5 + H, exercises: [{ id: 'p1', exerciseId: 'ex001', restSec: 90, sets: [{ id: 'q', type: 'N', kg: 80, reps: 5, done: true }] }] };
{
  const page = await newPage(T0 + 45 * MIN + 119 * MIN); // 1h59m after the last activity
  await put(page, 'bodyweight', { id: 'bw1', date: '2026-10-01', kg: 80 }); await put(page, 'workouts', prior); await put(page, 'kv', { id: 'active', w: mkActive(T0) });
  await page.reload(); await page.waitForSelector("text=Today's nutrition"); await page.goto(BASE + '#/workouts'); await page.waitForSelector('[data-testid=minimize]');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await page.waitForTimeout(500);
  if (await page.locator('[data-testid=autoend-modal]').count() || !(await getv(page, 'kv', 'active'))?.w) fail('auto-ended at 1h59m'); else log('1h59m idle: still in progress');
  await page.clock.runFor(2 * MIN); // the 60 s timer fires past 2 h while the workout screen is open
  await page.waitForSelector('[data-testid=autoend-modal]', { timeout: 8000 }).catch(() => fail('no auto-end after 2 h idle'));
  log('after 2h01m idle → route', await route(page), '| modal:', (await page.textContent('[data-testid=autoend-text]')).replace(/\s+/g, ' '));
  await page.screenshot({ path: 'screenshots/36-autoend-review.png' });
  const w = await getv(page, 'workouts', 'wA' + T0); const act = await getv(page, 'kv', 'active');
  const vol = w.exercises.flatMap((e) => e.sets).filter((s) => s.done).reduce((a, s) => a + s.kg * s.reps, 0);
  log('saved:', JSON.stringify({ end: new Date(w.end).toISOString(), durMin: (w.end - w.start) / MIN, autoEnded: w.autoEnded, needsReview: w.needsReview, sets: w.exercises.map((e) => e.sets.map((s) => `${s.kg}x${s.reps}${s.done ? '✓' : '○'}`).join(' ')), prs: w.prs }));
  if (act?.w) fail('active workout not cleared');
  if (w.end !== T0 + 40 * MIN) fail('end is not the last completed set');
  if (!w.autoEnded || !w.needsReview) fail('flags missing');
  if (w.exercises.length !== 1 || w.exercises[0].sets.length !== 3 || w.exercises[0].sets[2].done !== false || w.exercises[0].sets[2].kg !== 120) fail('set handling (keep filled unticked, drop empty)');
  if (!(w.prs.length && w.prs.every((p) => p.kind !== 'weight' || p.value === 85))) fail('PRs should come from ticked sets only (85 kg), not the unticked 120');
  const txt = await page.textContent('[data-testid=autoend-text]'); if (!/18:00/.test(txt) || !/18:40/.test(txt) || !/40 min/.test(txt)) fail('modal text times/duration');
  // history card: kcal from the 2 ticked sets only (80×5, 85×5 bench, 80 kg lifter) = 4.25 + 4.40 ≈ 9; the unticked 120 kg set and idle time add nothing
  await page.click('[data-testid=ae-yes]'); await page.waitForTimeout(300);
  if ((await getv(page, 'workouts', 'wA' + T0)).needsReview) fail('"Yes" did not clear the flag'); else log('"Yes, it was complete" → reviewed');
  await page.goto(BASE + '#/history'); await page.waitForSelector('[data-testid=card-kcal]'); const k = await page.locator('[data-testid=card-kcal]').first().textContent(); log('history kcal', k, 'volume', vol);
  if (!/🔥 9 kcal/.test(k)) fail('kcal should come from ticked sets only (9)'); if (await page.locator('[data-testid=autoended-badge]').count()) fail('badge still shown after review');
  await page.context().close();
}

// ---------- 3. launch-time check + Resume / Edit / Discard + multiple + >12 h + clock backwards ----------
{
  const now = T0 + 5 * H; const page = await newPage(now);
  await put(page, 'workouts', prior); await put(page, 'kv', { id: 'active', w: mkActive(T0) });
  await page.reload(); await page.waitForSelector('[data-testid=autoend-modal]'); log('launch with stale workout → modal on open');
  await page.goto(BASE + '#/history'); await page.waitForSelector('[data-testid=autoended-badge]'); log('history badge while unreviewed');
  await page.click('[data-testid=ae-resume]'); await page.waitForSelector('[data-testid=minimize]');
  const a = await getv(page, 'kv', 'active'); const gone = !(await getv(page, 'workouts', 'wA' + T0));
  log('Resume →', await route(page), '| start kept', a?.w?.start === T0, '| end cleared', a?.w?.end == null, '| removed from history', gone);
  if (!(a?.w?.start === T0 && a.w.end == null && !a.w.needsReview && gone)) fail('Resume');
  // Edit
  await page.evaluate(() => indexedDB); await put(page, 'kv', { id: 'active', w: null });
  const wE = { ...mkActive(T0), id: 'wE', end: T0 + 40 * MIN, autoEnded: true, needsReview: true, autoEndedAt: now - 10 * MIN };
  await put(page, 'workouts', wE); await page.reload(); await page.waitForSelector('[data-testid=autoend-modal]');
  await page.click('[data-testid=ae-edit]'); await page.waitForSelector('[data-testid=edit-end]'); log('Edit →', await route(page));
  const endVal = await page.inputValue('[data-testid=edit-end]'); log('end field', endVal); if (endVal !== '2026-10-22T18:40') fail('end time not prefilled');
  await page.fill('[data-testid=edit-end]', '2026-10-22T19:05'); await page.click('[data-testid=save-workout]'); await page.waitForTimeout(400);
  const e2 = await getv(page, 'workouts', 'wE'); log('edited end', (e2.end - e2.start) / MIN, 'min, needsReview', e2.needsReview, '| shown', await page.textContent('[data-testid=detail-duration]'));
  if (e2.end !== T0 + 65 * MIN || e2.needsReview) fail('Edit save');
  // Discard + multiple queued
  await put(page, 'workouts', { ...wE, id: 'wD1', start: T0 - H, end: T0 - 20 * MIN }); await put(page, 'workouts', { ...wE, id: 'wD2', name: 'Legs', start: T0 + 30 * MIN, end: T0 + 90 * MIN });
  await page.reload(); await page.waitForSelector('[data-testid=autoend-modal]'); const head = await page.textContent('[data-testid=autoend-modal]'); log('queue:', /1 of 2/.test(head) ? '1 of 2' : head.slice(0, 60));
  if (!/1 of 2/.test(head)) fail('multiple stale workouts not queued');
  await page.click('[data-testid=ae-discard]'); await page.waitForTimeout(300); if (await getv(page, 'workouts', 'wD1')) fail('Discard'); else log('Discard → deleted (after confirm)');
  const t2 = await page.textContent('[data-testid=autoend-text]'); if (!/Legs/.test(t2)) fail('second queued workout not shown next'); await page.click('[data-testid=ae-yes]');
  await page.waitForTimeout(300); if (await page.locator('[data-testid=autoend-modal]').count()) fail('modal still open after queue');
  // ended more than ~12 h ago: no Resume
  await put(page, 'kv', { id: 'active', w: mkActive(now - 14 * H, { id: 'wOld' }) }); await page.reload(); await page.waitForSelector('[data-testid=autoend-modal]');
  if (await page.locator('[data-testid=ae-resume]').count()) fail('Resume offered > 12 h after the end'); else log('>12 h old → no Resume option');
  await page.click('[data-testid=ae-yes]');
  // clock moved backwards (lastActivityAt in the future): no auto-end, window restarts
  await put(page, 'kv', { id: 'active', w: mkActive(now - H, { id: 'wBack', lastActivityAt: now + 3 * H }) }); await page.goto(BASE + '#/'); await page.reload(); await page.waitForSelector("text=Today's nutrition"); await page.waitForTimeout(300);
  const back = await getv(page, 'kv', 'active'); log('clock backwards → still active', !!back?.w, '| lastActivityAt reset', back?.w?.lastActivityAt <= now + MIN);
  if (!back?.w || back.w.lastActivityAt > now + MIN || await page.locator('[data-testid=autoend-modal]').count()) fail('clock-backwards handling');
  // pre-1.6 workout (no lastActivityAt) gets a fresh 2 h window instead of being ended at once
  await put(page, 'kv', { id: 'active', w: (({ lastActivityAt, ...x }) => x)(mkActive(now - 4 * H, { id: 'wLegacy' })) }); await page.reload(); await page.waitForSelector("text=Today's nutrition"); await page.waitForTimeout(300);
  const lg = await getv(page, 'kv', 'active'); if (!lg?.w || lg.w.id !== 'wLegacy') fail('legacy workout ended immediately'); else log('legacy (no stamp) → grace window started');
  await page.context().close();
}
await b.close();
if (failed) { console.error(`${failed} failure(s)`); process.exit(1); } console.log('WORKOUT AUTO-END TEST PASSED');
