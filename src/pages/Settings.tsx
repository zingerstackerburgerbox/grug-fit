import { useQuota, quotaText } from './Coach';
import { UsernameSetting } from './Username';
import { LeaderboardSetting } from './Leaderboard';
import { leaveBoard } from '../leaderboard';
import { StepGoalSetting } from './Steps';
import { coachMode, fetchStatus, removeAdmin, unlockAdmin } from '../coach';
import { DEFAULT_WORKOUT_GOAL } from '../stars';
import { useEffect, useRef, useState } from 'preact/hooks';
import { SCALED, scaleMacros } from '../targets';
import { clearAll, exportAll, importAll, getSettings, put } from '../db';
import { useSettings } from '../hooks';
import type { Settings } from '../types';
import { NumInput, Seg, Top, confirmDo, num, toast } from '../ui';
import { DEFAULT_SETTINGS, MICROS, fmtDate, fmtTime, r1, ymd } from '../util';
import { APP_VERSION, BUILD_ID, BUILD_TIME } from '../update';
import { scheduleReminders } from '../doses';
import { KCAL_EXPLAIN } from '../setKcal';
import { ImportSection } from './Import';
import { InstallSetting } from './Install';
import { InviteRow } from './Invite';
import { StorageCard } from './Private';
import { ensurePack, loadPackStatus, packStatus, type PackStatus } from '../offpack';
import { AppearanceSettings } from './Appearance';
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
  useEffect(() => { const v: any = {}; for (const k in s.targets) v[k] = String((s.targets as any)[k]); setT(v); }, [s]);
  const save = async (p: Partial<Settings>) => { await put('kv', { ...s, ...p }); };
  const saveTargets = async () => { const targets: any = { ...s.targets }; for (const k in t) { const v = num(t[k]); if (v != null) targets[k] = v; } await save({ targets }); toast('Targets saved'); };
  const doExport = async () => {
    const data = await exportAll(); const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const name = `lunk-backup-${ymd()}.json`; const file = new File([blob], name, { type: 'application/json' });
    if ((navigator as any).canShare?.({ files: [file] }) && confirmDo('Share the backup file (e.g. to Google Drive)? Cancel to download instead.')) { try { await navigator.share({ files: [file], title: name }); localStorage.setItem('lastBackup', String(Date.now())); return; } catch {} }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    localStorage.setItem('lastBackup', String(Date.now())); toast('Backup downloaded');
  };
  const doImport = (mode: 'replace' | 'merge') => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; try { const j = JSON.parse(await f.text()); if (mode === 'replace' && !confirmDo('Replace ALL current data with this backup?')) return; await importAll(j, mode); toast('Backup restored'); scheduleReminders(); } catch (e: any) { alert('Import failed: ' + e.message); } };
    inp.click();
  };
  // calorie edits scale protein/carbs/fat live from the values before this calorie edit; editing a macro resets that base
  const base = useRef<Record<string, number | null> | null>(null);
  const onField = (k: string, v: string) => {
    if (k === 'kcal') {
      base.current ||= { kcal: num(t.kcal || ''), protein: num(t.protein || ''), carbs: num(t.carbs || ''), fat: num(t.fat || '') };
      const sc = scaleMacros(base.current as any, num(v)); const nt = { ...t, kcal: v }; for (const m of SCALED) if (sc[m] != null) nt[m] = String(sc[m]); setT(nt); return;
    }
    if ((SCALED as readonly string[]).includes(k)) base.current = null;
    setT({ ...t, [k]: v });
  };
  useEffect(() => { base.current = null; }, [s]);
  const field = (k: string, label: string) => <label class="f">{label}<input inputMode="decimal" value={t[k] ?? ''} data-testid={'target-' + k} onInput={(e) => onField(k, e.currentTarget.value)} /></label>;
  return <><Top title="Settings" /><div class="page col">
    <InviteRow />
    <InstallSetting />
    <h2>Appearance</h2>
    <AppearanceSettings />
    <h2>Profile & calorie burn</h2>
    <UsernameSetting />
    <ProfileCard s={s} />
    <h2>Daily targets</h2>
    <div class="card col"><div class="grid2">{field('kcal', 'Energy (kcal)')}{field('protein', 'Protein (g)')}{field('carbs', 'Net carbs (g)')}{field('fat', 'Fat (g)')}{field('fibre', 'Fibre (g)')}</div>
      <details><summary class="b sm">Micronutrient targets</summary><div class="grid2" style="margin-top:10px">{MICROS.map((m) => field(m.key, `${m.label} (${m.unit})`))}</div></details>
      <div class="mut xs">Changing calories scales protein, carbs and fat to keep their ratio (fibre stays); editing a macro changes only that macro.</div>
      <div class="mut xs" data-testid="macro-split">Macro split: P {r1(((num(t.protein || '') || 0) * 4 / (num(t.kcal || '') || 1)) * 100)}% · C {r1(((num(t.carbs || '') || 0) * 4 / (num(t.kcal || '') || 1)) * 100)}% · F {r1(((num(t.fat || '') || 0) * 9 / (num(t.kcal || '') || 1)) * 100)}%</div>
      <div class="grid2"><button class="btn" onClick={() => { if (confirmDo('Reset targets to defaults (1800 kcal, P 157.5, C 202.5, F 40)?')) save({ targets: DEFAULT_SETTINGS.targets }); }}>Reset defaults</button><button class="btn p" onClick={saveTargets}>Save targets</button></div></div>
    <h2>Steps</h2>
    <StepGoalSetting />
    <h2>Training leaderboard</h2>
    <LeaderboardSetting />
    <h2>Units & workout</h2>
    <div class="card col"><label class="f">Energy<Seg value={s.energyUnit} onChange={(energyUnit) => save({ energyUnit })} options={[['kcal', 'kcal'], ['kJ', 'kJ']]} /></label>
      <label class="f">Lifting weight<Seg value={s.weightUnit} onChange={(weightUnit) => save({ weightUnit })} options={[['kg', 'kg'], ['lb', 'lb']]} /></label>
      <label class="f">Workouts per week goal<NumInput int value={s.workoutGoal ?? DEFAULT_WORKOUT_GOAL} data-testid="workout-goal" onValue={(n) => n != null && n >= 1 && n <= 7 && save({ workoutGoal: Math.round(n) })} /></label>
      <div class="mut xs" style="margin-top:-6px">Used for your Training stars and Grug's Review (1–7).</div>
      <label class="f">Default rest timer (seconds)<NumInput int value={s.defaultRest} onValue={(n) => n != null && save({ defaultRest: n })} data-testid="default-rest" /></label>
      <div class="chips" style="margin-top:-6px" data-testid="rest-chips">{[60, 90, 120, 150, 180, 240].map((v) => <button class={'chip ' + (s.defaultRest === v ? 'on' : '')} onClick={() => save({ defaultRest: v })}>{v % 60 ? `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}` : `${v / 60} min`}</button>)}</div>
      <div class="mut xs" style="margin-top:-6px">Starts when you tick a set in a workout; change it per exercise from the exercise ⋮ menu.</div>
      <label class="row sm"><input type="checkbox" style="width:24px;min-height:24px" checked={s.vibrate} onChange={(e) => { save({ vibrate: e.currentTarget.checked }); localStorage.setItem('vibrate', e.currentTarget.checked ? '1' : '0'); }} /> Vibrate on set complete & rest end</label>
      <label class="row sm"><input type="checkbox" style="width:24px;min-height:24px" data-testid="fact-setting" checked={(s.factCard || 'open') !== 'off'} onChange={(e) => save({ factCard: e.currentTarget.checked ? 'open' : 'off' })} /> Show “Fitness fact of the day” on Home</label>
      <div class="mut xs">Dates are shown as DD/MM/YYYY. Food quantities in grams.</div></div>
    <h2>Food lookup</h2>
    <div class="card col"><OfflinePackLine /></div>
    <h2>Coach</h2>
    <CoachSettings />
    <h2>Dose reminders</h2>
    <div class="card col"><label class="row sm"><input type="checkbox" style="width:24px;min-height:24px" checked={s.reminders} onChange={async (e) => { const on = e.currentTarget.checked; if (on && typeof Notification !== 'undefined' && Notification.permission !== 'granted') setPerm(await Notification.requestPermission()); await save({ reminders: on }); setTimeout(scheduleReminders, 50); }} /> Enable reminder notifications</label>
      <div class="mut xs">Permission: {perm}. {'TimestampTrigger' in window ? 'This browser supports Notification Triggers, so reminders are scheduled with the system.' : ''}</div>
      <div class="sm mut">⚠️ Honest limitation: web apps can't yet schedule reliable alarms on Android. Reminders fire while Lunk (or Chrome) is open or recently used in the background; if Android has closed the app, a reminder may be late or not appear. Notification Triggers would fix this but aren't broadly available in Chrome. For critical medications, also set a phone alarm. Opening the app always shows what's due.</div>
      <button class="btn sm" disabled={perm !== 'granted'} onClick={async () => { const r = await navigator.serviceWorker.ready; r.showNotification('Lunk test', { body: 'Notifications are working ✅', icon: 'icon-192.png' }); }}>Send test notification</button></div>
    <h2>Import data</h2>
    <ImportSection />
    <h2>Backup (important!)</h2>
    <StorageCard />
    <div class="card col"><div class="sm mut">All data lives only on this device in the browser's storage. Uninstalling the app or clearing Chrome site data deletes it. Export a backup regularly.</div>
      <button class="btn p" onClick={doExport}>⬇ Export all data (JSON)</button>
      <div class="grid2"><button class="btn" onClick={() => doImport('replace')}>Import (replace)</button><button class="btn" onClick={() => doImport('merge')}>Import (merge)</button></div>
      <div class="mut xs">Last backup: {localStorage.getItem('lastBackup') ? new Date(+localStorage.getItem('lastBackup')!).toLocaleString('en-AU') : 'never'}</div></div>
    <h2>Danger zone</h2>
    <button class="btn d" onClick={async () => { if (confirmDo('Delete ALL data (workouts, diary, supplements, settings)? This cannot be undone.') && confirmDo('Really? Export a backup first if unsure.')) { if ((await getSettings()).lbJoin) await leaveBoard(); await clearAll(); localStorage.removeItem('rest'); toast('All data cleared'); } }}>Clear all data</button>
    <h2>About</h2>
    <div class="card col" data-testid="about"><div class="row between"><b>Lunk v<span data-testid="app-version">{APP_VERSION}</span></b><span class="mut sm">built {fmtDate(new Date(BUILD_TIME))} {fmtTime(+new Date(BUILD_TIME))}</span></div>
      <div class="xs" data-testid="whats-new">New in v1.17: every vitamin, mineral and common supplement compound in Doses with % of the Australian daily reference and upper-level warnings, plus Photo of label (an automated read of the supplement facts panel). v1.16: scan a supplement barcode when adding a dose (name, brand, serving and key ingredients filled in for you). v1.15: Invite friends (Settings › Invite friends) with a share link and QR code. v1.14: Hevy-style set editing. Swipe a set right to delete it (with Undo), + Add set and + Add exercise when editing a past workout, and a ⋮ menu to reorder, remove or add a note. v1.13: about 30,000 Australian products kept on this device for instant scans.</div>
      <div class="mut xs">Build <span data-testid="build-id">{BUILD_ID}</span> · updates install automatically (checked on launch, when you return to the app, and every 30 min). Your data stays on the device across updates.</div>
      <button class="btn sm" onClick={async () => { const r = await navigator.serviceWorker?.getRegistration(); if (!r) { toast('Updates unavailable (no service worker)'); return; } await r.update().catch(() => {}); toast(r.installing || r.waiting ? 'Update found – installing…' : 'You have the latest version'); }}>Check for updates</button></div>
      <button class="btn sm" data-testid="ocr-offline" onClick={async () => { toast('Downloading label scanner (~6 MB)…'); try { const m = await import('../ocr/ocr'); await m.prefetchOcr(); toast('Label scanning is ready offline'); } catch (e: any) { toast('Download failed: ' + (e?.message || e)); } }}>📷 Make label scanning available offline</button>
    <AdminCode />
    <div class="mut xs center" style="margin-top:10px" data-testid="off-credit">Food data from <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a>, <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener">ODbL</a><PackDate /></div>
  </div></>;
}

