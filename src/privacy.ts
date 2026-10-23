// Private/incognito window detection (heuristic!) + storage persistence.
import { isApp } from './native';
// Browsers deliberately try to hide private mode, so this can only ever be a best guess:
//  - Chrome/Edge/Samsung ≥147 report a "predictable" quota (usage + 10 GiB); Chrome 147–15x incognito leaked usage + 9 GiB,
//    newer Chrome reports the same 10 GiB in incognito (IncognitoStaticStorageQuota) → NOT detectable there.
//  - Older Chromium: incognito quota was a small RAM-based value (< ~1.2 GB).
//  - Firefox private windows: no service workers (navigator.serviceWorker undefined) and, on old versions, IndexedDB errors.
//  - Safari private: OPFS getDirectory() rejects ("unknown transient reason"), old versions throw on IndexedDB/localStorage, tiny quota.
// Installed (standalone) apps are never treated as private.

export type PrivateResult = { private: boolean; reason: string; engine: string; quota?: number; usage?: number };
export type Env = {
  ua: string; standalone: boolean; secure: boolean;
  hasSW: boolean; hasIDB: boolean;
  estimate?: () => Promise<{ quota?: number; usage?: number }>;
  idbOpen?: () => Promise<boolean>; // resolves false if opening a test DB fails
  opfs?: () => Promise<void>; // navigator.storage.getDirectory
  lsWorks?: () => boolean;
};
const GiB = 2 ** 30, MiB = 2 ** 20;
export const CHROME_HEADROOM_CUTOFF = 9.5 * GiB; // Chrome ≥147: normal headroom = 10 GiB, leaky incognito = 9 GiB
export const OLD_CHROME_QUOTA_CUTOFF = 1.2 * 1e9; // pre-147 Chromium incognito quota (RAM-based)
export const SAFARI_QUOTA_CUTOFF = 200 * MiB;

export function engineOf(ua: string): { engine: 'chromium' | 'firefox' | 'webkit' | 'other'; major: number } {
  if (/Firefox\/(\d+)/.test(ua) && !/Seamonkey/i.test(ua)) return { engine: 'firefox', major: +RegExp.$1 };
  const c = ua.match(/(?:Chrome|Chromium|CriOS)\/(\d+)/);
  if (c && !/CriOS|FxiOS|EdgiOS/.test(ua)) return { engine: 'chromium', major: +c[1] };
  if (/AppleWebKit/.test(ua)) return { engine: 'webkit', major: +(ua.match(/Version\/(\d+)/)?.[1] || 0) }; // includes all iOS browsers
  return { engine: 'other', major: 0 };
}

export async function detectPrivate(env: Env): Promise<PrivateResult> {
  const { engine, major } = engineOf(env.ua);
  const r = (p: boolean, reason: string, extra: Partial<PrivateResult> = {}): PrivateResult => ({ private: p, reason, engine, ...extra });
  if (env.standalone) return r(false, 'standalone');
  if (!env.hasIDB) return r(true, 'indexeddb-missing');
  if (env.idbOpen && !(await env.idbOpen().catch(() => false))) return r(true, 'indexeddb-error');
  if (env.lsWorks && !env.lsWorks()) return r(true, 'localstorage-error');
  let est: { quota?: number; usage?: number } | undefined;
  try { est = await env.estimate?.(); } catch { if (engine === 'webkit') return r(true, 'estimate-error'); }
  const quota = est?.quota, usage = est?.usage || 0, q = { quota, usage };
  if (engine === 'firefox') {
    if (env.secure && !env.hasSW) return r(true, 'firefox-no-serviceworker', q);
    return r(false, 'firefox-ok', q);
  }
  if (engine === 'webkit') {
    if (env.opfs) { try { await env.opfs(); } catch (e: any) { if (/unknown transient reason/i.test(String(e?.message || e))) return r(true, 'safari-opfs', q); } }
    if (quota != null && quota > 0 && quota < SAFARI_QUOTA_CUTOFF) return r(true, 'safari-low-quota', q);
    return r(false, 'webkit-ok', q);
  }
  if (engine === 'chromium' && quota != null && quota > 0) {
    if (major >= 147) return quota - usage < CHROME_HEADROOM_CUTOFF ? r(true, 'chrome-headroom', q) : r(false, 'chrome-ok', q);
    return quota < OLD_CHROME_QUOTA_CUTOFF ? r(true, 'chrome-low-quota', q) : r(false, 'chrome-ok', q);
  }
  return r(false, 'unknown', q);
}

function standalone() { return matchMedia?.('(display-mode: standalone)').matches || matchMedia?.('(display-mode: fullscreen)').matches || (navigator as any).standalone === true; }
export function browserEnv(): Env {
  const n = navigator as any;
  return {
    ua: navigator.userAgent, standalone: standalone(), secure: !!window.isSecureContext,
    hasSW: !!n.serviceWorker, hasIDB: typeof indexedDB !== 'undefined' && !!indexedDB,
    estimate: n.storage?.estimate ? () => n.storage.estimate() : undefined,
    opfs: n.storage?.getDirectory ? () => n.storage.getDirectory().then(() => undefined) : undefined,
    idbOpen: () => new Promise<boolean>((res) => {
      try { const q = indexedDB.open('grug-private-probe'); q.onsuccess = () => { q.result.close(); res(true); }; q.onerror = () => res(false); q.onblocked = () => res(true); setTimeout(() => res(true), 1500); } catch { res(false); }
    }),
    lsWorks: () => { try { localStorage.setItem('__p', '1'); localStorage.removeItem('__p'); return true; } catch { return false; } }
  };
}

let cached: Promise<PrivateResult> | null = null;
export const checkPrivate = () => (cached ||= isApp() ? Promise.resolve({ private: false, reason: 'android-app', engine: 'chromium' } as any) : detectPrivate(browserEnv()).catch(() => ({ private: false, reason: 'error', engine: 'other' })));
export const privateDismissed = () => { try { return localStorage.getItem('privateDismissed') === '1'; } catch { return false; } };
export const dismissPrivate = () => { try { localStorage.setItem('privateDismissed', '1'); } catch {} };

// ---- persistence ----
let armed = false, asked = false;
export async function protectStorage(): Promise<boolean | null> {
  const s = (navigator as any).storage; if (!s?.persist) return null;
  try { if (await s.persisted()) return true; if (asked) return false; asked = true; const ok = await s.persist(); dispatchEvent(new Event('grug-persist')); return ok; } catch { return null; }
}
/** Arm after onboarding: the next data write (first log) also requests persistence once. */
export function armPersist() { armed = true; }
export function onWrite() { if (armed && !asked) protectStorage(); }
export async function storageStatus(): Promise<'protected' | 'unprotected' | 'unknown'> {
  const s = (navigator as any).storage; if (!s?.persisted) return 'unknown';
  try { return (await s.persisted()) ? 'protected' : 'unprotected'; } catch { return 'unknown'; }
}
