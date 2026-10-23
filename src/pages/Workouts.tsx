import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { WorkoutStepsCard } from './Steps';
import { all, del, get, put, reconcileNow } from '../db';
import { mergeExercise } from '../reconcile';
import { go, useLatest, useNow, useQuery, useSettings } from '../hooks';
import type { BodyWeight, Exercise, Routine, RoutineEx, SetType, Settings, WExercise, WSet, Workout } from '../types';
import { Bar, LineChart, NumInput, Seg, Sheet, Top, confirmDo, num, toast } from '../ui';
import { e1rm, fmtDate, fmtDM, fmtDur, fmtTime, r1, uid, vibrate, wDisp, wIn, ymd, WD } from '../util';
import { detectPRs, exerciseHistory, previousSets, workoutSetCount, workoutVolume } from '../workoutLogic';
import { CustomExerciseForm, ExerciseFilter, ExercisePicker, useExercises } from './ExercisePicker';
import { rest } from '../rest';
import { ExAnim, ExThumb } from '../exviz/ExViz';
import { weightAt, workoutKcal } from '../energy';
import { KCAL_EXPLAIN, setMode, workoutBreakdown } from '../setKcal';
import { checkStale } from '../autoend';

const useBW = () => useQuery(() => all<BodyWeight>('bodyweight'), [], []) as BodyWeight[];
const kgFor = (bws: BodyWeight[], w: Workout) => weightAt(bws, ymd(new Date(w.start)));
/** Calorie estimate card: per-set estimate (rest time not counted) + manual override (saved on the workout). */
function WorkoutKcalCard({ w, exs, onChange }: { w: Workout; exs: Map<string, Exercise>; onChange: (w: Workout) => void }) {
  const bws = useBW(); const kg = kgFor(bws, w); const est = workoutKcal({ ...w, kcalOverride: null }, kg, exs); const kcal = workoutKcal(w, kg, exs);
  const [ov, setOv] = useState<number | null>(w.kcalOverride ?? null);
  const upd = async (p: Partial<Workout>) => { const nw = { ...w, ...p }; await put('workouts', nw); onChange(nw); };
  const rows = workoutBreakdown(w, kg, exs).filter((x) => x.sets);
  return <div class="card col" style="margin-top:12px" data-testid="workout-kcal"><div class="row between"><b>🔥 Calories burned</b><b data-testid="workout-kcal-value">{kcal} kcal</b></div>
    {kg ? <div class="col" style="gap:2px" data-testid="kcal-breakdown">{rows.map((x) => <div class="row between xs mut"><span class="ell">{x.name} · {x.sets} set{x.sets === 1 ? '' : 's'}</span><span>{Math.round(x.kcal)} kcal</span></div>)}</div> : null}
    <div class="mut xs" data-testid="kcal-explain">{kg ? `${KCAL_EXPLAIN} Bodyweight ${r1(kg)} kg. Your resting burn is already in the daily total, so only the extra is added.` : 'Log your body weight to get an estimate.'}</div>
    <div class="row"><label class="f grow">Override (kcal, e.g. from a watch)<NumInput int value={ov} onValue={setOv} placeholder={String(est)} aria-label="Override calories" /></label>
      <button class="btn sm" style="align-self:flex-end" onClick={() => upd({ kcalOverride: ov })}>Save</button>{w.kcalOverride != null && <button class="btn g sm" style="align-self:flex-end" onClick={() => { setOv(null); upd({ kcalOverride: null }); }}>Use estimate</button>}</div>
  </div>;
}

/** "80 kg × 10", "60 s", "5 km · 30 min" */
const fmtSet = (st: WSet, ex: Exercise | undefined, s: Settings) => { const m = setMode(ex);
  if (m === 'hold') return `${st.kg ? `${wDisp(st.kg, s)} ${s.weightUnit} · ` : ''}${st.reps ?? '—'} s`;
  if (m === 'cardio') return `${st.km != null ? `${st.km} km · ` : ''}${st.reps ?? '—'} min`;
  return `${wDisp(st.kg, s) || 0} ${s.weightUnit} × ${st.reps ?? '—'}`; };
const exMap = (l: Exercise[]) => new Map(l.map((e) => [e.id, e]));
/** newest first (a workout with an unreadable date sorts last instead of breaking the order) */
const sortKey = (w: Workout) => (Number.isFinite(w.start) ? w.start : -Infinity);
export const useWorkouts = () => useQuery(() => all<Workout>('workouts').then((l) => l.filter((w) => w.end).sort((a, b) => sortKey(b) - sortKey(a) || 0)), [], []) as Workout[];
export const useActive = () => useQuery(() => get<{ id: string; w: Workout }>('kv', 'active').then((x) => x?.w || null), [], null);
const newSet = (p?: Partial<WSet>): WSet => ({ id: uid(), type: 'N', kg: null, reps: null, rpe: null, done: false, ...p });
const SRC_LABEL: Record<string, string> = { hevy: 'from Hevy', cronometer: 'from Cronometer' };
/** the only visible difference for imported workouts: a small grey tag (Settings › Import › Remove imported data still finds them) */
const SrcTag = ({ w }: { w: Workout }) => (w.importSource ? <span class="xs mut" data-testid="src-tag">{SRC_LABEL[w.importSource]}</span> : null);
const PR_LABEL: Record<string, string> = { '1rm': 'Est. 1RM', weight: 'Heaviest weight', volume: 'Best volume', reps: 'Most reps' };

export async function startWorkout(routine?: Routine) {
  const cur = await get('kv', 'active');
  if (cur && !confirmDo('A workout is already in progress. Discard it and start a new one?')) { go('/workout/active'); return; }
  const set = (await get<Settings>('kv', 'settings'))?.defaultRest ?? 90;
  const w: Workout = {
    id: uid(), name: routine?.name || 'Workout', start: Date.now(), lastActivityAt: Date.now(), routineId: routine?.id,
    exercises: (routine?.exercises || []).map((re) => ({ id: uid(), exerciseId: re.exerciseId, restSec: re.restSec || set, sets: Array.from({ length: Math.max(1, re.sets) }, () => newSet({ reps: re.reps ?? null, kg: re.kg ?? null })) }))
  };
  await put('kv', { id: 'active', w });
  go('/workout/active');
}

