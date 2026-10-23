/**
 * v1.9.0 steps: counted by the phone's built-in hardware step counter in the Grug Fit Android app (no Google Fit /
 * Health Connect / other apps). The native side keeps per-day totals (+ 10 days of time segments); this module syncs
 * them into IndexedDB (kv 'steps') and turns steps into calories for "burned today".
 *
 * Calories (pure functions below, unit-tested in tests/steps-unit.mjs):
 *  - stride = height × 0.415 (men) / 0.413 (women)  → distance = steps × stride
 *  - net walking cost 0.5 kcal per kg per km (ACSM walking equation: 0.1 ml O₂/kg per metre ≈ 0.5 kcal/kg/km above rest).
 *    Net, because resting burn is already in the "resting" part of burned-today. ≈ 0.03 kcal/step at 80 kg / 180 cm
 *    (the often-quoted 0.04–0.05 kcal/step is gross, i.e. includes resting energy).
 *  - the first 2,000 steps of a day are treated as part of the sedentary allowance (BMR × 1.2 already covers everyday
 *    pottering), so only steps above that add calories
 *  - steps during a logged Grug Fit cardio workout are excluded (that workout's calories already count them)
 */
import { get, put } from './db';
import type { Exercise, Profile, Workout } from './types';
import { native, type StepReply } from './native';

export const STEP_BASELINE = 2000;
export const NET_KCAL_PER_KG_KM = 0.5;
export const DEFAULT_STEP_GOAL = 8000;
export type StepCache = Omit<StepReply, 'segs'> & { segs: [number, number, number][]; synced: number };

export const strideCm = (heightCm: number, sex: 'male' | 'female') => heightCm * (sex === 'female' ? 0.413 : 0.415);
export const stepsKm = (steps: number, heightCm = 175, sex: 'male' | 'female' = 'male') => (steps * strideCm(heightCm, sex)) / 1e5;
export const stepKcal = (steps: number, kg: number, heightCm = 175, sex: 'male' | 'female' = 'male') => Math.max(0, NET_KCAL_PER_KG_KM * kg * stepsKm(steps, heightCm, sex));

/** steps recorded within [a, b): segments are spread evenly over their time span */
export function stepsInWindow(segs: [number, number, number][], a: number, b: number) {
  let n = 0;
  for (const [t0, t1, s] of segs) { const o = Math.min(b, t1) - Math.max(a, t0); if (o > 0) n += s * (o / Math.max(1, t1 - t0)); }
  return Math.round(n);
}
export const isCardioWorkout = (w: Pick<Workout, 'exercises'>, exs: Map<string, Pick<Exercise, 'muscle'>>) => w.exercises.some((e) => exs.get(e.exerciseId)?.muscle === 'Cardio' || e.sets.some((s) => s.km != null && s.km > 0));

export type DaySteps = { steps: number; inCardio: number; counted: number; kcal: number; km: number };
export function daySteps(date: string, c: Pick<StepCache, 'days' | 'segs'> | null | undefined, workouts: Workout[], exs: Map<string, Pick<Exercise, 'muscle'>>, kg: number | null, p?: Pick<Profile, 'heightCm' | 'sex'>): DaySteps {
  const steps = Math.round(c?.days?.[date] || 0);
  const [y, m, d] = date.split('-').map(Number); const from = new Date(y, m - 1, d).getTime(), to = new Date(y, m - 1, d + 1).getTime(); // local day, DST-safe
  const inCardio = Math.min(steps, workouts.filter((w) => w.end && w.start < to && w.end > from && isCardioWorkout(w, exs))
    .reduce((a, w) => a + stepsInWindow(c?.segs || [], Math.max(from, w.start), Math.min(to, w.end!)), 0));
  const counted = Math.max(0, steps - inCardio - STEP_BASELINE);
  const h = p?.heightCm || 175, sx = p?.sex || 'male';
  return { steps, inCardio, counted, kcal: kg ? Math.round(stepKcal(counted, kg, h, sx)) : 0, km: Math.round(stepsKm(steps, h, sx) * 10) / 10 };
}

export const stepCache = () => get<{ id: 'steps'; v: StepCache }>('kv', 'steps').then((x) => x?.v || null);

let syncing: Promise<StepCache | null> | null = null;
/** read the counter now (native) and store the totals; no-op in the web app */
export function syncSteps(opts: { sample?: boolean } = {}): Promise<StepCache | null> {
  return (syncing ||= (async () => {
    try {
      const n = await native(); if (!n) return null;
      const r = await n.steps({ days: 120, sample: opts.sample !== false });
      const v: StepCache = { ...r, synced: Date.now() }; await put('kv', { id: 'steps', v }); return v;
    } catch { return null; } finally { syncing = null; }
  })());
}
let armed = false;
/** sync on open, when the app comes back to the foreground, and every 5 min while it's open */
export function armStepSync() {
  if (armed) return; armed = true;
  native().then((n) => {
    if (!n) return;
    syncSteps();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncSteps(); });
    setInterval(() => { if (document.visibilityState === 'visible') syncSteps(); }, 5 * 60e3);
  });
}
