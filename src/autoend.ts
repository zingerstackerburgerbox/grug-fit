/** Auto-end stale workouts: a workout in progress with no edits for STALE_MS is ended at its last completed set and flagged for review. */
import { all, del, get, put } from './db';
import { rest } from './rest';
import type { Workout } from './types';
import { detectPRs } from './workoutLogic';

export const STALE_MS = 2 * 3600e3;
export const RESUME_MS = 12 * 3600e3;
const FUTURE_SLACK = 5 * 60e3; // tolerate small clock corrections

/** End time for an abandoned workout: last completed set, else last activity, else start — all clamped to [start, now]. */
export function autoEndTime(w: Workout, now = Date.now()): number {
  const ok = (t?: number) => t != null && t >= w.start && t <= now;
  const done = w.exercises.flatMap((e) => e.sets).filter((s) => s.done && ok(s.doneAt)).map((s) => s.doneAt!);
  if (done.length) return Math.max(...done);
  if (ok(w.lastActivityAt)) return w.lastActivityAt!;
  return w.start;
}
/** Pure: the finished workout. Unticked sets with weight/reps are kept (still unticked, so they don't count toward volume/PRs); empty ones dropped. */
export function autoEnd(w: Workout, history: Workout[], now = Date.now()): Workout {
  const end = autoEndTime(w, now);
  const exercises = w.exercises.map((e) => ({ ...e, sets: e.sets.filter((s) => s.done || s.kg != null || s.reps != null) })).filter((e) => e.sets.length);
  const fw: Workout = { ...w, exercises, end, autoEnded: true, needsReview: true, autoEndedAt: now };
  fw.prs = detectPRs(fw, history);
  return fw;
}
let running: Promise<Workout | null> | null = null;
/** Check the in-progress workout; returns the auto-ended workout if it fired. Safe to call often (launch, visible, tab open, timer). */
export function checkStale(now = Date.now()): Promise<Workout | null> {
  if (!running) running = (async () => {
    try {
      const a = await get<{ id: string; w: Workout | null }>('kv', 'active'); const w = a?.w; if (!w) return null;
      const la = w.lastActivityAt;
      // pre-1.6 workouts have no activity stamp, and a clock that jumped backwards puts it in the future: start the 2 h window now rather than guessing
      if (la == null || la > now + FUTURE_SLACK) { await put('kv', { id: 'active', w: { ...w, lastActivityAt: now } }); return null; }
      if (now - la < STALE_MS) return null;
      const hist = (await all<Workout>('workouts')).filter((h) => h.end);
      const fw = autoEnd(w, hist, now);
      await put('workouts', fw); await del('kv', 'active'); rest.stop();
      dispatchEvent(new CustomEvent('grug-autoended', { detail: fw.id }));
      return fw;
    } finally { running = null; }
  })();
  return running;
}
export const pendingReviews = async () => (await all<Workout>('workouts')).filter((w) => w.needsReview).sort((a, b) => a.start - b.start);
/** Reopen an auto-ended workout as the active one (same start time, end cleared). */
export async function resumeWorkout(w: Workout) {
  const { end, autoEnded, needsReview, autoEndedAt, prs, ...rest0 } = w;
  await put('kv', { id: 'active', w: { ...rest0, lastActivityAt: Date.now() } }); await del('workouts', w.id);
}