/** 'Repeat workout': same exercises, set types and last time's weight/reps prefilled (not ticked) – native and imported alike */
export async function repeatWorkout(src: Workout) {
  const cur = await get('kv', 'active');
  if (cur && !confirmDo('A workout is already in progress. Discard it and start a new one?')) { go('/workout/active'); return; }
  const w: Workout = { id: uid(), name: src.name, start: Date.now(), lastActivityAt: Date.now(), ...(src.routineId ? { routineId: src.routineId } : {}),
    exercises: src.exercises.map((e) => ({ id: uid(), exerciseId: e.exerciseId, restSec: e.restSec, sets: e.sets.filter((x) => x.done).map((x) => newSet({ type: x.type, kg: x.kg, reps: x.reps, ...(x.km != null ? { km: x.km } : {}) })) })).filter((e) => e.sets.length) };
  await put('kv', { id: 'active', w }); go('/workout/active');
}

export function WorkoutsHome() {
  const routines = (useQuery(() => all<Routine>('routines').then((l) => l.sort((a, b) => b.updated - a.updated)), [], []) || []) as Routine[];
  const exs = exMap(useExercises()); const active = useActive(); const ws = useWorkouts();
  // Opening the Workout tab (nav tap, launch, deep link) goes straight to a workout in progress; "Minimize" comes back here with ?list=1
  const listOnly = /[?&]list=1/.test(location.hash); const [checked, setChecked] = useState(listOnly);
  useEffect(() => { if (listOnly) { checkStale(); return; } checkStale().then(() => get<{ w: Workout | null }>('kv', 'active')).then((a) => { if (a?.w) location.replace('#/workout/active'); else setChecked(true); }); }, []);
  if (!checked) return <Top title="Workout" />;
  return <><Top title="Workout" />
    <div class="page">
      {active && <div class="card" style="border-color:var(--acc)"><div class="row between"><div><div class="b">{active.name} in progress</div><div class="mut sm">Started {fmtTime(active.start)}</div></div><a class="btn p" href="#/workout/active" data-testid="resume-active">Resume</a></div></div>}
      <button class="btn p full" onClick={() => startWorkout()}>+ Start empty workout</button>
      <div class="grid2" style="margin-top:10px">
        <a class="btn sm" href="#/exercises">Exercises</a><a class="btn sm" href="#/body">Body weight</a>
      </div>
      <div style="margin-top:10px"><WorkoutStepsCard /></div>
      <div class="row between"><h2>Routines</h2><a class="btn g sm" href="#/routine/new">+ New routine</a></div>
      {!routines.length && <div class="card empty">No routines yet. Create one (e.g. "Push Day") to start workouts quickly.</div>}
      {routines.map((r) => <div class="card">
        <div class="row between"><div class="grow"><div class="b">{r.name}</div><div class="mut sm ell">{r.exercises.map((e) => exs.get(e.exerciseId)?.name || '?').join(', ') || 'No exercises'}</div>
          {r.exercises.length > 0 && <div class="row" style="gap:4px;margin-top:6px;flex-wrap:wrap">{r.exercises.slice(0, 6).map((e) => <ExThumb ex={exs.get(e.exerciseId)} size={34} />)}</div>}</div>
          <a class="btn sm" href={`#/routine/${r.id}`}>Edit</a></div>
        <button class="btn b2 full" style="margin-top:10px" onClick={() => startWorkout(r)}>Start routine</button>
      </div>)}
      <WorkoutList ws={ws} exs={exs} />
    </div></>;
}

/** Link target for "see your workouts" (import summary, Home, old #/history links): the list on the Workout tab. */
export const WORKOUT_LIST = '#/workouts?list=1&at=all';
const PAGE = 20;
/** survives the trip to a workout's detail page and back: how many cards were rendered and where the list was scrolled to */
const listMem = { n: PAGE, y: 0, restore: false, anchor: '', off: 0 };

/** Every finished workout (native + imported), newest first, grouped by month. Cards are rendered in batches of 20 as you
 *  scroll (IntersectionObserver), and off-screen cards skip layout/paint (content-visibility), so hundreds stay smooth. */
export function WorkoutList({ ws, exs }: { ws: Workout[]; exs: Map<string, Exercise> }) {
  const [n, setN] = useState(listMem.restore ? Math.max(PAGE, listMem.n) : PAGE);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current; if (!el || n >= ws.length) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) setN((x) => Math.min(ws.length, x + PAGE)); }, { rootMargin: '1500px 0px' });
    io.observe(el); return () => io.disconnect();
  }, [n, ws.length]);
  useEffect(() => { listMem.n = n; }, [n]);
  useEffect(() => { const f = () => { listMem.y = scrollY; }; addEventListener('scroll', f, { passive: true }); return () => removeEventListener('scroll', f); }, []);
  useEffect(() => {
    if (!ws.length) return;
    if (listMem.restore) { // back from a workout: put the tapped card where it was on screen (card heights off-screen are estimates)
      listMem.restore = false; const y = listMem.y;
      const fix = () => { const el = document.querySelector(`a.card[href="#/history/${listMem.anchor}"]`); if (el) scrollTo(0, scrollY + el.getBoundingClientRect().top - listMem.off); else scrollTo(0, y); };
      setTimeout(() => { scrollTo(0, y); fix(); requestAnimationFrame(() => requestAnimationFrame(fix)); }, 30); setTimeout(fix, 300); // again once slow layouts settle
    }
    else if (/[?&]at=all/.test(location.hash)) setTimeout(() => document.getElementById('workout-list')?.scrollIntoView({ block: 'start' }), 30);
  }, [ws.length > 0]);
  const counts = useMemo(() => { const c = new Map<string, number>(); for (const w of ws) { const k = monthKey(w); c.set(k, (c.get(k) || 0) + 1); } return c; }, [ws]);
  if (!ws.length) return <><h2 id="workout-list">Workouts</h2><div class="card empty" data-testid="workout-list">No workouts yet. Start one above – finished workouts (and anything you import from Hevy) show up here.</div></>;
  const shown = ws.slice(0, n); const out: any[] = []; let cur = '';
  for (const w of shown) { const k = monthKey(w); if (k !== cur) { cur = k; out.push(<h3 class="month" data-testid="month">{k} <span class="mut sm">· {counts.get(k)} workout{counts.get(k) === 1 ? '' : 's'}</span></h3>); } out.push(<WorkoutCard w={w} exs={exs} />); }
  return <><h2 id="workout-list" style="scroll-margin-top:64px">Workouts <span class="mut sm">· {ws.length}</span></h2>
    <div class="wlist" data-testid="workout-list">{out}</div>
    {n < ws.length && <div ref={sentinel} class="mut sm" style="text-align:center;padding:16px" data-testid="list-more"><button class="btn sm" onClick={() => setN((x) => x + PAGE)}>Show more ({ws.length - n} older)</button></div>}</>;
}
const monthKey = (w: Workout) => (Number.isFinite(w.start) ? new Date(w.start).toLocaleString('en-AU', { month: 'long', year: 'numeric' }) : 'Unknown date');

