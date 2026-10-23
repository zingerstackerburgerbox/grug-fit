// v1.8.3 unit tests: Hevy name coverage, reconcile() migration of already-imported data (normalise, fold custom duplicates into built-ins,
// PRs across native + imported history), Cronometer foods, merge, idempotency.
import { buildSync } from 'esbuild'; import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { pathToFileURL } from 'node:url';
const dir = mkdtempSync(join(tmpdir(), 'rec-')); const entry = join(dir, 'e.ts'); const src = new URL('../src/', import.meta.url).pathname;
writeFileSync(entry, `export * from '${src}reconcile'; export { SEED_EXERCISES } from '${src}seed'; export { matchExercise, exKey } from '${src}importer';`);
buildSync({ entryPoints: [entry], bundle: true, format: 'esm', outfile: join(dir, 'b.mjs'), logLevel: 'error' });
const { reconcile, mergeExercise, cronFoods, SEED_EXERCISES, matchExercise, exKey } = await import(pathToFileURL(join(dir, 'b.mjs')).href);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };

// 1. common Hevy names → built-ins
const names = readFileSync(new URL('./fixtures/hevy-names.txt', import.meta.url), 'utf8').trim().split('\n');
const miss = names.filter((n) => !matchExercise(n, SEED_EXERCISES)); ok(names.length - miss.length >= 98, `Hevy names matched to built-ins: ${names.length - miss.length}/${names.length} (custom: ${miss.join(', ')})`);
const m = (n) => matchExercise(n, SEED_EXERCISES)?.name;
ok(m('Straight Arm Lat Pulldown (Cable)') === 'Straight Arm Pulldown' && m('Bench Press - Close Grip (Barbell)') === 'Close Grip Bench Press' && m('Shoulder Press (Machine Plates)') === 'Shoulder Press (Machine)', 'new aliases + same-equipment brackets');
ok(!m('Squat (Smith Machine)') && !m('Bench Press (Smith Machine)') && !m('Hip Adduction (Machine)'), 'Smith machine / different movements stay custom (no false merges)');
ok(matchExercise('My Weird Curl', [...SEED_EXERCISES, { id: 'c1', name: 'My Weird Curl', muscle: 'Biceps', equipment: 'Other', custom: true }], {})?.id === 'c1', 'exact custom match still works');
ok(matchExercise('Iso-Lateral Chest Press (Machine)', SEED_EXERCISES, { [exKey('Iso-Lateral Chest Press (Machine)')]: 'ex008' })?.id === 'ex008', 'user merge alias wins');

