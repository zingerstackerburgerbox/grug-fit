/**
 * v1.17.0 supplement nutrient catalogue: every vitamin, mineral and common supplement compound, with units, IU conversions
 * and Australian reference values (NHMRC/MoH Nutrient Reference Values, adults 19–50; RDI, or AI where no RDI is set; UL = upper level).
 * A supplement stores `ingr` (key + amount + the unit it was entered in); the old `nutrients` field is still written for the
 * diary totals and older backups, and old supplements are migrated on read (suppIngredients).
 */
import type { Nutrients, Supplement } from './types';

export type NCat = 'Vitamins' | 'Minerals' | 'Compounds' | 'Macros';
export type NDef = {
  key: string; label: string; unit: string; cat: NCat; alias?: string[];
  /** canonical units per 1 IU (vitamins A, D, E) */ iu?: number;
  /** reference daily amount (RDI or AI) for adult men / women, in `unit` */ rdi?: { m: number; f: number }; ai?: boolean;
  /** upper level of intake (adults) in `unit`; ulNote says what it applies to */ ul?: number; ulNote?: string;
  /** a guidance ceiling that isn't an NHMRC UL (e.g. caffeine) */ guide?: number; guideNote?: string;
  /** the old Nutrients key this maps to (counts toward the Food diary micronutrients) */ legacy?: keyof Nutrients;
  extraUnits?: string[];
};
const V = (key: string, label: string, unit: string, o: Partial<NDef> = {}): NDef => ({ key, label, unit, cat: 'Vitamins', ...o });
const M = (key: string, label: string, unit: string, o: Partial<NDef> = {}): NDef => ({ key, label, unit, cat: 'Minerals', ...o });
const C = (key: string, label: string, unit: string, o: Partial<NDef> = {}): NDef => ({ key, label, unit, cat: 'Compounds', ...o });
const X = (key: string, label: string, unit: string, o: Partial<NDef> = {}): NDef => ({ key, label, unit, cat: 'Macros', ...o });

