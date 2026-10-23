/** v1.9.0: Home steps card (7-day chart), Settings › Step counter, Android-app page (download, install, move data, updates). */
import { useEffect, useState } from 'preact/hooks';
import { all, exportAll, getSettings, importAll, put } from '../db';
import { useQuery, useSettings } from '../hooks';
import type { DiaryEntry, Workout } from '../types';
import { confirmDo, Top, toast } from '../ui';
import { addDays, fmtTime, ymd } from '../util';
import { APK_URL, isAndroidWeb, isApp, native, shellUpdate, type StepStatus } from '../native';
import { DEFAULT_STEP_GOAL, STEP_BASELINE, stepCache, syncSteps } from '../steps';
import { useDayEnergy } from './Burn';

const WD1 = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const fmtN = (n: number) => Math.round(n).toLocaleString('en-AU');
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
export const useStepStatus = () => { const [st, set] = useState<StepStatus | null>(null); const r = () => native().then((n) => n?.stepStatus().then(set)); useEffect(() => { r(); }, []); return [st, r] as const; };

export async function allowSteps() {
  const n = await native(); if (!n) return null;
  const st = await n.requestStepPermission();
  if (st.permission === 'granted') { await syncSteps(); toast('Step counting on 👣'); }
  else if (confirmDo('Step counting needs the "Physical activity" permission. Open Grug Fit\'s app settings to allow it?')) await n.openAppSettings();
  return st;
}

/** Home card. In the web app it's just a note that steps need the Android app. */
export function StepsCard() {
  const s = useSettings(); const c = useQuery(stepCache, []); const today = ymd(); const en = useDayEnergy(today); const [st, refresh] = useStepStatus();
  if (s.stepsCard === 'off') return null;
  const hide = async () => { await put('kv', { ...(await getSettings()), stepsCard: 'off' }); toast('Steps card hidden – turn it back on in Settings › Step counter'); };
  if (!isApp()) return <div class="card row" style="gap:10px;align-items:center" data-testid="steps-web">
    <span style="font-size:22px">👣</span><div class="grow sm"><b>Steps need the Grug Fit Android app</b><div class="mut xs">The app counts steps with your phone's built-in step sensor and adds them to calories burned.</div></div>
    {isAndroidWeb() ? <a class="btn sm" href="#/android" data-testid="steps-get-app">Get it</a> : null}<button class="btn g sm" onClick={hide} aria-label="Hide">✕</button></div>;
  const goal = s.stepGoal || DEFAULT_STEP_GOAL; const n = c?.days?.[today] || 0;
  if (st && !st.sensor) return <div class="card sm mut" data-testid="steps-nosensor">👣 This phone has no step-counter sensor, so Grug Fit can't count steps. <button class="btn g sm" onClick={hide}>Hide</button></div>;
  if (st && st.permission !== 'granted') return <div class="card col" data-testid="steps-allow"><b>👣 Count your steps</b><div class="sm mut">Grug Fit uses the phone's built-in step sensor (no other apps). Allow “Physical activity” to start counting.</div>
    <button class="btn p" data-testid="steps-allow-go" onClick={async () => { await allowSteps(); refresh(); }}>Allow step counting</button></div>;
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)); const vals = days.map((d) => c?.days?.[d] || 0); const max = Math.max(goal, ...vals) * 1.08;
  const W = 300, H = 92, bw = 28, gap = (W - 7 * bw) / 6, gy = H - (goal / max) * H;
  return <a class="card" style="display:block;color:inherit;text-decoration:none" href="#/settings?steps=1" data-testid="steps-card">
    <div class="row between"><b>👣 Steps today</b><span class="mut xs">{c?.synced ? `updated ${fmtTime(c.synced)}` : ''}</span></div>
    <div class="row" style="gap:10px;align-items:baseline;margin:4px 0 6px"><b style="font-size:28px" data-testid="steps-today">{fmtN(n)}</b><span class="mut sm">/ {fmtN(goal)}</span>
      <span class="mut sm grow" style="text-align:right" data-testid="steps-kcal">{en ? `${en.steps.km} km · +${en.stepKcal} kcal` : ''}</span></div>
    <div class="bar"><div style={`width:${Math.min(100, (n / goal) * 100)}%;background:var(--acc)`} /></div>
    <svg viewBox={`0 0 ${W} ${H + 16}`} width="100%" style="margin-top:10px" data-testid="steps-chart" aria-label="Steps, last 7 days">
      <line x1="0" x2={W} y1={gy} y2={gy} stroke="currentColor" stroke-opacity=".35" stroke-dasharray="4 4" />
      {vals.map((v, i) => { const h = Math.max(2, (v / max) * H); const x = i * (bw + gap); return <g><rect x={x} y={H - h} width={bw} height={h} rx="5" fill={v >= goal ? 'var(--acc)' : 'var(--acc2, #3b82f6)'} opacity={i === 6 ? 1 : 0.75}><title>{days[i]}: {fmtN(v)} steps</title></rect>
        <text x={x + bw / 2} y={H + 13} text-anchor="middle" font-size="10" fill="currentColor" opacity=".6">{WD1[new Date(days[i] + 'T12:00').getDay()]}</text></g>; })}
    </svg>
    <div class="mut xs">7-day average {fmtN(vals.reduce((a, b) => a + b, 0) / 7)} · goal line {fmtN(goal)}{en?.steps.inCardio ? ` · ${fmtN(en.steps.inCardio)} steps during cardio workouts not double-counted` : ''}</div>
  </a>;
}