export function WorkoutCard({ w, exs }: { w: Workout; exs: Map<string, Exercise> }) {
  const s = useSettings(); const bws = useQuery(() => all<BodyWeight>('bodyweight'), []) as BodyWeight[] | undefined; // undefined while loading: no '0 kcal' flash
  return <a class="card" style="display:block;color:inherit;text-decoration:none" href={`#/history/${w.id}`} onClick={(e) => { listMem.restore = true; listMem.anchor = w.id; listMem.off = (e.currentTarget as HTMLElement).getBoundingClientRect().top; }}>
    <div class="row between"><div class="b">{w.name}</div><div class="mut sm">{fmtDate(w.start)}</div></div>{w.importSource && <div style="margin-top:-2px"><SrcTag w={w} /></div>}
    <div class="row mut sm wrap" style="gap:14px;margin:6px 0"><span>⏱ {fmtDur((w.end || w.start) - w.start)}</span><span>🏋️ {Math.round(Number(wDisp(workoutVolume(w), s)))} {s.weightUnit}</span><span>{workoutSetCount(w)} set{workoutSetCount(w) === 1 ? '' : 's'}</span><span data-testid="card-kcal">🔥 {bws ? workoutKcal(w, kgFor(bws, w), exs) : '…'} kcal{w.kcalOverride != null ? '*' : ''}</span>{!!w.prs?.length && <span class="pill warn">🏆 {w.prs.length} PR</span>}{w.needsReview && <span class="pill info" data-testid="autoended-badge" title="Ended automatically after 2 h without activity — tap to review">⏹ Auto-ended</span>}</div>
    <div class="sm">{w.exercises.slice(0, 5).map((e) => <div class="row ell" style="gap:8px;margin-top:3px"><ExThumb ex={exs.get(e.exerciseId)} size={28} /><span class="ell">{e.sets.filter((x) => x.done).length} × {exs.get(e.exerciseId)?.name || 'Unknown'}</span></div>)}{w.exercises.length > 5 && <div class="mut">+{w.exercises.length - 5} more</div>}</div>
  </a>;
}

export function RoutineEdit({ id }: { id: string }) {
  const exs = exMap(useExercises()); const s = useSettings();
  const [r, setR, getR] = useLatest<Routine | null>(null); const [pick, setPick] = useState(false);
  useEffect(() => { if (id === 'new') setR({ id: uid(), name: '', exercises: [], updated: Date.now() }); else get<Routine>('routines', id).then((x) => setR(x || null)); }, [id]);
  if (!r) return <Top title="Routine" backBtn />;
  const upd = (i: number, p: Partial<RoutineEx>) => setR((r0) => r0 && { ...r0, exercises: r0.exercises.map((e, j) => (j === i ? { ...e, ...p } : e)) });
  const move = (i: number, d: number) => { const l = [...r.exercises]; const j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; setR({ ...r, exercises: l }); };
  const save = async () => { const r = getR()!; await put('routines', { ...r, name: r.name.trim() || 'Routine', updated: Date.now() }); toast('Routine saved'); go('/workouts'); };
  return <><Top title={id === 'new' ? 'New routine' : 'Edit routine'} backBtn right={<button class="btn p sm" onClick={save}>Save</button>} />
    <div class="page">
      <label class="f">Routine name<input value={r.name} placeholder="e.g. Push Day" onInput={(e) => setR({ ...r, name: e.currentTarget.value })} /></label>
      {r.exercises.map((e, i) => <div class="card" style="margin-top:10px">
        <div class="row between"><ExThumb ex={exs.get(e.exerciseId)} size={40} /><div class="b grow ell">{exs.get(e.exerciseId)?.name}</div>
          <button class="btn ic" onClick={() => move(i, -1)} aria-label="Move up">↑</button><button class="btn ic" onClick={() => move(i, 1)} aria-label="Move down">↓</button>
          <button class="btn ic" style="color:var(--bad)" onClick={() => setR({ ...r, exercises: r.exercises.filter((_, j) => j !== i) })} aria-label="Remove">✕</button></div>
        <div class="grid2" style="grid-template-columns:repeat(4,1fr);gap:6px">
          <label class="f">Sets<NumInput int value={e.sets} onValue={(n) => upd(i, { sets: Math.max(1, n || 1) })} /></label>
          <label class="f">Reps<NumInput int value={e.reps} onValue={(n) => upd(i, { reps: n ?? undefined })} /></label>
          <label class="f">{s.weightUnit}<NumInput value={e.kg != null ? wDisp(e.kg, s) : null} onValue={(v) => upd(i, { kg: v == null ? undefined : wIn(v, s) })} /></label>
          <label class="f">Rest s<NumInput int value={e.restSec} onValue={(n) => upd(i, { restSec: n || 0 })} /></label>
        </div></div>)}
      <button class="btn full" style="margin-top:12px" onClick={() => setPick(true)}>+ Add exercises</button>
      {id !== 'new' && <button class="btn d full" style="margin-top:24px" onClick={async () => { if (confirmDo('Delete this routine?')) { await del('routines', r.id); history.back(); } }}>Delete routine</button>}
      <ExercisePicker open={pick} onClose={() => setPick(false)} onAdd={(ids) => setR({ ...r, exercises: [...r.exercises, ...ids.map((x) => ({ exerciseId: x, sets: 3, restSec: s.defaultRest }))] })} />
    </div></>;
}

export function RestBar() {
  const [, f] = useState(0); useEffect(() => rest.sub(() => f((x) => x + 1)), []);
  const now = useNow(250); const st = rest.get();
  if (!st) return null; const left = Math.max(0, (st.end - now) / 1000);
  return <div class="rest" role="timer"><span class="mut sm">Rest</span><span class="t">{Math.floor(left / 60)}:{String(Math.ceil(left % 60) === 60 ? 0 : Math.floor(left % 60)).padStart(2, '0')}</span>
    <div style="width:80px"><Bar value={st.total - left} target={st.total} color="#0ea5e9" /></div>
    <button class="btn sm" onClick={() => rest.add(-15)}>−15</button><button class="btn sm" onClick={() => rest.add(15)}>+15</button><button class="btn sm b2" onClick={() => rest.stop()}>Skip</button></div>;
}

