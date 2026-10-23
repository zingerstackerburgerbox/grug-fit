// New built-in exercises reach existing installs (schema 2 → 3) without touching user data or duplicating.
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const log = (...a) => console.log('•', ...a); let failed = 0;
const fail = (m) => { console.error('FAIL:', m); failed++; };
const b = await chromium.launch();
const idb = (page, fn, arg) => page.evaluate(async ([src, arg]) => {
  const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); });
  const tx = (store, mode = 'readonly') => d.transaction(store, mode).objectStore(store);
  const p = (req) => new Promise((r, j) => { req.onsuccess = () => r(req.result); req.onerror = () => j(req.error); });
  const res = await new Function('tx', 'p', 'arg', `return (async () => { ${src} })()`)(tx, p, arg); d.close(); return res;
}, [fn, arg]);
const boot = async (page) => { await page.reload(); await page.waitForSelector("text=Today's nutrition"); };
const named = (page, n) => idb(page, `return (await p(tx('exercises').getAll())).filter((e) => e.name.toLowerCase() === arg.toLowerCase())`, n);
// simulate a v1.4.0 install: schema 2, no ex086, plus user data (custom exercise, renamed built-in, workout, diary)
const asV140 = (page, extra = '') => idb(page, `await p(tx('exercises','readwrite').delete('ex086')); await p(tx('kv','readwrite').put({ id: 'schema', v: 2 }));
  const e = await p(tx('exercises').get('ex010')); await p(tx('exercises','readwrite').put({ ...e, name: 'My Push Up', notes: 'mine' }));
  await p(tx('exercises','readwrite').put({ id: 'cxmine', name: 'Landmine Row', muscle: 'Back', equipment: 'Barbell', custom: true }));
  await p(tx('workouts','readwrite').put({ id: 'w1', name: 'Old', start: 1760000000000, end: 1760003600000, exercises: [{ id: 'we1', exerciseId: 'ex001', restSec: 90, sets: [{ id: 's1', reps: 5, kg: 100, done: true }] }] }));
  await p(tx('diary','readwrite').put({ id: 'd1', date: '2026-10-20', meal: 'lunch', foodId: 'x', name: 'Rice', grams: 200, qty: 200, serving: 'g', n: { kcal: 260, protein: 5, carbs: 56, fibre: 1, fat: 1 }, created: 1 }));
  ${extra} return (await p(tx('exercises').getAll())).length;`);
{
  const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' }); const page = await ctx.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => fail('pageerror ' + e.message));
  await page.goto(BASE); await page.fill('[data-testid=ob-username]', 'grug_tester').then(() => page.click('[data-testid=ob-next]')).then(() => page.click('[data-testid=ob-skip]')); await page.waitForSelector("text=Today's nutrition");
  const fresh = await named(page, 'Reverse Cable Crunch'); if (fresh.length !== 1 || fresh[0].id !== 'ex086') fail('fresh install should have ex086 once'); else log('fresh install: Reverse Cable Crunch = ex086, Core / Cable');
  const before = await asV140(page); await boot(page);
  const after = await idb(page, `return { n: (await p(tx('exercises').getAll())).length, schema: (await p(tx('kv').get('schema'))).v, ex010: await p(tx('exercises').get('ex010')), mine: await p(tx('exercises').get('cxmine')), w: await p(tx('workouts').get('w1')), d: await p(tx('diary').get('d1')) }`);
  log('existing install: exercises', before, '→', after.n, 'schema', after.schema);
  if (after.n !== before + 1) fail('expected exactly one new built-in'); if (after.schema !== 6) fail('schema not 6');
  if (after.ex010.name !== 'My Push Up' || after.ex010.notes !== 'mine') fail('edited built-in was overwritten');
  if (!after.mine || !after.w || after.w.exercises[0].sets[0].kg !== 100 || !after.d) fail('user data lost'); else log('user data intact (custom exercise, renamed built-in, workout, diary)');
  const rc = await named(page, 'Reverse Cable Crunch'); if (rc.length !== 1) fail('Reverse Cable Crunch count ' + rc.length); else log('added once:', rc[0].id, rc[0].muscle, rc[0].equipment);
  await boot(page); await idb(page, `return 1`); const again = await named(page, 'Reverse Cable Crunch'); if (again.length !== 1) fail('duplicated on 2nd launch'); else log('no duplicate after relaunch');
  // force re-run (as after importing an old backup) must stay idempotent
  await idb(page, `await p(tx('kv','readwrite').put({ id: 'schema', v: 1 }))`); await boot(page);
  if ((await named(page, 'Reverse Cable Crunch')).length !== 1) fail('duplicated on migration re-run'); else log('migration re-run idempotent');
  // it shows in the picker with its own thumbnail
  await page.goto(BASE + '#/workouts'); await page.click('text=+ Start empty workout'); await page.click('text=+ Add exercise');
  await page.fill('.sheet input[type=search]', 'reverse cable'); await page.waitForTimeout(250);
  const items = await page.locator('.sheet .item:has-text("Reverse Cable Crunch") .exthumb svg').count(); if (items !== 1) fail('not in picker with thumbnail'); else log('in picker with thumbnail');
  await ctx.close();
}
{ // a v1.4.1 install that already has the old (lying) ex086 and logged it: same id, history kept, only the how-to refreshed
  const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' }); const page = await ctx.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => fail('pageerror ' + e.message));
  await page.goto(BASE); await page.fill('[data-testid=ob-username]', 'grug_tester').then(() => page.click('[data-testid=ob-next]')).then(() => page.click('[data-testid=ob-skip]')); await page.waitForSelector("text=Today's nutrition");
  const n0 = await idb(page, `const e = await p(tx('exercises').get('ex086')); delete e.how; await p(tx('exercises','readwrite').put(e)); await p(tx('kv','readwrite').put({ id: 'schema', v: 3 }));
    await p(tx('workouts','readwrite').put({ id: 'w86', name: 'Abs', start: 1761100000000, end: 1761103600000, exercises: [{ id: 'we86', exerciseId: 'ex086', restSec: 60, notes: 'felt it', sets: [{ id: 's86', reps: 15, kg: 30, done: true }] }] }));
    await p(tx('routines','readwrite').put({ id: 'r86', name: 'Core day', updated: 1, exercises: [{ exerciseId: 'ex086', sets: 3, reps: 15, kg: 30, restSec: 60 }] }));
    return (await p(tx('exercises').getAll())).length;`);
  await boot(page);
  const r = await idb(page, `return { n: (await p(tx('exercises').getAll())).length, e: await p(tx('exercises').get('ex086')), w: await p(tx('workouts').get('w86')), r: await p(tx('routines').get('r86')), schema: (await p(tx('kv').get('schema'))).v }`);
  if (r.schema !== 6 || r.n !== n0) fail('v1.4.1 upgrade: schema/count ' + r.schema + ' ' + n0 + '→' + r.n);
  if (!/back to the stack/.test(r.e.how || '') || r.e.name !== 'Reverse Cable Crunch' || r.e.muscle !== 'Core' || r.e.equipment !== 'Cable') fail('ex086 not refreshed: ' + JSON.stringify(r.e)); else log('v1.4.1 install: ex086 refreshed in place (kneeling how-to), count unchanged');
  if (r.w.exercises[0].exerciseId !== 'ex086' || r.w.exercises[0].sets[0].kg !== 30 || r.w.exercises[0].notes !== 'felt it' || r.r.exercises[0].exerciseId !== 'ex086') fail('history/routine changed'); else log('logged workout + routine still point at ex086, sets/notes intact');
  await page.goto(BASE + '#/exercise/ex086'); await page.waitForSelector('[data-testid=ex-how]');
  const how = await page.textContent('[data-testid=ex-how]'); if (!/high pulley/.test(how)) fail('how-to not shown'); else log('exercise screen shows how-to + animation:', await page.locator('.exanim svg').count() === 1);
  if (!(await page.textContent('body')).includes('15')) fail('history not shown on exercise screen');
  await ctx.close();
}
{ // a user who already made a custom "Reverse Cable Crunch" doesn't get a second one
  const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' }); const page = await ctx.newPage(); page.setDefaultTimeout(10000);
  await page.goto(BASE); await page.fill('[data-testid=ob-username]', 'grug_tester').then(() => page.click('[data-testid=ob-next]')).then(() => page.click('[data-testid=ob-skip]')); await page.waitForSelector("text=Today's nutrition");
  await asV140(page, `await p(tx('exercises','readwrite').put({ id: 'cxrcc', name: 'reverse cable crunch', muscle: 'Core', equipment: 'Cable', custom: true }));`); await boot(page);
  const rc = await named(page, 'Reverse Cable Crunch'); if (rc.length !== 1 || rc[0].id !== 'cxrcc') fail('custom same-name exercise should win: ' + JSON.stringify(rc)); else log('custom same-name exercise kept, built-in not duplicated');
  await ctx.close();
}
await b.close();
if (failed) { console.error(failed, 'failure(s)'); process.exit(1); } console.log('SEED MIGRATION TEST PASSED');
