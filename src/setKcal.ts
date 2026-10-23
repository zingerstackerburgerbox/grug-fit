/**
 * Per-completed-set workout calories (v1.6.1). Rest time is never counted, so long rests don't inflate the estimate.
 *   reps sets:  active time = reps × 3 s
 *               metabolic   = (6 MET − 1 resting MET) × bodyweight kg × active hours            (net of resting burn)
 *               mechanical  = load kg × reps × range of motion m × 9.81 J ÷ 0.22 efficiency ÷ 4184 J/kcal
 *               bodyweight moves use a fraction of bodyweight as the load (push-up 65 %, pull-up 100 %, …) plus any added kg
 *   holds (plank): logged seconds at 4 MET (net 3)
 *   cardio:      logged minutes; with distance the MET comes from speed (ACSM walking/running equations), else 7 MET
 *   + 12 % post-set allowance (EPOC) on each set's active cost. Only ticked sets count; warm-ups count normally.
 */
import type { Exercise, WSet, Workout } from './types';

export const REP_SEC = 3, LIFT_MET = 6, REST_MET = 1, G = 9.81, EFFICIENCY = 0.22, J_PER_KCAL = 4184, EPOC = 0.12;
export const HOLD_MET = 4, CARDIO_MET = 7;
export type SetMode = 'reps' | 'hold' | 'cardio';
type Ex = Pick<Exercise, 'name' | 'muscle' | 'equipment'> | undefined;

export function setMode(ex: Ex): SetMode {
  if (!ex) return 'reps';
  if (ex.muscle === 'Cardio') return 'cardio';
  if (/\bplank|\bhold\b|wall sit|dead hang|hollow body|l-sit/i.test(ex.name)) return 'hold';
  return 'reps';
}

/** estimated range of motion per rep (m) – first matching name pattern, else by muscle group */
const ROM: [RegExp, number][] = [
  [/calf/i, 0.1], [/shrug/i, 0.08], [/wrist curl/i, 0.15], [/rack pull/i, 0.3], [/farmer/i, 0.05],
  [/thruster/i, 1.0], [/clean|snatch/i, 0.9], [/burpee/i, 0.8],
  [/hip thrust|glute bridge|kickback|abduction|adduction/i, 0.35],
  [/crunch|twist|leg raise|rollout|pallof|sit.?up/i, 0.3],
  [/leg press|hack squat/i, 0.5], [/squat|lunge|step up/i, 0.6], [/deadlift|good morning|swing/i, 0.6],
  [/leg curl|leg extension/i, 0.4], [/curl/i, 0.4], [/pushdown|skullcrusher|triceps extension|kickback/i, 0.35],
  [/lateral raise|front raise|rear delt|fly|pec deck|face pull|pullover|pulldown/i, 0.5],
  [/press|row|pull ?up|chin ?up|dip|push ?up/i, 0.5]
];
const ROM_MUSCLE: Record<string, number> = { Quadriceps: 0.6, Hamstrings: 0.5, Glutes: 0.4, Calves: 0.1, Biceps: 0.4, Triceps: 0.35, Forearms: 0.15, Core: 0.3, Traps: 0.08 };
export const romOf = (ex: Ex) => { const n = ex?.name || ''; for (const [re, m] of ROM) if (re.test(n)) return m; return ROM_MUSCLE[ex?.muscle || ''] ?? 0.5; };

/** share of bodyweight moved by bodyweight exercises */
const BW_FRAC: [RegExp, number][] = [
  [/push ?up/i, 0.65], [/pull ?up|chin ?up|muscle ?up/i, 1.0], [/dip/i, 0.95], [/calf/i, 1.0], [/burpee/i, 1.0],
  [/squat|lunge|step up|pistol/i, 0.85], [/back extension/i, 0.5], [/glute bridge|hip thrust/i, 0.6],
  [/hanging leg raise|leg raise/i, 0.35], [/crunch|sit.?up|twist/i, 0.3], [/inverted row/i, 0.6]
];
export const bwFraction = (ex: Ex) => { if (ex?.equipment !== 'Bodyweight') return 0; const n = ex.name; for (const [re, f] of BW_FRAC) if (re.test(n)) return f; return 0.5; };

/** MET for cardio from distance + minutes (ACSM: walking VO2 = 0.1·v + 3.5, running = 0.2·v + 3.5 ml/kg/min, v in m/min) */
export function cardioMet(km: number | null | undefined, min: number) {
  if (!km || !min) return CARDIO_MET;
  const v = (km * 1000) / min; const kmh = (v * 60) / 1000;
  return ((kmh < 8 ? 0.1 : 0.2) * v + 3.5) / 3.5;
}

/** net kcal for one set (0 if not ticked) */
export function setKcal(st: WSet, ex: Ex, bodyKg: number): number {
  if (!st.done || !bodyKg) return 0;
  const mode = setMode(ex);
  if (mode === 'hold') { const sec = st.reps || 0; return (HOLD_MET - REST_MET) * bodyKg * (sec / 3600) * (1 + EPOC); }
  if (mode === 'cardio') { const min = st.reps || 0; return Math.max(0, cardioMet(st.km, min) - REST_MET) * bodyKg * (min / 60) * (1 + EPOC); }
  const reps = st.reps || 0; if (!reps) return 0;
  const metabolic = (LIFT_MET - REST_MET) * bodyKg * ((reps * REP_SEC) / 3600);
  const load = (st.kg || 0) + bwFraction(ex) * bodyKg;
  const mechanical = (load * reps * romOf(ex) * G) / EFFICIENCY / J_PER_KCAL;
  return (metabolic + mechanical) * (1 + EPOC);
}

export type ExLookup = Map<string, Exercise> | ((id: string) => Exercise | undefined);
const look = (exs: ExLookup, id: string) => (typeof exs === 'function' ? exs(id) : exs.get(id));

/** per-exercise breakdown (unrounded) */
export function workoutBreakdown(w: Pick<Workout, 'exercises'>, bodyKg: number | null, exs: ExLookup) {
  return w.exercises.map((e) => { const ex = look(exs, e.exerciseId); return { exerciseId: e.exerciseId, name: ex?.name || 'Exercise', sets: e.sets.filter((s) => s.done).length, kcal: bodyKg ? e.sets.reduce((a, s) => a + setKcal(s, ex, bodyKg), 0) : 0 }; });
}
export const estimateWorkoutKcal = (w: Pick<Workout, 'exercises'>, bodyKg: number | null, exs: ExLookup) => workoutBreakdown(w, bodyKg, exs).reduce((a, x) => a + x.kcal, 0);
export const KCAL_EXPLAIN = "Estimated from your completed sets: reps, weight and your bodyweight (about 3 s per rep, plus a small post-set allowance). Rest time isn't counted.";
