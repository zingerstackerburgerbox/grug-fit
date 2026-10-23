import type { Food, Serving, DiaryEntry } from './types';
import { r1 } from './util';

export const baseUnit = (f: Pick<Food, 'unit'>) => f.unit || 'g';
export const isBase = (label: string) => label === 'g' || label === 'ml' || label === '100 g' || label === '100 ml';
/** Units offered on the amount screen: base unit first, then the food's servings/packages. */
export function unitsFor(f: Food): Serving[] {
  const b = baseUnit(f);
  return [{ label: b, grams: 1 }, ...servingsOf(f).filter((s) => !isBase(s.label) && s.grams > 0)];
}
export const unitLabel = (s: Serving, f: Pick<Food, 'unit' | 'gramsUnknown'>) => (isBase(s.label) ? s.label : f.gramsUnknown ? `${/^[\d½¼¾]/.test(s.label) ? '' : '1 '}${s.label}` : `${/^[\d½¼¾]/.test(s.label) ? '' : '1 '}${s.label} (${r1(s.grams)} ${baseUnit(f)}${s.note ? ` · ${s.note}` : ''})`);
/** Find the unit an existing diary entry was logged with (by label, then by grams-per-unit). */
export function matchUnit(units: Serving[], e: Pick<DiaryEntry, 'serving' | 'grams' | 'qty'>): number {
  if (isBase(e.serving)) return 0;
  const i = units.findIndex((u) => u.label === e.serving);
  if (i >= 0) return i;
  const per = e.qty > 0 ? e.grams / e.qty : 0;
  const j = units.findIndex((u, k) => k > 0 && Math.abs(u.grams - per) < 0.01 * Math.max(1, per));
  return j >= 0 ? j : 0;
}
/** Turn label text like "33 g (2 biscuits)", "2 biscuits (33 g)", "400 g e" into a useful note ("2 biscuits") or undefined. */
export function cleanNote(t?: string | null): string | undefined {
  if (!t) return undefined;
  let x = String(t).trim().replace(/\s+℮$|\s+e$/i, '');
  x = x.replace(/^[\d.,]+\s*(g|gr|grams?|ml|kg|l)\b\s*/i, '').replace(/\(\s*[\d.,]+\s*(g|ml)\s*\)/i, '').replace(/^[(\s]+|[)\s]+$/g, '').trim();
  return x && !/^[\d.,]*$/.test(x) ? x : undefined;
}
/** Normalise legacy (v1) servings: drop explicit 'g'/'100 g' units, turn "serving (33 g (2 biscuits))" into label 'serving' + note. */
export function normaliseServings(list: Serving[]): Serving[] {
  const out: Serving[] = [];
  for (const s of list || []) {
    if (isBase(s.label) || !(s.grams > 0)) continue;
    const m = /^serving \((.*)\)$/.exec(s.label);
    if (m) out.push({ label: 'serving', grams: s.grams, note: cleanNote(m[1]), kind: 'serving' });
    else out.push({ ...s, note: s.note ? cleanNote(s.note) : undefined, kind: s.kind || (s.label.startsWith('serving') ? 'serving' : 'custom') });
  }
  return out;
}
/** Convert a quantity from one unit to another keeping the same grams. */
export const convertQty = (qty: number, from: Serving, to: Serving) => (to.grams > 0 ? Math.round(((qty * from.grams) / to.grams) * 1000) / 1000 : qty);
export function amountText(e: Pick<DiaryEntry, 'serving' | 'grams' | 'qty' | 'amountLabel' | 'importSource'>) {
  if (e.amountLabel) return `${e.amountLabel}${e.importSource === 'cronometer' ? ' · from Cronometer' : ''}`;
  if (isBase(e.serving)) return `${r1(e.grams)} ${e.serving.includes('ml') ? 'ml' : 'g'}`;
  return `${r1(e.qty)} × ${e.serving} · ${Math.round(e.grams)} g`;
}