function CoachSettings() {
  const [s0, setS0] = useState<Settings | null>(null); useEffect(() => { getSettings().then(setS0); }, []);
  const q = useQuota();
  if (!s0) return <div class="card mut sm">Loading…</div>;
  const commit = async (p: Partial<Settings>, msg: string) => { const cur = await getSettings(); const n = { ...cur, ...p }; await put('kv', n); setS0(n); toast(msg); fetchStatus(); };
  const mode = coachMode(s0);
  const keyStatus = s0.coachKey ? 'Using your own key' : s0.usdaKey ? 'USDA key set' : 'Not set';
  return <div class="card col" data-testid="coach-settings">
    <div class="sm">Status: <b data-testid="coach-mode">{mode === 'own' ? 'Using your own xAI key' : mode === 'proxy' ? 'Using the Lunk coach service' : 'Coach is being set up'}</b>{mode === 'proxy' && q && <> · <span data-testid="coach-remaining">{quotaText(q)}</span></>}</div>
    <div class="mut xs">The coach sends a summary of your logs (profile, targets, 14 days of nutrition totals, recent workouts, PRs, body weight, supplements and adherence) with each message. Chat history stays on this device; clear it from the Coach tab.</div>
    {s0.coachConsent && <button class="btn g sm" onClick={() => commit({ coachConsent: undefined }, 'Privacy notice will show again')}>Show the privacy notice again</button>}
    <a class="btn g sm row between" style="justify-content:space-between" href="#/settings/keys" data-testid="api-key-row"><span>API key</span><span class="mut">{<span data-testid="api-key-status">{keyStatus}</span>} ›</span></a>
  </div>;
}

