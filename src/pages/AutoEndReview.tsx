import { useEffect, useState } from 'preact/hooks';
import { del, get, put } from '../db';
import { go, useNow, useQuery } from '../hooks';
import type { Workout } from '../types';
import { confirmDo, toast } from '../ui';
import { fmtDate, fmtTime } from '../util';
import { pendingReviews, resumeWorkout, RESUME_MS } from '../autoend';

const dur = (ms: number) => { const m = Math.round(ms / 60e3), h = Math.floor(m / 60); return h ? `${h} h ${m % 60} min` : `${m} min`; };
const when = (t: number) => { const d = new Date(t), n = new Date(); const same = d.toDateString() === n.toDateString(); const y = new Date(n); y.setDate(n.getDate() - 1);
  return same ? `today ${fmtTime(t)}` : d.toDateString() === y.toDateString() ? `yesterday ${fmtTime(t)}` : `${fmtDate(t)} ${fmtTime(t)}`; };

/** Review queue for auto-ended workouts: shown on app open, or straight away when one is auto-ended while the app is open. */
export function AutoEndReview() {
  const list = useQuery(pendingReviews, [], []) as Workout[]; const [skip, setSkip] = useState<string[]>([]); const now = useNow(30000);
  const activeW = useQuery(() => get<{ w: Workout | null }>('kv', 'active').then((a) => a?.w || null), [], null);
  const q = (list || []).filter((w) => !skip.includes(w.id)); const w = q[0];
  useEffect(() => { if (w) document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, [w?.id]);
  if (!w || !w.end) return null;
  const canResume = now - w.end < RESUME_MS && !activeW;
  const done = (id: string) => setSkip((s) => [...s, id]);
  return <div class="modal-bg" data-testid="autoend-modal" role="dialog" aria-modal="true" aria-labelledby="ae-h">
    <div class="modal col">
      <div class="row between"><b id="ae-h">⏹ Workout ended automatically</b>{q.length > 1 && <span class="pill">1 of {q.length}</span>}</div>
      <div class="sm" data-testid="autoend-text">Your workout <b>{w.name}</b> from {when(w.start)} was ended automatically at your last set ({fmtTime(w.end)}, {dur(w.end - w.start)}). Was it complete?</div>
      <div class="mut xs">No activity for 2 hours. Unticked sets were kept but don't count toward volume or PRs.</div>
      <button class="btn p" data-testid="ae-yes" onClick={async () => { await put('workouts', { ...w, needsReview: false }); done(w.id); toast('Saved to history'); }}>Yes, it was complete</button>
      {canResume && <button class="btn b2" data-testid="ae-resume" onClick={async () => { await resumeWorkout(w); done(w.id); go('/workout/active'); }}>Resume it</button>}
      {!canResume && now - w.end < RESUME_MS && <div class="mut xs">Resume isn't available while another workout is in progress.</div>}
      <button class="btn" data-testid="ae-edit" onClick={() => { done(w.id); go(`/history/${w.id}?edit=1`); }}>Edit it</button>
      <button class="btn d" data-testid="ae-discard" onClick={async () => { if (!confirmDo(`Discard "${w.name}" from ${when(w.start)}? Its sets will be deleted.`)) return; await del('workouts', w.id); done(w.id); toast('Workout discarded'); }}>Discard workout</button>
    </div></div>;
}

/** "Workout in progress · mm:ss" bar on every screen except the workout itself. */
export function WorkoutMiniBar({ hidden }: { hidden: boolean }) {
  const a = useQuery(() => get<{ w: Workout | null }>('kv', 'active').then((x) => x?.w || null), [], null); const now = useNow(1000);
  if (!a || hidden) return null;
  const sec = Math.max(0, Math.floor((now - a.start) / 1000)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const t = `${h ? h + ':' + String(m).padStart(2, '0') : m}:${String(s).padStart(2, '0')}`;
  return <a class="minibar" href="#/workout/active" data-testid="minibar"><span class="dot" />Workout in progress · <b>{t}</b><span class="grow ell mut sm">{a.name}</span><span>Open ›</span></a>;
}
