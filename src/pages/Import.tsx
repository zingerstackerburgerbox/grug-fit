/** Settings › Import data: Hevy + Cronometer CSV import with tutorial, preview, dedupe and undo. All on-device. */
import { useRef, useState } from 'preact/hooks';
import { all, bump, db, getSettings } from '../db';
import { useQuery } from '../hooks';
import type { BodyWeight, DiaryEntry, Exercise, Routine, Workout } from '../types';
import { buildPlan, KIND_LABEL, type ImportSource, type Input, type Plan } from '../importer';
import { confirmDo, toast } from '../ui';
import { fmtDate } from '../util';

async function existing() {
  const [exercises, workouts, diary, bodyweight, s] = await Promise.all([all<Exercise>('exercises'), all<Workout>('workouts'), all<DiaryEntry>('diary'), all<BodyWeight>('bodyweight'), getSettings()]);
  return { exercises, workouts, diaryIds: new Set(diary.map((d) => d.id)), diaryCronDates: new Set(diary.filter((d) => d.importSource === 'cronometer' && !d.id.startsWith('cron-day-')).map((d) => d.date)), bodyweight, defaultRest: s.defaultRest };
}
export async function applyPlan(p: Plan) {
  const d = await db(); const tx = d.transaction(['exercises', 'workouts', 'diary', 'bodyweight'], 'readwrite');
  for (const e of p.exercises) tx.objectStore('exercises').put(e);
  for (const w of [...p.workouts, ...p.activities]) tx.objectStore('workouts').put(w);
  for (const e of p.diary) tx.objectStore('diary').put(e);
  for (const b of p.bodyweight) tx.objectStore('bodyweight').put(b);
  await tx.done; bump();
}
export async function importedCounts() {
  const [w, dI, b, e] = await Promise.all([all<Workout>('workouts'), all<DiaryEntry>('diary'), all<BodyWeight>('bodyweight'), all<Exercise>('exercises')]);
  const c = (src: ImportSource) => ({ workouts: w.filter((x) => x.importSource === src).length, diary: dI.filter((x) => x.importSource === src).length, weighIns: b.filter((x) => x.importSource === src).length, exercises: e.filter((x) => x.importSource === src).length });
  return { hevy: c('hevy'), cronometer: c('cronometer') };
}
/** Undo: delete everything tagged with the source. Imported custom exercises are kept if a remaining workout or routine still uses them. */
export async function removeImported(src: ImportSource) {
  const [ws, ds, bs, es, rs] = await Promise.all([all<Workout>('workouts'), all<DiaryEntry>('diary'), all<BodyWeight>('bodyweight'), all<Exercise>('exercises'), all<Routine>('routines')]);
  const keepW = ws.filter((w) => w.importSource !== src); const used = new Set([...keepW.flatMap((w) => w.exercises.map((e) => e.exerciseId)), ...rs.flatMap((r) => r.exercises.map((e) => e.exerciseId))]);
  const d = await db(); const tx = d.transaction(['exercises', 'workouts', 'diary', 'bodyweight'], 'readwrite'); let n = 0;
  for (const w of ws) if (w.importSource === src) { tx.objectStore('workouts').delete(w.id); n++; }
  for (const x of ds) if (x.importSource === src) { tx.objectStore('diary').delete(x.id); n++; }
  for (const x of bs) if (x.importSource === src) { tx.objectStore('bodyweight').delete(x.id); n++; }
  for (const x of es) if (x.importSource === src && !used.has(x.id)) { tx.objectStore('exercises').delete(x.id); n++; }
  await tx.done; bump(); return n;
}

