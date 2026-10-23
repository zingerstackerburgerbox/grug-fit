/** v1.8.1 install support: capture beforeinstallprompt, detect standalone / platform / in-app browsers, snooze. */
type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
let deferred: BIP | null = null;
const ls = new Set<() => void>(); const emit = () => ls.forEach((f) => f());
export const subscribeInstall = (f: () => void) => { ls.add(f); return () => { ls.delete(f); }; };
export const SNOOZE_MS = 3 * 864e5;

export function initInstall() {
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own banner/button instead of Chrome's mini-infobar
    deferred = e as BIP; localStorage.removeItem('installedAt'); // firing again means the app isn't installed (e.g. it was uninstalled)
    emit();
  });
  addEventListener('appinstalled', () => { deferred = null; localStorage.setItem('installedAt', String(Date.now())); emit(); });
}
export const canPrompt = () => !!deferred;
/** true when the native install dialog was shown and accepted */
export async function promptInstall(): Promise<boolean> {
  const d = deferred; if (!d) return false;
  deferred = null; emit(); // a captured event can only be used once
  await d.prompt(); const c = await d.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
  if (c.outcome === 'accepted') { localStorage.setItem('installedAt', String(Date.now())); emit(); }
  return c.outcome === 'accepted';
}
export const isStandalone = () => ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'].some((m) => matchMedia(`(display-mode: ${m})`).matches) || (navigator as any).standalone === true;
export const installedHere = () => !!localStorage.getItem('installedAt');
export const snoozed = (now = Date.now()) => now < Number(localStorage.getItem('installSnoozeUntil') || 0);
export const snooze = (now = Date.now()) => { localStorage.setItem('installSnoozeUntil', String(now + SNOOZE_MS)); emit(); };
/** banner on Home/onboarding: not running as an app, not just installed from this browser, not snoozed */
export const showInstallBanner = (now = Date.now()) => !isStandalone() && !installedHere() && !snoozed(now);

export type Platform = 'inapp' | 'ios-safari' | 'ios-other' | 'samsung' | 'android-chrome' | 'android-other' | 'desktop';
const INAPP = /FBAN|FBAV|FB_IAB|FBIOS|FB4A|Messenger|MessengerLite|Instagram|Snapchat|musical_ly|TikTok|BytedanceWebview|Line\/|MicroMessenger|LinkedInApp|Pinterest|Twitter|\bGSA\/|DiscordBot|; wv\)/i;
export function platform(ua = navigator.userAgent, touch = navigator.maxTouchPoints || 0): Platform {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch > 1);
  if (INAPP.test(ua)) return 'inapp';
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|DuckDuckGo/.test(ua) ? 'ios-other' : 'ios-safari';
  if (/SamsungBrowser/.test(ua)) return 'samsung';
  if (/Android/.test(ua)) return /Chrome\/\d/.test(ua) && !/EdgA|OPR|Firefox|YaBrowser|UCBrowser|Brave/.test(ua) ? 'android-chrome' : 'android-other';
  return 'desktop';
}
export const isIOS = (ua = navigator.userAgent, touch = navigator.maxTouchPoints || 0) => /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch > 1);
