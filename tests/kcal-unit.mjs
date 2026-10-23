// Unit tests for the per-set workout calorie model (v1.6.1): rest time never counts.
import { buildSync } from 'esbuild'; import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { pathToFileURL } from 'node:url';
const out = join(mkdtempSync(join(tmpdir(), 'kcal-')), 'setKcal.mjs');
buildSync({ entryPoints: [new URL('../src/setKcal.ts', import.meta.url).pathname], bundle: true, format: 'esm', outfile: out, logLevel: 'error' });
const { setKcal, estimateWorkoutKcal, romOf, bwFraction, setMode, cardioMet } = await import(pathToFileURL(out).href);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const near = (a, b, t = 0.05) => Math.abs(a - b) <= t;
const EX = {
  bench: { id: 'ex001', name: 'Bench Press (Barbell)', muscle: 'Chest', equipment: 'Barbell' },
  squat: { id: 'ex050', name: 'Squat (Barbell)', muscle: 'Quadriceps', equipment: 'Barbell' },
  curl: { id: 'ex040', name: 'Bicep Curl (Dumbbell)', muscle: 'Biceps', equipment: 'Dumbbell' },
  pushup: { id: 'ex010', name: 'Push Up', muscle: 'Chest', equipment: 'Bodyweight' },
  pullup: { id: 'ex017', name: 'Pull Up', muscle: 'Back', equipment: 'Bodyweight' },
  plank: { id: 'ex080', name: 'Plank', muscle: 'Core', equipment: 'Bodyweight' },
  run: { id: 'c1', name: 'Treadmill Run', muscle: 'Cardio', equipment: 'Machine', custom: true }
};
const map = new Map(Object.values(EX).map((e) => [e.id, e]));
const set = (kg, reps, o = {}) => ({ id: Math.random().toString(36), type: 'N', kg, reps, done: true, ...o });
const BW = 85;

// worked example: 80 kg × 10 bench, 85 kg lifter
// active 30 s → (6−1) × 85 × 30/3600 = 3.542 kcal; work 80 × 10 × 0.5 m × 9.81 / 0.22 / 4184 = 4.263 kcal; ×1.12 → 8.74 kcal/set
const one = setKcal(set(80, 10), EX.bench, BW);
ok(near(one, (5 * 85 * 30 / 3600 + 80 * 10 * 0.5 * 9.81 / 0.22 / 4184) * 1.12, 1e-9) && near(one, 8.74, 0.01), `bench 80×10 @85 kg = ${one.toFixed(2)} kcal/set (want 8.74)`);
const w3 = (gapMin) => { let t = 0; return { exercises: [{ id: 'a', exerciseId: 'ex001', restSec: 90, sets: [0, 1, 2].map(() => set(80, 10, { doneAt: (t += gapMin * 60e3) })) }], start: 0, end: t + 60e3 }; };
const short = estimateWorkoutKcal(w3(1), BW, map), long = estimateWorkoutKcal(w3(15), BW, map);
ok(near(short, 26.2, 0.05), `3×10 bench 80 kg = ${short.toFixed(1)} kcal (≈26)`);
ok(short === long, `long rests (15 min) ${long.toFixed(3)} === short rests (1 min) ${short.toFixed(3)} kcal`);
const w2h = { ...w3(1), start: 0, end: 2 * 3600e3 };
ok(estimateWorkoutKcal(w2h, BW, map) === short, 'elapsed time (2 h) has no effect');

// only completed sets count; warm-ups count normally
ok(setKcal(set(80, 10, { done: false }), EX.bench, BW) === 0, 'unticked set = 0');
ok(setKcal(set(80, 10, { type: 'W' }), EX.bench, BW) === one, 'warm-up counts like a normal set');
ok(setKcal(set(80, 10), EX.bench, 0) === 0, 'no bodyweight → 0');

// ROM + bodyweight fractions
ok(romOf(EX.bench) === 0.5 && romOf(EX.squat) === 0.6 && romOf(EX.curl) === 0.4, 'ROM: press 0.5, squat 0.6, curl 0.4');
ok(romOf({ name: 'Deadlift (Barbell)', muscle: 'Back' }) === 0.6 && romOf({ name: 'Standing Calf Raise (Machine)', muscle: 'Calves' }) === 0.1, 'ROM: deadlift 0.6, calf 0.1');
ok(bwFraction(EX.pushup) === 0.65 && bwFraction(EX.pullup) === 1 && bwFraction(EX.bench) === 0, 'bodyweight share: push-up 65 %, pull-up 100 %, barbell 0');
const pu = setKcal(set(null, 10), EX.pullup, BW);
ok(near(pu, (5 * 85 * 30 / 3600 + 85 * 10 * 0.5 * 9.81 / 0.22 / 4184) * 1.12, 1e-9), `pull-up ×10 @85 kg = ${pu.toFixed(2)} kcal`);
ok(setKcal(set(10, 10), EX.pullup, BW) > pu, 'weighted pull-up adds the extra load');
ok(near(setKcal(set(null, 10), EX.pushup, BW), (5 * 85 * 30 / 3600 + 0.65 * 85 * 10 * 0.5 * 9.81 / 0.22 / 4184) * 1.12, 1e-9), 'push-up uses 65 % of bodyweight');

// timed + cardio
ok(setMode(EX.plank) === 'hold' && setMode(EX.run) === 'cardio' && setMode(EX.bench) === 'reps', 'set modes');
ok(near(setKcal(set(null, 60), EX.plank, BW), 3 * 85 / 60 * 1.12, 1e-9), `plank 60 s = ${setKcal(set(null, 60), EX.plank, BW).toFixed(2)} kcal`);
ok(near(cardioMet(5, 30), (0.2 * 166.667 + 3.5) / 3.5, 0.01), `5 km in 30 min (10 km/h) → ${cardioMet(5, 30).toFixed(1)} MET (ACSM running)`);
ok(near(cardioMet(2.5, 30), (0.1 * 83.333 + 3.5) / 3.5, 0.01), `5 km/h walk → ${cardioMet(2.5, 30).toFixed(1)} MET (ACSM walking)`);
ok(near(setKcal(set(null, 30, { km: 5 }), EX.run, BW), (cardioMet(5, 30) - 1) * 85 * 0.5 * 1.12, 1e-9), `run 5 km / 30 min = ${setKcal(set(null, 30, { km: 5 }), EX.run, BW).toFixed(0)} kcal`);
ok(near(setKcal(set(null, 30), EX.run, BW), 6 * 85 * 0.5 * 1.12, 1e-9), 'cardio with minutes only → 7 MET');
if (bad) { console.log(`KCAL UNIT TESTS FAILED (${bad})`); process.exit(1); } console.log('KCAL UNIT TESTS PASSED');
