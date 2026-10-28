// v1.16.0 supplement barcodes. Order: your own doses with that barcode → device cache (incl. ones you entered by hand) →
// offline AU pack (name/brand, instant) → coach-proxy Worker /supp/barcode (Open Food Facts → NIH DSLD → Open Products Facts,
// edge-cached). Results are cached on the device; nothing is sent anywhere except the barcode to the Worker.
import type { Nutrients, Supplement } from './types';
import { all } from './db';
import { cacheGet, cachePut, normCode, packLookup } from './offpack';
import { proxyGet } from './foodlookup';
import { proxyReady } from './coach';

export type SuppIngredient = { name: string; amount: number; unit: string };
export type SuppHit = { status: 'found'; src: 'off' | 'dsld' | 'opf' | 'pack' | 'mine'; code?: string; name: string; brand?: string;
  serving?: { text?: string; qty?: number; unit?: string }; form?: string; ingredients?: SuppIngredient[] };
export type SuppResult = SuppHit | { status: 'saved'; supp: Supplement } | { status: 'none'; offline?: boolean };
export const SRC_LABEL: Record<SuppHit['src'], string> = { off: 'Open Food Facts', dsld: 'NIH Dietary Supplement Label Database', opf: 'Open Products Facts', pack: 'offline Australian pack', mine: 'you, on this device' };
const KEY = (c: string) => 'supp:' + normCode(c); const MAX_AGE = 30 * 86400e3;

export async function lookupSupp(code: string): Promise<SuppResult> {
  const c = normCode(code);
  const mine = (await all<Supplement>('supplements').catch(() => [] as Supplement[])).find((x) => !x.archived && x.barcode && normCode(x.barcode) === c);
  if (mine) return { status: 'saved', supp: mine };
  const hit = await cacheGet<SuppHit>(KEY(code), MAX_AGE); if (hit?.status === 'found') return hit;
  const pk = await packLookup(code).catch(() => null);
  const base: SuppHit | null = pk ? { status: 'found', src: 'pack', code, name: pk.name, brand: pk.brand || undefined } : null;
  let w: any = null, offline = false;
  if (proxyReady()) { try { w = await proxyGet(`/supp/barcode?code=${encodeURIComponent(code)}`, 9000); } catch { offline = true; } } else offline = true;
  const found: SuppHit | null = w?.status === 'found' && w.name ? { ...w, brand: w.brand || base?.brand } : base;
  if (found) { await cachePut(KEY(code), found); return found; }
  return { status: 'none', offline };
}
/** remember a hand-entered (or edited) supplement for this barcode, so the next scan finds it even after it's deleted */
export const rememberSupp = (code: string, s: Supplement) => cachePut(KEY(code), { status: 'found', src: 'mine', code, name: s.name, brand: s.brand, form: s.form,
  serving: { qty: s.doseAmount, unit: s.unit }, ingredients: [] } as SuppHit);

const FILLER = /^(calories|total (fat|carbohydrates?)|fat|carbohydrates?|cholesterol|sugars?|total sugars|added sugars|dietary fiber|fibre|saturated fat|trans fat)$/i;
export const keyIngredients = (h: SuppHit) => (h.ingredients || []).filter((i) => !FILLER.test(i.name.trim()));
const NUT: [RegExp, keyof Nutrients, string][] = [[/^protein$/i, 'protein', 'g'], [/^vitamin d/i, 'vitD', 'µg'], [/^vitamin c/i, 'vitC', 'mg'], [/^vitamin b-?12|cobalamin/i, 'b12', 'µg'],
  [/^magnesium/i, 'magnesium', 'mg'], [/^calcium/i, 'calcium', 'mg'], [/^iron/i, 'iron', 'mg'], [/^potassium/i, 'potassium', 'mg'], [/^sodium/i, 'sodium', 'mg'], [/^folate|folic/i, 'folate', 'µg']];
const UNITS = ['mg', 'µg', 'g', 'IU', 'ml'];
/** the dose-form fields a hit suggests (the user confirms before saving) */
export function prefill(h: SuppHit, cur: Supplement): { supp: Supplement; nutrients: Record<string, string> } {
  const key = keyIngredients(h); const form = h.form || cur.form;
  const n: Record<string, string> = {};
  for (const i of h.ingredients || []) for (const [re, k, u] of NUT) if (re.test(i.name) && i.unit === u && n[k] == null) n[k] = String(i.amount);
  let doseAmount = cur.doseAmount, unit = cur.unit, unitsPerDose = cur.unitsPerDose;
  const main = key.filter((i) => !/^protein$/i.test(i.name));
  if (main.length === 1 && UNITS.includes(main[0].unit)) { doseAmount = main[0].amount; unit = main[0].unit; } // e.g. creatine 5 g, caffeine 200 mg
  else if (h.serving?.qty && UNITS.includes(h.serving.unit || '')) { doseAmount = h.serving.qty; unit = h.serving.unit!; }
  else if (h.serving?.qty) { doseAmount = h.serving.qty; unit = /scoop/i.test(h.serving.unit || '') ? 'scoop' : form === 'Tablet' ? 'tablet' : form === 'Capsule' || form === 'Softgel' ? 'capsule' : cur.unit; }
  if (form === 'Powder' && unit === 'g') unitsPerDose = doseAmount; else if (unit === 'capsule' || unit === 'tablet') unitsPerDose = doseAmount;
  const lines = [h.serving?.text && `Serving: ${h.serving.text}`, key.length ? `Per serving: ${key.map((i) => `${i.name} ${i.amount} ${i.unit}`).join(', ')}` : ''].filter(Boolean);
  return { supp: { ...cur, name: h.name, brand: h.brand, form, doseAmount, unit, unitsPerDose, barcode: h.code || cur.barcode, notes: [cur.notes, ...lines].filter(Boolean).join('\n') || undefined }, nutrients: n };
}