const TYPE_LABEL: Record<SetType, string> = { W: 'Warm-up', N: 'Normal', D: 'Drop set', F: 'Failure' };
export function ActiveWorkout() {
  const exList = useExercises(); const exs = exMap(exList); const s = useSettings(); const hist = useWorkouts();
  const [w, setW] = useState<Workout | null | undefined>(undefined);
  const [pick, setPick] = useState(false); const [setMenu, setSetMenu] = useState<{ ei: number; si: number } | null>(null);
  const [exMenu, setExMenu] = useState<number | null>(null); const [finish, setFinish] = useState(false); const [summary, setSummary] = useState<Workout | null>(null); const [demo, setDemo] = useState<string | null>(null);
  const now = useNow(1000); const bwsA = useBW(); const liveKg = weightAt(bwsA, ymd()); const restoring = useRef(true);
  useEffect(() => {
    checkStale().then(() => get<{ w: Workout }>('kv', 'active')).then((x) => { wRef.current = x?.w || null; setW(x?.w || null);
      const y = +(sessionStorage.getItem('activeScroll:' + x?.w?.id) || 0); if (!y) setTimeout(() => { restoring.current = false; }, 150);
      if (y) { restoring.current = true; let n = 0; const step = () => { window.scrollTo(0, y); if (Math.abs(window.scrollY - y) > 2 && ++n < 30) requestAnimationFrame(step); else setTimeout(() => { restoring.current = false; }, 150); }; requestAnimationFrame(step); } });
    const ended = () => { wRef.current = null; setW(null); rest.stop(); location.replace('#/workouts?list=1'); };
    addEventListener('grug-autoended', ended); return () => removeEventListener('grug-autoended', ended);
  }, []);
  useEffect(() => { // keep the scroll position so leaving and re-opening the workout lands where you were
    if (!w) return; const id = w.id; const f = () => { if (!restoring.current && location.hash.startsWith('#/workout/active')) sessionStorage.setItem('activeScroll:' + id, String(window.scrollY)); };
    addEventListener('scroll', f, { passive: true }); return () => removeEventListener('scroll', f);
  }, [w?.id]);
  const wRef = useRef<Workout | null | undefined>(undefined); wRef.current = wRef.current === undefined ? w : wRef.current;
  const cur = () => wRef.current as Workout;
  const save = (nw: Workout) => { if (!wRef.current) return; nw = { ...nw, lastActivityAt: Date.now() }; wRef.current = nw; setW(nw); put('kv', { id: 'active', w: nw }); };
  // all updates read the latest workout from the ref so rapid successive edits never clobber each other
  const updEx = (ei: number, p: Partial<WExercise> | ((e: WExercise) => Partial<WExercise>)) => { const c = cur(); if (!c) return; save({ ...c, exercises: c.exercises.map((e, i) => (i === ei ? { ...e, ...(typeof p === 'function' ? p(e) : p) } : e)) }); };
  const updSet = (ei: number, si: number, p: Partial<WSet>) => updEx(ei, (e) => ({ sets: e.sets.map((x, j) => (j === si ? { ...x, ...p } : x)) }));
  const prevMap = useMemo(() => new Map((w?.exercises || []).map((e) => [e.exerciseId, previousSets(hist, e.exerciseId)])), [hist, w?.exercises.length]);

  if (summary) return <WorkoutSummary w={summary} exs={exs} />;
  if (w === undefined) return <Top title="Workout" />;
  if (w === null) return <><Top title="Workout" backBtn /><div class="page empty">No workout in progress.<br /><br /><button class="btn p" onClick={() => startWorkout()}>Start empty workout</button></div></>;

  const doneSets = w.exercises.reduce((a, e) => a + e.sets.filter((x) => x.done).length, 0);
  const vol = w.exercises.reduce((a, e) => a + e.sets.filter((x) => x.done && x.type !== 'W').reduce((b, x) => b + (x.kg || 0) * (x.reps || 0), 0), 0);
  const toggleDone = (ei: number, si: number) => {
    const st = cur().exercises[ei].sets[si];
    if (!st.done) {
      const prev = prevMap.get(w.exercises[ei].exerciseId)?.[si];
      const p: Partial<WSet> = { done: true, doneAt: Date.now() };
      if (st.reps == null && prev?.reps) p.reps = prev.reps; // Hevy-style: tick fills from previous
      if (st.kg == null && prev?.kg != null) p.kg = prev.kg;
      if (st.reps == null && p.reps == null) { const m = setMode(exs.get(w.exercises[ei].exerciseId)); toast(m === 'hold' ? 'Enter seconds first' : m === 'cardio' ? 'Enter minutes first' : 'Enter reps first'); return; }
      if (st.km == null && prev?.km != null) p.km = prev.km;
      updSet(ei, si, p);
      if (s.vibrate) vibrate(40);
      if (w.exercises[ei].restSec > 0) rest.start(w.exercises[ei].restSec);
    } else updSet(ei, si, { done: false, doneAt: undefined });
  };
  const doFinish = async (dropIncomplete: boolean) => {
    const fw: Workout = { ...w, end: Date.now(), exercises: w.exercises.map((e) => ({ ...e, sets: dropIncomplete ? e.sets.filter((x) => x.done) : e.sets.map((x) => x) })).filter((e) => e.sets.length) };
    fw.prs = detectPRs(fw, hist);
    await put('workouts', fw); await put('kv', { id: 'active', w: null }); await del('kv', 'active'); rest.stop();
    setFinish(false); setSummary(fw);
  };
  return <><Top title={<input value={w.name} onInput={(e) => save({ ...cur(), name: e.currentTarget.value })} style="font-size:18px;font-weight:700;background:transparent;border:0;padding:0;min-height:40px" aria-label="Workout name" />} backBtn={() => go('/workouts?list=1')}
    right={<button class="btn p sm" onClick={() => setFinish(true)}>Finish</button>} />
    <div class="page">
      <div class="kpi"><div><span class="mut xs">Duration</span><b>{fmtDur(now - w.start)}</b></div><div><span class="mut xs">Volume</span><b>{Math.round(Number(wDisp(vol, s)))} {s.weightUnit}</b></div><div><span class="mut xs">Sets</span><b>{doneSets}</b></div><div><span class="mut xs">🔥 Est.</span><b data-testid="live-kcal">{workoutKcal(w, liveKg, exs)}</b></div></div>
      {w.exercises.map((e, ei) => {
        const ex = exs.get(e.exerciseId); const prev = prevMap.get(e.exerciseId) || []; const mode = setMode(ex);
        let n = 0;
        return <div class="card" style="margin-top:12px;padding:12px 8px">
          <div class="row between" style="padding:0 4px;gap:8px"><ExThumb ex={ex} size={44} onClick={() => setDemo(e.exerciseId)} /><a class="b grow ell" style="color:var(--acc2);text-decoration:none" href={`#/exercise/${e.exerciseId}`}>{ex?.name || 'Unknown exercise'}</a>
            <span class="pill">⏲ {e.restSec ? `${e.restSec}s` : 'off'}</span><button class="btn ic" aria-label="Exercise menu" onClick={() => setExMenu(ei)}>⋮</button></div>
          {e.notes != null && <input placeholder="Notes" value={e.notes} onInput={(x) => updEx(ei, { notes: x.currentTarget.value })} style="margin:4px 0 6px" />}
          <table class="sets"><thead><tr><th style="width:42px">Set</th><th>Previous</th><th style="width:20%">{mode === 'cardio' ? 'km' : s.weightUnit}</th><th style="width:16%">{mode === 'hold' ? 'Sec' : mode === 'cardio' ? 'Min' : 'Reps'}</th><th style="width:13%">RPE</th><th style="width:46px">✓</th></tr></thead>
            <tbody>{e.sets.map((st, si) => {
              const label = st.type === 'N' ? String(++n) : st.type; const pv = prev[si];
              return <tr class={st.done ? 'done' : ''}>
                <td><button class={'stype ' + st.type} onClick={() => setSetMenu({ ei, si })} aria-label={`Set ${label} type ${TYPE_LABEL[st.type]}`}>{label}</button></td>
                <td class="prev" onClick={() => pv && updSet(ei, si, { kg: pv.kg, reps: pv.reps })}>{pv ? `${pv.kg != null ? wDisp(pv.kg, s) : '—'} × ${pv.reps ?? '—'}` : '—'}</td>
                <td>{mode === 'cardio' ? <NumInput placeholder={pv?.km != null ? String(pv.km) : '0'} value={st.km ?? null} onValue={(v) => updSet(ei, si, { km: v })} aria-label="Distance km" />
                  : <NumInput placeholder={pv?.kg != null ? String(wDisp(pv.kg, s)) : '0'} value={st.kg != null ? wDisp(st.kg, s) : null} onValue={(v) => updSet(ei, si, { kg: v == null ? null : wIn(v, s) })} aria-label="Weight" />}</td>
                <td><NumInput int placeholder={pv?.reps != null ? String(pv.reps) : '0'} value={st.reps} onValue={(v) => updSet(ei, si, { reps: v })} aria-label={mode === 'hold' ? 'Seconds' : mode === 'cardio' ? 'Minutes' : 'Reps'} /></td>
                <td><NumInput placeholder="–" value={st.rpe} onValue={(v) => updSet(ei, si, { rpe: v == null ? null : Math.min(10, Math.max(1, v)) })} aria-label="RPE" /></td>
                <td><button class={'check ' + (st.done ? 'on' : '')} onClick={() => toggleDone(ei, si)} aria-label="Complete set">✓</button></td></tr>;
            })}</tbody></table>
          <button class="btn sm full" style="margin-top:8px" onClick={() => { const last = e.sets[e.sets.length - 1]; updEx(ei, { sets: [...e.sets, newSet({ kg: last?.kg ?? null, reps: last?.reps ?? null })] }); }}>+ Add set</button>
        </div>;
      })}
      <button class="btn b2 full" style="margin-top:14px" onClick={() => setPick(true)}>+ Add exercise</button>
      <button class="btn full" style="margin-top:24px" data-testid="minimize" onClick={() => go('/workouts?list=1')}>▾ Minimize — back to workouts (keeps running)</button>
      <button class="btn d full" style="margin-top:10px" onClick={async () => { if (confirmDo('Discard this workout? Logged sets will be lost.')) { await del('kv', 'active'); rest.stop(); go('/workouts?list=1'); } }}>Discard workout</button>
      <div style="height:60px" />
    </div>
    <ExercisePicker open={pick} onClose={() => setPick(false)} onAdd={(ids) => save({ ...cur(), exercises: [...w.exercises, ...ids.map((x) => ({ id: uid(), exerciseId: x, restSec: s.defaultRest, sets: [newSet()] }))] })} />
    <Sheet open={!!setMenu} onClose={() => setSetMenu(null)} title="Set type">
      {setMenu && <div class="col">{(['W', 'N', 'D', 'F'] as SetType[]).map((t) => <button class={'btn ' + (w.exercises[setMenu.ei]?.sets[setMenu.si]?.type === t ? 'b2' : '')} onClick={() => { updSet(setMenu.ei, setMenu.si, { type: t }); setSetMenu(null); }}><span class={'stype ' + t}>{t === 'N' ? '1' : t}</span> {TYPE_LABEL[t]}</button>)}
        <button class="btn d" onClick={() => { const e = w.exercises[setMenu.ei]; updEx(setMenu.ei, { sets: e.sets.filter((_, j) => j !== setMenu.si) }); setSetMenu(null); }}>Delete set</button></div>}
    </Sheet>
    <Sheet open={exMenu != null} onClose={() => setExMenu(null)} title={exMenu != null ? exs.get(w.exercises[exMenu]?.exerciseId)?.name : ''}>
      {exMenu != null && w.exercises[exMenu] && <div class="col">
        <label class="f">Rest timer (seconds, 0 = off)<div class="chips">{[0, 60, 90, 120, 180, 240].map((v) => <button class={'chip ' + (w.exercises[exMenu].restSec === v ? 'on' : '')} onClick={() => updEx(exMenu, { restSec: v })}>{v ? `${v}s` : 'Off'}</button>)}</div></label>
        <button class="btn" onClick={() => { updEx(exMenu, { notes: w.exercises[exMenu].notes ?? '' }); setExMenu(null); }}>Add note</button>
        <div class="grid2"><button class="btn" onClick={() => { const l = [...cur().exercises]; if (exMenu > 0) { [l[exMenu - 1], l[exMenu]] = [l[exMenu], l[exMenu - 1]]; save({ ...cur(), exercises: l }); } setExMenu(null); }}>Move up</button>
          <button class="btn" onClick={() => { const l = [...cur().exercises]; if (exMenu < l.length - 1) { [l[exMenu + 1], l[exMenu]] = [l[exMenu], l[exMenu + 1]]; save({ ...cur(), exercises: l }); } setExMenu(null); }}>Move down</button></div>
        <button class="btn d" onClick={() => { save({ ...cur(), exercises: cur().exercises.filter((_, j) => j !== exMenu) }); setExMenu(null); }}>Remove exercise</button></div>}
    </Sheet>
    <Sheet open={!!demo} onClose={() => setDemo(null)} title={demo ? exs.get(demo)?.name : ''}>
      {demo && <div class="col" data-testid="exdemo"><ExAnim ex={exs.get(demo)} size={260} /><div class="mut sm center">{exs.get(demo)?.muscle} · {exs.get(demo)?.equipment} · highlighted = main muscles</div></div>}
    </Sheet>
    <Sheet open={finish} onClose={() => setFinish(false)} title="Finish workout?">
      {(() => { const inc = w.exercises.reduce((a, e) => a + e.sets.filter((x) => !x.done).length, 0); return <div class="col">
        <p class="mut" style="margin:0">{doneSets} completed set{doneSets === 1 ? '' : 's'}{inc ? `, ${inc} not ticked` : ''}.</p>
        {doneSets === 0 && <p class="sm" style="color:var(--warn);margin:0">No sets are ticked as complete — tick ✓ on sets you did.</p>}
        <button class="btn p" disabled={!doneSets} onClick={() => doFinish(true)}>{inc ? 'Finish (discard unticked sets)' : 'Finish & save'}</button>
        <button class="btn" onClick={() => setFinish(false)}>Keep going</button></div>; })()}
    </Sheet></>;
}

