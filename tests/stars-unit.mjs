// v1.11.0 Home star ratings: thresholds, Grug lines, no history, redistribution (no steps / no supplements / no lift history),
// a cutting week scored against its own target like any other, consistency vs weekly goal, overload + volume balance.
import { buildSync } from 'esbuild'; import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { pathToFileURL } from 'node:url';
const dir = mkdtempSync(join(tmpdir(), 'st-'));
buildSync({ entryPoints: [new URL('../src/stars.ts', import.meta.url).pathname], bundle: true, format: 'esm', outfile: join(dir, 'b.mjs'), logLevel: 'error' });
const S = await import(pathToFileURL(join(dir, 'b.mjs')).href);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const TODAY = '2026-10-24'; const add = (d, n) => { const [y, m, dd] = d.split('-').map(Number); const x = new Date(y, m - 1, dd + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const at = (d, h = 18) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd, h).getTime(); };
const EX = { bench: { id: 'bench', name: 'Bench Press (Barbell)', muscle: 'Chest' }, row: { id: 'row', name: 'Bent Over Row (Barbell)', muscle: 'Back' }, squat: { id: 'squat', name: 'Squat (Barbell)', muscle: 'Quadriceps' },
  ohp: { id: 'ohp', name: 'Overhead Press (Barbell)', muscle: 'Shoulders' }, curl: { id: 'curl', name: 'Bicep Curl (Dumbbell)', muscle: 'Biceps' } };
const sets = (n, kg, reps) => Array.from({ length: n }, (_, i) => ({ id: 's' + i, type: 'N', kg, reps, done: true }));
const wo = (date, list) => ({ id: 'w' + date + Math.random(), name: 'W', start: at(date), end: at(date) + 3600e3, exercises: list.map(([e, n, kg, reps]) => ({ id: e, exerciseId: e, restSec: 90, sets: sets(n, kg, reps) })) });
const food = (date, kcal, protein, meals = ['breakfast', 'lunch', 'dinner']) => meals.map((meal, i) => ({ id: date + meal, date, meal, foodId: 'f', name: 'x', grams: 100, qty: 100, serving: 'g', created: 0, n: { kcal: kcal / meals.length, protein: protein / meals.length, carbs: 0, fat: 0, fibre: 0 } }));
const base = (o = {}) => ({ today: TODAY, diary: [], workouts: [], exercises: EX, steps: {}, settings: { targets: { kcal: 2400, protein: 180, carbs: 240, fat: 75, fibre: 30 }, stepGoal: 8000 }, doseSlots: [], ...o });

// thresholds + lines
ok([100, 90, 89.9, 75, 74, 60, 59, 40, 39, 0].map(S.starsFor).join('') === '5544332211', 'star thresholds ≥90/75/60/40');
ok(S.GRUG_LINE[5] === 'Grug proud. Strong like mammoth.' && S.GRUG_LINE[1] === 'Grug sad. Tomorrow new hunt.', 'Grug lines for 5★ and 1★');
ok(S.workoutGoal({}) === 3 && S.workoutGoal({ workoutGoal: 5 }) === 5, 'weekly workout goal defaults to 3');

// no history
const none = S.computeStars(base());
ok(!none.ready && none.historyDays === 0, 'no history → not ready (0/7)');
ok(none.training.stars === 1 && none.nutrition.stars === 1, 'no history → 1★ each (nothing logged), no crash');
const six = S.computeStars(base({ diary: food(add(TODAY, -5), 2400, 180) })); ok(!six.ready && six.historyDays === 6, '6 days of history → still building (6/7)');
const seven = S.computeStars(base({ diary: food(add(TODAY, -6), 2400, 180) })); ok(seven.ready && seven.historyDays === 7, '7 days of history → ready');

// perfect week
const days7 = Array.from({ length: 7 }, (_, i) => add(TODAY, -7 + i));
const prior = [wo(add(TODAY, -14), [['bench', 3, 80, 5], ['squat', 3, 100, 5]]), wo(add(TODAY, -12), [['row', 3, 70, 8], ['ohp', 3, 50, 8]])];
const goodW = [add(TODAY, -6), add(TODAY, -4), add(TODAY, -2)].map((d) => wo(d, [['bench', 4, 82.5, 5], ['squat', 4, 102.5, 5], ['row', 4, 72.5, 8], ['ohp', 4, 52.5, 8], ['curl', 4, 14, 12]]));
const steps = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [add(TODAY, -6 + i), 9000]));
const perfect = base({ workouts: [...prior, ...goodW], diary: days7.flatMap((d) => food(d, 2400, 185)), steps, doseSlots: days7.map((date) => ({ date, taken: true })) });
const P = S.computeStars(perfect);
ok(P.training.score === 100 && P.training.stars === 5 && !P.training.weakest, `perfect training → 100, 5★, no weakest (${P.training.score})`);
ok(P.nutrition.score === 100 && P.nutrition.stars === 5, 'perfect nutrition → 100, 5★');

