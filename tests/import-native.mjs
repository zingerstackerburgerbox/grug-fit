// v1.8.3: imported Hevy/Cronometer data behaves exactly like data logged in Grug Fit – history list/detail, PREVIOUS column, exercise
// chart/PRs, week streak, burned calories, Coach context, repeat/save-as-routine/edit/delete, merge, Cronometer diary/edit; + migration.
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const FX = ['hevy_workouts_kg.csv', 'hevy_workouts_lbs.csv', 'cronometer_servings.csv'].map((f) => new URL('./fixtures/' + f, import.meta.url).pathname);
const NOW = new Date('2026-10-23T12:00:00+11:00');
const b = await chromium.launch();
async function fresh() {
  const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark', timezoneId: 'Australia/Sydney' }); await ctx.clock.install({ time: NOW });
  const page = await ctx.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => fail('pageerror ' + e.message)); page.on('dialog', (d) => d.accept());
  await page.goto(BASE); await page.click('[data-testid=ob-skip]'); await page.waitForSelector("text=Today's nutrition");
  const idb = (src, arg) => page.evaluate(async ([src, arg]) => {
    const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); });
    const tx = (store, mode = 'readonly') => d.transaction(store, mode).objectStore(store);
    const p = (req) => new Promise((r, j) => { req.onsuccess = () => r(req.result); req.onerror = () => j(req.error); });
    const res = await new Function('tx', 'p', 'arg', `return (async () => { ${src} })()`)(tx, p, arg); d.close(); return res;
  }, [src, arg]);
  return { ctx, page, idb };
}
const T = (s) => new Date(s + '+11:00').getTime();
const S = (kg, reps, x = {}) => ({ id: Math.random().toString(36).slice(2), type: 'N', kg, reps, done: true, doneAt: 0, ...x });

