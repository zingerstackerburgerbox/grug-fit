// v1.13.0 offline Australian food pack: ~30k products sold in Australia from the Open Food Facts bulk export
// (scripts/build-au-pack.mjs → public/offpack/). Downloaded once in the background (16 shards, ~1.4 MB gzip) into its own
// IndexedDB database so barcode lookups and text search are instant and work offline. Not part of the main bundle or the
// precache; a single shard is fetched on demand if a scan happens before the background download finished.
// Data © Open Food Facts contributors, ODbL.
import { openDB, type IDBPDatabase } from 'idb';
import type { Food } from './types';
import { offToFood } from './off';

export const PACK_DB = 'grugfit-offpack';
export type PackMeta = { version: string; date: string; count: number; shards: number; bytes?: number; gzipBytes?: number };
type Stored = PackMeta & { installed: number[]; at: number };
export type PackStatus = { state: 'none' | 'loading' | 'ready' | 'error'; count: number; date?: string; done: number; total: number; error?: string };
/** [rank, code, name, brand, kcal, protein, carbs, fat, fibre, sugar, satfat, sodium_mg, serving_size, serving_g, package_g, quantity, cats] */
export type PackRow = (string | number | null)[];

let dbp: Promise<IDBPDatabase> | undefined;
const STORES_P = ['products', 'meta', 'lookups'];
const open = (v?: number) => openDB(PACK_DB, v, {
  upgrade(d) { for (const n of STORES_P) if (!d.objectStoreNames.contains(n)) d.createObjectStore(n); },
  blocking() { dbp?.then((d) => d.close()); dbp = undefined; }
});
// self-healing: if something created the database without our stores, bump the version once to add them
const pdb = () => (dbp ??= open(1).then(async (d) => { if (STORES_P.every((n) => d.objectStoreNames.contains(n))) return d; const v = d.version + 1; d.close(); return open(v); }));
const packBase = () => new URL('offpack/', document.baseURI).href;
export const normCode = (c: string) => String(c).trim().replace(/^0+/, '');
/** Same rule as the build script: last two digits mod shard count (stable across UPC-A / EAN-13 zero padding). */
export const shardOf = (code: string, shards = 16) => (+String(code).trim().slice(-2) || 0) % shards;

let status: PackStatus = { state: 'none', count: 0, done: 0, total: 16 };
const emit = (s: Partial<PackStatus>) => { status = { ...status, ...s }; dispatchEvent(new CustomEvent('lunk-offpack', { detail: status })); };
export const packStatus = () => status;
/** Test switch: localStorage.foodPack = '0' turns the pack off (older tests mock Open Food Facts directly). */
export const packEnabled = () => localStorage.getItem('foodPack') !== '0';
async function stored(): Promise<Stored | undefined> { try { return await (await pdb()).get('meta', 'pack'); } catch { return undefined; } }
export async function loadPackStatus() {
  const m = await stored(); if (!m) return status;
  emit({ state: m.installed.length >= m.shards ? 'ready' : status.state === 'loading' ? 'loading' : 'none', count: m.installed.length >= m.shards ? m.count : 0, date: m.date, done: m.installed.length, total: m.shards });
  return status;
}

async function getJson(url: string, ms: number) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal, cache: 'no-cache' }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
let metaP: Promise<PackMeta> | null = null;
const fetchMeta = () => (metaP ??= getJson(packBase() + 'meta.json?t=' + Date.now(), 8000).finally(() => setTimeout(() => (metaP = null), 60000)) as Promise<PackMeta>);

