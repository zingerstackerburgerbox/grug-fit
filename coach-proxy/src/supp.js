// v1.16.0 supplement barcodes: GET /supp/barcode?code= → Open Food Facts (many supplements / protein powders) →
// NIH Dietary Supplement Label Database (DSLD, US labels with ingredient amounts) → Open Products Facts.
// Returns one small normalised record; cached at the edge like /food (isolate memory + KV). No xAI key, no coach counters.
import { OFF_BASE, barcodeVariants, cached, cleanCode, getJson, isFound, tooMany } from './food.js';
export const DSLD_BASE = 'https://api.ods.od.nih.gov/dsld/v9';
export const OPF_BASE = 'https://world.openproductsfacts.org';
export const SUPP_TTL = { found: 14 * 86400, none: 2 * 86400 };
const T = 6000;
const OFF_FIELDS = 'code,product_name,product_name_en,brands,serving_size,serving_quantity,serving_quantity_unit,quantity,categories_tags,nutriments';
const s = (v, max = 100) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : undefined);
const num = (v) => (Number.isFinite(+v) && +v > 0 ? Math.round(+v * 1000) / 1000 : undefined);
/** DSLD / OFF unit spellings → the app's units */
export function normUnit(u) {
  const t = String(u || '').toLowerCase().replace(/\(s\)/g, '').trim();
  if (/^(g|gram|grams)$/.test(t)) return 'g'; if (/^(mg|milligram)/.test(t)) return 'mg'; if (/^(mcg|µg|ug|microgram)/.test(t)) return 'µg';
  if (/^iu\b/.test(t)) return 'IU'; if (/^(ml|milliliter|millilitre)/.test(t)) return 'ml'; if (/^kcal|calorie/.test(t)) return 'kcal';
  return s(t, 12);
}
export function formOf(t) { const x = String(t || '').toLowerCase();
  if (/whey|protein powder|pre-?workout|mass gainer/.test(x) && !/capsule|tablet/.test(x)) return 'Powder';
  return /softgel/.test(x) ? 'Softgel' : /capsule|vcap|veg cap/.test(x) ? 'Capsule' : /tablet|caplet/.test(x) ? 'Tablet' : /gumm/.test(x) ? 'Gummy' : /powder|scoop/.test(x) ? 'Powder' : /liquid|drop|ml\b|shot/.test(x) ? 'Liquid' : undefined; }
// per-serving nutriments OFF files for supplements (unit in g unless noted)
const OFF_ING = [['caffeine', 'Caffeine', 'mg', 1000], ['creatine', 'Creatine', 'g', 1], ['proteins', 'Protein', 'g', 1], ['vitamin-d', 'Vitamin D', 'µg', 1e6], ['vitamin-c', 'Vitamin C', 'mg', 1000],
  ['vitamin-b12', 'Vitamin B12', 'µg', 1e6], ['magnesium', 'Magnesium', 'mg', 1000], ['zinc', 'Zinc', 'mg', 1000], ['iron', 'Iron', 'mg', 1000], ['calcium', 'Calcium', 'mg', 1000], ['omega-3-fat', 'Omega-3', 'g', 1], ['beta-alanine', 'Beta-alanine', 'g', 1]];
