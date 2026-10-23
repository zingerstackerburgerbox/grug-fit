// v1.8.5: protein/carbs/fat scale with the calorie target (ratio kept, whole grams); fibre untouched; macro edits don't cascade.
import { buildSync } from 'esbuild'; import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { pathToFileURL } from 'node:url';
const dir = mkdtempSync(join(tmpdir(), 'tg-'));
buildSync({ entryPoints: [new URL('../src/targets.ts', import.meta.url).pathname], bundle: true, format: 'esm', outfile: join(dir, 'b.mjs'), logLevel: 'error' });
const { scaleMacros, applyTargetChange } = await import(pathToFileURL(join(dir, 'b.mjs')).href);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; }; const J = JSON.stringify;
const T = { kcal: 2000, protein: 200, carbs: 150, fat: 60, fibre: 30, vitC: 90 };
ok(J(scaleMacros(T, 1000)) === J({ protein: 100, carbs: 75, fat: 30 }), '2000 → 1000 kcal: protein 200 → 100, carbs 150 → 75, fat 60 → 30');
ok(J(scaleMacros(T, 2500)) === J({ protein: 250, carbs: 188, fat: 75 }), '2000 → 2500 kcal: 250 / 187.5→188 / 75 (whole grams)');
ok(J(scaleMacros({ kcal: 1800, protein: 157.5, carbs: 202.5, fat: 40 }, 2150)) === J({ protein: 188, carbs: 242, fat: 48 }), 'defaults 1800 → 2150: 188 / 242 / 48');
ok(J(scaleMacros(T, 0)) === J({ protein: 200, carbs: 150, fat: 60 }) && J(scaleMacros(T, null)) === J({ protein: 200, carbs: 150, fat: 60 }) && J(scaleMacros({ ...T, kcal: 0 }, 1500)) === J({ protein: 200, carbs: 150, fat: 60 }), 'invalid / empty calories → macros unchanged');
const a = applyTargetChange(T, { kcal: 1000 });
ok(a.next.protein === 100 && a.next.carbs === 75 && a.next.fat === 30 && a.next.fibre === 30 && a.next.vitC === 90 && J(a.scaled) === J(['protein', 'carbs', 'fat']), 'calorie-only change: macros scaled, fibre + micros unchanged');
const b = applyTargetChange(T, { kcal: 1000, protein: 160 });
ok(b.next.protein === 160 && b.next.carbs === 75 && b.next.fat === 30 && J(b.scaled) === J(['carbs', 'fat']), 'explicit macro wins, the others scale');
const c = applyTargetChange(T, { protein: 150 });
ok(c.next.kcal === 2000 && c.next.protein === 150 && c.next.carbs === 150 && c.next.fat === 60 && !c.scaled.length, 'macro-only change: nothing else changes');
ok(!applyTargetChange(T, { kcal: 2000 }).scaled.length, 'same calories → nothing scaled');
if (bad) { console.error(bad + ' FAILED'); process.exit(1); } console.log('TARGETS UNIT TESTS PASSED');
