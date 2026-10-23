import { useQuota, quotaText } from './Coach';
import { coachMode, fetchStatus } from '../coach';
import { useEffect, useState } from 'preact/hooks';
import { clearAll, exportAll, importAll, getSettings, put } from '../db';
import { useSettings } from '../hooks';
import type { Settings } from '../types';
import { NumInput, Seg, Top, confirmDo, num, toast } from '../ui';
import { DEFAULT_SETTINGS, MICROS, fmtDate, fmtTime, r1, ymd } from '../util';
import { APP_VERSION, BUILD_ID, BUILD_TIME } from '../update';
import { scheduleReminders } from '../doses';
import { KCAL_EXPLAIN } from '../setKcal';
import { ImportSection } from './Import';
import { GOAL_LABEL, ageFromBirthYear, bmr, eatBackOn, latestWeight, sedentaryBurn, type Goal } from '../energy';
import { go, useQuery } from '../hooks';
import { LB } from '../util';

function ProfileCard({ s }: { s: Settings }) {
  const kg = useQuery(latestWeight, [], null); const p = s.profile;
  const [h, setH] = useState<number | null>(p?.heightCm ?? null); const [by, setBy] = useState<number | null>(p?.birthYear ?? null);
  const [w, setW] = useState<number | null>(null);
  useEffect(() => { setH(p?.heightCm ?? null); setBy(p?.birthYear ?? null); }, [p?.updated]);
  useEffect(() => { if (kg != null) setW(r1(p?.bwUnit === 'lb' ? kg * LB : kg)); }, [kg]);
  const bwUnit = p?.bwUnit || 'kg';
  if (!p) return <div class="card col"><div class="sm">Set up your height, weight, age, sex and goal to see your daily calorie burn and get suggested targets.</div><button class="btn p" onClick={() => go('/welcome?from=settings')} data-testid="profile-setup">Set up profile</button></div>;
  const age = ageFromBirthYear(p.birthYear); const B = kg ? bmr(kg, p.heightCm, age, p.sex) : null;
  const save = async (patch: any) => { await put('kv', { ...s, profile: { ...p, ...patch, updated: Date.now() } }); };
  const saveAll = async () => {
    if (!h || h < 100 || h > 250 || !by) { toast('Check height and birth year'); return; }
    await save({ heightCm: h, birthYear: by });
    if (w) { const nkg = bwUnit === 'lb' ? w / LB : w; if (kg == null || Math.abs(nkg - kg) > 0.05) await put('bodyweight', { id: 'bw' + ymd(), date: ymd(), kg: Math.round(nkg * 100) / 100 }); }
    toast('Profile saved');
  };
  return <div class="card col" data-testid="profile-card">
    <div class="grid2"><label class="f">Height (cm)<NumInput value={h} onValue={setH} aria-label="Profile height" /></label><label class="f">Birth year<NumInput int value={by} onValue={setBy} aria-label="Profile birth year" /></label>
      <label class="f">Weight ({bwUnit}) · latest log<NumInput value={w} onValue={setW} aria-label="Profile weight" /></label>
      <label class="f">Sex<Seg value={p.sex} onChange={(sex) => save({ sex })} options={[['male', 'Male'], ['female', 'Female']]} /></label></div>
    <label class="f">Goal<Seg value={p.goal} onChange={(goal: Goal) => save({ goal })} options={(['cut', 'maintain', 'bulk'] as Goal[]).map((g) => [g, GOAL_LABEL[g]] as [Goal, string])} /></label>
    {B != null && <div class="sm">Age {age} · BMR {r1(B).toFixed(0)} kcal · <b>sedentary burn ~{Math.round(sedentaryBurn(B))} kcal/day</b></div>}
    <div class="grid2"><button class="btn" onClick={saveAll}>Save profile</button><button class="btn p" onClick={async () => { await saveAll(); go('/welcome?step=result&from=settings'); }} data-testid="recalculate">Recalculate targets</button></div>
    <label class="row sm"><input type="checkbox" style="width:24px;min-height:24px" checked={eatBackOn(s)} onChange={(e) => put('kv', { ...s, eatBack: e.currentTarget.checked })} data-testid="eatback" /> Add workout calories to my daily target (“eat back” what I burn training)</label>
    <div class="mut xs" data-testid="kcal-method">🔥 Workout calories: {KCAL_EXPLAIN}</div>
    <div class="mut xs">{eatBackOn(s) ? 'On: on workout days your calorie target grows by the workout estimate.' : 'Off: your calorie target stays fixed; workouts only show in “Burned today”.'} Default is on for maintaining/bulking, off for cutting.</div>
  </div>;
}