function WorkoutSummary({ w: w0, exs }: { w: Workout; exs: Map<string, Exercise> }) {
  const s = useSettings(); const [w, setW] = useState(w0);
  return <><Top title="Workout complete 🎉" /><div class="page">
    <div class="kpi"><div><span class="mut xs">Duration</span><b>{fmtDur((w.end || 0) - w.start)}</b></div><div><span class="mut xs">Volume</span><b>{Math.round(Number(wDisp(workoutVolume(w), s)))} {s.weightUnit}</b></div><div><span class="mut xs">Sets</span><b>{workoutSetCount(w)}</b></div></div>
    {!!w.prs?.length && <div class="card" style="margin-top:12px;border-color:var(--warn)"><h3>🏆 Personal records</h3>{w.prs.map((p) => <div class="row between sm"><span>{exs.get(p.exerciseId)?.name}</span><span class="pill warn">{PR_LABEL[p.kind]}: {p.kind === 'reps' ? p.value : `${wDisp(p.value, s)} ${s.weightUnit}`}</span></div>)}</div>}
    <WorkoutKcalCard w={w} exs={exs} onChange={setW} />
    <button class="btn p full" style="margin-top:12px" onClick={() => go(`/history/${w.id}`)}>View workout</button>
    <button class="btn full" style="margin-top:8px" onClick={async () => { await saveAsRoutine(w); }}>Save as routine</button>
    <button class="btn g full" style="margin-top:8px" onClick={() => go('/')}>Done</button>
  </div></>;
}
async function saveAsRoutine(w: Workout) {
  const name = prompt('Routine name', w.name); if (name == null) return;
  const r: Routine = { id: uid(), name: name || w.name, updated: Date.now(), exercises: w.exercises.map((e) => { const ws = e.sets.filter((x) => x.type !== 'W'); const last = ws[ws.length - 1]; return { exerciseId: e.exerciseId, sets: e.sets.length, reps: last?.reps ?? undefined, kg: last?.kg ?? undefined, restSec: e.restSec }; }) };
  await put('routines', r); toast('Saved as routine');
}

