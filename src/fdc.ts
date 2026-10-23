/** USDA FoodData Central (Branded Foods) — second-pass barcode lookup when Open Food Facts has nothing.
 *  Public domain data (CC0). Branded nutrient values are per 100 g (or 100 ml). */
import type { Food, Nutrients, Serving } from './types';
import { cleanNote } from './servings';

export const FDC_BASE = 'https://api.nal.usda.gov/fdc/v1';
export const FDC_DEMO_KEY = 'DEMO_KEY';
export const FDC_SIGNUP = 'https://fdc.nal.usda.gov/api-key-signup';
export class FdcBusy extends Error { constructor(m = 'USDA busy') { super(m); } }

/** UPC-E (8 digits incl. number system + check digit, or the 6 middle digits) → UPC-A (12 digits). */
export function upcEtoA(e: string): string | null {
  let ns = '0', d = e, chk = '';
  if (e.length === 8) { ns = e[0]; d = e.slice(1, 7); chk = e[7]; } else if (e.length === 7) { ns = e[0]; d = e.slice(1); } else if (e.length !== 6) return null;
  if (ns !== '0' && ns !== '1') return null;
  const [a, b, c, x, y, z] = d; let body: string;
  if (z <= '2') body = a + b + z + '0000' + c + x + y;
  else if (z === '3') body = a + b + c + '00000' + x + y;
  else if (z === '4') body = a + b + c + x + '00000' + y;
  else body = a + b + c + x + y + '0000' + z;
  const s11 = ns + body; return s11 + (chk || checkDigit(s11));
}
/** GS1 check digit for the given digits (without check digit). */
export function checkDigit(s: string): string {
  let sum = 0; for (let i = 0; i < s.length; i++) sum += +s[s.length - 1 - i] * (i % 2 === 0 ? 3 : 1);
  return String((10 - (sum % 10)) % 10);
}
/** All the ways FDC may have stored this barcode: GTIN-12/13/14 zero-padding (and un-padding), plus UPC-E → UPC-A. */
export function gtinVariants(code: string): string[] {
  const c = code.replace(/\D/g, ''); const out = new Set<string>();
  const add = (x: string) => { if (!x) return; const core = x.replace(/^0+/, ''); for (const L of [8, 12, 13, 14]) if (core.length <= L) out.add(core.padStart(L, '0')); out.add(x); };
  add(c);
  if (c.length === 8 || c.length === 6 || c.length === 7) { const a = upcEtoA(c); if (a) add(a); }
  return [...out].filter((x) => x.length >= 8);
}