// ---------------------------------------------------------------- A. fresh import next to native workouts
{
  const { ctx, page, idb } = await fresh();
  // native workouts logged in Grug Fit + body weight + profile (for calories)
  await idb(`const s = await p(tx('kv').get('settings'));
    await p(tx('kv','readwrite').put({ ...s, profile: { heightCm: 180, sex: 'male', birthYear: 1990, goal: 'maintain' } }));
    for (const w of arg.ws) await p(tx('workouts','readwrite').put(w)); await p(tx('bodyweight','readwrite').put({ id: 'bw2026-10-01', date: '2026-10-01', kg: 84 }));`, { ws: [
    { id: 'nat-15', name: 'Native Back', start: T('2026-10-15T18:00'), end: T('2026-10-15T19:00'), exercises: [{ id: 'n1', exerciseId: 'ex019', restSec: 90, sets: [S(60, 10), S(60, 9)] }], prs: [] },
    { id: 'nat-22', name: 'Native Legs', start: T('2026-10-22T18:00'), end: T('2026-10-22T19:00'), exercises: [{ id: 'n2', exerciseId: 'ex052', restSec: 120, sets: [S(100, 5), S(100, 5)] }], prs: [{ exerciseId: 'ex052', kind: 'weight', value: 100 }] }] });
  await page.goto(BASE + '#/settings'); await page.setInputFiles('[data-testid=import-input]', FX); await page.click('[data-testid=import-go]'); await page.waitForSelector('[data-testid=import-done]');
  const db = await idb(`return { w: await p(tx('workouts').getAll()), e: await p(tx('exercises').getAll()), f: await p(tx('foods').getAll()), d: await p(tx('diary').getAll()) };`);
  const imp = db.w.filter((w) => w.importSource === 'hevy'); log('imported workouts:', imp.length, '| custom created:', db.e.filter((e) => e.importSource === 'hevy').map((e) => e.name).join(', '));

  // 1. history list: one list sorted by date, same card, subtle tag only
  await page.goto(BASE + '#/history'); await page.waitForSelector('a.card[href^="#/history/"]');
  const cards = await page.locator('a.card[href^="#/history/"]').evaluateAll((l) => l.map((a) => ({ id: a.getAttribute('href').split('/').pop(), tag: a.querySelector('[data-testid=src-tag]')?.textContent || '', kcal: a.querySelector('[data-testid=card-kcal]')?.textContent || '', text: a.textContent, cls: a.className })));
  const expected = db.w.filter((w) => w.end).sort((a, b) => b.start - a.start).map((w) => w.id);
  log('history order:', cards.map((c) => c.id.slice(0, 12) + (c.tag ? '(H)' : '')).join(' '));
  if (cards.map((c) => c.id).join() !== expected.join()) fail('history not one date-sorted list');
  if (new Set(cards.map((c) => c.cls)).size !== 1) fail('imported cards styled differently');
  if (cards.filter((c) => c.tag === 'from Hevy').length !== imp.length || cards.some((c) => c.id.startsWith('nat') && c.tag)) fail('src tags');
  for (const c of cards) if (!/⏱/.test(c.text) || !/🏋️/.test(c.text) || !/\d+ sets?\b/.test(c.text) || !/[1-9]\d* kcal/.test(c.kcal)) fail('card fields missing ' + c.id + ' ' + c.kcal);
  const prCards = cards.filter((c) => /🏆 \d+ PR/.test(c.text)); log('cards with PR badge:', prCards.map((c) => c.id.slice(0, 12)).join(' '));
  if (!prCards.some((c) => c.tag)) fail('no PR badge on imported workouts');
  await page.addStyleTag({ content: '.toast{display:none!important}' }); await page.screenshot({ path: 'screenshots/51-history-imported.png' });
  // native squat 100 kg on 22 Oct is NOT a PR any more: the imported 10 Oct squat was 225 lb ≈ 102 kg
  const n22 = db.w.find((w) => w.id === 'nat-22'); log('native 22 Oct PRs after import:', JSON.stringify(n22.prs)); if (n22.prs.some((p) => p.kind === 'weight')) fail('stale native PR kept');

  // 2. detail of an imported workout: same layout + actions
  const lastBench = db.w.filter((w) => w.end && w.exercises.some((e) => e.exerciseId === 'ex001')).sort((a, b) => b.start - a.start)[0];
  if (lastBench.importSource !== 'hevy') fail('expected the last bench workout to be imported');
  await page.goto(BASE + '#/history/' + lastBench.id); await page.waitForSelector('[data-testid=detail-duration]');
  for (const t of ['edit-workout', 'repeat-workout', 'delete-workout', 'workout-kcal']) if (!(await page.locator(`[data-testid=${t}]`).count())) fail('detail missing ' + t);
  if (!(await page.locator('button:has-text("Save as routine")').count())) fail('no Save as routine');
  log('detail:', (await page.textContent('.page .mut.sm')).trim(), '| kcal', await page.textContent('[data-testid=workout-kcal-value]'));
  await page.click('button:has-text("Save as routine")'); await page.waitForTimeout(300);
  const rt = await idb(`return (await p(tx('routines').getAll()))`); if (!rt.some((r) => r.exercises.some((e) => e.exerciseId === 'ex001'))) fail('save as routine from imported');

  // 3. PREVIOUS column in an active workout uses the imported sets (exercise + set index)
  const prevSets = lastBench.exercises.filter((e) => e.exerciseId === 'ex001').flatMap((e) => e.sets).filter((s) => s.done);
  const lastDl = db.w.filter((w) => w.end && w.exercises.some((e) => e.exerciseId === 'ex012')).sort((a, b) => b.start - a.start)[0]; if (lastDl.importSource !== 'hevy') fail('last deadlift not imported');
  const dlSets = lastDl.exercises.filter((e) => e.exerciseId === 'ex012').flatMap((e) => e.sets).filter((s) => s.done);
  const empty = (l, p) => l.map((s, i) => ({ id: p + i, type: s.type, kg: null, reps: null, done: false }));
  await idb(`await p(tx('kv','readwrite').put({ id: 'active', w: arg }));`, { id: 'act1', name: 'Today', start: NOW.getTime(), lastActivityAt: NOW.getTime(), exercises: [{ id: 'a1', exerciseId: 'ex001', restSec: 0, sets: empty(prevSets, 'b') }, { id: 'a2', exerciseId: 'ex012', restSec: 0, sets: empty(dlSets, 'd') }] });
  await page.goto(BASE + '#/workout/active'); await page.waitForSelector('td.prev');
  const prev = await page.locator('td.prev').allTextContents(); log('PREVIOUS column:', prev.join(' | '), '← imported', lastBench.name, new Date(lastBench.start).toDateString(), '+', lastDl.name, new Date(lastDl.start).toDateString());
  if (prev.join('|') !== [...prevSets, ...dlSets].map((s) => `${s.kg} × ${s.reps}`).join('|')) fail('PREVIOUS column ≠ imported sets');
  await page.addStyleTag({ content: '.toast{display:none!important}' }); await page.waitForTimeout(150);
  await page.locator('table.sets').first().screenshot({ path: 'screenshots/52-previous-from-import.png' });
  await page.screenshot({ path: 'screenshots/52b-previous-full.png' });
  await page.locator('button[aria-label="Complete set"]').first().click(); await page.waitForTimeout(200);
  const a = await idb(`return (await p(tx('kv').get('active'))).w.exercises[0].sets[0]`); log('tick fills from previous:', a.kg, '×', a.reps); if (a.kg !== prevSets[0].kg || a.reps !== prevSets[0].reps) fail('tick fill from imported previous');
  await idb(`await p(tx('kv','readwrite').delete('active'));`);

  // 4. exercise detail: chart/history/bests include imported sessions
  const benchWs = db.w.filter((w) => w.end && w.exercises.some((e) => e.exerciseId === 'ex001' && e.sets.some((s) => s.done && s.type !== 'W' && s.reps)));
  await page.goto(BASE + '#/exercise/ex001'); await page.waitForSelector('text=Best est. 1RM');
  const hc = await page.locator('h2:has-text("History") ~ a.card').count(); const best = await page.textContent('.kpi'); log('bench history entries:', hc, '/', benchWs.length, '|', best.replace(/\s+/g, ' '));
  if (hc !== benchWs.length) fail('exercise history count');
  const e1 = (kg, r) => (r === 1 ? kg : kg * (1 + r / 30)); const bestR = Math.max(...benchWs.flatMap((w) => w.exercises.filter((e) => e.exerciseId === 'ex001').flatMap((e) => e.sets.filter((s) => s.done && s.type !== 'W' && s.reps).map((s) => e1(s.kg, s.reps)))));
  if (!best.includes(String(Math.round(bestR * 10) / 10))) fail('best 1RM ' + bestR);
  if (!(await page.locator('svg circle, svg path').count())) fail('no chart');

  // 5. Home: week streak + this week count (19–25 Oct: imported 21 Oct + native 22 Oct; 12–18 Oct; 5–11 Oct: imported 10 Oct)
  await page.goto(BASE); await page.waitForSelector("text=Week streak"); const k = (await page.locator('.kpi >> nth=0').textContent()).replace(/\s+/g, ' '); log('home kpi:', k);
  if (!/Week streak\s*3/.test(k) || !/2 this week/.test(k)) fail('week streak / this week with imports');

  // 6. burned calories on an imported workout day (21 Oct)
  await page.goto(BASE + '#/food/2026-10-21'); await page.waitForSelector('[data-testid=burn-split]'); const bs = await page.textContent('[data-testid=burn-split]'); log('21 Oct burn:', bs); if (!/workout/.test(bs)) fail('imported workout kcal not in burned');

  // 7. Cronometer: diary + totals; edit keeps the import tag; unit-only foods hide grams
  await page.goto(BASE + '#/food/2026-10-20'); await page.waitForSelector('text=Greek');
  const d20 = db.d.filter((e) => e.date === '2026-10-20'); const sum = Math.round(d20.reduce((a, e) => a + e.n.kcal, 0));
  const top = await page.textContent('.page'); log('20 Oct entries:', d20.length, '| kcal', sum); if (!top.includes(String(sum))) fail('diary total ≠ imported entries');
  const foodsImp = db.f.filter((f) => f.importSource === 'cronometer'); log('imported foods in My Foods:', foodsImp.length, foodsImp.map((f) => f.name + (f.gramsUnknown ? '(units)' : '')).join(', '));
  if (!foodsImp.length) fail('no foods created');
  await page.click('button.item:has-text("Greek")'); await page.waitForSelector('[role=radiogroup]');
  const chips = await page.locator('[role=radiogroup] [role=radio]').allTextContents(); log('yogurt unit chips:', chips.join(' | '));
  if (chips.includes('grams') || !chips.some((c) => /cup/.test(c))) fail('unit-only food chips');
  await page.fill('input[aria-label=Amount]', '2'); await page.click('button:has-text("Save changes")'); await page.waitForTimeout(300);
  const y = await idb(`return (await p(tx('diary').getAll())).find((e) => /Greek/.test(e.name) && e.date === '2026-10-20')`); log('edited yogurt:', y.qty, y.serving, y.amountLabel, y.importSource, Math.round(y.n.kcal));
  if (y.importSource !== 'cronometer' || y.qty !== 2 || Math.abs(y.n.kcal - 2 * d20.find((e) => /Greek/.test(e.name)).n.kcal) > 1) fail('imported entry edit');
  await page.goto(BASE + '#/food/add/2026-10-23/breakfast'); await page.waitForTimeout(500); if (!(await page.locator('text=Oats').count())) fail('imported food not in recents'); else log('imported food offered in Add food recents');

  // 8. Coach context includes imported workouts and PRs
  await page.evaluate(() => localStorage.setItem('coachProxyUrl', 'https://coach.test')); let body = null;
  await ctx.route('https://coach.test/**', (r) => { const u = r.request().url(); const cors = { 'access-control-allow-origin': '*' };
    if (u.endsWith('/status')) return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ enabled: true, remaining: 30, cap: 30, used: 0 }) });
    body = JSON.parse(r.request().postData()); return r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n' }); });
  await page.goto(BASE + '#/coach'); await page.click('[data-testid=coach-accept]'); await page.fill('textarea[aria-label="Message the coach"]', 'how am I doing?'); await page.click('[data-testid=coach-send]'); await page.waitForTimeout(800);
  const sys = body?.messages?.[0]?.content || ''; const cx = JSON.parse(sys.split("DATA (the user's own logs, JSON):\n")[1] || '{}'); const cs = JSON.stringify(cx);
  log('coach context: recent workouts', (cs.match(/Push, Heavy|Pull Day|Leg Day/g) || []).length, '| PR rows', (cx.prs || cx.recentPRs || []).length);
  if (!/Push, Heavy/.test(cs) || !/Leg Day/.test(cs) || !/Bench Press/.test(cs)) fail('coach context missing imported workouts'); if (!/Greek|Oats/.test(cs) && !/"2026-10-20"|20\/10|10-20/.test(cs)) log('(nutrition days are aggregated)');

  // 10. merge an imported custom exercise into a built-in
  const iso = db.e.find((e) => /Iso-Lateral Chest Press/.test(e.name));
  await page.goto(BASE + '#/exercise/' + iso.id); await page.click('button:has-text("Edit")'); await page.click('[data-testid=merge-exercise]');
  await page.fill('.sheet input[placeholder*="Search" i]', 'Chest Press'); await page.locator('.sheet button:has-text("Chest Press (Machine)")').first().click(); await page.locator('.sheet button.btn.p').last().click();
  await page.waitForURL(/exercise\/ex008/); const mg = await idb(`const ws = await p(tx('workouts').getAll()); return { left: ws.filter((w) => w.exercises.some((e) => e.exerciseId === arg)).length, moved: ws.filter((w) => w.exercises.some((e) => e.exerciseId === 'ex008')).length, ex: !!(await p(tx('exercises').get(arg))), al: (await p(tx('kv').get('exAliases')))?.v }`, iso.id);
  log('merge:', JSON.stringify(mg)); if (mg.left || !mg.moved || mg.ex || !Object.values(mg.al || {}).includes('ex008')) fail('merge');
  // 9. edit + delete an imported workout like a native one; repeat it
  const leg = db.w.find((w) => w.name === 'Leg Day');
  await page.goto(BASE + '#/history/' + leg.id + '?edit=1'); await page.waitForSelector('[data-testid=save-workout]');
  await page.locator('input[aria-label=Reps]').first().fill('9'); await page.click('[data-testid=save-workout]'); await page.waitForSelector('[data-testid=edit-workout]');
  const leg2 = await idb(`return await p(tx('workouts').get(arg))`, leg.id); log('edited imported workout reps:', leg2.exercises[0].sets[0].reps, '| source kept:', leg2.importSource); if (leg2.exercises[0].sets[0].reps !== 9 || leg2.importSource !== 'hevy') fail('edit imported');
  await page.click('[data-testid=repeat-workout]'); await page.waitForURL(/workout\/active/); await page.waitForSelector('td.prev');
  const act = await idb(`return (await p(tx('kv').get('active'))).w`); log('repeat → active:', act.name, act.exercises.length, 'exercises,', act.exercises.reduce((a, e) => a + e.sets.length, 0), 'sets prefilled, none ticked:', act.exercises.every((e) => e.sets.every((s) => !s.done)));
  if (act.name !== 'Leg Day' || act.exercises.length !== leg2.exercises.length || act.exercises[0].sets[0].kg !== leg2.exercises[0].sets[0].kg) fail('repeat workout');
  await page.locator('button:has-text("Discard workout")').click(); await page.waitForTimeout(200);
  await page.goto(BASE + '#/history/' + leg.id); await page.click('[data-testid=delete-workout]'); await page.waitForTimeout(400);
  if (await idb(`return !!(await p(tx('workouts').get(arg)))`, leg.id)) fail('delete imported');
  // PRs are recomputed after a delete: without the first bench session (imported 14 Oct), 21 Oct is the first → no bench PR (first time isn't a record)
  const push = db.w.find((w) => w.name === 'Push, Heavy'); const before = (await idb(`return await p(tx('workouts').get(arg))`, lastBench.id)).prs.filter((p) => p.exerciseId === 'ex001').length;
  await page.goto(BASE + '#/history/' + push.id); await page.click('[data-testid=delete-workout]'); await page.waitForTimeout(400);
  const after = (await idb(`return await p(tx('workouts').get(arg))`, lastBench.id)).prs.filter((p) => p.exerciseId === 'ex001').length; log('bench PRs on 21 Oct before/after deleting 14 Oct:', before, '/', after);
  if (!before || after) fail('PRs not recomputed after delete');

  // undo still finds everything imported (incl. merged + edited)
  await page.goto(BASE + '#/settings'); await page.click('[data-testid=import-undo-hevy]'); await page.waitForTimeout(500);
  const left = await idb(`return (await p(tx('workouts').getAll())).map((w) => w.id)`); log('after undo Hevy:', left.join(',')); if (left.join() !== 'nat-15,nat-22' && left.sort().join() !== 'nat-15,nat-22') fail('undo');
  await ctx.close();
}