/** v1.13.1: everything about using your own keys lives on its own screen (Settings › Coach › API key). Behaviour unchanged. */
export function ApiKeysPage() {
  const [s0, setS0] = useState<Settings | null>(null); const [key, setKey] = useState(''); const [tok, setTok] = useState(''); const [showKey, setShowKey] = useState(false);
  // fill the fields in the same update that shows them, so typing right after the screen opens is never overwritten by the load
  useEffect(() => { getSettings().then((x) => { setKey(x.coachKey || ''); setTok(x.coachOwnerToken || ''); setS0(x); }); }, []);
  const commit = async (p: Partial<Settings>, msg: string) => { const cur = await getSettings(); const n = { ...cur, ...p }; await put('kv', n); setS0(n); toast(msg); fetchStatus(); };
  return <><Top title="API key" backBtn /><div class="page" data-testid="api-keys-page">
    {!s0 ? <div class="card mut sm">Loading…</div> : <>
      <h2>Coach (xAI)</h2>
      <div class="card col" data-testid="coach-key-box">
        <div class="sm">Status: <b data-testid="coach-key-mode">{s0.coachKey ? 'Using your own xAI key' : 'Using the Lunk coach service'}</b></div>
        <label class="f">Use my own xAI API key (optional)<div class="row"><input type={(showKey ? 'text' : 'password') as any} autocomplete="off" spellcheck={false} value={key} placeholder="xai-…" data-testid="coach-key" onInput={(e) => setKey(e.currentTarget.value.trim())} />
          <button class="btn sm" type="button" onClick={() => setShowKey(!showKey)}>{showKey ? 'Hide' : 'Show'}</button></div></label>
        <div class="grid2"><button class="btn sm p" data-testid="coach-key-save" onClick={() => commit({ coachKey: key || undefined }, key ? 'xAI key saved on this device' : 'Own key cleared')}>Save key</button>{s0.coachKey && <button class="btn sm" onClick={() => { setKey(''); commit({ coachKey: undefined }, 'Own key cleared'); }}>Remove key</button>}</div>
        <div class="mut xs">With your own key the app calls api.x.ai directly from this device (no daily cap; usage billed to your xAI account). The key is stored only on this device and is left out of backups.</div>
        <label class="f">Owner token (optional)<input type="password" autocomplete="off" value={tok} data-testid="coach-owner" onInput={(e) => setTok(e.currentTarget.value.trim())} placeholder="Only for the app owner" /></label>
        <button class="btn sm" data-testid="coach-owner-save" onClick={() => commit({ coachOwnerToken: tok || undefined }, tok ? 'Owner token saved' : 'Owner token cleared')}>Save owner token</button>
      </div>
      <h2>Food lookup (USDA)</h2>
      <div class="card col"><UsdaKeyField />
        <div class="mut xs">Barcodes Open Food Facts doesn't know are checked in USDA FoodData Central (US branded foods). The shared DEMO_KEY allows only ~30 lookups an hour; a <a href="https://fdc.nal.usda.gov/api-key-signup" target="_blank" rel="noopener">free personal key</a> raises that to 1,000.</div></div>
    </>}
  </div></>;
}