/** #/history (old bookmarks, links from older versions) → the list on the Workout tab */
export function HistoryRedirect() { useEffect(() => { location.replace(WORKOUT_LIST); }, []); return null; }

const pad2 = (n: number) => String(n).padStart(2, '0');
const toLocalInput = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const fromLocalInput = (v: string) => { const t = new Date(v).getTime(); return isNaN(t) ? null : t; };
export function WorkoutDetail({ id }: { id: string }) {
  const w0 = useQuery(() => get<Workout>('workouts', id), [id]); const exs = exMap(useExercises()); const s = useSettings(); const hist = useWorkouts();
  const [edit, setEdit] = useState(/[?&]edit=1/.test(location.hash)); const [d, setD] = useState<Workout | null>(null);
  useEffect(() => { if (edit && w0 && !d) setD(structuredClone(w0)); }, [edit, w0]);
  const w = edit && d ? d : w0;
  if (!w) return <Top title="Workout" backBtn />;
  const updSet = (ei: number, si: number, p: Partial<WSet>) => setD((o) => o && { ...o, exercises: o.exercises.map((e, i) => (i === ei ? { ...e, sets: e.sets.map((x, j) => (j === si ? { ...x, ...p } : x)) } : e)) });
  const saveEdit = async () => {
    if (!d) return; if (!d.end || d.end <= d.start) { toast('End time must be after the start time'); return; }
    const nw: Workout = { ...d, exercises: d.exercises.map((e) => ({ ...e, sets: e.sets.filter((x) => x.done || x.kg != null || x.reps != null) })).filter((e) => e.sets.length), needsReview: false };
    nw.prs = detectPRs(nw, hist); await put('workouts', nw); await reconcileNow(); toast('Workout updated');
    setEdit(false); setD(null); history.replaceState(null, '', `#/history/${id}`);
  };
  return <><Top title={edit ? 'Edit workout' : w.name} backBtn right={edit ? <button class="btn p sm" data-testid="save-workout" onClick={saveEdit}>Save</button> : <><button class="btn sm" data-testid="edit-workout" onClick={() => setEdit(true)}>Edit</button><button class="btn sm" onClick={() => saveAsRoutine(w)}>Save as routine</button></>} /><div class="page" data-editing={edit ? '1' : undefined}>
    {w.needsReview && !edit && <div class="card sm" data-testid="autoended-note" style="border-color:var(--acc2)">⏹ Ended automatically at the last completed set after 2 h without activity. <button class="btn g sm" onClick={async () => { await put('workouts', { ...w, needsReview: false }); toast('Marked as reviewed'); }}>Looks right</button></div>}
    {edit && d ? <div class="card col">
      <label class="f">Name<input value={d.name} onInput={(e) => setD({ ...d, name: e.currentTarget.value })} /></label>
      <div class="grid2"><label class="f">Start<input type="datetime-local" data-testid="edit-start" value={toLocalInput(d.start)} onInput={(e) => { const t = fromLocalInput(e.currentTarget.value); if (t) setD({ ...d, start: t }); }} /></label>
        <label class="f">End<input type="datetime-local" data-testid="edit-end" value={toLocalInput(d.end || d.start)} onInput={(e) => { const t = fromLocalInput(e.currentTarget.value); if (t) setD({ ...d, end: t }); }} /></label></div>
      <div class="mut xs">Duration {fmtDur(Math.max(0, (d.end || d.start) - d.start))} · calories come from the completed sets, not the duration.</div></div>
      : <div class="mut sm">{fmtDate(w.start)} · {fmtTime(w.start)}–{fmtTime(w.end || w.start)}{w.autoEnded ? ' · auto-ended' : ''}{w.importSource ? ' · ' : ''}<SrcTag w={w} /></div>}
    {!edit && w.notes && <div class="sm mut" style="margin-top:4px">{w.notes}</div>}
    <div class="kpi" style="margin-top:8px"><div><span class="mut xs">Duration</span><b data-testid="detail-duration">{fmtDur((w.end || 0) - w.start)}</b></div><div><span class="mut xs">Volume</span><b>{Math.round(Number(wDisp(workoutVolume(w), s)))} {s.weightUnit}</b></div><div><span class="mut xs">Sets</span><b>{workoutSetCount(w)}</b></div></div>
    {!edit && !!w.prs?.length && <div class="card" style="margin-top:12px;border-color:var(--warn)"><h3>🏆 Personal records</h3>{w.prs.map((p) => <div class="row between sm"><span>{exs.get(p.exerciseId)?.name}</span><span class="pill warn">{PR_LABEL[p.kind]}: {p.kind === 'reps' ? p.value : `${wDisp(p.value, s)} ${s.weightUnit}`}</span></div>)}</div>}
    {!edit && <WorkoutKcalCard key={String(w.end) + w.start + JSON.stringify(w.exercises)} w={w} exs={exs} onChange={() => {}} />}
    {w.exercises.map((e, ei) => { let n = 0; return <div class="card" style="margin-top:12px"><div class="row" style="gap:8px"><ExThumb ex={exs.get(e.exerciseId)} size={40} /><a class="b" style="color:var(--acc2);text-decoration:none" href={`#/exercise/${e.exerciseId}`}>{exs.get(e.exerciseId)?.name}</a></div>
      {e.notes && <div class="mut sm">{e.notes}</div>}
      {e.sets.map((st, si) => edit ? <div class="row sm" style="padding:4px 0;gap:6px"><span class={'stype ' + st.type} style="min-height:0">{st.type === 'N' ? ++n : st.type}</span>
          <NumInput style="width:70px" value={st.kg != null ? wDisp(st.kg, s) : null} onValue={(v) => updSet(ei, si, { kg: v == null ? null : wIn(v, s) })} aria-label="Weight" /><span class="mut">×</span>
          <NumInput int style="width:60px" value={st.reps} onValue={(v) => updSet(ei, si, { reps: v })} aria-label="Reps" />
          <button class={'check ' + (st.done ? 'on' : '')} onClick={() => updSet(ei, si, { done: !st.done })} aria-label="Completed">✓</button>
          <button class="btn ic" aria-label="Delete set" onClick={() => setD((o) => o && { ...o, exercises: o.exercises.map((x, i) => (i === ei ? { ...x, sets: x.sets.filter((_, j) => j !== si) } : x)) })}>✕</button></div>
        : <div class={'row between sm' + (st.done ? '' : ' unticked')} style="padding:4px 0"><span class={'stype ' + st.type} style="min-height:0">{st.type === 'N' ? ++n : st.type}</span><span class="grow">{fmtSet(st, exs.get(e.exerciseId), s)}{st.rpe ? ` @ RPE ${st.rpe}` : ''}{!st.done && <span class="pill" style="margin-left:6px">not ticked</span>}</span><span class="mut">{st.done ? `1RM ${r1(Number(wDisp(e1rm(st.kg || 0, st.reps || 0), s)))}` : ''}</span></div>)}</div>; })}
    {edit ? <button class="btn full" style="margin-top:20px" onClick={() => { setEdit(false); setD(null); history.replaceState(null, '', `#/history/${id}`); }}>Cancel editing</button>
      : <><button class="btn b2 full" style="margin-top:20px" data-testid="repeat-workout" onClick={() => repeatWorkout(w)}>↻ Repeat workout</button>
        <button class="btn d full" style="margin-top:10px" data-testid="delete-workout" onClick={async () => { if (confirmDo('Delete this workout from history?')) { await del('workouts', w.id); await reconcileNow(); history.back(); } }}>Delete workout</button></>}
  </div></>;
}

