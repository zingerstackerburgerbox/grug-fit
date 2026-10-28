// v1.13.0 lookup order for barcodes and food search: offline Australian pack → coach-proxy Worker (edge-cached Open Food Facts,
// trimmed fields, 6 s upstream timeout) → Open Food Facts directly (old path, only if the Worker is unreachable).
import type { Food } from './types';
import { lookupBarcode, LookupError, offToFood, searchOFF } from './off';
import { cacheGet, cachePut, normCode, packLookup, packSearch } from './offpack';
import { deviceId, proxyReady, proxyUrl } from './coach';

const usable = (f: Food | null) => !!f && (f.per100.kcal > 0 || f.per100.protein > 0 || f.per100.fat > 0 || f.per100.carbs > 0);
export async function proxyGet(path: string, ms: number) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  let r: Response;
  try { r = await fetch(proxyUrl() + path, { headers: { 'X-Device-Id': deviceId() }, signal: c.signal }); }
  catch (e: any) { throw new LookupError(e?.name === 'AbortError' ? 'timeout' : 'network', e?.name === 'AbortError' ? `timed out after ${Math.round(ms / 1000)} s` : 'network error'); }
  finally { clearTimeout(t); }
  if (!r.ok) throw new LookupError('http', 'HTTP ' + r.status);
  try { return await r.json(); } catch { throw new LookupError('parse', 'unreadable response'); }
}
export type OnlineResult = { food: Food | null | { partial: string }; via: 'proxy' | 'off' };
/** Online barcode lookup: Worker first (fast, cached at the edge), direct Open Food Facts if the Worker fails. */
export async function lookupOnline(code: string): Promise<OnlineResult> {
  if (proxyReady()) {
    try {
      const j = await proxyGet(`/food/barcode?code=${encodeURIComponent(code)}`, 8000);
      if (j?.status === 'none') return { food: null, via: 'proxy' };
      if (j?.status === 'found' && j.product) {
        const f = offToFood({ ...j.product, code: j.product.code || code });
        if (f && usable(f)) return { food: { ...f, barcode: code }, via: 'proxy' };
        return { food: f ? { partial: f.brand ? `${f.name} (${f.brand})` : f.name } : null, via: 'proxy' };
      }
    } catch { /* fall through to the direct lookup */ }
  }
  return { food: await lookupBarcode(code), via: 'off' };
}
/** The offline pack only (instant). */
export const lookupLocal = (code: string) => packLookup(code).catch(() => null);

const SEARCH_TTL = 7 * 86400e3;
/** Online search with a device cache (7 days): Worker, then direct Open Food Facts; cached results are used offline or on failure. */
export async function searchOnline(q: string): Promise<Food[]> {
  const key = 's:' + q.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!navigator.onLine) { const c = await cacheGet<Food[]>(key, SEARCH_TTL * 4); if (c) return c; throw new LookupError('network', 'offline'); }
  let foods: Food[] | null = null; let err: any;
  if (proxyReady()) {
    try {
      const j = await proxyGet(`/food/search?q=${encodeURIComponent(q)}`, 9000);
      const hits: any[] = j?.products || [];
      const au = new Set(hits.filter((h) => (h.countries_tags || []).includes('en:australia')).map((h) => 'off_' + h.code));
      foods = hits.map(offToFood).filter((f): f is Food => !!f && (f.per100.kcal > 0 || f.per100.protein > 0)).sort((a, b) => Number(au.has(b.id)) - Number(au.has(a.id)));
    } catch (e) { err = e; }
  }
  if (!foods) { try { foods = await searchOFF(q); } catch (e) { err = e; } }
  if (!foods) { const c = await cacheGet<Food[]>(key, SEARCH_TTL * 4); if (c) return c; throw err || new Error('search failed'); }
  cachePut(key, foods); return foods;
}
/** Offline pack results first (shown immediately via onLocal), then online results not already listed. */
export async function searchFoods(q: string, onLocal?: (f: Food[]) => void): Promise<{ foods: Food[]; error?: string }> {
  const local = await packSearch(q).catch(() => [] as Food[]);
  if (local.length) onLocal?.(local);
  try {
    const online = await searchOnline(q);
    const seen = new Set(local.map((f) => normCode(f.barcode || '')));
    return { foods: [...local, ...online.filter((f) => !seen.has(normCode(f.barcode || '')))] };
  } catch (e: any) { return { foods: local, error: local.length ? undefined : e?.message || 'search failed' }; }
}
