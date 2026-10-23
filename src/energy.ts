/** Energy maths: Mifflin-St Jeor BMR, sedentary expenditure, goal-based targets and MET workout calories. */
import { all, get } from './db';
import type { BodyWeight, Nutrients, Settings, Workout } from './types';

export type Sex = 'male' | 'female';
export type Goal = 'cut' | 'maintain' | 'bulk';
export type Intensity = 'light' | 'moderate' | 'vigorous';
export const MET: Record<Intensity, number> = { light: 3.5, moderate: 5, vigorous: 6 };
export const SEDENTARY = 1.2; // PAL multiplier, also used as the resting MET baseline already counted in the day
export const GOAL_LABEL: Record<Goal, string> = { cut: 'Cutting', maintain: 'Maintaining', bulk: 'Bulking' };

export const ageFromBirthYear = (by: number, now = new Date()) => now.getFullYear() - by;
/** Mifflin-St Jeor (1990): 10·kg + 6.25·cm − 5·age + 5 (male) / −161 (female) */
export const bmr = (kg: number, cm: number, age: number, sex: Sex) => 10 * kg + 6.25 * cm - 5 * age + (sex === 'male' ? 5 : -161);
export const sedentaryBurn = (b: number) => b * SEDENTARY;

const r10 = (n: number) => Math.round(n / 10) * 10;
/** Calorie + macro suggestion. cut ≈ −20 % (capped 300–500), maintain = expenditure, bulk ≈ +13 % (capped 250–400). */
export function suggestTargets(kg: number, expenditure: number, goal: Goal): Pick<Nutrients, 'kcal' | 'protein' | 'fat' | 'carbs'> {
  const delta = goal === 'cut' ? -Math.min(500, Math.max(300, expenditure * 0.2)) : goal === 'bulk' ? Math.min(400, Math.max(250, expenditure * 0.13)) : 0;
  const kcal = r10(expenditure + delta);
  const protein = Math.round(kg * (goal === 'maintain' ? 1.6 : 2));
  const fat = Math.round((kcal * 0.275) / 9); // 27.5 % of energy (middle of 25–30 %)
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, fat, carbs };
}
export const eatBackOn = (s: Settings) => s.eatBack ?? (s.profile ? s.profile.goal !== 'cut' : false);

/** kcal above the resting baseline: (MET − 1.2) × kg × hours. Manual override wins. */
export function workoutKcal(w: Pick<Workout, 'start' | 'end' | 'intensity' | 'kcalOverride'>, kg: number | null, now = Date.now()) {
  if (w.kcalOverride != null) return Math.round(w.kcalOverride);
  if (!kg) return 0;
  const h = Math.max(0, ((w.end ?? now) - w.start) / 3.6e6);
  return Math.round(Math.max(0, MET[w.intensity || 'moderate'] - SEDENTARY) * kg * Math.min(h, 6));
}
export const sortBW = (l: BodyWeight[]) => [...l].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
/** body weight on (or before) a date, falling back to the earliest entry */
export function weightAt(list: BodyWeight[], date: string): number | null {
  const l = sortBW(list); let w: BodyWeight | undefined; for (const x of l) { if (x.date <= date) w = x; else break; } return (w || l[0])?.kg ?? null;
}
export async function latestWeight(): Promise<number | null> { const l = sortBW(await all<BodyWeight>('bodyweight')); return l[l.length - 1]?.kg ?? null; }

export type DayEnergy = { kg: number | null; bmr: number | null; sedentary: number | null; workouts: { id: string; name: string; kcal: number; live?: boolean }[]; workoutKcal: number; burned: number | null; target: number; eatBack: boolean };
export async function dayEnergy(date: string, s: Settings, now = Date.now()): Promise<DayEnergy> {
  const bws = await all<BodyWeight>('bodyweight'); const kg = weightAt(bws, date);
  const p = s.profile; let b: number | null = null;
  if (p && kg) b = bmr(kg, p.heightCm, ageFromBirthYear(p.birthYear, new Date(date)), p.sex);
  const from = new Date(date + 'T00:00:00').getTime(), to = from + 864e5;
  const ws = (await all<Workout>('workouts')).filter((w) => w.end && w.start >= from && w.start < to);
  const list: DayEnergy['workouts'] = ws.map((w) => ({ id: w.id, name: w.name, kcal: workoutKcal(w, kg) }));
  const act = (await get<{ w: Workout | null }>('kv', 'active'))?.w;
  if (act && act.start >= from && act.start < to) list.push({ id: act.id, name: act.name, kcal: workoutKcal(act, kg, now), live: true });
  const wk = list.reduce((a, x) => a + x.kcal, 0);
  const sed = b != null ? Math.round(sedentaryBurn(b)) : null; const eb = eatBackOn(s);
  return { kg, bmr: b != null ? Math.round(b) : null, sedentary: sed, workouts: list, workoutKcal: wk, burned: sed != null ? sed + wk : null, target: Math.round(s.targets.kcal + (eb ? wk : 0)), eatBack: eb };
}