// nutrient number → [our key, our unit]
const MAP: Record<string, [keyof Nutrients, 'g' | 'mg' | 'µg' | 'kcal']> = {
  '208': ['kcal', 'kcal'], '203': ['protein', 'g'], '204': ['fat', 'g'], '606': ['satfat', 'g'], '205': ['carbs', 'g'], '291': ['fibre', 'g'], '269': ['sugar', 'g'],
  '307': ['sodium', 'mg'], '301': ['calcium', 'mg'], '303': ['iron', 'mg'], '401': ['vitC', 'mg'], '320': ['vitA', 'µg'], '328': ['vitD', 'µg'], '418': ['b12', 'µg'],
  '435': ['folate', 'µg'], '304': ['magnesium', 'mg'], '306': ['potassium', 'mg']
};
const TO_G: Record<string, number> = { G: 1, MG: 1e-3, UG: 1e-6, 'µG': 1e-6, MCG: 1e-6 };
const FROM_G: Record<string, number> = { g: 1, mg: 1e3, 'µg': 1e6 };
/** Map FDC foodNutrients (search-hit shape or /food/{id} shape) to per-100 g Nutrients. */
export function fdcNutrients(list: any[]): Partial<Nutrients> {
  const o: any = {}; let kj: number | undefined;
  for (const n of list || []) {
    const num = String(n.nutrientNumber ?? n.nutrient?.number ?? ''); const unit = String(n.unitName ?? n.nutrient?.unitName ?? '').toUpperCase();
    const v = n.value ?? n.amount; if (v == null || isNaN(+v)) continue;
    if (num === '268') { kj = +v; continue; }
    const m = MAP[num]; if (!m) continue; const [key, want] = m;
    if (want === 'kcal') { if (unit === 'KJ') kj = +v; else o.kcal = +v; continue; }
    const f = TO_G[unit]; if (f == null) continue; // e.g. IU (vit A/D in IU) — skip rather than guess
    o[key] = Math.round(+v * f * FROM_G[want] * 1e4) / 1e4;
  }
  if (o.kcal == null && kj != null) o.kcal = Math.round((kj / 4.184) * 100) / 100;
  return o;
}
const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()) : s);
/** FDC branded food → Grug Fit Food. Carbs from FDC are total carbohydrate (US labels), so they're stored as-is (net = carbs − fibre). */
export function fdcToFood(f: any, scanned: string): Food | null {
  const n = fdcNutrients(f.foodNutrients || []);
  if (!f.description || !(n.kcal || n.protein || n.fat || n.carbs)) return null;
  const per100: Nutrients = { kcal: 0, protein: 0, carbs: 0, fibre: 0, fat: 0, ...n } as Nutrients;
  const su = String(f.servingSizeUnit || '').toLowerCase(); const liquid = su === 'mlt' || su === 'ml';
  const servings: Serving[] = [];
  const ss = +f.servingSize; const okUnit = ['g', 'grm', 'ml', 'mlt'].includes(su);
  if (ss > 0 && okUnit) servings.push({ label: 'serving', grams: ss, note: cleanNote(f.householdServingFullText ? `${f.householdServingFullText} (${ss} ${liquid ? 'ml' : 'g'})` : ''), kind: 'serving' });
  const brand = f.brandName || f.brandOwner;
  return { id: 'fdc_' + scanned, name: titleCase(String(f.description).trim()), brand: brand ? titleCase(String(brand)) : undefined, barcode: scanned, source: 'usda', fdcId: f.fdcId, unit: liquid ? 'ml' : 'g', per100, servings };
}

async function getJson(url: string, ms: number) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal });
    if (r.status === 429 || r.status === 503) throw new FdcBusy(`HTTP ${r.status}`);
    if (r.status === 403) throw new FdcBusy('key rejected (403)');
    if (!r.ok) throw new Error('USDA HTTP ' + r.status);
    return await r.json();
  } catch (e: any) { if (e?.name === 'AbortError') throw new FdcBusy('timed out'); throw e; } finally { clearTimeout(t); }
}
/** One search request ORs every barcode variant; a hit must match gtinUpc exactly. Returns null if USDA doesn't have it. */
export async function lookupFDC(code: string, key?: string, ms = 6000): Promise<Food | null> {
  const k = encodeURIComponent((key || '').trim() || FDC_DEMO_KEY); const vars = gtinVariants(code);
  const j = await getJson(`${FDC_BASE}/foods/search?api_key=${k}&dataType=Branded&pageSize=10&query=${encodeURIComponent(vars.join(' OR '))}`, ms);
  const hits: any[] = (j.foods || []).filter((f: any) => vars.includes(String(f.gtinUpc || '').replace(/\D/g, '')));
  if (!hits.length) return null;
  hits.sort((a, b) => String(b.publishedDate || b.modifiedDate || '').localeCompare(String(a.publishedDate || a.modifiedDate || ''))); // newest label first
  let food = fdcToFood(hits[0], code);
  if (!food || food.per100.kcal === 0) { // search hit lacked nutrients: fetch the full record
    const d = await getJson(`${FDC_BASE}/food/${hits[0].fdcId}?api_key=${k}`, ms);
    food = fdcToFood({ ...hits[0], ...d }, code);
  }
  return food;
}