// 2. reconcile legacy (v1.8.0-v1.8.2) imported data
const D = (s) => new Date(s).getTime();
const set = (kg, reps, x = {}) => ({ id: Math.random().toString(36).slice(2), type: 'N', kg, reps, done: true, ...x });
const legacyCustom = { id: 'cx-hevy-abc', name: 'Straight Arm Lat Pulldown (Cable)', muscle: 'Back', equipment: 'Cable', custom: true, importSource: 'hevy' };
const userCustom = { id: 'cu1', name: 'Landmine Press', muscle: 'Shoulders', equipment: 'Barbell', custom: true };
const data = {
  exercises: [...SEED_EXERCISES, legacyCustom, userCustom],
  workouts: [
    // imported, malformed the way an older build / hand-edited backup could leave it
    { id: 'hevy-1', name: '', start: D('2026-10-14T07:15'), end: D('2026-10-14T07:15'), importSource: 'hevy', exercises: [
      { exerciseId: 'ex001', sets: [{ type: 'X', kg: '80', reps: '8' }, set(60, 10, { type: 'W' })] },
      { id: 'e2', exerciseId: 'cx-hevy-abc', restSec: 90, sets: [set(25, 12)] }, { id: 'e3', exerciseId: 'ex017', restSec: 90, sets: [] }] },
    { id: 'hevy-2', name: 'Push', start: D('2026-10-21T07:00'), end: D('2026-10-21T08:00'), importSource: 'hevy', exercises: [{ id: 'a', exerciseId: 'ex001', restSec: 90, sets: [set(85, 6)] }] },
    // native, logged before the import: its stored PR ignored the (older) imported 90 kg session
    { id: 'n0', name: 'Old native', start: D('2026-09-01T07:00'), end: D('2026-09-01T08:00'), exercises: [{ id: 'b', exerciseId: 'ex001', restSec: 90, sets: [set(70, 8)] }], prs: [] },
    { id: 'hevy-0', name: 'Heavy', start: D('2026-10-01T07:00'), end: D('2026-10-01T08:00'), importSource: 'hevy', exercises: [{ id: 'c', exerciseId: 'ex001', restSec: 90, sets: [set(90, 5)] }] },
    { id: 'n1', name: 'Native', start: D('2026-10-22T07:00'), end: D('2026-10-22T08:00'), exercises: [{ id: 'd', exerciseId: 'ex001', restSec: 90, sets: [set(87.5, 5)] }], prs: [{ exerciseId: 'ex001', kind: 'weight', value: 87.5 }, { exerciseId: 'ex001', kind: '1rm', value: 102.1 }] },
    { id: 'n2', name: 'Landmine', start: D('2026-10-20T07:00'), end: D('2026-10-20T08:00'), exercises: [{ id: 'f', exerciseId: 'cu1', restSec: 90, sets: [set(20, 10)] }] }
  ],
  routines: [{ id: 'r1', name: 'Back', updated: 1, exercises: [{ exerciseId: 'cx-hevy-abc', sets: 3, restSec: 90 }] }],
  active: { id: 'act', name: 'Now', start: D('2026-10-23T07:00'), exercises: [{ id: 'z', exerciseId: 'cx-hevy-abc', restSec: 90, sets: [set(null, null, { done: false })] }] },
  diary: [], foods: [], exAliases: {}, defaultRest: 120
};
const c = reconcile(data); const W = (id) => c.workouts.find((w) => w.id === id) || data.workouts.find((w) => w.id === id);
ok(c.remapped['cx-hevy-abc'] === 'ex021' && c.delExercises.includes('cx-hevy-abc') && !c.delExercises.includes('cu1'), 'imported custom duplicate folded into built-in Straight Arm Pulldown; user custom kept');
const h1 = W('hevy-1');
ok(h1.name === 'Workout' && h1.end === h1.start + 3600e3 && h1.exercises.length === 2 && h1.exercises[0].id && h1.exercises[0].restSec === 120, 'normalised: name, end > start, empty exercise dropped, ids, rest');
ok(h1.exercises[0].sets[0].type === 'N' && h1.exercises[0].sets[0].kg === 80 && h1.exercises[0].sets[0].reps === 8 && h1.exercises[0].sets[0].done === true && h1.exercises[0].sets[0].id, 'normalised sets: type, numbers, done, id');
ok(h1.exercises[1].exerciseId === 'ex021', 'workout set now on built-in id');
ok(c.routines[0]?.exercises[0].exerciseId === 'ex021' && c.active?.exercises[0].exerciseId === 'ex021', 'routine + active workout remapped');
const prK = (w) => (w.prs || []).map((p) => p.kind).sort().join(',');
ok(prK(W('hevy-0')).includes('weight'), 'imported 1 Oct 90 kg gets PRs vs older native 70 kg: ' + prK(W('hevy-0')));
ok(prK(W('n1')) === '', 'native 22 Oct 87.5 kg: stale PRs removed (older imported 90 kg is heavier)');
ok(prK(W('hevy-2')) === '', 'imported 21 Oct 85×6 (1RM 102) < 90×5 (1RM 105): no PR');
ok(W('n2').prs === undefined && !c.workouts.find((w) => w.id === 'n2'), 'unaffected native workout untouched');
// idempotent
const apply = (d, c) => ({ ...d, workouts: d.workouts.map((w) => c.workouts.find((x) => x.id === w.id) || w), routines: d.routines.map((r) => c.routines.find((x) => x.id === r.id) || r), exercises: d.exercises.filter((e) => !c.delExercises.includes(e.id)), active: c.active || d.active,
  diary: d.diary.map((e) => c.diary.find((x) => x.id === e.id) || e), foods: [...d.foods.filter((f) => !c.foods.find((x) => x.id === f.id)), ...c.foods] });
const d2 = apply(data, c); const c2 = reconcile(d2);
ok(!c2.workouts.length && !c2.routines.length && !c2.delExercises.length && !c2.foods.length && !c2.diary.length && !c2.active, 'second run changes nothing (idempotent)');

