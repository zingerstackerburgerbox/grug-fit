import { useEffect, useState, useCallback, useRef } from 'preact/hooks';
import { subscribe, getSettings } from './db';
import { DEFAULT_SETTINGS } from './util';
import type { Settings } from './types';

export function useQuery<T>(fn: () => Promise<T>, deps: any[] = [], init?: T): T | undefined {
  const [v, setV] = useState<T | undefined>(init);
  const run = useCallback(() => { let live = true; fn().then((r) => live && setV(r)); return () => { live = false; }; }, deps);
  useEffect(() => { let cancel = run(); const un = subscribe(() => { cancel(); cancel = run(); }); return () => { cancel(); un(); }; }, [run]);
  return v;
}
export const useSettings = () => useQuery<Settings>(getSettings, [], DEFAULT_SETTINGS) as Settings;

export function useHash() {
  const [h, setH] = useState(location.hash.slice(1) || '/');
  useEffect(() => { const f = () => setH(location.hash.slice(1) || '/'); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return h;
}
export const go = (path: string) => { location.hash = path; };
export const back = () => (history.length > 1 ? history.back() : go('/'));

export function useNow(ms = 1000) {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setN(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return n;
}

/** useState whose setter also updates a ref synchronously, so handlers in the same tick (e.g. blur→change then click Save) see the latest value. */
export function useLatest<T>(init: T): [T, (v: T | ((o: T) => T)) => void, () => T] {
  const [v, setV] = useState<T>(init); const ref = useRef<T>(init);
  const set = useCallback((n: T | ((o: T) => T)) => { ref.current = typeof n === 'function' ? (n as any)(ref.current) : n; setV(ref.current); }, []);
  return [v, set, () => ref.current];
}