function AdminCode() {
  const s = useSettings(); const [code, setCode] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false); const [open, setOpen] = useState(false);
  if (s.adminToken) return <div class="card col" data-testid="admin-box"><div class="row between"><b class="sm" data-testid="admin-on">Admin: unlimited access ✓</b>
    <button class="btn sm" data-testid="admin-remove" disabled={busy} onClick={async () => { if (!confirmDo('Remove admin access from this device?')) return; setBusy(true); await removeAdmin(); setBusy(false); setMsg(''); toast('Admin access removed'); }}>Remove</button></div>
    <div class="mut xs">Unlimited chat, Smart Estimates and reviews on this device.</div></div>;
  const submit = async (e?: Event) => { e?.preventDefault(); if (busy) return; setBusy(true); setMsg(''); const r = await unlockAdmin(code); setBusy(false);
    if (r.ok) { setCode(''); toast('Admin access unlocked'); } else setMsg(r.message); };
  return <div class="card col" data-testid="admin-box">{!open ? <button class="btn g sm" style="justify-content:flex-start" data-testid="admin-open" onClick={() => setOpen(true)}>Advanced · Admin code ›</button>
    : <form class="col" onSubmit={submit}><label class="f">Admin code<input type="password" autocomplete="off" autocapitalize="characters" spellcheck={false} value={code} data-testid="admin-code" onInput={(e) => { setCode(e.currentTarget.value); setMsg(''); }} /></label>
      <button class="btn sm p" type="submit" disabled={busy || !code.trim()} data-testid="admin-unlock">{busy ? 'Checking…' : 'Unlock'}</button>
      {msg && <div class="sm" style="color:var(--warn)" role="alert" data-testid="admin-msg">{msg}</div>}
      <div class="mut xs">Only for the app owner. The code is checked by the Lunk service and isn't stored on this phone.</div></form>}</div>;
}

