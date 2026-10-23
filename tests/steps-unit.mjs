// v1.9.1 manual steps → calories (stride from height, net 0.5 kcal/kg/km, first 2,000 steps are resting allowance), goal rules.
import { buildSync } from 'esbuild'; import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { pathToFileURL } from 'node:url';
const dir = mkdtempSync(join(tmpdir(), 'st-'));
buildSync({ entryPoints: [new URL('../src/steps.ts', import.meta.url).pathname], bundle: true, format: 'esm', outfile: join(dir, 'b.mjs'), logLevel: 'error' });
const S = await import(pathToFileURL(join(dir, 'b.mjs')).href);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const near = (a, b, e = 1) => Math.abs(a - b) <= e;
ok(near(S.strideCm(180, 'male'), 74.7, 0.01) && near(S.strideCm(165, 'female'), 68.1, 0.1), 'stride from height (0.415 / 0.413 × height)');
ok(near(S.stepsKm(10000, 180, 'male'), 7.47, 0.01), '10,000 steps at 180 cm ≈ 7.5 km');
ok(near(S.stepKcal(10000, 80, 180, 'male'), 299, 1), '10,000 steps, 80 kg, 180 cm → ≈ 299 kcal net');
const d = S.daySteps(12000, 80, { heightCm: 180, sex: 'male' }); ok(d.counted === 10000 && near(d.kcal, 299) && d.km === 9, `12,000 steps: first 2,000 are resting → counted 10,000, ${d.kcal} kcal, ${d.km} km`);
ok(S.daySteps(1500, 80).kcal === 0 && S.daySteps(1500, 80).steps === 1500, 'under 2,000 steps adds nothing');
ok(S.daySteps(9000, null).kcal === 0, 'no body weight → no step calories');
ok(S.daySteps(-50, 80).steps === 0, 'negative → 0');
ok(S.stepGoal({}) === 8000 && S.stepGoal({ stepGoal: 0 }) === 0 && S.stepGoal({ stepGoal: 12000 }) === 12000, 'goal: default 8,000, 0 = no goal');
if (bad) { console.error(bad + ' FAILED'); process.exit(1); } console.log('STEPS UNIT TESTS PASSED');