// ---------- package / drained-weight logic for Open Food Facts products ----------
/** Canned / jarred in liquid: nutrition panels are for the drained food, so the gross 'quantity' (incl. brine, water, oil, syrup) is not eatable. */
const LIQUID_PACK = /in (spring ?water|springwater|water|brine|oil|olive oil|sunflower oil|vegetable oil|tomato sauce|sauce|syrup|light syrup|heavy syrup|juice|natural juice|own juice)\b|en:canned-(fish|fishes|tunas|tuna|salmon|sardines|seafood|mackerel|anchovies|vegetables|legumes|beans|chickpeas|lentils|corn|peas|mushrooms|fruits|peaches|pineapple|pears)|en:(tunas|sardines|anchovies|mackerels)-in-|en:fruits-in-syrup|en:pickles|en:olives/i;
export function packedInLiquid(p: { product_name?: string; product_name_en?: string; categories_tags?: string[]; categories?: string; _keywords?: string[] }) {
  const txt = [p.product_name_en, p.product_name, p.categories, ...(p.categories_tags || [])].filter(Boolean).join(' | ');
  return LIQUID_PACK.test(txt);
}
const num = (s: string) => +s.replace(',', '.');
/** Drained weight in grams from OFF fields / quantity text: "185 g (130 g drained)", "drained weight 130g", "poids égoutté : 130 g", "Abtropfgewicht 130 g". */
export function drainedGrams(p: any): number | undefined {
  for (const k of ['drained_weight', 'drained_weight_value', 'product_quantity_drained']) {
    const v = p?.[k]; if (v == null || v === '') continue;
    const n = typeof v === 'number' ? v : parseGrams(String(v)); if (n && n > 0) return n;
  }
  const t = [p?.quantity, p?.net_weight, p?.serving_size].filter(Boolean).join(' ; ').toLowerCase();
  const kw = '(?:drained(?: weight)?|égoutté|egoutte|poids net égoutté|poids égoutté|abtropfgewicht|sgocciolato|peso escurrido|uitlekgewicht)';
  const a = new RegExp(`([\\d.,]+)\\s*(kg|g)\\s*\\)?\\s*[(\\[]?\\s*${kw}`).exec(t) || new RegExp(`${kw}\\s*[:=]?\\s*([\\d.,]+)\\s*(kg|g)`).exec(t);
  if (a) { const n = num(a[1]) * (a[2] === 'kg' ? 1000 : 1); if (n > 0) return n; }
  return undefined;
}
function parseGrams(s: string) { const m = /([\d.,]+)\s*(kg|g)?\b/i.exec(s); return m ? num(m[1]) * (m[2]?.toLowerCase() === 'kg' ? 1000 : 1) : undefined; }
/** Grams in one OFF serving: serving_quantity, else a gram/ml figure in serving_size. Never invented. */
export function servingGrams(p: any): number | undefined {
  const sq = +p?.serving_quantity; if (sq > 0) return sq;
  const m = /([\d.,]+)\s*(g|ml)\b/i.exec(String(p?.serving_size || '')); return m && num(m[1]) > 0 ? num(m[1]) : undefined;
}

// ---------- user / built-in serving overrides ----------
export type ServingOverride = { servings: Serving[]; def?: string };
/** Built-in corrections for products whose OFF data is known to mislead (checked against the physical label). */
export const BUILTIN_SERVINGS: Record<string, ServingOverride & { wrongPackage?: { grams: number; right: number; label: string } }> = {
  // Safcol No Net Tuna in Spring Water 185 g: label serving 65 g, ~130 g drained tuna per can; per-100 g values are for drained tuna
  '9310768114941': { servings: [{ label: 'serving', grams: 65, kind: 'serving' }, { label: 'can, drained', grams: 130, kind: 'package' }], def: 'serving', wrongPackage: { grams: 185, right: 130, label: 'can, drained' } }
};
/** Servings actually offered: user's own edits win, then built-in corrections, then the source data. */
export function servingsOf(f: Pick<Food, 'servings' | 'userServings' | 'barcode'>): Serving[] {
  return f.userServings ?? (f.barcode ? BUILTIN_SERVINGS[f.barcode]?.servings : undefined) ?? f.servings ?? [];
}
export function defaultServingOf(f: Pick<Food, 'userServings' | 'defaultServing' | 'barcode'>): string | undefined {
  if (f.defaultServing !== undefined) return f.defaultServing;
  return !f.userServings && f.barcode ? BUILTIN_SERVINGS[f.barcode]?.def : undefined;
}
