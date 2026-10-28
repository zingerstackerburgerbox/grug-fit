// v1.17.0 nutrient catalogue unit tests: coverage, units + IU conversion, % of NHMRC reference by sex, UL warnings,
// migration of old supplements, label-read mapping, and the Worker's key list staying in sync with the app.
import { buildSync } from 'esbuild';
import { NUTRIENT_KEYS } from '../coach-proxy/src/label.js';
const src = buildSync({ stdin: { contents: "export * from './src/nutrients'; export { applyLabel } from './src/labelread'; export { prefill } from './src/suppscan';", resolveDir: '.', loader: 'ts' }, bundle: true, format: 'esm', write: false, platform: 'browser', define: { 'import.meta.env': '{}' } }).outputFiles[0].text;
import { writeFileSync } from 'node:fs'; const tmp = '/tmp/lunk-nutrients-test.mjs'; writeFileSync(tmp, src);
const N = await import(tmp);
let failed = 0; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) failed++; };
const keys = N.NUTRIENTS.map((d) => d.key);
const want = ['vitA', 'b1', 'b2', 'b3', 'b5', 'b6', 'b7', 'folate', 'b12', 'vitC', 'vitD', 'vitE', 'vitK1', 'vitK2', 'calcium', 'magnesium', 'zinc', 'iron', 'potassium', 'sodium', 'phosphorus', 'selenium', 'iodine', 'copper', 'manganese', 'chromium', 'molybdenum', 'boron', 'chloride', 'fluoride', 'epa', 'dha', 'creatine', 'caffeine', 'theanine', 'betaAlanine', 'citrulline', 'ashwagandha', 'coq10', 'collagen', 'glucosamine', 'melatonin', 'probiotics', 'fibre', 'protein'];
ok(want.every((k) => keys.includes(k)), `catalogue has all ${want.length} requested entries (${keys.length} total)`);
ok(new Set(keys).size === keys.length, 'keys unique');
ok(JSON.stringify([...NUTRIENT_KEYS].sort()) === JSON.stringify([...keys].sort()), 'Worker label-read key list matches the app catalogue');
// units + conversion
ok(N.toCanon({ key: 'vitD', amount: 1000, unit: 'IU' }) === 25, '1000 IU vitamin D = 25 µg');
ok(Math.abs(N.toCanon({ key: 'vitA', amount: 6000, unit: 'IU' }) - 1800) < 1e-9, '6000 IU vitamin A = 1800 µg RAE (retinol)');
ok(Math.abs(N.toCanon({ key: 'vitE', amount: 30, unit: 'IU' }) - 20.1) < 1e-9, '30 IU vitamin E = 20.1 mg (natural d-alpha)');
ok(N.toCanon({ key: 'creatine', amount: 5000, unit: 'mg' }) === 5 && N.toCanon({ key: 'zinc', amount: 15000, unit: 'µg' }) === 15 && N.toCanon({ key: 'b12', amount: 1, unit: 'mcg' }) === 1, 'mass units convert (mg↔g↔µg, mcg)');
ok(N.toCanon({ key: 'zinc', amount: 1, unit: 'IU' }) === null && N.toCanon({ key: 'probiotics', amount: 2e10, unit: 'CFU' }) === 20, 'IU only where standard; CFU → bn CFU');
ok(N.unitsFor('vitD').join() === 'µg,g,mg,IU' && N.unitsFor('caffeine').includes('mg') && !N.unitsFor('caffeine').includes('IU'), 'unit choices per nutrient');
// % daily (NHMRC NRVs)
ok(N.pctRdi({ key: 'zinc', amount: 14, unit: 'mg' }, 'male') === 100 && N.pctRdi({ key: 'zinc', amount: 14, unit: 'mg' }, 'female') === 175, 'zinc 14 mg: 100% men (RDI 14), 175% women (RDI 8)');
ok(N.pctRdi({ key: 'iron', amount: 18, unit: 'mg' }, undefined) === 100, 'no sex in profile → higher adult value (iron 18 mg)');
ok(N.pctRdi({ key: 'vitD', amount: 1000, unit: 'IU' }, 'male') === 500, 'vitamin D 1000 IU = 500% of the 5 µg AI');
ok(N.pctRdi({ key: 'creatine', amount: 5, unit: 'g' }, 'male') === null, 'compounds have no % daily');
// UL
const t = N.totals([[[{ key: 'magnesium', amount: 250, unit: 'mg' }, { key: 'zinc', amount: 15, unit: 'mg' }], 2], [[{ key: 'caffeine', amount: 200, unit: 'mg' }], 3], [[{ key: 'vitD', amount: 1000, unit: 'IU' }], 1]]);
const w = N.ulWarnings(t); ok(t.get('magnesium') === 500 && t.get('vitD') === 25, 'totals across doses × count, canonical units');
ok(w.some((x) => x.key === 'magnesium' && x.kind === 'ul' && x.limit === 350) && w.some((x) => x.key === 'caffeine' && x.kind === 'guide') && !w.some((x) => x.key === 'zinc' || x.key === 'vitD'), 'UL warnings: magnesium 500 > 350 (supplement UL), caffeine 600 > 400 guide; zinc 30 and D 25 µg fine');
// migration
const old = { nutrients: { vitD: 25, magnesium: 300, protein: 0, b12: 2.4 } };
const m = N.suppIngredients(old); ok(m.length === 3 && m.find((x) => x.key === 'vitD').unit === 'µg' && m.find((x) => x.key === 'magnesium').amount === 300, 'old nutrients → ingredients (zero dropped)');
ok(JSON.stringify(N.legacyNutrients([{ key: 'vitD', amount: 1000, unit: 'IU' }, { key: 'zinc', amount: 15, unit: 'mg' }, { key: 'protein', amount: 24, unit: 'g' }])) === '{"vitD":25,"protein":24}', 'diary nutrients kept in sync (vitD 25 µg, protein; zinc only in ingredients)');
ok(N.suppIngredients({ ingr: [], nutrients: { vitD: 25 } }).length === 0, 'saved ingredients win over the old field');
// search + matching
ok(N.searchNutrients('biotin')[0].key === 'b7' && N.searchNutrients('thiamine')[0].key === 'b1' && N.searchNutrients('fish oil').length === 2 && !N.searchNutrients('zzz').length, 'search by name / alias');
ok(N.matchKey('Vitamin D3 (as Cholecalciferol)') === 'vitD' && N.matchKey('Zinc (as Zinc Citrate)') === 'zinc' && N.matchKey('Folic Acid') === 'folate' && N.matchKey('Pyridoxine HCl') === 'b6' && N.matchKey('Maca root') === null, 'free-text names → keys');
ok(N.toIngredient('Maca root', 500, 'mg').key === 'custom' && N.toIngredient('Vitamin B12', 60, 'mcg').unit === 'µg', 'unknowns → custom; mcg → µg');
// label read → form
const cur = { id: 'x', name: '', kind: 'supplement', doseAmount: 1, unit: 'capsule', form: 'Capsule', unitsPerDose: 1, lowStock: 7, stock: null, color: '#000' };
const a = N.applyLabel({ name: 'Multivitamin for Men', brand: 'Nutricost', form: 'Capsule', serving: { text: '2 Capsules', qty: 2, unit: 'capsule' }, servingsPerContainer: 60,
  ingredients: [{ key: 'vitD', name: 'Vitamin D3', amount: 3000, unit: 'IU' }, { key: 'custom', name: 'Zinc (as zinc AAC)', amount: 30, unit: 'mg' }, { key: 'custom', name: 'TestX Blend', amount: 340, unit: 'mg' }, { key: 'zinc', name: 'dup', amount: 1, unit: 'IU' }] }, cur);
ok(a.supp.name === 'Multivitamin for Men' && a.supp.doseAmount === 2 && a.supp.unit === 'capsule' && a.supp.unitsPerDose === 2 && a.supp.servings === 60 && a.supp.serving === '2 Capsules', 'label → name, 2 capsules per dose, 60 servings');
ok(a.ingr.length === 4 && a.ingr[1].key === 'zinc' && a.ingr[2].key === 'custom' && a.ingr[2].name === 'TestX Blend' && a.ingr[3].key === 'custom', 'label ingredients: custom zinc remapped, blend kept as custom, a row whose unit does not convert kept as custom (visible to fix)');
ok(N.prefill({ status: 'found', src: 'dsld', name: 'Creatine', ingredients: [{ name: 'Creatine Monohydrate', amount: 5, unit: 'g' }] }, cur).ingr[0].key === 'creatine', 'barcode prefill uses the catalogue too');
if (failed) { console.error(failed, 'failed'); process.exit(1); } console.log('NUTRIENT UNIT TESTS PASSED');
