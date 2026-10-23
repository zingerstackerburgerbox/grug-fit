import type { Food, Nutrients, Serving } from './types';
import { r1, uid } from './util';
import { cleanNote, drainedGrams, packedInLiquid, servingGrams } from './servings';
const FIELDS = 'code,product_name,product_name_en,brands,nutriments,serving_size,serving_quantity,serving_quantity_unit,product_quantity,product_quantity_unit,quantity,nutrition_data_per,countries_tags,categories_tags,drained_weight,image_small_url,image_front_small_url';
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
    kcal: kcal ?? 0, protein: g2(nm['proteins_100g'], 1) ?? 0, carbs, fibre, fat: g2(nm['fat_100g'], 1) ?? 0, satfat: g2(nm['saturated-fat_100g'], 1), sugar: g2(nm['sugars_100g'], 1),
    calcium: g2(nm['calcium_100g'], 1000), iron: g2(nm['iron_100g'], 1000), vitC: g2(nm['vitamin-c_100g'], 1000), vitA: g2(nm['vitamin-a_100g'], 1e6),
    vitD: g2(nm['vitamin-d_100g'], 1e6), b12: g2(nm['vitamin-b12_100g'], 1e6), folate: g2(nm['vitamin-b9_100g'] ?? nm['folates_100g'], 1e6),
    magnesium: g2(nm['magnesium_100g'], 1000), potassium: g2(nm['potassium_100g'], 1000), sodium: g2(nm['sodium_100g'], 1000)
  };
  for (const k in per100) if ((per100 as any)[k] === undefined) delete (per100 as any)[k];
  // liquids: OFF reports per 100 ml; we treat 1 ml ≈ 1 g for maths and show "ml"
  const unitTxt = `${p.serving_quantity_unit || ''} ${p.product_quantity_unit || ''} ${p.serving_size || ''} ${p.quantity || ''}`.toLowerCase();
  const liquid = /\bml\b|\bcl\b|\bl\b|litre|liter/.test(unitTxt) && !/\bg\b|\bkg\b/.test(`${p.serving_quantity_unit || ''} ${p.product_quantity_unit || ''}`.toLowerCase());
  const servings: Serving[] = [];
  // 1 serving: only what the label/OFF says (serving_quantity, or a g/ml figure in serving_size) — never invented
  const sq = servingGrams(p);
  if (sq) servings.push({ label: 'serving', grams: sq, note: cleanNote(p.serving_size), kind: 'serving' });
  let pq = +p.product_quantity; const pu = String(p.product_quantity_unit || '').toLowerCase();
  if (pq > 0 && (pu === 'kg' || pu === 'l')) pq *= 1000;
  // whole package: the gross/net quantity is only eatable when nothing is drained off. Canned/jarred-in-liquid products
  // (tuna in spring water, beans in brine, fruit in syrup…) have per-100 g values for the drained food, so offer the drained weight or nothing.
  const liq = packedInLiquid(p); const dw = drainedGrams(p);
  const ctx = `${(p.categories_tags || []).join(' ')} ${p.product_name || ''} ${p.quantity || ''}`;
  const box = /\bjar\b|glass|bocal|en:pickles|en:olives/i.test(ctx) ? 'jar' : liq || /can|tin\b|canned/i.test(ctx) ? 'can' : 'package';
  if (dw && dw < 20000 && dw !== sq) servings.push({ label: `${box}, drained`, grams: dw, note: pq > 0 ? `${r1(pq)} g incl. liquid` : undefined, kind: 'package' });
  else if (!liq && pq > 0 && pq !== sq && pq < 20000) servings.push({ label: 'package', grams: pq, note: cleanNote(p.quantity), kind: 'package' });
  const brand = Array.isArray(p.brands) ? p.brands.join(', ') : p.brands;
  return { id: p.code ? 'off_' + p.code : uid(), name: String(name).trim(), brand: brand || undefined, barcode: p.code, source: 'off', unit: liquid ? 'ml' : 'g', per100, servings, image: p.image_front_small_url || p.image_small_url };
}

/** Why a lookup failed, in words a bug report can carry: timeout / network / HTTP n / parse. */
export class LookupError extends Error { constructor(public kind: 'timeout' | 'network' | 'http' | 'parse', msg: string) { super(msg); } }
async function fetchJson(url: string, ms = 12000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  let r: Response;
  try { r = await fetch(url, { signal: c.signal }); }
  catch (e: any) { clearTimeout(t); throw e?.name === 'AbortError' ? new LookupError('timeout', `timed out after ${Math.round(ms / 1000)} s`) : new LookupError('network', `network error (${e?.message || e})`); }
  try {
    if (r.status === 404 && url.includes('/product/')) return { status: 0 };
    if (!r.ok) throw new LookupError('http', r.status === 503 ? 'server busy (HTTP 503)' : 'HTTP ' + r.status);
    const txt = await r.text();
    try { return JSON.parse(txt); } catch { throw new LookupError('parse', `unreadable response (${txt.slice(0, 40).replace(/\s+/g, ' ')}…)`); }
  } catch (e: any) { if (e instanceof LookupError) throw e; throw e?.name === 'AbortError' ? new LookupError('timeout', `timed out after ${Math.round(ms / 1000)} s`) : new LookupError('network', `network error (${e?.message || e})`); }
  finally { clearTimeout(t); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Open Food Facts full-text search. The classic cgi endpoint is CORS-enabled but often rate-limited (503),
 *  so retry with backoff; search-a-licious is tried as an alternative in case it allows CORS. */
export async function searchOFF(q: string): Promise<Food[]> {
  const cgi = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=40&fields=${FIELDS}`;
  const sal = `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=40&fields=${FIELDS}`;
  const attempts: [string, number][] = [[cgi, 0], [cgi, 1200], [sal, 0], [cgi, 2500], [cgi, 4000]];
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
const found = (j: any) => j && (j.status === 1 || j.status === 'success' || j.status === 'success_with_warnings') && j.product;
/** Returns the product, null if not in OFF, or { partial } if OFF knows the code but has no nutrition data.
 *  Transient failures (timeout / network / 5xx / garbled body) are retried once via the v0 endpoint before giving up. */
export async function lookupBarcode(code: string, ms = 10000): Promise<Food | null | { partial: string }> {
  let partial = '';
  const tries = [code]; if (code.length === 12) tries.push('0' + code); if (code.length === 13 && code.startsWith('0')) tries.push(code.slice(1));
  for (const c of tries) {
    let j: any;
    try { j = await fetchJson(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(c)}.json?fields=${FIELDS}`, ms); }
    catch (e) {
      if (!(e instanceof LookupError) || (e.kind === 'http' && !/50\d/.test(e.message))) throw e;
      await sleep(600);
      j = await fetchJson(`https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(c)}.json?fields=${FIELDS}`, ms);
    }
    if (found(j)) {
      const f = offToFood({ ...j.product, code: j.product.code || c });
      if (f && (f.per100.kcal > 0 || f.per100.protein > 0 || f.per100.fat > 0 || f.per100.carbs > 0)) return { ...f, barcode: code };
      if (f) partial = f.brand ? `${f.name} (${f.brand})` : f.name;
    }
  }
  return partial ? { partial } : null;
}
