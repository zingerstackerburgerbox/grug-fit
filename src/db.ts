import { openDB, type IDBPDatabase } from 'idb';
import { SEED_EXERCISES, SEED_ADDED, SEED_REFRESH } from './seed';
import { DEFAULT_SETTINGS } from './util';
import { normaliseServings, isBase } from './servings';
import type { Settings } from './types';

export const STORES = ['exercises', 'routines', 'workouts', 'bodyweight', 'foods', 'diary', 'supplements', 'schedules', 'doselogs', 'kv'] as const;
export type StoreName = (typeof STORES)[number];
/**
 * Two kinds of versioning, both forward-only so data survives app updates:
 *  - DB_VERSION: IndexedDB structural version (object stores / indexes). Add `if (oldVersion < N) {...}` blocks in upgrade().
 *  - SCHEMA_VERSION: data-shape version stored in kv 'schema'; MIGRATIONS[n] transforms records from n-1 to n (see migrate()).
 */
export const DB_VERSION = 1;
export const SCHEMA_VERSION = 4;
let dbp: Promise<IDBPDatabase> | null = null;
export function db() {
  if (!dbp) dbp = openDB('grugfit', DB_VERSION, {
    // another tab/app version needs a newer DB: close ours and reload so the upgrade can proceed
    blocking() { dbp?.then((d) => d.close()); location.reload(); },
    upgrade(d, oldVersion) {
      if (oldVersion < 1) for (const s of STORES) {
        const st = d.createObjectStore(s, { keyPath: 'id' });
        if (s === 'diary' || s === 'bodyweight' || s === 'doselogs') st.createIndex('date', 'date');
        if (s === 'workouts') st.createIndex('start', 'start');
        if (s === 'foods') st.createIndex('barcode', 'barcode');
      }
    }
  });
  return dbp;
}
export const all = async <T = any>(s: StoreName): Promise<T[]> => (await db()).getAll(s);
export const get = async <T = any>(s: StoreName, id: string): Promise<T | undefined> => (await db()).get(s, id);
export const put = async (s: StoreName, v: any) => { await (await db()).put(s, v); bump(); };
export const del = async (s: StoreName, id: string) => { await (await db()).delete(s, id); bump(); };
export const byDate = async <T = any>(s: StoreName, from: string, to: string): Promise<T[]> => (await db()).getAllFromIndex(s, 'date', IDBKeyRange.bound(from, to));
export const byBarcode = async (code: string) => (await db()).getFromIndex('foods', 'barcode', code);

// tiny change-notification so views refresh
type L = () => void; const ls = new Set<L>();
export const subscribe = (l: L) => { ls.add(l); return () => ls.delete(l); };
let pending = false;
export function bump() { if (pending) return; pending = true; queueMicrotask(() => { pending = false; ls.forEach((l) => l()); }); }

export async function init() {
  const d = await db();
  const seeded = await d.get('kv', 'seeded');
  if (!seeded) {
    const tx = d.transaction(['exercises', 'kv'], 'readwrite');
    for (const e of SEED_EXERCISES) tx.objectStore('exercises').put(e);
    tx.objectStore('kv').put({ id: 'seeded', v: 1 });
    tx.objectStore('kv').put(DEFAULT_SETTINGS);
    await tx.done;
  }
  await migrate();
  try { await navigator.storage?.persist?.(); } catch {}
}
type Tx = any;
/** Data migrations, keyed by the schema version they produce. Each must be idempotent and must never drop user data. */
const MIGRATIONS: Record<number, (tx: Tx) => Promise<void>> = {
  // v2: normalise food servings (implicit g/ml base unit, serving notes) and legacy diary unit labels. Nutrient snapshots untouched.
  2: async (tx) => {
    for (const f of await tx.objectStore('foods').getAll()) await tx.objectStore('foods').put({ ...f, servings: normaliseServings(f.servings || []), unit: f.unit || 'g' });
    for (const e of await tx.objectStore('diary').getAll()) {
      let { serving, qty } = e;
      if (isBase(serving)) { serving = 'g'; qty = e.grams; }
      else if (/^serving \((.*)\)$/.test(serving)) serving = 'serving';
      if (serving !== e.serving || qty !== e.qty) await tx.objectStore('diary').put({ ...e, serving, qty, legacyServing: e.legacyServing || e.serving });
    }
  },
  // v3: add new built-in exercises to existing installs. Never overwrites: skips ids already present and names the user already has (e.g. a custom one).
  3: (tx) => addSeed(tx, SEED_ADDED[3]),
  // v4: Reverse Cable Crunch (ex086) is now the kneeling, back-to-the-stack movement: refresh only its how-to text. Same id, so logged sets,
  // routines, notes and any rename stay as they are; the visual comes from code. Custom exercises are never touched.
  4: (tx) => refreshSeed(tx, SEED_REFRESH[4])
};
async function refreshSeed(tx: Tx, ids: string[]) {
  const store = tx.objectStore('exercises');
  for (const e of SEED_EXERCISES.filter((x) => ids.includes(x.id))) {
    const cur = await store.get(e.id);
    if (!cur || cur.custom || cur.how === e.how) continue;
    await store.put({ ...cur, how: e.how });
  }
}
async function addSeed(tx: Tx, ids: string[]) {
  const store = tx.objectStore('exercises');
  const have = await store.getAll();
  const names = new Set(have.map((e: any) => String(e.name).trim().toLowerCase()));
  const idSet = new Set(have.map((e: any) => e.id));
  for (const e of SEED_EXERCISES.filter((x) => ids.includes(x.id))) {
    if (idSet.has(e.id) || names.has(e.name.toLowerCase())) continue;
    await store.put(e);
  }
}
/** Bring stored data up to SCHEMA_VERSION. `force` re-runs all (idempotent) migrations, e.g. after importing an old backup. */
export async function migrate(force = false) {
  const d = await db();
  const cur = force ? 1 : (await d.get('kv', 'schema'))?.v || 1;
  if (cur >= SCHEMA_VERSION) return;
  const tx = d.transaction(STORES as any, 'readwrite');
  for (let v = cur + 1; v <= SCHEMA_VERSION; v++) if (MIGRATIONS[v]) await MIGRATIONS[v](tx);
  await tx.objectStore('kv').put({ id: 'schema', v: SCHEMA_VERSION });
  await tx.done;
}
export async function getSettings(): Promise<Settings> {
  const s = await get<Settings>('kv', 'settings');
  return { ...DEFAULT_SETTINGS, ...(s || {}), targets: { ...DEFAULT_SETTINGS.targets, ...(s?.targets || {}) } };
}
export async function exportAll() {
  const d = await db(); const out: any = { app: 'grugfit', version: 1, schema: SCHEMA_VERSION, exported: new Date().toISOString(), data: {} };
  for (const s of STORES) out.data[s] = await d.getAll(s);
  return out;
}
export async function importAll(json: any, mode: 'replace' | 'merge' = 'replace') {
  if (!json || json.app !== 'grugfit' || !json.data) throw new Error('Not a Grug Fit backup file');
  const d = await db(); const tx = d.transaction(STORES as any, 'readwrite');
  for (const s of STORES) {
    const st = tx.objectStore(s);
    if (mode === 'replace') await st.clear();
    for (const v of json.data[s] || []) await st.put(v);
  }
  await tx.done; await migrate(true); bump();
}
export async function clearAll() {
  const d = await db(); const tx = d.transaction(STORES as any, 'readwrite');
  for (const s of STORES) await tx.objectStore(s).clear();
  await tx.done; await init(); bump();
}
