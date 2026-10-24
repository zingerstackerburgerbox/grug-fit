// v1.13.0 food lookups: Open Food Facts proxied through the Worker so the app gets trimmed fields, a hard timeout,
// barcode variants fetched in parallel, and edge caching (isolate memory + KV) instead of a slow round trip to France per scan.
// Data: Open Food Facts (ODbL). No xAI key, no coach counters.
export const OFF_BASE = 'https://world.openfoodfacts.org';
export const FOOD_FIELDS = 'code,product_name,product_name_en,brands,nutriments,serving_size,serving_quantity,serving_quantity_unit,product_quantity,product_quantity_unit,quantity,countries_tags,categories_tags,drained_weight,image_front_small_url';
const NUT_KEEP = /^(energy-kcal|energy-kj|energy|proteins|carbohydrates|sugars|fiber|fat|saturated-fat|sodium|calcium|iron|vitamin-c|vitamin-a|vitamin-d|vitamin-b12|vitamin-b9|folates|magnesium|potassium)_100g$/;
const CAT_KEEP = /canned|-in-|syrup|pickles|olives|brine|jar/;
const UA = 'Lunk/1.13 (personal fitness PWA; https://zingerstackerburgerbox.github.io/grug-fit/) grug-coach-proxy';
export const FOOD_TTL = { found: 7 * 86400, none: 86400, search: 3 * 86400 };
export const FOOD_TIMEOUT_MS = 6000;
const s = (v, max = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/** Only the fields the app maps (offToFood) — a few hundred bytes instead of the full product document. */
export function trimProduct(p) {
  if (!p || typeof p !== 'object') return null;
  const nm = {}; for (const [k, v] of Object.entries(p.nutriments || {})) if (NUT_KEEP.test(k) && v !== '' && v != null && Number.isFinite(+v)) nm[k] = +v;
  const out = { code: s(p.code, 20), product_name: s(p.product_name), product_name_en: s(p.product_name_en), brands: s(Array.isArray(p.brands) ? p.brands.join(', ') : p.brands, 80), nutriments: nm,
    serving_size: s(p.serving_size, 60), serving_quantity: Number.isFinite(+p.serving_quantity) && +p.serving_quantity > 0 ? +p.serving_quantity : undefined, serving_quantity_unit: s(p.serving_quantity_unit, 8),
    product_quantity: Number.isFinite(+p.product_quantity) && +p.product_quantity > 0 ? +p.product_quantity : undefined, product_quantity_unit: s(p.product_quantity_unit, 8), quantity: s(p.quantity, 60),
    countries_tags: Array.isArray(p.countries_tags) ? p.countries_tags.slice(0, 30) : undefined, categories_tags: Array.isArray(p.categories_tags) ? p.categories_tags.filter((t) => CAT_KEEP.test(t)).slice(0, 10) : undefined,
    drained_weight: p.drained_weight || undefined, image_front_small_url: s(p.image_front_small_url || p.image_small_url, 300) };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}
export const cleanCode = (c) => (/^\d{6,14}$/.test(String(c || '').trim()) ? String(c).trim() : null);
/** UPC-A ↔ EAN-13 forms OFF may have filed the product under. */
export function barcodeVariants(code) { const t = [code]; if (code.length === 12) t.push('0' + code); if (code.length === 13 && code.startsWith('0')) t.push(code.slice(1)); return t; }
export const cleanQuery = (q) => { const t = String(q || '').toLowerCase().replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60); return t.length >= 2 ? t : null; };

class Upstream extends Error { constructor(kind, msg) { super(msg); this.kind = kind; } }
async function getJson(url, ms, fetcher) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetcher(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: c.signal, cf: { cacheTtl: 3600, cacheEverything: true } });
    if (r.status === 404 && url.includes('/product/')) return { status: 0 };
    if (!r.ok) throw new Upstream('http', 'HTTP ' + r.status);
    return await r.json();
  } catch (e) { if (e instanceof Upstream) throw e; throw new Upstream(e?.name === 'AbortError' ? 'timeout' : 'network', e?.name === 'AbortError' ? `timed out after ${ms} ms` : 'network error'); }
  finally { clearTimeout(t); }
}
const isFound = (j) => j && (j.status === 1 || j.status === 'success' || j.status === 'success_with_warnings') && j.product;