export const NUTRIENTS: NDef[] = [
  V('vitA', 'Vitamin A', 'µg', { alias: ['retinol', 'retinyl', 'beta-carotene', 'RAE', 'RE'], iu: 0.3, rdi: { m: 900, f: 700 }, ul: 3000, ulNote: 'preformed vitamin A (retinol)', legacy: 'vitA' }),
  V('b1', 'Vitamin B1 (thiamin)', 'mg', { alias: ['thiamine', 'thiamin'], rdi: { m: 1.2, f: 1.1 } }),
  V('b2', 'Vitamin B2 (riboflavin)', 'mg', { alias: ['riboflavin'], rdi: { m: 1.3, f: 1.1 } }),
  V('b3', 'Vitamin B3 (niacin)', 'mg', { alias: ['niacin', 'nicotinamide', 'niacinamide', 'nicotinic acid'], rdi: { m: 16, f: 14 }, ul: 35, ulNote: 'nicotinic acid from supplements' }),
  V('b5', 'Vitamin B5 (pantothenic acid)', 'mg', { alias: ['pantothenic', 'pantothenate'], rdi: { m: 6, f: 4 }, ai: true }),
  V('b6', 'Vitamin B6', 'mg', { alias: ['pyridoxine', 'pyridoxal'], rdi: { m: 1.3, f: 1.3 }, ul: 50 }),
  V('b7', 'Vitamin B7 (biotin)', 'µg', { alias: ['biotin'], rdi: { m: 30, f: 25 }, ai: true }),
  V('folate', 'Vitamin B9 (folate / folic acid)', 'µg', { alias: ['folic', 'folate', 'b9', 'DFE', 'methylfolate'], rdi: { m: 400, f: 400 }, ul: 1000, ulNote: 'folic acid from supplements and fortified food', legacy: 'folate' }),
  V('b12', 'Vitamin B12', 'µg', { alias: ['cobalamin', 'cyanocobalamin', 'methylcobalamin'], rdi: { m: 2.4, f: 2.4 }, legacy: 'b12' }),
  V('vitC', 'Vitamin C', 'mg', { alias: ['ascorbic', 'ascorbate'], rdi: { m: 45, f: 45 }, legacy: 'vitC' }),
  V('vitD', 'Vitamin D', 'µg', { alias: ['cholecalciferol', 'd3', 'd2', 'ergocalciferol'], iu: 0.025, rdi: { m: 5, f: 5 }, ai: true, ul: 80, legacy: 'vitD' }),
  V('vitE', 'Vitamin E', 'mg', { alias: ['tocopherol', 'alpha-tocopherol'], iu: 0.67, rdi: { m: 10, f: 7 }, ai: true, ul: 300 }),
  V('vitK1', 'Vitamin K1', 'µg', { alias: ['phylloquinone', 'vitamin k'], rdi: { m: 70, f: 60 }, ai: true }),
  V('vitK2', 'Vitamin K2', 'µg', { alias: ['menaquinone', 'mk-7', 'mk7', 'mk-4'] }),
  M('calcium', 'Calcium', 'mg', { rdi: { m: 1000, f: 1000 }, ul: 2500, legacy: 'calcium' }),
  M('magnesium', 'Magnesium', 'mg', { rdi: { m: 420, f: 320 }, ul: 350, ulNote: 'applies to supplements; food is extra', legacy: 'magnesium' }),
  M('zinc', 'Zinc', 'mg', { rdi: { m: 14, f: 8 }, ul: 40 }),
  M('iron', 'Iron', 'mg', { rdi: { m: 8, f: 18 }, ul: 45, legacy: 'iron' }),
  M('potassium', 'Potassium', 'mg', { rdi: { m: 3800, f: 2800 }, ai: true, legacy: 'potassium' }),
  M('sodium', 'Sodium', 'mg', { rdi: { m: 920, f: 920 }, ai: true, ul: 2300, legacy: 'sodium' }),
  M('phosphorus', 'Phosphorus', 'mg', { rdi: { m: 1000, f: 1000 }, ul: 4000 }),
  M('selenium', 'Selenium', 'µg', { rdi: { m: 70, f: 60 }, ul: 400 }),
  M('iodine', 'Iodine', 'µg', { rdi: { m: 150, f: 150 }, ul: 1100 }),
  M('copper', 'Copper', 'mg', { rdi: { m: 1.7, f: 1.2 }, ai: true, ul: 10 }),
  M('manganese', 'Manganese', 'mg', { rdi: { m: 5.5, f: 5 }, ai: true }),
  M('chromium', 'Chromium', 'µg', { rdi: { m: 35, f: 25 }, ai: true }),
  M('molybdenum', 'Molybdenum', 'µg', { rdi: { m: 45, f: 45 }, ul: 2000 }),
  M('boron', 'Boron', 'mg'),
  M('chloride', 'Chloride', 'mg'),
  M('fluoride', 'Fluoride', 'mg', { rdi: { m: 4, f: 3 }, ai: true, ul: 10 }),
  C('epa', 'Omega-3 EPA', 'mg', { alias: ['eicosapentaenoic', 'fish oil', 'omega 3'] }),
  C('dha', 'Omega-3 DHA', 'mg', { alias: ['docosahexaenoic', 'fish oil', 'omega 3'] }),
  C('creatine', 'Creatine', 'g', { alias: ['creatine monohydrate'] }),
  C('caffeine', 'Caffeine', 'mg', { guide: 400, guideNote: 'about 400 mg a day is the usual guide for healthy adults (FSANZ)' }),
  C('theanine', 'L-theanine', 'mg', { alias: ['theanine'] }),
  C('betaAlanine', 'Beta-alanine', 'g', { alias: ['beta alanine', 'carnosyn'] }),
  C('citrulline', 'Citrulline', 'g', { alias: ['l-citrulline', 'citrulline malate'] }),
  C('ashwagandha', 'Ashwagandha', 'mg', { alias: ['withania', 'ksm-66'] }),
  C('coq10', 'CoQ10', 'mg', { alias: ['coenzyme q10', 'ubiquinol', 'ubiquinone'] }),
  C('collagen', 'Collagen', 'g', { alias: ['collagen peptides', 'hydrolysed collagen'] }),
  C('glucosamine', 'Glucosamine', 'mg'),
  C('melatonin', 'Melatonin', 'mg'),
  C('probiotics', 'Probiotics', 'bn CFU', { alias: ['cfu', 'lactobacillus', 'bifidobacterium', 'probiotic'], extraUnits: ['CFU'] }),
  X('protein', 'Protein', 'g', { legacy: 'protein' }),
  X('fibre', 'Fibre', 'g', { alias: ['fiber', 'psyllium', 'inulin'], legacy: 'fibre' }),
  X('kcal', 'Energy', 'kcal', { alias: ['calories'], legacy: 'kcal' }),
  X('carbs', 'Carbohydrate', 'g', { alias: ['carbohydrates'], legacy: 'carbs' }),
  X('sugar', 'Sugars', 'g', { legacy: 'sugar' }),
  X('fat', 'Fat', 'g', { legacy: 'fat' }),
];
export const NUT = new Map(NUTRIENTS.map((d) => [d.key, d]));
export const CATS: NCat[] = ['Vitamins', 'Minerals', 'Compounds', 'Macros'];
export const CUSTOM_UNITS = ['mg', 'µg', 'g', 'IU', 'ml', 'bn CFU', 'capsule', 'drop'];

