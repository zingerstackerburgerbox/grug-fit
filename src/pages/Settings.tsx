import { useEffect, useState } from 'preact/hooks';
import { clearAll, exportAll, importAll, put } from '../db';
import { useSettings } from '../hooks';
import type { Settings } from '../types';
import { NumInput, Seg, Top, confirmDo, num, toast } from '../ui';
import { DEFAULT_SETTINGS, MICROS, fmtDate, fmtTime, r1, ymd } from '../util';
import { APP_VERSION, BUILD_ID, BUILD_TIME } from '../update';
import { scheduleReminders } from '../doses';

export function SettingsPage() {
  const s = useSettings(); const [t, setT] = useState<Record<string, string>>({});
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  const [installEvt, setInstallEvt] = useState<any>((window as any).__installPrompt);
  useEffect(() => { const v: any = {}; for (const k in s.targets) v[k] = String((s.targets as any)[k]); setT(v); }, [s]);
  useEffect(() => { const f = () => setInstallEvt((window as any).__installPrompt); addEventListener('installprompt', f); return () => removeEventListener('installprompt', f); }, []);
  const save = async (p: Partial<Settings>) => { await put('kv', { ...s, ...p }); };
  const saveTargets = async () => { const targets: any = { ...s.targets }; for (const k in t) { const v = num(t[k]); if (v != null) targets[k] = v; } await save({ targets }); toast('Targets saved'); };
  const doExport = async () => {
    const data = await exportAll(); const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const name = `grugfit-backup-${ymd()}.json`; const file = new File([blob], name, { type: 'application/json' });
    if ((navigator as any).canShare?.({ files: [file] }) && confirmDo('Share the backup file (e.g. to Google Drive)? Cancel to download instead.')) { try { await navigator.share({ files: [file], title: name }); localStorage.setItem('lastBackup', String(Date.now())); return; } catch {} }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    localStorage.setItem('lastBackup', String(Date.now())); toast('Backup downloaded');
  };
  const doImport = (mode: 'replace' | 'merge') => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; try { const j = JSON.parse(await f.text()); if (mode === 'replace' && !confirmDo('Replace ALL current data with this backup?')) return; await importAll(j, mode); toast('Backup restored'); scheduleReminders(); } catch (e: any) { alert('Import failed: ' + e.message); } };
    inp.click();
  };
  const field = (k: string, label: string) => <label class="f">{label}<input inputMode="decimal" value={t[k] ?? ''} onInput={(e) => setT({ ...t, [k]: e.currentTarget.value })} /></label>;
  return <><Top title="Settings" /><div class="page col">
    {installEvt && <button class="btn p" onClick={async () => { installEvt.prompt(); await installEvt.userChoice; (window as any).__installPrompt = null; setInstallEvt(null); }}>📲 Install Grug Fit app</button>}
    <h2>Daily targets</h2>
    <div class="card col"><div class="grid2">{field('kcal', 'Energy (kcal)')}{field('protein', 'Protein (g)')}{field('carbs', 'Net carbs (g)')}{field('fat', 'Fat (g)')}{field('fibre', 'Fibre (g)')}</div>
      <details><summary class="b sm">Micronutrient targets</summary><div class="grid2" style="margin-top:10px">{MICROS.map((m) => field(m.key, `${m.label} (${m.unit})`))}</div></details>
      <div class="mut xs">Macro split: P {r1(((num(t.protein || '') || 0) * 4 / (num(t.kcal || '') || 1)) * 100)}% · C {r1(((num(t.carbs || '') || 0) * 4 / (num(t.kcal || '') || 1)) * 100)}% · F {r1(((num(t.fat || '') || 0) * 9 / (num(t.kcal || '') || 1)) * 100)}%</div>
      <div class="grid2"><button class="btn" onClick={() => { if (confirmDo('Reset targets to defaults (1800 kcal, P 157.5, C 202.5, F 40)?')) save({ targets: DEFAULT_SETTINGS.targets }); }}>Reset defaults</button><button class="btn p" onClick={saveTargets}>Save targets</button></div></div>
    <h2>Units & workout</h2>
    <div class="card col"><label class="f">Energy<Seg value={s.energyUnit} onChange={(energyUnit) => save({ energyUnit })} options={[['kcal', 'kcal'], ['kJ', 'kJ']]} /></label>
      <label class="f">Lifting weight<Seg value={s.weightUnit} onChange={(weightUnit) => save({ weightUnit })} options={[['kg', 'kg'], ['lb', 'lb']]} /></label>
      <label class="f">Default rest timer (seconds)<NumInput int value={s.defaultRest} onValue={(n) => n != null && save({ defaultRest: n })} /></label>
      <label class="row sm"><input type="checkbox" style="width:24px;min-height:24px" checked={s.vibrate} onChange={(e) => { save({ vibrate: e.currentTarget.checked }); localStorage.setItem('vibrate', e.currentTarget.checked ? '1' : '0'); }} /> Vibrate on set complete & rest end</label>
      <div class="mut xs">Dates are shown as DD/MM/YYYY. Food quantities in grams.</div></div>
    <h2>Dose reminders</h2>
    <div class="card col"><label class="row sm"><input type="checkbox" style="width:24px;min-height:24px" checked={s.reminders} onChange={async (e) => { const on = e.currentTarget.checked; if (on && typeof Notification !== 'undefined' && Notification.permission !== 'granted') setPerm(await Notification.requestPermission()); await save({ reminders: on }); setTimeout(scheduleReminders, 50); }} /> Enable reminder notifications</label>
      <div class="mut xs">Permission: {perm}. {'TimestampTrigger' in window ? 'This browser supports Notification Triggers, so reminders are scheduled with the system.' : ''}</div>
      <div class="sm mut">⚠️ Honest limitation: web apps can't yet schedule reliable alarms on Android. Reminders fire while Grug Fit (or Chrome) is open or recently used in the background; if Android has closed the app, a reminder may be late or not appear. Notification Triggers would fix this but aren't broadly available in Chrome. For critical medications, also set a phone alarm. Opening the app always shows what's due.</div>
      <button class="btn sm" disabled={perm !== 'granted'} onClick={async () => { const r = await navigator.serviceWorker.ready; r.showNotification('Grug Fit test', { body: 'Notifications are working ✅', icon: 'icon-192.png' }); }}>Send test notification</button></div>
    <h2>Backup (important!)</h2>
    <div class="card col"><div class="sm mut">All data lives only on this device in the browser's storage. Uninstalling the app or clearing Chrome site data deletes it. Export a backup regularly.</div>
      <button class="btn p" onClick={doExport}>⬇ Export all data (JSON)</button>
      <div class="grid2"><button class="btn" onClick={() => doImport('replace')}>Import (replace)</button><button class="btn" onClick={() => doImport('merge')}>Import (merge)</button></div>
      <div class="mut xs">Last backup: {localStorage.getItem('lastBackup') ? new Date(+localStorage.getItem('lastBackup')!).toLocaleString('en-AU') : 'never'}</div></div>
    <h2>Danger zone</h2>
    <button class="btn d" onClick={async () => { if (confirmDo('Delete ALL data (workouts, diary, supplements, settings)? This cannot be undone.') && confirmDo('Really? Export a backup first if unsure.')) { await clearAll(); localStorage.removeItem('rest'); toast('All data cleared'); } }}>Clear all data</button>
    <h2>About</h2>
    <div class="card col" data-testid="about"><div class="row between"><b>Grug Fit v<span data-testid="app-version">{APP_VERSION}</span></b><span class="mut sm">built {fmtDate(BUILD_TIME)} {fmtTime(+new Date(BUILD_TIME))}</span></div>
      <div class="mut xs">Build <span data-testid="build-id">{BUILD_ID}</span> · updates install automatically (checked on launch, when you return to the app, and every 30 min). Your data stays on the device across updates.</div>
      <button class="btn sm" onClick={async () => { const r = await navigator.serviceWorker?.getRegistration(); if (!r) { toast('Updates unavailable (no service worker)'); return; } await r.update().catch(() => {}); toast(r.installing || r.waiting ? 'Update found – installing…' : 'You have the latest version'); }}>Check for updates</button></div>
      <button class="btn sm" data-testid="ocr-offline" onClick={async () => { toast('Downloading label scanner (~6 MB)…'); try { const m = await import('../ocr/ocr'); await m.prefetchOcr(); toast('Label scanning is ready offline'); } catch (e: any) { toast('Download failed: ' + (e?.message || e)); } }}>📷 Make label scanning available offline</button>
    <div class="mut xs center" style="margin-top:10px">Food data from Open Food Facts (ODbL)</div>
  </div></>;
}