// ---------------------------------------------------------------- B. migration of data imported by v1.8.0–v1.8.2
{
  const { ctx, page, idb } = await fresh();
  await idb(`for (const e of arg.ex) await p(tx('exercises','readwrite').put(e)); for (const w of arg.ws) await p(tx('workouts','readwrite').put(w)); for (const d of arg.d) await p(tx('diary','readwrite').put(d));
    await p(tx('routines','readwrite').put(arg.r)); await p(tx('kv','readwrite').put({ id: 'schema', v: 4 }));`, {
    ex: [{ id: 'cx-hevy-old1', name: 'Straight Arm Lat Pulldown (Cable)', muscle: 'Back', equipment: 'Cable', custom: true, importSource: 'hevy' }],
    ws: [
      { id: 'hevy-old1', name: 'Pull', start: T('2026-10-01T07:00'), end: T('2026-10-01T07:00'), importSource: 'hevy', exercises: [{ exerciseId: 'ex012', sets: [{ type: 'N', kg: '150', reps: '5', done: true }] }, { id: 'q', exerciseId: 'cx-hevy-old1', restSec: 90, sets: [S(30, 12)] }] },
      { id: 'hevy-old2', name: 'Pull 2', start: T('2026-10-08T07:00'), end: T('2026-10-08T08:00'), importSource: 'hevy', exercises: [{ id: 'q2', exerciseId: 'ex012', restSec: 90, sets: [S(160, 5)] }] },
      { id: 'native-x', name: 'Native pull', start: T('2026-10-20T07:00'), end: T('2026-10-20T08:00'), exercises: [{ id: 'q3', exerciseId: 'ex012', restSec: 90, sets: [S(155, 5)] }], prs: [{ exerciseId: 'ex012', kind: 'weight', value: 155 }] }],
    d: [{ id: 'cron-old', date: '2026-10-20', meal: 'breakfast', foodId: 'import-zzz', name: 'Rice, White, Cooked', grams: 100, qty: 1, serving: 'serving', amountLabel: '1.00 cup', n: { kcal: 205, protein: 4, carbs: 44, fibre: 0.6, fat: 0.4 }, created: T('2026-10-20T12:30'), importSource: 'cronometer' }],
    r: { id: 'r-old', name: 'Pull', updated: 1, exercises: [{ exerciseId: 'cx-hevy-old1', sets: 3, restSec: 90 }] } });
  await page.reload(); await page.waitForSelector("text=Today's nutrition"); await page.waitForTimeout(300);
  const m = await idb(`return { schema: (await p(tx('kv').get('schema'))).v, w: await p(tx('workouts').getAll()), ex: await p(tx('exercises').get('cx-hevy-old1')), r: await p(tx('routines').get('r-old')), f: await p(tx('foods').get('import-zzz')), d: await p(tx('diary').get('cron-old')) }`);
  const W = (id) => m.w.find((w) => w.id === id);
  log('migration: schema', m.schema, '| old1', JSON.stringify({ end: W('hevy-old1').end - W('hevy-old1').start, kg: W('hevy-old1').exercises[0].sets[0].kg, ex: W('hevy-old1').exercises[1].exerciseId, prs: W('hevy-old1').prs }), '| old2 PRs', JSON.stringify(W('hevy-old2').prs), '| native PRs', JSON.stringify(W('native-x').prs));
  if (m.schema !== 6) fail('schema not migrated');
  if (W('hevy-old1').end - W('hevy-old1').start !== 3600e3 || W('hevy-old1').exercises[0].sets[0].kg !== 150 || !W('hevy-old1').exercises[0].sets[0].id || W('hevy-old1').exercises[1].exerciseId !== 'ex021') fail('workout not normalised/remapped');
  if (m.ex || m.r.exercises[0].exerciseId !== 'ex021') fail('custom duplicate not folded');
  if (!W('hevy-old2').prs?.some((p) => p.kind === 'weight')) fail('imported PRs not computed'); if (W('native-x').prs.some((p) => p.kind === 'weight')) fail('native stale PR');
  log('migrated food:', m.f?.name, m.f?.gramsUnknown ? '(unit food)' : '', '| entry', m.d.qty, m.d.serving, m.d.amountLabel); if (!m.f || m.d.serving !== 'cup') fail('cronometer food migration');
  await page.goto(BASE + '#/exercise/ex012'); await page.waitForSelector('text=Best est. 1RM'); const hc = await page.locator('h2:has-text("History") ~ a.card').count(); log('deadlift history after migration:', hc); if (hc !== 3) fail('migrated history in exercise detail');
  await page.goto(BASE + '#/history/hevy-old1'); await page.waitForSelector('[data-testid=detail-duration]'); log('migrated detail duration:', await page.textContent('[data-testid=detail-duration]'));
  await ctx.close();
}
await b.close();
if (failed) { console.error(failed + ' FAILURES'); process.exit(1); } console.log('IMPORT-NATIVE TEST PASSED');
