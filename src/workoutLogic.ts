import type { Workout, WSet, PR } from './types';
import { e1rm, workingSets, setVolume } from './util';

export type ExStats = { date: number; workoutId: string; best1rm: number; bestKg: number; volume: number; bestReps: number; sets: WSet[] };
export function exerciseHistory(workouts: Workout[], exerciseId: string): ExStats[] {
  const out: ExStats[] = [];
  for (const w of workouts) {
    if (!w.end) continue;
    const sets = w.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets);
    const ws = workingSets(sets);
    if (!ws.length) continue;
    out.push({
      date: w.start, workoutId: w.id, sets: sets.filter((s) => s.done),
      best1rm: Math.max(...ws.map((s) => e1rm(s.kg || 0, s.reps || 0))), bestKg: Math.max(...ws.map((s) => s.kg || 0)),
      volume: ws.reduce((a, s) => a + setVolume(s), 0), bestReps: Math.max(...ws.map((s) => s.reps || 0))
    });
  }
  return out.sort((a, b) => a.date - b.date);
}
/** The previous completed sets for an exercise (most recent finished workout containing it), excluding `excludeId`. */
export function previousSets(workouts: Workout[], exerciseId: string, excludeId?: string): WSet[] {
  const ws = workouts.filter((w) => w.end && w.id !== excludeId).sort((a, b) => b.start - a.start);
  for (const w of ws) { const sets = w.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets).filter((s) => s.done); if (sets.length) return sets; }
  return [];
}
export function detectPRs(w: Workout, history: Workout[]): PR[] {
  const prior = history.filter((h) => h.end && h.id !== w.id && h.start < w.start);
  const prs: PR[] = [];
  const ids = [...new Set(w.exercises.map((e) => e.exerciseId))];
  for (const id of ids) {
    const prev = exerciseHistory(prior, id);
    const cur = exerciseHistory([{ ...w, end: w.end || Date.now() }], id)[0];
    if (!cur || !prev.length) continue; // first time isn't a "record"
    const p1 = Math.max(...prev.map((p) => p.best1rm)), pk = Math.max(...prev.map((p) => p.bestKg)), pv = Math.max(...prev.map((p) => p.volume));
    if (cur.best1rm > p1 + 0.01 && cur.bestKg > 0) prs.push({ exerciseId: id, kind: '1rm', value: cur.best1rm });
    if (cur.bestKg > pk + 0.01) prs.push({ exerciseId: id, kind: 'weight', value: cur.bestKg });
    if (cur.volume > pv + 0.01) prs.push({ exerciseId: id, kind: 'volume', value: cur.volume });
    if (pk === 0 && cur.bestKg === 0) { const pr = Math.max(...prev.map((p) => p.bestReps)); if (cur.bestReps > pr) prs.push({ exerciseId: id, kind: 'reps', value: cur.bestReps }); }
  }
  return prs;
}
export const workoutVolume = (w: Workout) => w.exercises.reduce((a, e) => a + workingSets(e.sets).reduce((b, s) => b + setVolume(s), 0), 0);
export const workoutSetCount = (w: Workout) => w.exercises.reduce((a, e) => a + e.sets.filter((s) => s.done).length, 0);