// isolate-local cache in front of KV (KV reads are already edge-cached, this saves even that hop for hot items)
const mem = new Map(); const MEM_MAX = 500;
const memGet = (k) => { const e = mem.get(k); if (!e) return null; if (e.exp < Date.now()) { mem.delete(k); return null; } return e.v; };
const memPut = (k, v, ttl) => { if (mem.size >= MEM_MAX) mem.delete(mem.keys().next().value); mem.set(k, { v, exp: Date.now() + Math.min(ttl, 3600) * 1000 }); };
export const _clearFoodMem = () => mem.clear();
async function cached(env, key, ttlFor, load) {
  const m = memGet(key); if (m) return { v: m, src: 'mem' };
  const k = await env.COACH_KV.get(key).catch(() => null);
  if (k) { try { const v = JSON.parse(k); memPut(key, v, 3600); return { v, src: 'kv' }; } catch {} }
  const v = await load(); const ttl = ttlFor(v);
  memPut(key, v, ttl); await env.COACH_KV.put(key, JSON.stringify(v), { expirationTtl: ttl }).catch(() => {});
  return { v, src: 'origin' };
}

// short-burst guard per hashed network (isolate-local, approximate): lookups are cheap but OFF asks for polite clients
const burst = new Map(); export const FOOD_PER_MIN = 60;
function tooMany(ip, now = Date.now()) { const b = burst.get(ip); if (!b || now - b.t > 60000) { burst.set(ip, { t: now, n: 1 }); if (burst.size > 5000) burst.clear(); return false; } return ++b.n > FOOD_PER_MIN; }
export const _clearFoodBurst = () => burst.clear();

export async function food(request, env, cors, url, ip, owner, fetcher = fetch) {
  const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': status === 200 ? 'private, max-age=3600' : 'no-store', ...cors, ...extra } });
  if (request.method !== 'GET') return json(405, { error: 'method', message: 'Use GET.' });
  if (!owner && tooMany(ip)) return json(429, { error: 'rate_limited', message: 'Too many lookups in a minute – wait a moment.' }, { 'Retry-After': '60' });
  const t0 = Date.now();
  try {
    if (url.pathname === '/food/barcode') {
      const code = cleanCode(url.searchParams.get('code')); if (!code) return json(400, { error: 'bad_code', message: 'code must be 6–14 digits.' });
      const r = await cached(env, 'food:b:' + code, (v) => (v.status === 'found' ? FOOD_TTL.found : FOOD_TTL.none), async () => {
        const vs = barcodeVariants(code);
        const res = await Promise.allSettled(vs.map((c) => getJson(`${OFF_BASE}/api/v2/product/${c}.json?fields=${FOOD_FIELDS}`, FOOD_TIMEOUT_MS, fetcher)));
        for (let i = 0; i < res.length; i++) if (res[i].status === 'fulfilled' && isFound(res[i].value)) return { status: 'found', product: trimProduct({ ...res[i].value.product, code: res[i].value.product.code || vs[i] }) };
        const bad = res.find((x) => x.status === 'rejected'); if (bad) throw bad.reason; // don't cache "not found" if a variant failed
        return { status: 'none' };
      });
      return json(200, r.v, { 'X-Food-Cache': r.src, 'Server-Timing': `food;dur=${Date.now() - t0}` });
    }
    if (url.pathname === '/food/search') {
      const q = cleanQuery(url.searchParams.get('q')); if (!q) return json(400, { error: 'bad_query', message: 'q must be 2–60 characters.' });
      const r = await cached(env, 'food:s:' + q, () => FOOD_TTL.search, async () => {
        const cgi = `${OFF_BASE}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=30&fields=${FOOD_FIELDS}`;
        const sal = `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=30&fields=${FOOD_FIELDS}`;
        let j; try { j = await getJson(cgi, FOOD_TIMEOUT_MS, fetcher); } catch { j = await getJson(sal, FOOD_TIMEOUT_MS, fetcher); }
        return { status: 'ok', products: (j.products || j.hits || []).map(trimProduct).filter((p) => p && (p.product_name || p.product_name_en)) };
      });
      return json(200, r.v, { 'X-Food-Cache': r.src, 'Server-Timing': `food;dur=${Date.now() - t0}` });
    }
  } catch (e) {
    const kind = e?.kind || 'network';
    return json(502, { error: kind === 'timeout' ? 'upstream_timeout' : 'upstream_error', message: `Open Food Facts ${kind === 'timeout' ? 'timed out' : 'failed'} (${e?.message || kind}).` });
  }
  return json(404, { error: 'not_found', message: 'Use GET /food/barcode?code= or /food/search?q=.' });
}