export function ExercisesPage() {
  const list = useExercises(); const [custom, setCustom] = useState(false);
  return <><Top title="Exercises" backBtn right={<button class="btn p sm" onClick={() => setCustom(true)}>+ Custom</button>} /><div class="page">
    <div class="mut sm" style="margin-bottom:8px">{list.length} exercises</div>
    <ExerciseFilter list={list} onPick={(e) => go(`/exercise/${e.id}`)} />
    <Sheet open={custom} onClose={() => setCustom(false)} title="New custom exercise"><CustomExerciseForm onSaved={() => setCustom(false)} /></Sheet>
  </div></>;
}

export function ExerciseDetail({ id }: { id: string }) {
  const ex = useQuery(() => get<Exercise>('exercises', id), [id]); const ws = useWorkouts(); const s = useSettings();
  const [metric, setMetric] = useState<'1rm' | 'kg' | 'vol'>('1rm'); const [edit, setEdit] = useState(false); const [merge, setMerge] = useState(false);
  const doMerge = async (toId: string) => {
    const to = await get<Exercise>('exercises', toId); if (!ex || !to || to.id === ex.id) return;
    if (!confirmDo(`Merge “${ex.name}” into “${to.name}”? All its sets (${h.length} workout${h.length === 1 ? '' : 's'}) and routines move to “${to.name}”, future imports of this name go there too, and “${ex.name}” is removed.`)) return;
    const c = await reconcileNow((d) => mergeExercise(d, ex.id, to.id)); setMerge(false); setEdit(false);
    toast(`Merged into ${to.name}${c.workouts.length ? ` · ${c.workouts.length} workouts updated` : ''}`); location.replace(`#/exercise/${to.id}`);
  };
  const h = useMemo(() => exerciseHistory(ws, id), [ws, id]);
  if (!ex) return <Top title="Exercise" backBtn />;
  const best = h.length ? { r: Math.max(...h.map((x) => x.best1rm)), k: Math.max(...h.map((x) => x.bestKg)), v: Math.max(...h.map((x) => x.volume)) } : null;
  const pts = h.map((x) => ({ x: x.date, y: Number(wDisp(metric === '1rm' ? x.best1rm : metric === 'kg' ? x.bestKg : x.volume, s)) }));
  return <><Top title={ex.name} backBtn right={ex.custom ? <button class="btn sm" onClick={() => setEdit(true)}>Edit</button> : undefined} /><div class="page">
    <div class="card" style="padding:8px"><ExAnim ex={ex} size={240} /><div class="mut xs center" style="margin-top:4px">{ex.muscle} · {ex.equipment} · <span style="color:#fb923c">■</span> main muscles</div></div>
    {ex.how && <div class="card sm" data-testid="ex-how" style="margin-top:10px;line-height:1.45"><b>How to</b><div style="margin-top:4px">{ex.how}</div></div>}
    {best && <div class="kpi" style="margin-top:10px"><div><span class="mut xs">Best est. 1RM</span><b>{r1(Number(wDisp(best.r, s)))}</b></div><div><span class="mut xs">Heaviest</span><b>{wDisp(best.k, s)}</b></div><div><span class="mut xs">Best volume</span><b>{Math.round(Number(wDisp(best.v, s)))}</b></div></div>}
    <div class="card" style="margin-top:12px"><Seg value={metric} onChange={setMetric} options={[['1rm', 'Est. 1RM'], ['kg', 'Best weight'], ['vol', 'Volume']]} />
      <div style="margin-top:10px"><LineChart points={pts} fmtX={(x) => fmtDM(x)} color={metric === 'vol' ? '#a78bfa' : '#22c55e'} /></div>
      <div class="mut xs center">{s.weightUnit} · est. 1RM uses the Epley formula; warm-up sets excluded</div></div>
    <h2>History</h2>
    {!h.length && <div class="empty">No completed sets yet for this exercise.</div>}
    {[...h].reverse().map((x) => <a class="card" style="display:block;color:inherit;text-decoration:none" href={`#/history/${x.workoutId}`}><div class="row between"><b>{fmtDate(x.date)}</b><span class="mut sm">1RM {r1(Number(wDisp(x.best1rm, s)))} {s.weightUnit}</span></div>
      <div class="sm mut">{x.sets.map((st) => `${st.type !== 'N' ? st.type + ' ' : ''}${wDisp(st.kg, s) || 0}×${st.reps}`).join('  ·  ')}</div></a>)}
    <Sheet open={edit} onClose={() => setEdit(false)} title="Edit exercise"><CustomExerciseForm initial={ex} onSaved={() => setEdit(false)} />
      <button class="btn full" style="margin-top:10px" data-testid="merge-exercise" onClick={() => setMerge(true)}>⇄ Merge into an existing exercise…</button>
      <div class="mut xs">For duplicates (e.g. an imported “{ex.name}” that is the same as a built-in exercise): history, charts and PRs combine.</div>
      <button class="btn d full" style="margin-top:10px" onClick={async () => { if (confirmDo('Delete this custom exercise? Past workouts keep their sets but show "Unknown".')) { await del('exercises', ex.id); history.back(); } }}>Delete exercise</button></Sheet>
    <ExercisePicker open={merge} onClose={() => setMerge(false)} onAdd={(ids) => { const t = ids.find((x) => x !== id); if (t) doMerge(t); }} />
  </div></>;
}

