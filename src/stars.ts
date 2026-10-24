/** v1.11.0 Home star ratings (computed on-device, instant, free). Pure functions: unit-tested in tests/stars-unit.mjs.
 *  100-point scores → stars: ≥90 5★, 75–89 4★, 60–74 3★, 40–59 2★, <40 1★.
 *  Training (last 7 days incl. today): consistency 40 (workouts vs weekly goal), progressive overload 30 (main lifts vs their
 *  best of the prior 4 weeks, by e1RM), volume balance 20 (~10 hard sets per group: chest/back/legs/shoulders/arms),
 *  daily movement 10 (avg logged steps vs goal).
 *  Nutrition (the 7 days up to yesterday – today is still being eaten): calories on target 35 (±10 % full, ±20 % half),
 *  protein 35 (days ≥90 % of target), logging 20 (days with ≥2 meals logged), supplements 10 (doses taken vs due).
 *  A metric that can't apply (no steps logged / no step goal, no supplements scheduled, no lift history to compare) is left out
 *  and its points are shared out proportionally ("redistributed"), so nobody is penalised for not using a feature.
 *  A cut/bulk is judged against the user's own calorie target like any other week. */
import type { DiaryEntry, Exercise, Settings, Workout } from './types';
import { addDays, e1rm, r0, workingSets, ymd } from './util';

export const DEFAULT_WORKOUT_GOAL = 3;
export const workoutGoal = (s: Pick<Settings, 'workoutGoal'>) => (s.workoutGoal && s.workoutGoal > 0 ? s.workoutGoal : DEFAULT_WORKOUT_GOAL);
export const starsFor = (score: number) => (score >= 90 ? 5 : score >= 75 ? 4 : score >= 60 ? 3 : score >= 40 ? 2 : 1);
export const GRUG_LINE: Record<number, string> = { 5: 'Grug proud. Strong like mammoth.', 1: 'Grug sad. Tomorrow new hunt.' };
export const GROUPS = ['chest', 'back', 'legs', 'shoulders', 'arms'] as const;
export type Group = typeof GROUPS[number];
export function groupOf(muscle: string): Group | null {
  const m = (muscle || '').toLowerCase();
  if (/chest|pec/.test(m)) return 'chest';
  if (/back|lat|trap/.test(m)) return 'back';
  if (/quad|hamstring|glute|calf|calves|leg|adductor|abductor/.test(m)) return 'legs';
  if (/shoulder|delt/.test(m)) return 'shoulders';
  if (/bicep|tricep|forearm|arm/.test(m)) return 'arms';
  return null;
}
export type Part = { key: string; label: string; max: number; pts: number; applicable: boolean; detail: string; tip: string };
export type Rating = { score: number; stars: number; parts: Part[]; weakest: Part | null };
export type StarInput = {
  today: string; diary: DiaryEntry[]; workouts: Workout[]; exercises: Map<string, Exercise> | Record<string, Exercise>;
  steps: Record<string, number>; settings: Pick<Settings, 'targets' | 'stepGoal' | 'workoutGoal'>;
  /** dose slots in the nutrition window that are past (status taken or missed) */ doseSlots: { date: string; taken: boolean }[];
};
export type Stars = { ready: boolean; historyDays: number; training: Rating; nutrition: Rating };

const exMap = (x: StarInput['exercises']) => (x instanceof Map ? x : new Map(Object.entries(x)));
const finish = (parts: Part[]): Rating => {
  const app = parts.filter((p) => p.applicable); const max = app.reduce((a, p) => a + p.max, 0);
  const score = max ? r0((app.reduce((a, p) => a + p.pts, 0) / max) * 100) : 0;
  const weakest = app.length ? [...app].sort((a, b) => a.pts / a.max - b.pts / b.max)[0] : null;
  return { score, stars: starsFor(score), parts: parts.map((p) => ({ ...p, pts: Math.round(p.pts * 10) / 10 })), weakest: weakest && weakest.pts / weakest.max < 1 ? weakest : null };
};
const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(r0(n)));
const startOf = (date: string) => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };

export function trainingRating(inp: StarInput): Rating {
  const { today } = inp; const from = startOf(addDays(today, -6)); const priorFrom = startOf(addDays(today, -34));
  const ex = exMap(inp.exercises); const done = inp.workouts.filter((w) => w.end);
  const recent = done.filter((w) => w.start >= from); const prior = done.filter((w) => w.start >= priorFrom && w.start < from);
  const goal = workoutGoal(inp.settings); const n = recent.length;
  const cons: Part = { key: 'consistency', label: 'Consistency', max: 40, pts: 40 * Math.min(1, n / goal), applicable: true, detail: `${n} of ${goal} planned workouts`, tip: `${n}/${goal} workouts – one more session` };
  // progressive overload: best e1RM (or reps for bodyweight) per exercise, last 7 days vs the 4 weeks before
  const best = (ws: Workout[]) => { const m = new Map<string, { v: number; txt: string; n: number }>(); for (const w of ws) for (const e of w.exercises) for (const s of workingSets(e.sets)) {
    const v = (s.kg || 0) > 0 ? e1rm(s.kg || 0, s.reps || 0) : (s.reps || 0); const o = m.get(e.exerciseId); const txt = (s.kg || 0) > 0 ? `${s.kg} kg × ${s.reps}` : `${s.reps} reps`;
    if (!o) m.set(e.exerciseId, { v, txt, n: 1 }); else { o.n++; if (v > o.v) { o.v = v; o.txt = txt; } } } return m; };
  const rb = best(recent), pb = best(prior);
  const lifts = [...rb.entries()].filter(([id]) => pb.has(id)).sort((a, b) => b[1].n - a[1].n).slice(0, 6);
  let up = 0, held = 0; const stuck: string[] = [];
  for (const [id, r] of lifts) { const p = pb.get(id)!.v; if (r.v > p * 1.001) up++; else if (r.v >= p * 0.98) { held++; stuck.push(ex.get(id)?.name || 'a lift'); } else stuck.push(ex.get(id)?.name || 'a lift'); }
  const ov: Part = { key: 'overload', label: 'Progressive overload', max: 30, applicable: lifts.length > 0, pts: lifts.length ? 30 * (up + 0.5 * held) / lifts.length : 0,
    detail: lifts.length ? `${up} of ${lifts.length} main lifts beat their 4-week best` : 'Not enough lift history to compare yet',
    tip: lifts.length ? `${up}/${lifts.length} main lifts up – add a rep or 2.5 kg` : '' };
  // volume balance
  const sets: Record<Group, number> = { chest: 0, back: 0, legs: 0, shoulders: 0, arms: 0 };
  for (const w of recent) for (const e of w.exercises) { const g = groupOf(ex.get(e.exerciseId)?.muscle || ''); if (g) sets[g] += workingSets(e.sets).length; }
  const low = [...GROUPS].sort((a, b) => sets[a] - sets[b])[0];
  const vol: Part = { key: 'volume', label: 'Volume balance', max: 20, applicable: true, pts: 20 * GROUPS.reduce((a, g) => a + Math.min(1, sets[g] / 10), 0) / GROUPS.length,
    detail: GROUPS.map((g) => `${g[0].toUpperCase() + g.slice(1)} ${sets[g]}`).join(' · ') + ' hard sets', tip: `Low ${low} volume – ${sets[low]} of ~10 sets` };
  // daily movement (steps typed in by the user)
  const sg = inp.settings.stepGoal === 0 ? 0 : inp.settings.stepGoal || 8000;
  const sd = Array.from({ length: 7 }, (_, i) => addDays(today, -i)).map((d) => inp.steps[d] || 0).filter((v) => v > 0);
  const avg = sd.length ? sd.reduce((a, b) => a + b, 0) / sd.length : 0;
  const mv: Part = { key: 'movement', label: 'Daily movement', max: 10, applicable: sd.length > 0 && sg > 0, pts: sd.length && sg ? 10 * Math.min(1, avg / sg) : 0,
    detail: sd.length ? (sg ? `Avg ${fmtK(avg)} steps vs ${fmtK(sg)} goal` : `Avg ${fmtK(avg)} steps (no goal set)`) : 'No steps logged (points shared out)', tip: `Steps ${fmtK(avg)} of ${fmtK(sg)} – walk more` };
  return finish([cons, ov, vol, mv]);
}

export function nutritionRating(inp: StarInput): Rating {
  const { today } = inp; const days = Array.from({ length: 7 }, (_, i) => addDays(today, -7 + i)); // the 7 days up to yesterday
  const t = inp.settings.targets; const byDay = new Map<string, DiaryEntry[]>(); for (const e of inp.diary) if (days.includes(e.date)) (byDay.get(e.date) || byDay.set(e.date, []).get(e.date)!).push(e);
  let cal = 0, calHit = 0, pro = 0, logged = 0;
  for (const d of days) { const es = byDay.get(d) || []; if (!es.length) continue;
    const kcal = es.reduce((a, e) => a + (e.n.kcal || 0), 0), protein = es.reduce((a, e) => a + (e.n.protein || 0), 0);
    const off = t.kcal ? Math.abs(kcal - t.kcal) / t.kcal : 1; if (off <= 0.1) { cal += 1; calHit++; } else if (off <= 0.2) cal += 0.5;
    if (t.protein && protein >= 0.9 * t.protein) pro++;
    if (new Set(es.map((e) => e.meal)).size >= 2) logged++; }
  const due = inp.doseSlots.filter((x) => days.includes(x.date)); const taken = due.filter((x) => x.taken).length;
  return finish([
    { key: 'calories', label: 'Calories on target', max: 35, applicable: true, pts: 35 * cal / 7, detail: `${calHit}/7 days within ±10 % of ${r0(t.kcal)} kcal`, tip: `Calories on target ${calHit}/7 days` },
    { key: 'protein', label: 'Protein', max: 35, applicable: true, pts: 35 * pro / 7, detail: `${pro}/7 days at ≥90 % of ${r0(t.protein)} g`, tip: `Protein hit ${pro}/7 days` },
    { key: 'logging', label: 'Logging', max: 20, applicable: true, pts: 20 * logged / 7, detail: `${logged}/7 days with 2+ meals logged`, tip: `Food logged ${logged}/7 days` },
    { key: 'supplements', label: 'Supplements', max: 10, applicable: due.length > 0, pts: due.length ? 10 * taken / due.length : 0, detail: due.length ? `${taken}/${due.length} scheduled doses taken` : 'No doses scheduled (points shared out)', tip: `Doses taken ${taken}/${due.length}` }
  ]);
}

/** First day with any data (food, workout or steps). */
export function historyStart(inp: Pick<StarInput, 'diary' | 'workouts' | 'steps'>): string | null {
  let m: string | null = null; const k = (d: string) => { if (!m || d < m) m = d; };
  for (const e of inp.diary) k(e.date); for (const w of inp.workouts) k(ymd(new Date(w.start))); for (const [d, v] of Object.entries(inp.steps)) if (v > 0) k(d);
  return m;
}
export function computeStars(inp: StarInput): Stars {
  const h = historyStart(inp); const historyDays = h ? Math.max(0, Math.round((startOf(inp.today) - startOf(h)) / 864e5) + 1) : 0;
  return { ready: historyDays >= 7, historyDays: Math.min(historyDays, 7), training: trainingRating(inp), nutrition: nutritionRating(inp) };
}
