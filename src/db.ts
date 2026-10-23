import { openDB, type IDBPDatabase } from 'idb';
import { SEED_EXERCISES } from './seed';
import { DEFAULT_SETTINGS } from './util';
import type { Settings } from './types';

export const STORES = ['exercises', 'routines', 'workouts', 'bodyweight', 'foods', 'diary', 'supplements', 'schedules', 'doselogs', 'kv'] as const;
export type StoreName = (typeof STORES)[number];
let dbp: Promise<IDBPDatabase> | null = null;
export function db() {
  if (!dbp) dbp = openDB('grugfit', 1, {
    upgrade(d) {
      for (const s of STORES) {
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
  try { await navigator.storage?.persist?.(); } catch {}
}
export async function getSettings(): Promise<Settings> {
  const s = await get<Settings>('kv', 'settings');
  return { ...DEFAULT_SETTINGS, ...(s || {}), targets: { ...DEFAULT_SETTINGS.targets, ...(s?.targets || {}) } };
}
export async function exportAll() {
  const d = await db(); const out: any = { app: 'grugfit', version: 1, exported: new Date().toISOString(), data: {} };
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
  await tx.done; bump();
}
export async function clearAll() {
  const d = await db(); const tx = d.transaction(STORES as any, 'readwrite');
  for (const s of STORES) await tx.objectStore(s).clear();
  await tx.done; await init(); bump();
}