/** Optional personal api.data.gov key. Loads the stored value before enabling the field so a fast tap can't be overwritten by the initial load. */
function UsdaKeyField() {
  const [v, setV] = useState<string | null>(null);
  useEffect(() => { getSettings().then((x) => setV(x.usdaKey || '')); }, []);
  const commit = async (val: string) => { const cur = await getSettings(); await put('kv', { ...cur, usdaKey: val.trim() || undefined }); toast(val.trim() ? 'USDA key saved' : 'USDA key cleared — using DEMO_KEY'); };
  return <label class="f">USDA API key (optional)<input data-testid="usda-key" aria-label="USDA API key" autocomplete="off" spellcheck={false} placeholder="Blank = shared DEMO_KEY" disabled={v === null} value={v ?? ''}
    onInput={(e) => setV(e.currentTarget.value)} onChange={(e) => commit(e.currentTarget.value)} /></label>;
}
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
    <h2>Profile & calorie burn</h2>
    <ProfileCard s={s} />
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
      <label class="row sm"><input type="checkbox" style="width:24px;min-height:24px" data-testid="fact-setting" checked={(s.factCard || 'open') !== 'off'} onChange={(e) => save({ factCard: e.currentTarget.checked ? 'open' : 'off' })} /> Show “Fitness fact of the day” on Home</label>
      <div class="mut xs">Dates are shown as DD/MM/YYYY. Food quantities in grams.</div></div>
    <h2>Food lookup</h2>
    <div class="card col"><UsdaKeyField />
      <div class="mut xs">Barcodes Open Food Facts doesn't know are checked in USDA FoodData Central (US branded foods). The shared DEMO_KEY allows only ~30 lookups an hour; a <a href="https://fdc.nal.usda.gov/api-key-signup" target="_blank" rel="noopener">free personal key</a> raises that to 1,000.</div></div>
    <h2>Coach</h2>
    <CoachSettings />
    <h2>Dose reminders</h2>
    <div class="card col"><label class="row sm"><input type="checkbox" style="width:24px;min-height:24px" checked={s.reminders} onChange={async (e) => { const on = e.currentTarget.checked; if (on && typeof Notification !== 'undefined' && Notification.permission !== 'granted') setPerm(await Notification.requestPermission()); await save({ reminders: on }); setTimeout(scheduleReminders, 50); }} /> Enable reminder notifications</label>
      <div class="mut xs">Permission: {perm}. {'TimestampTrigger' in window ? 'This browser supports Notification Triggers, so reminders are scheduled with the system.' : ''}</div>
      <div class="sm mut">⚠️ Honest limitation: web apps can't yet schedule reliable alarms on Android. Reminders fire while Grug Fit (or Chrome) is open or recently used in the background; if Android has closed the app, a reminder may be late or not appear. Notification Triggers would fix this but aren't broadly available in Chrome. For critical medications, also set a phone alarm. Opening the app always shows what's due.</div>
      <button class="btn sm" disabled={perm !== 'granted'} onClick={async () => { const r = await navigator.serviceWorker.ready; r.showNotification('Grug Fit test', { body: 'Notifications are working ✅', icon: 'icon-192.png' }); }}>Send test notification</button></div>
    <h2>Import data</h2>
    <ImportSection />
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

function CoachSettings() {
  const [s0, setS0] = useState<Settings | null>(null); useEffect(() => { getSettings().then(setS0); }, []);
  const q = useQuota(); const [key, setKey] = useState(''); const [tok, setTok] = useState(''); const [showKey, setShowKey] = useState(false);
  useEffect(() => { if (s0) { setKey(s0.coachKey || ''); setTok(s0.coachOwnerToken || ''); } }, [s0]);
  if (!s0) return <div class="card mut sm">Loading…</div>;
  const commit = async (p: Partial<Settings>, msg: string) => { const cur = await getSettings(); const n = { ...cur, ...p }; await put('kv', n); setS0(n); toast(msg); fetchStatus(); };
  const mode = coachMode({ ...s0, coachKey: key || undefined });
  return <div class="card col" data-testid="coach-settings">
    <div class="sm">Status: <b data-testid="coach-mode">{mode === 'own' ? 'Using your own xAI key' : mode === 'proxy' ? 'Using the Grug Fit coach service' : 'Coach is being set up'}</b>{mode === 'proxy' && q && <> · <span data-testid="coach-remaining">{quotaText(q)}</span></>}</div>
    <label class="f">Use my own xAI API key (optional)<div class="row"><input type={(showKey ? 'text' : 'password') as any} autocomplete="off" spellcheck={false} value={key} placeholder="xai-…" data-testid="coach-key" onInput={(e) => setKey(e.currentTarget.value.trim())} />
      <button class="btn sm" type="button" onClick={() => setShowKey(!showKey)}>{showKey ? 'Hide' : 'Show'}</button></div></label>
    <div class="grid2"><button class="btn sm p" data-testid="coach-key-save" onClick={() => commit({ coachKey: key || undefined }, key ? 'xAI key saved on this device' : 'Own key cleared')}>Save key</button>{s0.coachKey && <button class="btn sm" onClick={() => { setKey(''); commit({ coachKey: undefined }, 'Own key cleared'); }}>Remove key</button>}</div>
    <div class="mut xs">With your own key the app calls api.x.ai directly from this device (no daily cap; usage billed to your xAI account). The key is stored only on this device and is left out of backups.</div>
    <label class="f">Owner token (optional)<input type="password" autocomplete="off" value={tok} data-testid="coach-owner" onInput={(e) => setTok(e.currentTarget.value.trim())} placeholder="Only for the app owner" /></label>
    <button class="btn sm" data-testid="coach-owner-save" onClick={() => commit({ coachOwnerToken: tok || undefined }, tok ? 'Owner token saved' : 'Owner token cleared')}>Save owner token</button>
    <div class="mut xs">The coach sends a summary of your logs (profile, targets, 14 days of nutrition totals, recent workouts, PRs, body weight, supplements and adherence) with each message. Chat history stays on this device; clear it from the Coach tab.</div>
    {s0.coachConsent && <button class="btn g sm" onClick={() => commit({ coachConsent: undefined }, 'Privacy notice will show again')}>Show the privacy notice again</button>}
  </div>;
}
