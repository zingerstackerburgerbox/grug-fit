import type { Food, Serving, DiaryEntry } from './types';
import { r1 } from './util';

export const baseUnit = (f: Pick<Food, 'unit'>) => f.unit || 'g';
export const isBase = (label: string) => label === 'g' || label === 'ml' || label === '100 g' || label === '100 ml';
/** Units offered on the amount screen: base unit first, then the food's servings/packages. */
export function unitsFor(f: Food): Serving[] {
  const b = baseUnit(f);
  return [{ label: b, grams: 1 }, ...f.servings.filter((s) => !isBase(s.label) && s.grams > 0)];
}
export const unitLabel = (s: Serving, f: Pick<Food, 'unit'>) => (isBase(s.label) ? s.label : `${s.label} (${r1(s.grams)} ${baseUnit(f)}${s.note ? ` · ${s.note}` : ''})`);
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
export function amountText(e: Pick<DiaryEntry, 'serving' | 'grams' | 'qty'>) {
  if (isBase(e.serving)) return `${r1(e.grams)} ${e.serving.includes('ml') ? 'ml' : 'g'}`;
  return `${r1(e.qty)} × ${e.serving} · ${Math.round(e.grams)} g`;
}