export type Ingredient = { key: string; amount: number; unit: string; /** custom entries: the free name */ name?: string };

const MASS: Record<string, number> = { g: 1e6, mg: 1e3, 'µg': 1, mcg: 1 };
/** units the picker offers for a nutrient */
export function unitsFor(key: string): string[] {
  const d = NUT.get(key); if (!d) return CUSTOM_UNITS;
  const u = [d.unit]; if (MASS[d.unit]) for (const m of ['g', 'mg', 'µg']) if (!u.includes(m)) u.push(m);
  if (d.iu) u.push('IU'); if (d.unit === 'bn CFU') u.push('CFU'); return u;
}
/** amount in the nutrient's canonical unit, or null when the unit doesn't convert */
export function toCanon(i: Ingredient): number | null {
  const d = NUT.get(i.key); if (!d) return null; const u = i.unit === 'mcg' ? 'µg' : i.unit;
  if (u === d.unit) return i.amount;
  if (u === 'IU') return d.iu ? i.amount * d.iu : null;
  if (MASS[u] && MASS[d.unit]) return (i.amount * MASS[u]) / MASS[d.unit];
  if (d.unit === 'bn CFU' && u === 'CFU') return i.amount / 1e9;
  return null;
}
export const fromIU = (key: string, iu: number) => { const d = NUT.get(key); return d?.iu ? iu * d.iu : null; };
export type Sex = 'male' | 'female' | undefined;
/** reference daily amount for the user (profile sex; without one, the higher adult value) */
export function rdiFor(key: string, sex: Sex): number | null {
  const d = NUT.get(key); if (!d?.rdi) return null; return sex === 'male' ? d.rdi.m : sex === 'female' ? d.rdi.f : Math.max(d.rdi.m, d.rdi.f);
}
export function pctRdi(i: Ingredient, sex: Sex): number | null { const c = toCanon(i); const r = rdiFor(i.key, sex); return c == null || !r ? null : Math.round((c / r) * 100); }
export const labelOf = (i: Ingredient) => (i.key === 'custom' ? i.name || 'Custom' : NUT.get(i.key)?.label || i.key);
const r = (n: number) => (n >= 100 ? Math.round(n) : n >= 10 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100);
export const fmtAmt = (n: number) => String(r(n));

/** search the catalogue (label, key, aliases); empty query lists everything */
export function searchNutrients(q: string): NDef[] {
  const t = q.trim().toLowerCase(); if (!t) return NUTRIENTS;
  const words = t.split(/\s+/);
  return NUTRIENTS.filter((d) => { const hay = [d.label, d.key, ...(d.alias || [])].join(' ').toLowerCase(); return words.every((w) => hay.includes(w)); });
}

