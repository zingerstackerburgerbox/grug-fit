/**
 * v1.9.1 manual steps: the user types in a day's step total (Workout tab › Steps, any date). Stored in kv 'stepLog'
 * { days: { 'YYYY-MM-DD': steps } }, so it is part of Backup like everything else.
 *
 * Calories (pure functions, unit-tested in tests/steps-unit.mjs):
 *  - stride = height × 0.415 (men) / 0.413 (women)  → distance = steps × stride
 *  - net walking cost 0.5 kcal per kg per km (ACSM walking equation ≈ 0.5 kcal/kg/km above rest). Net, because resting
 *    burn is already the "resting" part of burned-today. ≈ 0.03 kcal/step at 80 kg / 180 cm.
 *  - the first 2,000 steps of a day are part of the sedentary allowance (BMR × 1.2 already covers everyday pottering)
 *  - a walk/run that is ALSO logged as a workout would be counted twice – the UI says so (simple approach, no guessing)
 */
import { get, put } from './db';
import type { Profile } from './types';

export const STEP_BASELINE = 2000;
export const NET_KCAL_PER_KG_KM = 0.5;
export const DEFAULT_STEP_GOAL = 8000;
export const MAX_STEPS = 150000;
export type StepLog = { id: 'stepLog'; days: Record<string, number> };

export const strideCm = (heightCm: number, sex: 'male' | 'female') => heightCm * (sex === 'female' ? 0.413 : 0.415);
export const stepsKm = (steps: number, heightCm = 175, sex: 'male' | 'female' = 'male') => (steps * strideCm(heightCm, sex)) / 1e5;
export const stepKcal = (steps: number, kg: number, heightCm = 175, sex: 'male' | 'female' = 'male') => Math.max(0, NET_KCAL_PER_KG_KM * kg * stepsKm(steps, heightCm, sex));

export type DaySteps = { steps: number; counted: number; kcal: number; km: number };
export function daySteps(steps: number, kg: number | null, p?: Pick<Profile, 'heightCm' | 'sex'>): DaySteps {
  steps = Math.max(0, Math.round(steps || 0)); const counted = Math.max(0, steps - STEP_BASELINE);
  const h = p?.heightCm || 175, sx = p?.sex || 'male';
  return { steps, counted, kcal: kg ? Math.round(stepKcal(counted, kg, h, sx)) : 0, km: Math.round(stepsKm(steps, h, sx) * 10) / 10 };
}

export const stepLog = async (): Promise<Record<string, number>> => (await get<StepLog>('kv', 'stepLog'))?.days || {};
/** set (or clear with null/0) one day's total */
export async function setSteps(date: string, n: number | null) {
  const days = { ...(await stepLog()) }; const v = n == null ? 0 : Math.round(n);
  if (!(v > 0)) delete days[date]; else days[date] = Math.min(MAX_STEPS, v);
  await put('kv', { id: 'stepLog', days });
}
/** user's goal; 0 = no goal */
export const stepGoal = (s: { stepGoal?: number }) => (s.stepGoal === 0 ? 0 : s.stepGoal || DEFAULT_STEP_GOAL);
