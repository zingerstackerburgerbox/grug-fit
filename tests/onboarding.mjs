// Onboarding (fresh + existing install), BMR maths, burned-today header, workout calories, eat-back toggle.
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const log = (...a) => console.log('•', ...a); let failed = 0;
const fail = (m) => { console.error('FAIL:', m); failed++; };
const eq = (name, got, want) => { if (String(got).trim() !== String(want)) fail(`${name}: got ${got}, want ${want}`); else log(name, '=', got); };
const b = await chromium.launch();
const idb = (page, fn, arg) => page.evaluate(async ([src, arg]) => {
  const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); });
  const tx = (store, mode = 'readonly') => d.transaction(store, mode).objectStore(store);
  const p = (req) => new Promise((r, j) => { req.onsuccess = () => r(req.result); req.onerror = () => j(req.error); });
  const res = await new Function('tx', 'p', 'arg', `return (async () => { ${src} })()`)(tx, p, arg); d.close(); return res;
}, [fn, arg]);
const num = (t) => Number(String(t).replace(/[^\d.-]/g, ''));

// ---------- fresh install ----------
{
  const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' }); const page = await ctx.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => fail('pageerror ' + e.message));
  await page.goto(BASE); await page.waitForSelector('[data-testid=onboarding][data-step=welcome]'); log('fresh: onboarding shown on first open');
  await page.click('[data-testid=ob-next]');
  await page.fill('[aria-label="Height (cm)"]', '180'); await page.fill('[aria-label=Weight]', '85'); await page.click('[data-testid=ob-next]');
  await page.fill('[aria-label=Age]', '30'); await page.click('[data-testid=sex-male]'); await page.click('[data-testid=ob-next]');
  await page.click('[data-testid=goal-cut]'); await page.screenshot({ path: 'screenshots/19-onboarding-goal.png' }); await page.click('[data-testid=ob-next]');
  await page.waitForSelector('[data-testid=ob-bmr]');
  eq('BMR (male 180 cm 85 kg 30 y)', await page.textContent('[data-testid=ob-bmr]'), '1830');
  eq('sedentary burn', num(await page.textContent('[data-testid=ob-sedentary]')), '2196');
  const sug = await page.$$eval('[data-testid=onboarding] input', (l) => l.map((i) => i.value));
  log('suggested cut targets kcal/P/F/C:', sug.join(' / ')); eq('cut kcal (−20% of 2196, rounded)', sug[0], '1760'); eq('protein 2 g/kg', sug[1], '170');
  if (await page.locator('[data-testid=ob-keep]').count()) fail('fresh install should not offer "keep current"');
  await page.screenshot({ path: 'screenshots/20-onboarding-result.png' });
  await page.click('[data-testid=ob-use]'); await page.waitForSelector('text=Today\'s nutrition');
  const st = await idb(page, `return p(tx('kv').get('settings'))`); eq('saved kcal target', st.targets.kcal, 1760); eq('saved protein target', st.targets.protein, 170); eq('profile goal', st.profile.goal, 'cut');
  const bw = await idb(page, `return p(tx('bodyweight').getAll())`); eq('first body-weight entry', bw.map((x) => x.kg).join(','), '85');
  eq('header burned (no workout)', num(await page.textContent('[data-testid=burned]')), '2196');
  // completed workout today, 3×10 bench at 80 kg (+1 unticked set) over 1 h, 85 kg lifter → per-set estimate 26 kcal (time not counted)
  const now = Date.now();
  await idb(page, `const S = (i, done) => ({ id: 's' + i, type: 'N', kg: 80, reps: 10, done }); return p(tx('workouts','readwrite').put({ id: 'wtest', name: 'Test lift', start: arg - 3600000, end: arg, exercises: [{ id: 'e1', exerciseId: 'ex001', restSec: 180, sets: [S(1, true), S(2, true), S(3, true), S(4, false)] }] }))`, now);
  await page.reload(); await page.waitForSelector('[data-testid=burned]');
  eq('header burned incl. workout', num(await page.textContent('[data-testid=burned]')), '2222');
  eq('cut: eat-back off → remaining = target', num(await page.textContent('[data-testid=remaining]')), '1760');
  await page.goto(BASE + '#/settings'); await page.check('[data-testid=eatback]'); await page.goto(BASE + '#/');
  await page.waitForSelector('[data-testid=burned]'); await page.waitForTimeout(300);
  eq('eat-back on → remaining = 1760 + 26', num(await page.textContent('[data-testid=remaining]')), '1786');
  await page.screenshot({ path: 'screenshots/21-burned-today.png' });
  await page.goto(BASE + '#/food'); await page.waitForSelector('[data-testid=burned]'); eq('Food tab header burned', num(await page.textContent('[data-testid=burned]')), '2222');
  await page.goto(BASE + '#/history'); await page.waitForSelector('[data-testid=card-kcal]'); eq('history card kcal', num(await page.textContent('[data-testid=card-kcal]')), '26');
  await page.goto(BASE + '#/history/wtest'); await page.waitForSelector('[data-testid=workout-kcal-value]'); await page.waitForTimeout(300);
  eq('detail per-set estimate', num(await page.textContent('[data-testid=workout-kcal-value]')), '26');
  if (await page.locator('text=Vigorous 6').count()) fail('intensity picker should be gone');
  if (!/rest time isn't counted/i.test(await page.textContent('[data-testid=kcal-explain]'))) fail('explanation missing');
  if (!/Bench Press \(Barbell\) · 3 sets/.test(await page.textContent('[data-testid=kcal-breakdown]'))) fail('breakdown should count 3 ticked sets');
  await page.fill('[aria-label="Override calories"]', '500'); await page.click('[data-testid=workout-kcal] button:has-text("Save")'); await page.waitForTimeout(300);
  await page.goto(BASE + '#/'); await page.waitForSelector('[data-testid=burned]'); await page.waitForTimeout(300);
  eq('header with manual override', num(await page.textContent('[data-testid=burned]')), '2696');
  // live update while a workout is in progress
  await page.goto(BASE + '#/workouts'); await page.click('text=+ Start empty workout'); await page.waitForSelector('[data-testid=live-kcal]');
  await idb(page, `const a = await p(tx('kv').get('active')); a.w.start = Date.now() - 1800000; return p(tx('kv','readwrite').put(a))`);
  await page.goto(BASE + '#/'); await page.waitForSelector('[data-testid=burned]'); await page.waitForTimeout(400);
  eq('30 min live workout with no ticked sets adds nothing', num(await page.textContent('[data-testid=burned]')), '2696');
  await idb(page, `const a = await p(tx('kv').get('active')); a.w.exercises = [{ id: 'le', exerciseId: 'ex001', restSec: 90, sets: [{ id: 'l1', type: 'N', kg: 80, reps: 10, done: true, doneAt: Date.now() }] }]; a.w.lastActivityAt = Date.now(); return p(tx('kv','readwrite').put(a))`);
  await page.reload(); await page.waitForSelector('[data-testid=burned]'); await page.waitForTimeout(400);
  const live = num(await page.textContent('[data-testid=burned]')); log('header during live workout with 1 ticked set:', live, await page.textContent('[data-testid=burn-split]'));
  eq('live ticked set included (+9)', live, '2705');
  await page.reload(); await page.waitForSelector('text=Today\'s nutrition'); if (await page.locator('[data-testid=onboarding]').count()) fail('onboarding shown again');
  await ctx.close();
}
// ---------- existing install (Erik: data + custom targets, no profile) ----------
{
  const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' }); const page = await ctx.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => fail('pageerror ' + e.message));
  await page.goto(BASE); await page.waitForSelector('[data-testid=onboarding]');
  // simulate a v1.2 install: custom targets, diary, workouts, body weight, no onboarded flag
  await idb(page, `const s = await p(tx('kv').get('settings')); delete s.onboarded; s.targets = { ...s.targets, kcal: 1800, protein: 150, fat: 60, carbs: 180 };
    await p(tx('kv','readwrite').put(s)); await p(tx('bodyweight','readwrite').put({ id: 'bw2026-10-01', date: '2026-10-01', kg: 84 }));
    await p(tx('diary','readwrite').put({ id: 'd1', date: '2026-10-20', meal: 'lunch', foodId: 'x', name: 'Rice', grams: 200, qty: 200, serving: 'g', n: { kcal: 260, protein: 5, carbs: 56, fibre: 1, fat: 1 }, created: 1 }));
    await p(tx('workouts','readwrite').put({ id: 'wold', name: 'Old push', start: 1760000000000, end: 1760003600000, exercises: [] }));`);
  await page.reload(); await page.waitForSelector('[data-testid=onboarding][data-step=welcome]');
  if (!(await page.textContent('[data-testid=onboarding]')).includes('Welcome back')) fail('existing install should say welcome back');
  await page.click('[data-testid=ob-next]'); await page.fill('[aria-label="Height (cm)"]', '180');
  eq('weight prefilled from latest log', await page.inputValue('[aria-label=Weight]'), '84');
  await page.click('[data-testid=ob-next]'); await page.fill('[aria-label=Age]', '30'); await page.click('[data-testid=sex-male]'); await page.click('[data-testid=ob-next]');
  await page.click('[data-testid=goal-maintain]'); await page.click('[data-testid=ob-next]'); await page.waitForSelector('[data-testid=ob-keep]');
  eq('existing: BMR 84 kg', await page.textContent('[data-testid=ob-bmr]'), '1820');
  await page.click('[data-testid=ob-keep]'); await page.waitForSelector('text=Today\'s nutrition');
  const st = await idb(page, `return p(tx('kv').get('settings'))`);
  eq('kept kcal', st.targets.kcal, 1800); eq('kept protein', st.targets.protein, 150); eq('profile saved', st.profile?.goal, 'maintain');
  const counts = await idb(page, `return [(await p(tx('diary').getAll())).length, (await p(tx('workouts').getAll())).length, (await p(tx('bodyweight').getAll())).length]`);
  eq('data preserved diary/workouts/bodyweight', counts.join('/'), '1/1/1');
  eq('maintain: eat-back default on → remaining', num(await page.textContent('[data-testid=remaining]')), '1800');
  await page.goto(BASE + '#/settings'); await page.click('[data-testid=recalculate]'); await page.waitForSelector('[data-testid=ob-use]');
  await page.click('[data-testid=ob-use]'); await page.waitForURL(/#\/settings/);
  const st2 = await idb(page, `return p(tx('kv').get('settings'))`); eq('recalculated maintain kcal (2184 → 2180)', st2.targets.kcal, 2180); eq('maintain protein 1.6 g/kg', st2.targets.protein, 134);
  await ctx.close();
}
await b.close();
if (failed) { console.log(`ONBOARDING TEST FAILED (${failed})`); process.exit(1); } else console.log('ONBOARDING TEST PASSED');