export function fromOff(p, src = 'off') {
  if (!p) return null; const nm = p.nutriments || {}; const ingredients = [];
  for (const [k, name, unit, mul] of OFF_ING) { const v = num(nm[k + '_serving']); if (v) ingredients.push({ name, amount: Math.round(v * mul * 100) / 100, unit }); }
  const name = s(p.product_name_en) || s(p.product_name); if (!name) return null;
  const sq = num(p.serving_quantity);
  return { status: 'found', src, code: s(p.code, 20), name, brand: s(Array.isArray(p.brands) ? p.brands.join(', ') : p.brands, 60)?.split(',')[0].trim(),
    serving: s(p.serving_size, 60) || sq ? { text: s(p.serving_size, 60), qty: sq, unit: normUnit(p.serving_quantity_unit || 'g') } : undefined,
    form: formOf(`${p.serving_size || ''} ${p.product_name || ''} ${p.quantity || ''}`), ingredients: ingredients.slice(0, 12) };
}
/** DSLD stores UPCs as printed, e.g. "7 33739 02030 7" */
export const upcSpaced = (c) => (c.length === 12 ? `${c[0]} ${c.slice(1, 6)} ${c.slice(6, 11)} ${c[11]}` : null);
const digits = (v) => String(v || '').replace(/\D/g, '');
export function fromDsld(l) {
  if (!l || !l.fullName) return null;
  const ss = (l.servingSizes || [])[0]; const ingredients = [];
  for (const r of l.ingredientRows || []) {
    const q = (r.quantity || []).find((x) => (x.servingSizeOrder ?? 1) === 1) || (r.quantity || [])[0];
    const amount = num(q?.quantity); const unit = normUnit(q?.unit);
    if (r.name && amount && unit && unit !== 'kcal' && !/^calories$/i.test(r.name)) ingredients.push({ name: s(r.name, 60), amount, unit });
    if (ingredients.length >= 12) break;
  }
  const state = l.physicalState?.langualCodeDescription || '';
  return { status: 'found', src: 'dsld', code: digits(l.upcSku), name: s(l.fullName), brand: s(l.brandName, 60),
    serving: ss ? { text: [ss.minQuantity, normUnit(ss.unit)].filter((x) => x != null).join(' ') || undefined, qty: num(ss.minQuantity), unit: normUnit(ss.unit) } : undefined,
    form: formOf(`${state} ${ss?.unit || ''}`), ingredients };
}
async function viaOff(base, code, src, fetcher) {
  const vs = barcodeVariants(code);
  const res = await Promise.allSettled(vs.map((c) => getJson(`${base}/api/v2/product/${c}.json?fields=${OFF_FIELDS}`, T, fetcher)));
  for (let i = 0; i < res.length; i++) if (res[i].status === 'fulfilled' && isFound(res[i].value)) { const r = fromOff({ ...res[i].value.product, code: vs[i] }, src); if (r) return r; }
  if (res.every((x) => x.status === 'rejected')) throw res[0].reason;
  return null;
}
async function viaDsld(code, fetcher) {
  const upc = code.length === 13 && code.startsWith('0') ? code.slice(1) : code; const sp = upcSpaced(upc); if (!sp) return null; // DSLD is US labels (UPC-A)
  const j = await getJson(`${DSLD_BASE}/search-filter?q=${encodeURIComponent(`"${sp}"`)}&size=10`, T, fetcher);
  const hits = (j?.hits || []).filter((h) => digits(h._source?.upcSku ?? '') === upc || !h._source?.upcSku);
  if (!hits.length) return null;
  hits.sort((a, b) => (+!!a._source?.offMarket - +!!b._source?.offMarket) || String(b._source?.entryDate || '').localeCompare(String(a._source?.entryDate || '')));
  const l = await getJson(`${DSLD_BASE}/label/${encodeURIComponent(hits[0]._id)}`, T, fetcher);
  if (digits(l?.upcSku) !== upc) return null;
  return fromDsld(l);
}
export async function supp(request, env, cors, url, ip, owner, fetcher = fetch) {
  const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': status === 200 ? 'private, max-age=3600' : 'no-store', ...cors, ...extra } });
  if (request.method !== 'GET') return json(405, { error: 'method', message: 'Use GET.' });
  if (url.pathname !== '/supp/barcode') return json(404, { error: 'not_found', message: 'Use GET /supp/barcode?code=.' });
  if (!owner && tooMany(ip)) return json(429, { error: 'rate_limited', message: 'Too many lookups in a minute – wait a moment.' }, { 'Retry-After': '60' });
  const code = cleanCode(url.searchParams.get('code')); if (!code || /^(\d)\1+$/.test(code)) return json(400, { error: 'bad_code', message: 'code must be 6–14 digits.' });
  const t0 = Date.now();
  try {
    const r = await cached(env, 'supp:b:' + code, (v) => (v.status === 'found' ? SUPP_TTL.found : SUPP_TTL.none), async () => {
      let failed = 0; const tryIt = async (f) => { try { return await f(); } catch { failed++; return null; } };
      const hit = (await tryIt(() => viaOff(OFF_BASE, code, 'off', fetcher))) || (await tryIt(() => viaDsld(code, fetcher))) || (await tryIt(() => viaOff(OPF_BASE, code, 'opf', fetcher)));
      if (hit) return { ...hit, code };
      if (failed) throw new Error('upstream'); // don't cache "not found" while a source was down
      return { status: 'none' };
    });
    return json(200, r.v, { 'X-Food-Cache': r.src, 'Server-Timing': `supp;dur=${Date.now() - t0}` });
  } catch { return json(502, { error: 'upstream_error', message: 'Supplement lookup failed, try again.' }); }
}
