import { useEffect, useState } from 'preact/hooks';
import { InstallSteps } from './Install';
import { toast } from '../ui';
import { dismissPrivate, storageStatus } from '../privacy';

const link = () => location.href.split('#')[0];
async function copyLink() {
  try { await navigator.clipboard.writeText(link()); toast('Link copied – paste it into a normal Chrome window'); return true; }
  catch { const i = document.getElementById('private-link') as HTMLInputElement | null; i?.select(); toast('Select the link and copy it'); return false; }
}

export function PrivateBlock({ onContinue }: { onContinue: () => void }) {
  const [steps, setSteps] = useState(false);
  return <div class="private-block" data-testid="private-block" role="alertdialog" aria-labelledby="pb-t">
    <div class="col" style="gap:14px;max-width:460px;margin:0 auto">
      <div style="font-size:52px;line-height:1">🕶️</div>
      <h1 id="pb-t" style="margin:0">Private/incognito window detected</h1>
      <div class="card col" style="border-color:var(--warn)">
        <b>Anything you log here is erased when this window closes.</b>
        <div class="sm mut">Grug Fit keeps your workouts, food diary and doses only on this device. Private windows throw that storage away, so you'd lose everything.</div>
      </div>
      <ol class="col sm" style="gap:6px;padding-left:20px;margin:0">
        <li>Tap <b>Copy link</b> below.</li>
        <li>Open a <b>normal</b> (not incognito) Chrome window and paste the link.</li>
        <li><b>Install</b> Grug Fit from there so it opens like an app.</li>
      </ol>
      <input id="private-link" class="inp" readOnly value={link()} onFocus={(e) => (e.target as HTMLInputElement).select()} data-testid="private-url" />
      <button class="btn p" data-testid="private-copy" onClick={copyLink}>📋 Copy link</button>
      <button class="btn" data-testid="private-install-steps" onClick={() => setSteps(true)}>How to install</button>
      <button class="linklike xs mut" data-testid="private-continue" onClick={() => { dismissPrivate(); onContinue(); }}>I'm not in incognito</button>
      <div class="xs mut">Detection is a best guess and can be wrong in both directions.</div>
    </div>
    <InstallSteps open={steps} onClose={() => setSteps(false)} />
  </div>;
}

export function PrivateBanner() {
  return <div class="private-banner" data-testid="private-banner" role="status">⚠️ This may be a private window – data is erased when it closes. <a href="#/settings">Install / back up</a></div>;
}

export function StorageCard() {
  const [st, setSt] = useState<string>('…');
  useEffect(() => { const f = () => storageStatus().then(setSt); f(); addEventListener('grug-persist', f); return () => removeEventListener('grug-persist', f); }, []);
  const prot = st === 'protected';
  return <div class="card col" data-testid="storage-status" data-state={st}>
    <div class="row between"><b>{prot ? '🔒 Storage: Protected' : st === 'unknown' ? '❔ Storage: Unknown' : '⚠️ Storage: Not protected'}</b></div>
    <div class="sm mut">{prot ? 'The browser has agreed not to clear Grug Fit\'s data automatically. Uninstalling or clearing site data still deletes it.'
      : 'The browser may clear Grug Fit\'s data if the phone runs low on space. Installing the app usually fixes this (and private windows always lose data).'}</div>
    <div class="sm" data-testid="backup-reminder">💾 Either way, export a backup regularly (Backup below).</div>
  </div>;
}