/** Make sure the stored pack matches this meta (a new pack version clears the old rows first). */
async function prepare(meta: PackMeta): Promise<Stored> {
  const d = await pdb(); const m = await stored();
  if (m && m.version === meta.version && m.shards === meta.shards) return m;
  const tx = d.transaction(['products', 'meta'], 'readwrite'); await tx.objectStore('products').clear();
  const fresh: Stored = { ...meta, installed: [], at: Date.now() }; await tx.objectStore('meta').put(fresh, 'pack'); await tx.done; index = null;
  return fresh;
}
const shardLoads = new Map<string, Promise<void>>();
function installShard(meta: PackMeta, i: number) {
  const k = meta.version + ':' + i; let p = shardLoads.get(k);
  if (!p) {
    p = (async () => {
      const j = await getJson(`${packBase()}au-${i.toString(16)}.json?v=${encodeURIComponent(meta.version)}`, 20000);
      const d = await pdb(); const tx = d.transaction(['products', 'meta'], 'readwrite'); const st = tx.objectStore('products');
      for (const r of j.rows as PackRow[]) st.put(r, normCode(String(r[1])));
      const m: Stored = (await tx.objectStore('meta').get('pack')) || { ...meta, installed: [], at: Date.now() };
      if (m.version === meta.version && !m.installed.includes(i)) { m.installed = [...m.installed, i].sort((a, b) => a - b); m.at = Date.now(); await tx.objectStore('meta').put(m, 'pack'); }
      await tx.done; index = null;
      emit({ done: m.installed.length, total: m.shards, date: m.date, ...(m.installed.length >= m.shards ? { state: 'ready', count: m.count } : {}) });
    })().finally(() => shardLoads.delete(k));
    shardLoads.set(k, p);
  }
  return p;
}

let running: Promise<PackStatus> | null = null;
/** Download (or refresh) the whole pack. Safe to call repeatedly; one run at a time. */
export function ensurePack(force = false): Promise<PackStatus> {
  if (running) return running;
  running = (async () => {
    const m0 = await stored();
    if (!force && m0 && m0.installed.length >= m0.shards && Date.now() - m0.at < 12 * 3600e3) return loadPackStatus(); // checked recently
    if (!navigator.onLine) return loadPackStatus();
    try {
      const meta = await fetchMeta(); const m = await prepare(meta);
      const missing = Array.from({ length: meta.shards }, (_, i) => i).filter((i) => !m.installed.includes(i));
      if (!missing.length) { const d = await pdb(); await d.put('meta', { ...m, at: Date.now() }, 'pack'); return loadPackStatus(); }
      emit({ state: 'loading', done: m.installed.length, total: meta.shards, date: meta.date, error: undefined });
      for (const i of missing) await installShard(meta, i);
      return loadPackStatus();
    } catch (e: any) {
      const m = await stored();
      if (m && m.installed.length >= m.shards) return loadPackStatus(); // complete older pack still works
      emit({ state: 'error', error: e?.name === 'AbortError' ? 'timed out' : e?.message || 'download failed' }); return status;
    }
  })().finally(() => { running = null; });
  return running;
}
/** Background download a few seconds after start-up, when online and the user hasn't asked to save data. */
export function initOffpack() {
  loadPackStatus().catch(() => null);
  if (localStorage.getItem('offpackAuto') === '0' || !packEnabled()) return;
  const go = () => { if (navigator.onLine && !(navigator as any).connection?.saveData) ensurePack().catch(() => null); };
  setTimeout(() => ((window as any).requestIdleCallback ? (window as any).requestIdleCallback(go, { timeout: 10000 }) : go()), 6000);
}

const num = (v: any) => (v == null ? undefined : +v);
/** A pack row as an Open Food Facts product, so it goes through the same mapping (offToFood) as live lookups. */
export function rowToOff(r: PackRow) {
  const [, code, name, brand, kcal, protein, carbs, fat, fibre, sugar, satfat, sodiumMg, servingSize, servingG, packageG, quantity, cats] = r as any[];
  const nutriments: Record<string, number> = {};
  const set = (k: string, v: any) => { if (v != null) nutriments[k] = +v; };
  set('energy-kcal_100g', kcal); set('proteins_100g', protein); set('carbohydrates_100g', carbs); set('fat_100g', fat); set('fiber_100g', fibre); set('sugars_100g', sugar); set('saturated-fat_100g', satfat);
  if (sodiumMg != null) nutriments['sodium_100g'] = +sodiumMg / 1000;
  const liquid = /\d\s*(ml|cl|l)\b|litre|liter/i.test(`${quantity || ''} ${servingSize || ''}`) && !/\d\s*(g|kg)\b/i.test(String(quantity || ''));
  return { code: String(code), product_name: name, brands: brand || undefined, nutriments, serving_size: servingSize || undefined, serving_quantity: num(servingG), product_quantity: num(packageG),
    product_quantity_unit: packageG != null ? (liquid ? 'ml' : 'g') : undefined, quantity: quantity || undefined, countries_tags: ['en:australia'], categories_tags: cats ? String(cats).split(',') : [] };
}
export const rowToFood = (r: PackRow): Food | null => offToFood(rowToOff(r));