/** Settings › Step counter */
export function StepSettings() {
  const s = useSettings(); const [st, refresh] = useStepStatus(); const c = useQuery(stepCache, []);
  const [goal, setGoal] = useState(String(s.stepGoal || DEFAULT_STEP_GOAL)); useEffect(() => setGoal(String(s.stepGoal || DEFAULT_STEP_GOAL)), [s.stepGoal]);
  useEffect(() => { if (/[?&]steps=1/.test(location.hash)) setTimeout(() => document.getElementById('step-settings')?.scrollIntoView({ block: 'start' }), 80); }, []);
  const saveGoal = async () => { const g = Math.round(Number(goal)); if (!(g >= 500 && g <= 100000)) { toast('Goal: 500 – 100,000 steps'); return; } await put('kv', { ...s, stepGoal: g }); toast('Step goal saved'); };
  const card = <label class="row sm"><input type="checkbox" style="width:24px;min-height:24px" checked={s.stepsCard !== 'off'} onChange={(e) => put('kv', { ...s, stepsCard: e.currentTarget.checked ? 'on' : 'off' })} data-testid="steps-card-toggle" /> Show the steps card on Home</label>;
  if (!isApp()) return <div class="card col" id="step-settings" data-testid="step-settings-web"><div class="sm">👣 Step counting needs the <b>Grug Fit Android app</b> (the same app, plus your phone's built-in step sensor). The web version can't read the sensor.</div>
    {isAndroidWeb() && <a class="btn" href="#/android">Get the Android app</a>}{card}</div>;
  const bgOk = st && st.bgReadings > 0 && Date.now() - st.lastBgT < 6 * 3600e3;
  return <div class="card col" id="step-settings" data-testid="step-settings">
    <div class="row between"><b>Status</b><span class="sm" data-testid="step-perm">{!st ? '…' : !st.sensor ? '❌ no step sensor on this phone' : st.permission === 'granted' ? '✅ counting' : '⚠️ permission needed'}</span></div>
    {st && st.sensor && st.permission !== 'granted' && <button class="btn p" onClick={async () => { await allowSteps(); refresh(); }}>Allow step counting</button>}
    <label class="f">Daily step goal<div class="row" style="gap:8px"><input inputMode="numeric" value={goal} onInput={(e) => setGoal(e.currentTarget.value)} data-testid="step-goal" /><button class="btn" onClick={saveGoal}>Save</button></div></label>
    <label class="row sm"><input type="checkbox" style="width:24px;min-height:24px" checked={!!st?.alwaysOn} disabled={!st || st.permission !== 'granted'} data-testid="steps-always"
      onChange={async (e) => { const n = await native(); await n?.setAlwaysOn({ enabled: e.currentTarget.checked }); refresh(); }} />
      <span>Always count in the background<div class="mut xs">Keeps a silent “Grug Fit counting steps” notification so readings keep arriving. Usually not needed – turn on if days look short or steps land on the wrong day.</div></span></label>
    {card}
    <div class="mut xs" data-testid="step-diag">
      Last reading {st?.lastT ? ago(st.lastT) : 'never'} · background readings {st ? (st.bgReadings ? `${st.bgReadings}, last ${ago(st.lastBgT)}` : 'none yet') : '…'}{c?.synced ? ` · synced ${fmtTime(c.synced)}` : ''}
      {st && st.readings > 8 && !bgOk && !st.alwaysOn ? <div style="color:var(--warn)">⚠️ This phone isn't delivering background readings. Steps are still counted, but steps since the last reading land on the day you next open the app (or are split over the gap). Turn on “Always count” for exact days.</div> : null}
      {st?.lostReboots ? <div>Restarts seen: {st.lostReboots} (steps between the last reading and a restart can be missed).</div> : null}
    </div>
    <div class="mut xs">How it works: the phone's step sensor counts all the time (even with the app closed, no extra battery). Grug Fit reads it when you open the app, every ~15 minutes, and just after midnight. Calories: steps above {fmtN(STEP_BASELINE)}/day (the first ones are part of the resting allowance) × your stride (from height) × 0.5 kcal per kg per km; steps during logged cardio workouts aren't counted twice.</div>
  </div>;
}

/** Native update banner (APK); web content updates itself. */
export function ShellUpdateBanner() {
  const [u, setU] = useState<{ latest: string; url: string } | null>(null);
  useEffect(() => { shellUpdate().then((x) => x?.url && setU(x)); }, []);
  if (!u) return null;
  return <a class="card row" style="gap:10px;color:inherit;text-decoration:none;border-color:var(--acc)" href={u.url} data-testid="shell-update"><span style="font-size:22px">⬆️</span><div class="grow sm"><b>Android app update {u.latest}</b><div class="mut xs">Tap to download, then open it to install (your data stays).</div></div></a>;
}

/** first launch of the Android app with an empty database: offer the data move */
export function MoveDataCard() {
  const has = useQuery(async () => (await all<Workout>('workouts')).length + (await all<DiaryEntry>('diary')).length > 0, [], true);
  const [gone, setGone] = useState(() => localStorage.getItem('moveDismissed') === '1');
  if (!isApp() || has || gone) return null;
  return <div class="card col" data-testid="move-data"><b>📦 Used Grug Fit in Chrome before?</b><div class="sm mut">This app keeps its own copy of your data. Move it over once with a backup file – takes a minute.</div>
    <div class="row" style="gap:8px"><a class="btn p grow" href="#/android?move=1">Move my data</a><button class="btn g" onClick={() => { localStorage.setItem('moveDismissed', '1'); setGone(true); }}>I'm new</button></div></div>;
}

export async function importBackupFile() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.onchange = async () => {
    const f = inp.files?.[0]; if (!f) return;
    try { const j = JSON.parse(await f.text()); if (j?.app !== 'grugfit') throw new Error('not a Grug Fit backup');
      const has = (await all<Workout>('workouts')).length + (await all<DiaryEntry>('diary')).length > 0;
      if (has && !confirmDo('Replace the data in this app with the backup?')) return;
      await importAll(j, 'replace'); localStorage.setItem('moveDismissed', '1'); toast('Data moved ✔ – everything from the backup is here'); location.hash = '#/';
    } catch (e: any) { alert('Import failed: ' + e.message); }
  };
  inp.click();
}
/** save a backup file: native app → Downloads (WebView can't download), web → share sheet / download */
export async function saveBackup(): Promise<string> {
  const data = JSON.stringify(await exportAll()); const name = `grugfit-backup-${ymd()}.json`; const n = await native();
  if (n) { const r = await n.saveFile({ name, data }); localStorage.setItem('lastBackup', String(Date.now())); return r.saved ? `Saved to ${r.saved}` : 'Backup ready to share'; }
  const blob = new Blob([data], { type: 'application/json' }); const file = new File([blob], name, { type: 'application/json' });
  if ((navigator as any).canShare?.({ files: [file] }) && confirmDo('Share the backup file (e.g. to Google Drive or Files)? Cancel to download instead.')) { try { await navigator.share({ files: [file], title: name }); localStorage.setItem('lastBackup', String(Date.now())); return 'Backup shared'; } catch {} }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  localStorage.setItem('lastBackup', String(Date.now())); return 'Backup downloaded';
}

/** #/android – web: why + download + install + move data; app: version, updates, move data in. */
export function AndroidAppPage() {
  const app = isApp(); const [info, setInfo] = useState<{ versionName: string } | null>(null); const [upd, setUpd] = useState<string>('');
  useEffect(() => { native().then((n) => n?.info().then(setInfo)); if (/[?&]move=1/.test(location.hash)) setTimeout(() => document.getElementById('move')?.scrollIntoView({ block: 'start' }), 80); }, []);
  const ol = (l: any[]) => <ol class="sm" style="margin:4px 0 0;padding-left:20px;display:grid;gap:6px">{l.map((x) => <li>{x}</li>)}</ol>;
  return <><Top title="Grug Fit Android app" backBtn /><div class="page col">
    {app ? <div class="card col" data-testid="android-in-app"><b>✅ You're using the Android app{info ? ` (${info.versionName})` : ''}</b>
      <div class="sm mut">It's the same Grug Fit – the screens update themselves from the web like before. Only the app shell (step counting) needs an occasional download.</div>
      <button class="btn" onClick={async () => { setUpd('Checking…'); const u = await shellUpdate(true); setUpd(!u ? 'Could not check' : u.url ? `Update ${u.latest} available` : `Up to date (${u.current})`); }}>Check for app update</button>
      {upd && <div class="sm">{upd}{/available/.test(upd) && <> – <a href={APK_URL} style="color:var(--acc)">download</a></>}</div>}</div>
      : <div class="card col"><b>👣 Why the app?</b><div class="sm">Same Grug Fit, plus <b>step counting</b> with your phone's built-in step sensor – steps and their calories show up on Home and in “burned today”. Nothing else to install, no Google Fit or other apps. Android only; free; not on the Play Store (you install the file yourself).</div>
        <a class="btn p" href={APK_URL} data-testid="apk-download">⬇️ Download Grug Fit for Android (APK)</a></div>}
    {!app && <><h2>Install</h2><div class="card">{ol([
      <>Tap <b>Download</b> above. Chrome may warn “File might be harmful” – tap <b>Download anyway</b> (it's this app, built from the project's source on GitHub).</>,
      <>Open the downloaded <b>grug-fit.apk</b> (notification or Files › Downloads).</>,
      <>Android asks to allow installs from Chrome: tap <b>Settings</b> › turn on <b>Allow from this source</b> › back.</>,
      <>Tap <b>Install</b>. If Play Protect asks, choose <b>Install anyway</b> (apps outside the Play Store get this check).</>,
      <>Open Grug Fit from the app drawer and tap <b>Allow step counting</b> on Home (“Physical activity” permission).</>])}</div></>}
    <h2 id="move" style="scroll-margin-top:64px">Move your data</h2>
    <div class="card col" data-testid="move-steps"><div class="sm mut">The Android app and the Chrome version keep separate data on the phone (Android keeps every app's storage apart). Move it once with a backup file:</div>
      {ol([<>In the <b>Chrome</b> version: Settings › Backup › <b>Export</b> (or the button below when you're in Chrome). Save it to Downloads / Files.</>,
        <>In the <b>Android app</b>: tap <b>Import backup</b> below (or Settings › Backup › Import › Replace) and pick the file.</>,
        <>Check your workouts and diary are there. Then use the app from now on – the Chrome version won't see new entries (you can uninstall it, or keep it as a spare).</>])}
      {app ? <button class="btn p" onClick={importBackupFile} data-testid="move-import">📥 Import backup</button> : <button class="btn" onClick={async () => toast(await saveBackup())} data-testid="move-export">📤 Export backup from here</button>}
      <div class="mut xs">Your step history lives in the app only. Backups made in the app include steps synced so far.</div></div>
    <h2>Good to know</h2><div class="card sm col">
      <div>• <b>Updates:</b> screens and features update automatically (same as the web version). A new app file is only needed for changes to step counting – the app tells you on Home.</div>
      <div>• <b>Offline:</b> after the first start the app works offline like the installed web app.</div>
      <div>• <b>Battery:</b> the step sensor is a low-power chip that counts anyway; Grug Fit just reads it now and then.</div>
      <div>• <b>Privacy:</b> step counts stay on your phone, like everything else in Grug Fit.</div></div>
  </div></>;
}