// redistribution: no steps logged → movement not counted, score still 100
const noSteps = S.trainingRating({ ...perfect, steps: {} }); const mv = noSteps.parts.find((p) => p.key === 'movement');
ok(!mv.applicable && noSteps.score === 100, 'no steps logged → movement left out, points shared (still 100)');
const goal0 = S.trainingRating({ ...perfect, settings: { ...perfect.settings, stepGoal: 0 } }); ok(!goal0.parts.find((p) => p.key === 'movement').applicable, 'step goal 0 → movement left out');
const noSupp = S.nutritionRating({ ...perfect, doseSlots: [] }); ok(!noSupp.parts.find((p) => p.key === 'supplements').applicable && noSupp.score === 100, 'no supplements set up → left out, still 100');
const noPrior = S.trainingRating({ ...perfect, workouts: goodW }); ok(!noPrior.parts.find((p) => p.key === 'overload').applicable && noPrior.score === 100, 'no lift history to compare → overload left out');
// proportional redistribution: half protein days with no supps = 35 + 17.5 + 20 + 0 of 90 → 80.6
const halfP = S.nutritionRating({ ...perfect, doseSlots: [], diary: days7.flatMap((d, i) => food(d, 2400, i < 3 ? 185 : 100)) });
ok(halfP.score === Math.round((35 + 35 * 3 / 7 + 20) / 90 * 100) && halfP.weakest?.key === 'protein', `redistributed score ${halfP.score} = (35+15+20)/90, weakest protein`);
// missed doses count
const missed = S.nutritionRating({ ...perfect, doseSlots: days7.map((date, i) => ({ date, taken: i % 2 === 0 })) }); ok(missed.parts.find((p) => p.key === 'supplements').pts === Math.round(10 * 4 / 7 * 10) / 10, 'supplements: 4/7 doses taken → 5.7 of 10');

// cut week: 1,800 target, eating 1,800 → judged like any other on-target week
const cut = S.nutritionRating({ ...perfect, settings: { ...perfect.settings, targets: { ...perfect.settings.targets, kcal: 1800 } }, diary: days7.flatMap((d) => food(d, 1800, 185)) });
ok(cut.score === 100, 'cut week on its own target → 100 (no penalty for eating less)');
const cutUnder = S.nutritionRating({ ...perfect, settings: { ...perfect.settings, targets: { ...perfect.settings.targets, kcal: 1800 } }, diary: days7.flatMap((d) => food(d, 1400, 185)) });
ok(cutUnder.parts[0].pts === 0, 'under-eating a cut by >20 % scores 0 for calories (same rule both ways)');
const near = S.nutritionRating({ ...perfect, diary: days7.flatMap((d) => food(d, 2800, 185)) }); ok(near.parts[0].pts === 17.5, '±10–20 % → half points (2,800 vs 2,400)');
// today ignored for nutrition
const todayOnly = S.nutritionRating({ ...perfect, diary: [...days7.flatMap((d) => food(d, 2400, 185)), ...food(TODAY, 300, 10)] }); ok(todayOnly.score === 100, "today's half-eaten log doesn't count (window ends yesterday)");
// logging: one meal a day isn't 'logged'
const oneMeal = S.nutritionRating({ ...perfect, diary: days7.flatMap((d) => food(d, 2400, 185, ['dinner'])) }); ok(oneMeal.parts.find((p) => p.key === 'logging').pts === 0, 'one meal a day → logging 0');

// consistency vs goal + weakest tip text
const one = S.trainingRating({ ...perfect, workouts: [...prior, goodW[0]] }); const c = one.parts.find((p) => p.key === 'consistency');
ok(Math.abs(c.pts - 40 / 3) < 0.1, `1 of 3 workouts → consistency ${c.pts}/40`);
const g5 = S.trainingRating({ ...perfect, settings: { ...perfect.settings, workoutGoal: 5 } }); ok(Math.abs(g5.parts[0].pts - 24) < 0.1, 'goal 5, did 3 → 24/40');
// overload: stalled lifts get half, lower gets 0
const stall = S.trainingRating({ ...perfect, workouts: [...prior, ...[add(TODAY, -6), add(TODAY, -4), add(TODAY, -2)].map((d) => wo(d, [['bench', 4, 80, 5], ['squat', 4, 90, 5], ['row', 4, 72.5, 8], ['ohp', 4, 52.5, 8], ['curl', 4, 14, 12]]))] });
const ov = stall.parts.find((p) => p.key === 'overload'); ok(ov.pts === Math.round(30 * (2 + 0.5) / 4 * 10) / 10 && /2\/4 main lifts up/.test(ov.tip), `overload: 2 up, 1 held, 1 down → ${ov.pts}/30 · "${ov.tip}"`);
// volume balance: chest only
const chest = S.trainingRating({ ...perfect, workouts: [...prior, ...[add(TODAY, -6), add(TODAY, -4), add(TODAY, -2)].map((d) => wo(d, [['bench', 4, 82.5, 5]]))] });
const vb = chest.parts.find((p) => p.key === 'volume'); ok(vb.pts === 4 && /^Low back volume|^Low legs volume|^Low shoulders volume|^Low arms volume/.test(vb.tip), `volume: chest only → ${vb.pts}/20 · "${vb.tip}"`);
ok(S.groupOf('Quadriceps') === 'legs' && S.groupOf('Traps') === 'back' && S.groupOf('Triceps') === 'arms' && S.groupOf('Core') === null && S.groupOf('Full Body') === null, 'muscle → group mapping');
// unfinished workout doesn't count
const open = S.trainingRating({ ...perfect, workouts: [...prior, { ...goodW[0], end: undefined }] }); ok(open.parts[0].pts === 0, 'in-progress workout not counted');

if (bad) { console.error(bad, 'failure(s)'); process.exit(1); } else console.log('stars unit OK');
