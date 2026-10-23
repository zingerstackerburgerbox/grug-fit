import type { Food, Nutrients, Serving } from './types';
import { uid } from './util';
const FIELDS = 'code,product_name,product_name_en,brands,nutriments,serving_size,serving_quantity,countries_tags,image_small_url,image_front_small_url';
const g2 = (v: any, f: number) => (v == null || v === '' || isNaN(+v) ? undefined : +v * f);

export function offToFood(p: any): Food | null {
  const nm = p.nutriments || {};
  const name = p.product_name_en || p.product_name;
  if (!name) return null;
  let kcal = g2(nm['energy-kcal_100g'], 1);
  if (kcal == null && nm['energy-kj_100g'] != null) kcal = +nm['energy-kj_100g'] / 4.184;
  if (kcal == null && nm['energy_100g'] != null) kcal = +nm['energy_100g'] / 4.184; // energy_100g is kJ
  const fibre = g2(nm['fiber_100g'], 1) ?? 0;
  let carbs = g2(nm['carbohydrates_100g'], 1) ?? 0;
  // US/Canada labels report total carbohydrate (incl. fibre). AU/NZ/EU labels report available carbs (excl. fibre).
  const countries: string[] = Array.isArray(p.countries_tags) ? p.countries_tags : [];
  const usStyle = countries.length > 0 && countries.every((c) => c === 'en:united-states' || c === 'en:canada');
  if (!usStyle) carbs += fibre; // store as total carbs so net = total - fibre
  const per100: Nutrients = {
    kcal: kcal ?? 0, protein: g2(nm['proteins_100g'], 1) ?? 0, carbs, fibre, fat: g2(nm['fat_100g'], 1) ?? 0, sugar: g2(nm['sugars_100g'], 1),
    calcium: g2(nm['calcium_100g'], 1000), iron: g2(nm['iron_100g'], 1000), vitC: g2(nm['vitamin-c_100g'], 1000), vitA: g2(nm['vitamin-a_100g'], 1e6),
    vitD: g2(nm['vitamin-d_100g'], 1e6), b12: g2(nm['vitamin-b12_100g'], 1e6), folate: g2(nm['vitamin-b9_100g'] ?? nm['folates_100g'], 1e6),
    magnesium: g2(nm['magnesium_100g'], 1000), potassium: g2(nm['potassium_100g'], 1000), sodium: g2(nm['sodium_100g'], 1000)
  };
  for (const k in per100) if ((per100 as any)[k] === undefined) delete (per100 as any)[k];
  const servings: Serving[] = [{ label: '100 g', grams: 100 }, { label: 'g', grams: 1 }];
  const sq = +p.serving_quantity;
  if (sq > 0) servings.unshift({ label: `serving (${p.serving_size || sq + ' g'})`, grams: sq });
  const brand = Array.isArray(p.brands) ? p.brands.join(', ') : p.brands;
  return { id: p.code ? 'off_' + p.code : uid(), name: String(name).trim(), brand: brand || undefined, barcode: p.code, source: 'off', per100, servings, image: p.image_front_small_url || p.image_small_url };
}

async function fetchJson(url: string, ms = 12000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) throw new Error(r.status === 503 ? 'server busy (503)' : 'HTTP ' + r.status); return await r.json(); } finally { clearTimeout(t); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Open Food Facts full-text search. The classic cgi endpoint is CORS-enabled but often rate-limited (503),
 *  so retry with backoff; search-a-licious is tried as an alternative in case it allows CORS. */
export async function searchOFF(q: string): Promise<Food[]> {
  const cgi = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=40&fields=${FIELDS}`;
  const sal = `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=40&fields=${FIELDS}`;
  const attempts: [string, number][] = [[cgi, 0], [cgi, 1200], [sal, 0], [cgi, 2500]];
  let hits: any[] | null = null; let lastErr: any;
  for (const [u, wait] of attempts) {
    if (wait) await sleep(wait);
    try { const j = await fetchJson(u, 15000); hits = j.products || j.hits || []; break; } catch (e) { lastErr = e; }
  }
  if (!hits) throw lastErr || new Error('search failed');
  const foods = hits.map(offToFood).filter((f): f is Food => !!f && (f.per100.kcal > 0 || f.per100.protein > 0));
  // Prefer Australian products for Erik
  const au = new Set(hits.filter((h) => (h.countries_tags || []).includes('en:australia')).map((h) => 'off_' + h.code));
  return foods.sort((a, b) => Number(au.has(b.id)) - Number(au.has(a.id)));
}
export async function lookupBarcode(code: string): Promise<Food | null> {
  const j = await fetchJson(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`);
  if (j.status !== 1 || !j.product) return null;
  return offToFood({ ...j.product, code: j.product.code || code });
}