export function BodyWeightPage() {
  const s = useSettings();
  const list = (useQuery(() => all<BodyWeight>('bodyweight').then((l) => l.sort((a, b) => a.date.localeCompare(b.date))), [], []) || []) as BodyWeight[];
  const [date, setDate] = useState(ymd()); const [v, setV] = useState('');
  const add = async () => { const n = num(v); if (!n) return; await put('bodyweight', { id: 'bw' + date, date, kg: wIn(n, s) }); setV(''); toast('Body weight saved'); };
  const last = list[list.length - 1]; const first30 = list.find((x) => x.date >= ymd(new Date(Date.now() - 30 * 864e5)));
  return <><Top title="Body weight" backBtn /><div class="page">
    <div class="card"><div class="grid2"><label class="f">Date<input type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} /></label>
      <label class="f">Weight ({s.weightUnit})<input inputMode="decimal" value={v} placeholder={last ? String(wDisp(last.kg, s)) : ''} onInput={(e) => setV(e.currentTarget.value)} /></label></div>
      <button class="btn p full" style="margin-top:10px" onClick={add}>Log weight</button></div>
    {last && <div class="kpi"><div><span class="mut xs">Current</span><b>{wDisp(last.kg, s)}</b></div><div><span class="mut xs">30-day change</span><b>{first30 ? (last.kg - first30.kg >= 0 ? '+' : '') + wDisp(last.kg - first30.kg, s) : '—'}</b></div><div><span class="mut xs">Entries</span><b>{list.length}</b></div></div>}
    <div class="card" style="margin-top:12px"><LineChart points={list.map((x) => ({ x: +new Date(x.date), y: Number(wDisp(x.kg, s)) }))} fmtX={(x) => fmtDM(x)} fmtY={(y) => r1(y).toString()} color="#38bdf8" /></div>
    <div class="list">{[...list].reverse().map((x) => <div class="item"><span class="grow">{WD[new Date(x.date).getDay()]} {fmtDate(x.date)}</span><b>{wDisp(x.kg, s)} {s.weightUnit}</b><button class="btn ic" onClick={() => del('bodyweight', x.id)} aria-label="Delete">✕</button></div>)}</div>
  </div></>;
}