const fmtPackDate = (d?: string) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
function usePack() {
  const [st, setSt] = useState<PackStatus>(packStatus());
  useEffect(() => { const on = (e: Event) => setSt({ ...(e as CustomEvent).detail }); addEventListener('lunk-offpack', on); loadPackStatus().then((x) => setSt({ ...x })).catch(() => null); return () => removeEventListener('lunk-offpack', on); }, []);
  return st;
}
function PackDate() { const st = usePack(); return st.date ? <> · offline pack data {fmtPackDate(st.date)}</> : null; }
/** v1.13.0: one quiet line about the on-device Australian food pack, with a refresh link. */
function OfflinePackLine() {
  const st = usePack();
  const txt = st.state === 'ready' ? `${st.count.toLocaleString('en-AU')} Australian products on this device · data ${fmtPackDate(st.date)}`
    : st.state === 'loading' ? `downloading… ${Math.round((st.done / (st.total || 16)) * 100)}%`
      : st.state === 'error' ? `couldn't download (${st.error || 'offline?'})` : 'not downloaded yet';
  return <div class="row between xs mut" data-testid="offpack-status" data-state={st.state}><span>Offline food pack: {txt}</span>
    {st.state !== 'loading' && <button class="btn sm" style="min-height:28px;padding:2px 10px" data-testid="offpack-refresh" onClick={() => { if (!navigator.onLine) { toast("You're offline"); return; } ensurePack(true).then((x) => toast(x.state === 'ready' ? 'Offline food pack is up to date' : 'Download failed – try again later')); }}>{st.state === 'ready' ? 'Refresh' : 'Download'}</button>}</div>;
}
