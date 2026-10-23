// v1.9.0 steps → calories, double-count rules (cardio workouts, resting allowance), time-window maths, shell version compare.
import { buildSync } from 'esbuild'; import { mkdtempSync, writeFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { pathToFileURL } from 'node:url';
process.env.TZ = 'Australia/Sydney';
const dir = mkdtempSync(join(tmpdir(), 'st-')); const src = new URL('../src/', import.meta.url).pathname; const entry = join(dir, 'e.ts');
writeFileSync(entry, `export * from '${src}steps'; export { newer } from '${src}native';`);
buildSync({ entryPoints: [entry], bundle: true, format: 'esm', outfile: join(dir, 'b.mjs'), logLevel: 'error' });
const S = await import(pathToFileURL(join(dir, 'b.mjs')).href);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const L = (d, h, mi = 0) => new Date(2026, 9, d, h, mi).getTime();
const near = (a, b, e = 1) => Math.abs(a - b) <= e;

ok(near(S.strideCm(180, 'male'), 74.7, 0.01) && near(S.strideCm(165, 'female'), 68.1, 0.1), 'stride from height (0.415 / 0.413 × height)');
ok(near(S.stepsKm(10000, 180, 'male'), 7.47, 0.01) && near(S.stepKcal(10000, 80, 180, 'male'), 298.8, 0.1), '10,000 steps at 80 kg / 180 cm → 7.47 km, ≈ 299 kcal net (0.03 kcal/step)');
ok(near(S.stepKcal(10000, 60, 165, 'female') / S.stepKcal(10000, 90, 165, 'female'), 60 / 90, 1e-9), 'calories scale with body weight');
ok(S.stepsInWindow([[L(23, 7), L(23, 8), 6000]], L(23, 7, 30), L(23, 9)) === 3000 && S.stepsInWindow([[L(23, 7), L(23, 8), 600]], L(23, 9), L(23, 10)) === 0, 'stepsInWindow spreads a segment evenly over its time');

const EX = new Map([['run', { muscle: 'Cardio' }], ['bench', { muscle: 'Chest' }]]);
const P = { heightCm: 180, sex: 'male' };
const cache = { days: { '2026-10-23': 9000 }, segs: [[L(23, 0), L(23, 7), 500], [L(23, 7), L(23, 7, 30), 3000], [L(23, 7, 30), L(23, 18), 5500]] };
const run = { id: 'r', name: 'Run', start: L(23, 7), end: L(23, 7, 30), exercises: [{ id: 'e', exerciseId: 'run', restSec: 0, sets: [{ id: 's', type: 'N', km: 4, done: true }] }] };
const lift = { id: 'l', name: 'Push', start: L(23, 12), end: L(23, 13), exercises: [{ id: 'e', exerciseId: 'bench', restSec: 90, sets: [{ id: 's', type: 'N', kg: 60, reps: 8, done: true }] }] };
const d0 = S.daySteps('2026-10-23', cache, [], EX, 80, P);
ok(d0.steps === 9000 && d0.inCardio === 0 && d0.counted === 7000 && d0.kcal === Math.round(S.stepKcal(7000, 80, 180, 'male')), `no workouts: 9,000 steps − 2,000 resting allowance → ${d0.counted} counted, +${d0.kcal} kcal, ${d0.km} km`);
const d1 = S.daySteps('2026-10-23', cache, [run, lift], EX, 80, P);
ok(d1.inCardio === 3000 && d1.counted === 4000, `logged 30-min run with 3,000 steps inside it: excluded (${d1.inCardio}); strength workout not excluded → ${d1.counted} counted, +${d1.kcal} kcal`);
const sneaky = { ...lift, id: 'w', start: L(23, 7), end: L(23, 7, 30), exercises: [{ id: 'e', exerciseId: 'bench', restSec: 0, sets: [{ id: 's', type: 'N', km: 3, done: true }] }] };
ok(S.daySteps('2026-10-23', cache, [sneaky], EX, 80, P).inCardio === 3000, 'a set with distance counts as cardio even on a non-cardio exercise');
ok(S.daySteps('2026-10-23', { days: { '2026-10-23': 1500 }, segs: [] }, [], EX, 80, P).kcal === 0, 'under the resting allowance → 0 kcal');
ok(S.daySteps('2026-10-23', cache, [], EX, null, P).kcal === 0 && S.daySteps('2026-10-23', null, [], EX, 80, P).steps === 0, 'no body weight → no kcal; no data → 0 steps');
const late = { ...run, id: 'late', start: L(23, 23, 30), end: L(24, 0, 30) };
const c2 = { days: { '2026-10-23': 4000, '2026-10-24': 3000 }, segs: [[L(23, 23, 30), L(24, 0, 30), 2000]] };
ok(S.daySteps('2026-10-23', c2, [late], EX, 80, P).inCardio === 1000 && S.daySteps('2026-10-24', c2, [late], EX, 80, P).inCardio === 1000, 'a cardio workout across midnight is excluded from each day only for its own part');
ok(S.daySteps('2026-10-23', { days: { '2026-10-23': 2500 }, segs: [[L(23, 7), L(23, 8), 9000]] }, [{ ...run, end: L(23, 8) }], EX, 80, P).counted === 0, 'excluded steps never exceed the day total (no negative)');
ok(S.newer('1.0.10', '1.0.9') && !S.newer('1.0.0', '1.0.0') && !S.newer('1.0', '1.0.1') && S.newer('2.0', '1.9.9'), 'shell version compare');
if (bad) { console.error(bad + ' FAILED'); process.exit(1); } console.log('STEPS UNIT TESTS PASSED');