// 3. Cronometer foods
const n = (kcal, p = 0) => ({ kcal, protein: p, carbs: 0, fibre: 0, fat: 0 });
const diary = [
  { id: 'c1', date: '2026-10-20', meal: 'breakfast', foodId: 'import-oats', name: 'Oats', grams: 50, qty: 50, serving: 'g', n: n(189.5, 6.5), created: 1, importSource: 'cronometer' },
  { id: 'c2', date: '2026-10-21', meal: 'breakfast', foodId: 'import-oats', name: 'Oats', grams: 100, qty: 1, serving: 'serving', amountLabel: '1.00 cup', n: n(303.2, 10.4), created: 2, importSource: 'cronometer' },
  { id: 'c3', date: '2026-10-20', meal: 'breakfast', foodId: 'import-yog', name: 'Greek Yogurt', grams: 100, qty: 1, serving: 'serving', amountLabel: '1 cup', n: n(133, 23), created: 3, importSource: 'cronometer' },
  { id: 'c4', date: '2026-10-21', meal: 'breakfast', foodId: 'import-yog', name: 'Greek Yogurt', grams: 100, qty: 1, serving: 'serving', amountLabel: '0.5 cup', n: n(66.5, 11.5), created: 4, importSource: 'cronometer' },
  { id: 'c5', date: '2026-10-19', meal: 'snacks', foodId: 'import-cron-day', name: 'Cronometer daily total', grams: 100, qty: 1, serving: 'serving', amountLabel: 'daily total', n: n(2000), created: 5, importSource: 'cronometer' },
  { id: 'x1', date: '2026-10-20', meal: 'lunch', foodId: 'f-native', name: 'Native', grams: 100, qty: 100, serving: 'g', n: n(100), created: 6 }
];
const cf = cronFoods(diary, []); const F = (id) => cf.foods.find((f) => f.id === id); const E = (id) => cf.diary.find((e) => e.id === id) || diary.find((e) => e.id === id);
ok(F('import-oats') && Math.abs(F('import-oats').per100.kcal - 379) < 0.01 && !F('import-oats').gramsUnknown, 'oats: real food, per100 from the 50 g entry (379 kcal/100 g)');
const cup = F('import-oats').servings.find((s) => s.label === 'cup'); ok(cup && Math.abs(cup.grams - 80) < 0.2, `oats cup derived from kcal: ${cup?.grams} g`);
ok(E('c2').serving === 'cup' && E('c2').qty === 1 && Math.abs(E('c2').grams - 80) < 0.2 && !E('c2').amountLabel && E('c2').n.kcal === 303.2 && E('c2').importSource === 'cronometer', 'oats cup entry now native (1 × cup · 80 g), nutrients and source kept');
ok(F('import-yog')?.gramsUnknown && E('c3').serving === 'cup' && E('c3').amountLabel === '1 cup' && E('c4').qty === 0.5 && Math.abs(E('c4').grams - 50) < 0.01, 'yogurt (cups only): unit food, weight unknown, entries keep "1 cup"/"0.5 cup"');
ok(!F('import-cron-day') && !cf.diary.find((e) => e.id === 'c5' || e.id === 'x1'), 'daily totals + native entries untouched');
ok(F('import-oats').useCount === 2 && F('import-oats').lastUsed === 2 && F('import-oats').importSource === 'cronometer', 'food recents (useCount/lastUsed) + source tag');
const cf2 = cronFoods(diary.map((e) => cf.diary.find((x) => x.id === e.id) || e), cf.foods); ok(!cf2.foods.length && !cf2.diary.length, 'cronometer foods idempotent');

// 4. merge custom → existing
const mg = mergeExercise(d2, 'cu1', 'ex025');
ok(mg.delExercises[0] === 'cu1' && mg.workouts.find((w) => w.id === 'n2')?.exercises[0].exerciseId === 'ex025' && mg.exAliases[exKey('Landmine Press')] === 'ex025', 'merge: workouts moved, custom removed, alias stored for future imports');
if (bad) { console.error(bad + ' FAILED'); process.exit(1); } console.log('RECONCILE UNIT TESTS PASSED');