/** v1.17.0 migration: old supplements only had `nutrients` (Food-diary keys) */
export function suppIngredients(s: Pick<Supplement, 'ingr' | 'nutrients'>): Ingredient[] {
  if (Array.isArray(s.ingr)) return s.ingr;
  const out: Ingredient[] = [];
  for (const [k, v] of Object.entries(s.nutrients || {})) { if (typeof v !== 'number' || !v) continue; const d = NUTRIENTS.find((x) => x.legacy === k); if (d) out.push({ key: d.key, amount: v, unit: d.unit }); }
  return out;
}
/** the Food-diary nutrients a dose adds (only keys the diary knows) */
export function legacyNutrients(ingr: Ingredient[]): Partial<Nutrients> {
  const n: any = {}; for (const i of ingr) { const d = NUT.get(i.key); const c = toCanon(i); if (d?.legacy && c != null) n[d.legacy] = (n[d.legacy] || 0) + c; } return n;
}
/** totals (canonical units) from a list of [ingredients, multiplier] */
export function totals(list: [Ingredient[], number][]): Map<string, number> {
  const m = new Map<string, number>();
  for (const [ingr, k] of list) for (const i of ingr) { const c = toCanon(i); if (c == null) continue; m.set(i.key, (m.get(i.key) || 0) + c * k); }
  return m;
}
export type UlWarn = { key: string; label: string; total: number; limit: number; unit: string; kind: 'ul' | 'guide'; note?: string };
export function ulWarnings(t: Map<string, number>): UlWarn[] {
  const w: UlWarn[] = [];
  for (const [key, total] of t) { const d = NUT.get(key); if (!d) continue;
    if (d.ul && total > d.ul) w.push({ key, label: d.label, total, limit: d.ul, unit: d.unit, kind: 'ul', note: d.ulNote });
    else if (d.guide && total > d.guide) w.push({ key, label: d.label, total, limit: d.guide, unit: d.unit, kind: 'guide', note: d.guideNote }); }
  return w;
}
/** map a free text name + unit (labels, barcode lookups, the label read) onto a catalogue key */
export function matchKey(name: string): string | null {
  const t = name.toLowerCase().replace(/[()®™,]/g, ' ');
  const vit = t.match(/vitamin\s*([a-z])\s*-?\s*(\d+)?/);
  if (vit) { const k = (vit[1] + (vit[2] || '')).toLowerCase(); const map: Record<string, string> = { a: 'vitA', c: 'vitC', d: 'vitD', d3: 'vitD', d2: 'vitD', e: 'vitE', k: 'vitK1', k1: 'vitK1', k2: 'vitK2', b1: 'b1', b2: 'b2', b3: 'b3', b5: 'b5', b6: 'b6', b7: 'b7', b9: 'folate', b12: 'b12' }; if (map[k]) return map[k]; }
  for (const d of NUTRIENTS) if (t.trim() === d.label.toLowerCase() || t.trim() === d.key.toLowerCase()) return d.key;
  for (const d of NUTRIENTS) for (const a of [d.label.split(' (')[0], ...(d.alias || [])]) if (a.length > 3 && new RegExp(`\\b${a.toLowerCase().replace(/[-]/g, '[- ]?')}`).test(t)) return d.key;
  for (const d of NUTRIENTS) if (d.cat === 'Minerals' && t.includes(d.label.toLowerCase())) return d.key;
  return null;
}
/** a free-text ingredient (name, amount, unit) as an Ingredient: a catalogue key when it maps and the unit converts, else custom */
export function toIngredient(name: string, amount: number, unit: string): Ingredient {
  const u = unit === 'mcg' ? 'µg' : unit; const key = matchKey(name);
  if (key) { const i = { key, amount, unit: u }; if (toCanon(i) != null) return i; }
  return { key: 'custom', name: name.slice(0, 60), amount, unit: u.slice(0, 12) };
}