const ACCEPT = '.csv,text/csv,text/comma-separated-values,application/csv,application/vnd.ms-excel,text/plain';
const pl = (v: number, k: string) => `${v} ${v === 1 ? k.replace(/ies$/, 'y').replace(/s$/, '') : k}`;
const fmtRange = (a?: string, b?: string) => (a ? (a === b ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b!)}`) : '');

export function ImportSection() {
  const inp = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Input[] | null>(null); const [plan, setPlan] = useState<Plan | null>(null);
  const [cronEx, setCronEx] = useState(false); const [busy, setBusy] = useState(false); const [done, setDone] = useState('');
  const counts = useQuery(importedCounts, [], null);
  const preview = async (fs: Input[], ce = cronEx) => { setPlan(buildPlan(fs, await existing(), { cronExercises: ce })); };
  const pick = async (list: FileList | null) => {
    if (!list?.length) return; setDone(''); setBusy(true);
    try { const fs = await Promise.all([...list].map(async (f) => ({ name: f.name, text: await f.text() }))); setFiles(fs); await preview(fs); }
    catch (e: any) { toast('Could not read the file: ' + (e?.message || e)); } finally { setBusy(false); if (inp.current) inp.current.value = ''; }
  };
  const doImport = async () => {
    if (!plan) return; setBusy(true);
    try {
      await applyPlan(plan);
      const parts = [plan.workouts.length && `${plan.workouts.length} workouts`, plan.diary.length && `${plan.diary.length} food entries`, plan.bodyweight.length && `${plan.bodyweight.length} weigh-ins`, plan.activities.length && `${plan.activities.length} activities`].filter(Boolean);
      setDone(parts.length ? `Imported ${parts.join(', ')}.` : 'Nothing new to import – everything in these files was already imported.'); toast('Import complete');
      setPlan(null); setFiles(null);
    } finally { setBusy(false); }
  };
  const total = plan ? plan.workouts.length + plan.diary.length + plan.bodyweight.length + plan.activities.length + plan.exercises.length : 0;
  const sk = plan?.skipped; const skipped = sk ? sk.workouts + sk.diary + sk.weighIns + sk.activities : 0;
  const hasCronEx = plan?.files.some((f) => f.kind === 'cron-exercises');
  return <div class="card col" data-testid="import-section">
    <div class="sm mut">Bring your history over from Hevy and Cronometer. Files are read on this phone only – nothing is uploaded.</div>
    <details class="tut" data-testid="tut-hevy"><summary class="b sm">How to export from Hevy</summary>
      <ol class="sm">
        <li>Open the <b>Hevy</b> app and go to the <b>Profile</b> tab.</li>
        <li>Tap <b>Settings</b> (⚙), then <b>Export &amp; Import Data</b>.</li>
        <li>Tap <b>Export Data</b>, then <b>Export Workouts</b>.</li>
        <li>Save the CSV to your phone (e.g. <b>Downloads</b> or Google Drive) from the share sheet.</li>
        <li>Then tap <b>Choose files</b> here.</li>
      </ol><div class="mut xs">Imports every logged set (weights in kg or lb, distance in km or miles, warm-up/drop/failure sets, RPE, notes). Menus may vary by app version.</div></details>
    <details class="tut" data-testid="tut-cron"><summary class="b sm">How to export from Cronometer</summary>
      <ol class="sm">
        <li>Open <b>cronometer.com</b> in your browser and log in (export isn't in the mobile app; Chrome on your phone works).</li>
        <li>Go to <b>More › Your Account</b> (or <b>Settings › Account</b>), scroll to <b>Account Data</b> and tap <b>Export Data</b>.</li>
        <li>Pick a date range (e.g. <b>All Time</b>) and tap <b>Export Food &amp; Recipe Entries</b> – that's your food diary.</li>
        <li>Optional: also <b>Export Biometrics</b> (weight), <b>Export Daily Nutrition</b> (daily totals) and <b>Export Exercises</b>.</li>
        <li>Then tap <b>Choose files</b> here – you can pick several files at once.</li>
      </ol><div class="mut xs">Menus may vary by app version.</div></details>
    <input ref={inp} type="file" multiple accept={ACCEPT} style="display:none" data-testid="import-input" onChange={(e) => pick(e.currentTarget.files)} />
    <button class="btn p" data-testid="import-choose" disabled={busy} onClick={() => inp.current?.click()}>📂 Choose files (CSV)</button>
    {done && <div class="sm" data-testid="import-done" style="color:var(--acc)">✅ {done}</div>}
    {plan && <div class="card col import-preview" data-testid="import-preview" data-editing="1" style="background:var(--bg);margin:0">
      <b>Preview</b>
      {plan.files.map((f) => <div class="sm" data-testid="import-file" data-kind={f.kind}>
        <div><span class={'pill ' + (f.kind === 'unknown' ? 'bad' : 'info')}>{KIND_LABEL[f.kind]}</span> <span class="mut xs ell">{f.name}</span></div>
        <div class="mut xs">{[fmtRange(f.from, f.to), ...Object.entries(f.counts).map(([k, v]) => pl(v, k)), f.note].filter(Boolean).join(' · ')}</div></div>)}
      <div class="grid2 sm" data-testid="import-totals">
        <span>🏋️ <b>{plan.workouts.length}</b> workouts</span><span>✔️ <b>{plan.sets}</b> sets</span>
        <span>🍽 <b>{plan.diary.length}</b> food entries</span><span>⚖️ <b>{plan.bodyweight.length}</b> weigh-ins</span>
        {hasCronEx && <span>🔥 <b>{plan.activities.length}</b> activities</span>}<span>🆕 <b>{plan.exercises.length}</b> new exercises</span></div>
      {!!plan.created.length && <div class="xs mut" data-testid="import-created"><b>New custom exercises:</b> {plan.created.join(', ')}</div>}
      {!!plan.matched.length && <details class="xs mut"><summary>Matched to existing exercises ({plan.matched.length})</summary>{plan.matched.join(', ')}</details>}
      {!!skipped && <div class="xs" data-testid="import-skipped" style="color:var(--warn)">Skipped – already in Grug Fit: {[sk!.workouts && pl(sk!.workouts, 'workouts'), sk!.diary && pl(sk!.diary, 'food entries'), sk!.weighIns && `${pl(sk!.weighIns, 'weigh-ins')} (that day already has a weight)`, sk!.activities && pl(sk!.activities, 'activities')].filter(Boolean).join(', ')}</div>}
      {!!sk?.days && <div class="xs mut">{sk.days} daily total(s) skipped because those days have individual food entries.</div>}
      {hasCronEx && <label class="row xs"><input type="checkbox" style="width:22px;min-height:22px" data-testid="import-cronex" checked={cronEx} onChange={async (e) => { const v = e.currentTarget.checked; setCronEx(v); if (files) await preview(files, v); }} /> Import Cronometer exercises as calorie-only activities (skip if you also logged these workouts in Hevy – they'd count twice)</label>}
      {plan.warnings.map((w) => <div class="xs" style="color:var(--warn)">{w}</div>)}
      <div class="mut xs">Workout calories are estimated from the sets with Grug Fit's per-set method; personal records are recalculated.</div>
      <div class="grid2"><button class="btn" onClick={() => { setPlan(null); setFiles(null); }}>Cancel</button>
        <button class="btn p" data-testid="import-go" disabled={busy || !total} onClick={doImport}>{total ? 'Import' : 'Nothing new'}</button></div>
    </div>}
    {counts && (['hevy', 'cronometer'] as ImportSource[]).map((src) => { const c = counts[src]; const n = c.workouts + c.diary + c.weighIns; if (!n) return null;
      return <button class="btn d sm" data-testid={`import-undo-${src}`} onClick={async () => { if (!confirmDo(`Remove all data imported from ${src === 'hevy' ? 'Hevy' : 'Cronometer'}? (${[c.workouts && `${c.workouts} workouts`, c.diary && `${c.diary} food entries`, c.weighIns && `${c.weighIns} weigh-ins`].filter(Boolean).join(', ')}) Things you logged in Grug Fit are not affected.`)) return; const k = await removeImported(src); setDone(''); toast(`Removed ${k} imported items`); }}>
        🗑 Remove imported {src === 'hevy' ? 'Hevy' : 'Cronometer'} data ({[c.workouts && `${c.workouts} workouts`, c.diary && `${c.diary} food`, c.weighIns && `${c.weighIns} weigh-ins`].filter(Boolean).join(', ')})</button>; })}
  </div>;
}