/** Barcode → Food from the pack, or null. If this code's shard isn't on the device yet (first scan right after install),
 *  fetch just that shard (~100 kB) — waiting at most `ms` before letting the online lookup take over. */
export async function packLookup(code: string, ms = 2500): Promise<Food | null> {
  const key = normCode(code); if (!key || !packEnabled()) return null;
  const d = await pdb(); let r: PackRow | undefined = await d.get('products', key);
  if (!r) {
    const m = await stored(); const i = shardOf(code, m?.shards || 16);
    if (m && m.installed.includes(i)) return null; // shard present: a genuine miss
    if (!navigator.onLine) return null;
    try {
      const meta = await Promise.race([fetchMeta(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('slow')), ms))]);
      await prepare(meta); const load = installShard(meta, i); load.catch(() => null);
      await Promise.race([load, new Promise((res) => setTimeout(res, ms))]);
      r = await d.get('products', key);
    } catch { return null; }
    if (!r) return null;
  }
  const f = rowToFood(r); if (!f) return null;
  return { ...f, barcode: code };
}

// ---------- text search ----------
export const normText = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
type Ix = { r: PackRow; t: string; c: string; n: string }[];
export function buildIndex(rows: PackRow[]): Ix {
  return [...rows].sort((a, b) => +a[0]! - +b[0]!).map((r) => { const n = normText(String(r[2] || '')); const t = n + ' ' + normText(String(r[3] || '')); return { r, t, c: t.replace(/ /g, ''), n }; });
}
let index: Ix | null = null; let indexP: Promise<Ix> | null = null;
async function getIndex(): Promise<Ix> {
  if (index) return index;
  return (indexP ??= (async () => {
    const rows: PackRow[] = await (await pdb()).getAll('products');
    const ix = buildIndex(rows); index = ix; return ix;
  })().finally(() => { indexP = null; }));
}
/** Pure matcher (exported for unit tests): every word must appear in name+brand, or the query without spaces/hyphens
 *  must appear in them without spaces ("weetbix" finds "Weet-Bix"). Exact names first, then name prefixes, then popularity. */
export function matchPack(ix: Ix, q: string, limit = 30): PackRow[] {
  const qn = normText(q); if (qn.length < 2) return [];
  const words = qn.split(' '); const compact = qn.replace(/ /g, '');
  const hits: { r: PackRow; s: number }[] = [];
  for (const e of ix) {
    if (!(words.every((w) => e.t.includes(w)) || (compact.length >= 4 && e.c.includes(compact)))) continue;
    const nc = e.n.replace(/ /g, '');
    const s = nc === compact ? 0 : e.n.startsWith(qn) || nc.startsWith(compact) ? 1 : words.every((w) => (' ' + e.n).includes(' ' + w)) ? 2 : 3;
    hits.push({ r: e.r, s });
    if (hits.length > 4000) break;
  }
  return hits.sort((a, b) => a.s - b.s || +a.r[0]! - +b.r[0]!).slice(0, limit).map((h) => h.r);
}
export async function packSearch(q: string, limit = 30): Promise<Food[]> {
  if (!packEnabled()) return [];
  const ix = await getIndex(); if (!ix.length) return [];
  return matchPack(ix, q, limit).map((r) => { const f = rowToFood(r); return f && { ...f }; }).filter((f): f is Food => !!f);
}

// ---------- device cache for online searches ----------
export async function cacheGet<T = any>(key: string, maxAgeMs: number): Promise<T | null> {
  try { const v = await (await pdb()).get('lookups', key); return v && Date.now() - v.at < maxAgeMs ? v.v : null; } catch { return null; }
}
export async function cachePut(key: string, v: any) { try { await (await pdb()).put('lookups', { at: Date.now(), v }, key); } catch {} }
