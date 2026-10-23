/**
 * v1.9.0: running inside the Grug Fit Android app (Capacitor shell that loads this same site). The shell adds
 * "GrugFitAndroid" to the user agent and injects window.Capacitor with the GrugNative plugin (android/…/GrugNativePlugin.kt).
 * In the plain web app everything here is a no-op. Tests can inject window.__grugNativeMock.
 */
export type StepStatus = { sensor: boolean; permission: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' | string; alwaysOn: boolean; notifications: string;
  readings: number; bgReadings: number; lastBgT: number; lastT: number; lostReboots: number };
export type StepReply = StepStatus & { days: Record<string, number>; segs: [number, number, number][] };
export type GrugNative = {
  info(): Promise<{ versionName: string; versionCode: number; sdk: number; device: string }>;
  stepStatus(): Promise<StepStatus>; requestStepPermission(): Promise<StepStatus>;
  steps(o: { days?: number; sample?: boolean }): Promise<StepReply>; setAlwaysOn(o: { enabled: boolean }): Promise<StepStatus>;
  openAppSettings(): Promise<void>; saveFile(o: { name: string; data: string; mime?: string; share?: boolean }): Promise<{ saved?: string; shared?: boolean }>;
};
const w = globalThis as any;
export const isApp = (): boolean => !!w.__grugNativeMock || !!w.Capacitor?.isNativePlatform?.() || /GrugFitAndroid/.test(globalThis.navigator?.userAgent || '');
export const isAndroidWeb = () => !isApp() && /Android/i.test(globalThis.navigator?.userAgent || '');
let p: Promise<GrugNative | null> | null = null;
export function native(): Promise<GrugNative | null> {
  if (w.__grugNativeMock) return Promise.resolve(w.__grugNativeMock);
  if (!isApp()) return Promise.resolve(null);
  return (p ||= import('@capacitor/core').then((c) => (c.Capacitor.isNativePlatform() ? c.registerPlugin<GrugNative>('GrugNative') : null)).catch(() => null));
}
export const REPO = 'zingerstackerburgerbox/grug-fit';
/** stable download link: always the newest release's APK */
export const APK_URL = `https://github.com/${REPO}/releases/latest/download/grug-fit.apk`;
export const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

/** compare dotted versions: 1.0.10 > 1.0.9 */
export const newer = (a: string, b: string) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

/** Native-shell update check (web content updates itself): latest GitHub release tag "android-v1.2.3", cached 6 h. */
export async function shellUpdate(force = false): Promise<{ current: string; latest: string; url: string } | null> {
  const n = await native(); if (!n) return null;
  const cur = (await n.info()).versionName; let latest = '';
  try {
    const c = JSON.parse(localStorage.getItem('shellLatest') || 'null');
    if (!force && c && Date.now() - c.t < 6 * 3600e3) latest = c.v;
    else { const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } }); if (r.ok) { latest = String((await r.json()).tag_name || '').replace(/^android-v/, ''); localStorage.setItem('shellLatest', JSON.stringify({ t: Date.now(), v: latest })); } }
  } catch {}
  return latest && newer(latest, cur) ? { current: cur, latest, url: APK_URL } : { current: cur, latest: latest || cur, url: '' };
}
