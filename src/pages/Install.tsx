/** v1.8.1: "Install Grug Fit" banner (Home / onboarding), Settings item and manual-steps sheet. */
import { useEffect, useState } from 'preact/hooks';
import { canPrompt, isIOS, isStandalone, platform, promptInstall, showInstallBanner, snooze, subscribeInstall, type Platform } from '../install';
import { Sheet, toast } from '../ui';

export function useInstall() {
  const [, set] = useState(0);
  useEffect(() => subscribeInstall(() => set((n) => n + 1)), []);
  return { can: canPrompt(), banner: showInstallBanner(), standalone: isStandalone() };
}
const STEPS: Record<Exclude<Platform, 'inapp'>, { title: string; steps: string[] }> = {
  'android-chrome': { title: 'Android – Chrome', steps: ['Tap ⋮ (top right of Chrome).', 'Tap “Install app” (or “Add to Home screen”).', 'Tap Install – Grug Fit appears on your home screen.'] },
  samsung: { title: 'Samsung Internet', steps: ['Tap the ☰ menu (bottom right).', 'Tap “Add page to”.', 'Choose “Home screen”, then Add.'] },
  'ios-safari': { title: 'iPhone / iPad – Safari', steps: ['Tap the Share button (□ with ↑) at the bottom.', 'Scroll down and tap “Add to Home Screen”.', 'Tap Add (top right).'] },
  'ios-other': { title: 'iPhone – Chrome / other browsers', steps: ['Tap the Share button (□ with ↑) next to the address bar.', 'Tap “Add to Home Screen” (if it isn’t there, open this page in Safari and use Share › Add to Home Screen).', 'Tap Add.'] },
  'android-other': { title: 'Other Android browsers', steps: ['Open the browser menu (⋮ or ☰).', 'Look for “Install app”, “Add to Home screen” or “Add page to › Home screen”.', 'If there’s no such option, open this page in Chrome and install from there.'] },
  desktop: { title: 'Computer – Chrome / Edge', steps: ['Click the install icon (⊕ / 🖥) at the right of the address bar,', 'or open ⋮ › “Cast, save and share” › “Install page as app”.', 'Click Install.'] }
};
const ORDER: Exclude<Platform, 'inapp'>[] = ['android-chrome', 'samsung', 'ios-safari', 'ios-other', 'android-other', 'desktop'];

export function InstallSteps({ open, onClose }: { open: boolean; onClose: () => void }) {
  const p = platform(); const ios = isIOS(); const mine = p === 'inapp' ? null : STEPS[p];
  const copy = async () => { try { await navigator.clipboard.writeText(location.href.split('#')[0]); toast('Link copied – paste it into ' + (ios ? 'Safari' : 'Chrome')); } catch { toast(location.href.split('#')[0]); } };
  return <Sheet open={open} onClose={onClose} title="Install Grug Fit">
    <div class="col install-steps" data-testid="install-steps" data-platform={p}>
      {p === 'inapp' ? <div class="card col" data-testid="install-inapp" style="border-color:var(--warn)">
        <b>Open this page in {ios ? 'Safari' : 'Chrome'} first</b>
        <div class="sm">You’re in an in-app browser (Messenger, Instagram, Facebook, Snapchat, TikTok…). Apps can’t be installed from here.</div>
        <ol class="sm">{ios ? <><li>Tap ⋯ or the compass/share icon (top or bottom right).</li><li>Tap “Open in Safari” (or “Open in browser”).</li><li>Then use Share › “Add to Home Screen”.</li></>
          : <><li>Tap ⋮ (top right).</li><li>Tap “Open in Chrome” (or “Open in browser”).</li><li>Then tap ⋮ › “Install app” in Chrome.</li></>}</ol>
        <button class="btn sm" onClick={copy} data-testid="install-copy">Copy link instead</button></div>
        : <div class="card col" data-testid="install-mine"><b>{mine!.title}</b><ol class="sm">{mine!.steps.map((x) => <li>{x}</li>)}</ol></div>}
      <div class="sm mut">Then open Grug Fit from your home screen: it runs full-screen, works offline and keeps your data on this phone.</div>
      {ios && <div class="xs" style="color:var(--warn)">iPhone note: the home-screen app has its own storage, separate from Safari. If you already logged things in the browser, export a backup in Settings first and import it in the app.</div>}
      <details class="tut"><summary class="b sm">Other browsers</summary>
        {ORDER.filter((k) => k !== p).map((k) => <div class="sm" style="margin:6px 0"><b>{STEPS[k].title}</b><ol class="xs" style="margin:2px 0;padding-left:20px">{STEPS[k].steps.map((x) => <li>{x}</li>)}</ol></div>)}
        <div class="xs mut">Menus may vary by browser version.</div></details>
      <button class="btn" onClick={onClose}>Close</button>
    </div>
  </Sheet>;
}

/** Tap handler shared by banner + settings: native prompt when Chrome offered one, else manual steps. */
function useInstallAction() {
  const [steps, setSteps] = useState(false);
  const act = async () => { if (canPrompt()) { const ok = await promptInstall(); if (ok) toast('Installing Grug Fit…'); } else setSteps(true); };
  return { act, sheet: <InstallSteps open={steps} onClose={() => setSteps(false)} /> };
}

export function InstallBanner({ compact }: { compact?: boolean }) {
  const st = useInstall(); const { act, sheet } = useInstallAction();
  if (!st.banner) return null;
  const inapp = platform() === 'inapp';
  return <><div class={'card install-banner' + (compact ? ' compact' : '')} data-testid="install-banner">
    <div class="row" style="gap:12px;align-items:flex-start"><img src="icon-192.png" alt="" width={44} height={44} style="border-radius:10px;flex:none" />
      <div class="grow"><b>Install Grug Fit</b><div class="sm mut">{inapp ? 'Open in Chrome to install – it’s free, no app store needed.' : 'Add it to your home screen: full-screen, works offline, one tap to open. Free, no app store.'}</div></div></div>
    <div class="row" style="gap:8px;margin-top:10px"><button class="btn p grow" data-testid="install-go" onClick={act}>📲 {inapp ? 'How to install' : 'Install Grug Fit'}</button>
      <button class="btn g" data-testid="install-later" onClick={() => snooze()}>Not now</button></div>
  </div>{sheet}</>;
}

export function InstallSetting() {
  const st = useInstall(); const { act, sheet } = useInstallAction();
  if (st.standalone) return <div class="card sm mut" data-testid="settings-installed">✅ Running as an installed app.</div>;
  return <><div class="card col" data-testid="settings-install"><div class="row between"><div><b>📲 Install app</b><div class="mut xs">{st.can ? 'Your browser can install Grug Fit directly.' : 'Add Grug Fit to your home screen.'}</div></div>
    <button class="btn p sm" data-testid="settings-install-go" onClick={act}>{st.can ? 'Install' : 'Show me how'}</button></div></div>{sheet}</>;
}
