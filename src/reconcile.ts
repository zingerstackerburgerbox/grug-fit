/**
 * v1.8.3: make imported history indistinguishable from history logged in Grug Fit. Pure (no DB) so it is unit-testable;
 * db.ts runs it as schema migration 5 (existing installs, also after restoring a backup) and history.ts after every import / merge / edit / delete.
 *  1. Imported Hevy workouts: normalised structure (ids, set types, done, numbers, end > start, rest).
 *  2. Imported custom Hevy exercises that now match a built-in exercise (better aliases) are folded into it: workouts, routines and the
 *     active workout point at the built-in id; the duplicate custom exercise is removed.
 *  3. Personal records are recomputed for ALL finished workouts in date order (native + imported), so a native PR that was beaten by older
 *     imported history no longer shows, and imported sessions earn PRs exactly as native ones do.
 *  4. Imported Cronometer entries get a real Food (My Foods, recents, search, editable amount) and native serving fields.
 * Idempotent: running it twice changes nothing the second time.
 */
import type { DiaryEntry, Exercise, Food, Nutrients, Routine, Serving, SetType, WSet, Workout } from './types';
import { exKey, matchExercise } from './importer';
import { detectPRs } from './workoutLogic';

export type Data = { workouts: Workout[]; exercises: Exercise[]; routines: Routine[]; diary: DiaryEntry[]; foods: Food[]; active?: Workout | null; exAliases?: Record<string, string>; defaultRest?: number };
export type Changes = { workouts: Workout[]; routines: Routine[]; diary: DiaryEntry[]; foods: Food[]; delExercises: string[]; active?: Workout | null; remapped: Record<string, string>; stats: Record<string, number> };

const TYPES: SetType[] = ['W', 'N', 'D', 'F'];
const numOrNull = (v: any) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);

export function normaliseWorkout(w: Workout, remap: Record<string, string>, defaultRest = 90): Workout {
  const start = Number(w.start); const end = Number(w.end) > start ? Number(w.end) : start + 3600e3;
  const exercises = (w.exercises || []).map((e, ei) => ({
    ...e, id: e.id || `${w.id}-e${ei}`, exerciseId: remap[e.exerciseId] || e.exerciseId, restSec: Number.isFinite(e.restSec) ? e.restSec : defaultRest,
    sets: (e.sets || []).map((s, si): WSet => ({ ...s, id: s.id || `${w.id}-e${ei}-s${si}`, type: TYPES.includes(s.type) ? s.type : 'N', kg: numOrNull(s.kg), reps: numOrNull(s.reps), done: s.done !== false, ...(s.km !== undefined ? { km: numOrNull(s.km) } : {}) }))
  })).filter((e) => e.sets.length);
  return { ...w, name: (w.name || '').trim() || 'Workout', start, end, exercises };
}

/** grams per unit implied by the logged nutrients vs the food's per-100 values (kcal, else macros) */
function gramsPerUnit(n: Nutrients, qty: number, per100: Nutrients): number | null {
  if (!(qty > 0)) return null;
  const k = (x: Nutrients) => (x.kcal > 0 ? x.kcal : (x.protein || 0) * 4 + (x.carbs || 0) * 4 + (x.fat || 0) * 9);
  const a = k(n), b = k(per100); return a > 0 && b > 0 ? Math.round(((100 * a) / qty / b) * 10) / 10 : null;
}
const parseAmount = (s: string) => { const m = /^\s*([\d.,]+)\s*(.*)$/.exec(s || ''); return m ? { qty: Number(m[1].replace(',', '.')) || 1, unit: m[2].trim() || 'serving' } : { qty: 1, unit: (s || '').trim() || 'serving' }; };
const fmtQ = (q: number) => String(Math.round(q * 100) / 100);
const isBaseL = (l: string) => l === 'g' || l === 'ml';

export function cronFoods(diary: DiaryEntry[], foods: Food[]): { diary: DiaryEntry[]; foods: Food[] } {
  const byId = new Map(foods.map((f) => [f.id, f])); const groups = new Map<string, DiaryEntry[]>();
  for (const e of diary) if (e.importSource === 'cronometer' && e.foodId.startsWith('import-') && e.foodId !== 'import-cron-day') { if (!groups.has(e.foodId)) groups.set(e.foodId, []); groups.get(e.foodId)!.push(e); }
  const outD: DiaryEntry[] = [], outF: Food[] = [];
  for (const [fid, list] of groups) {
    const prev = byId.get(fid); if (prev && !prev.importSource) continue; // never touch a food the user made
    list.sort((a, b) => a.created - b.created);
    const unitOf = (e: DiaryEntry) => isBaseL(e.serving) ? { qty: e.grams, unit: e.serving } : e.serving === 'serving' && e.amountLabel ? parseAmount(e.amountLabel) : { qty: e.qty, unit: e.serving };
    let per100 = prev?.per100; let gramsUnknown = prev?.gramsUnknown ?? false; const servings: Serving[] = [...(prev?.servings || [])];
    const gEntry = list.find((e) => isBaseL(e.serving) && e.grams > 0);
    if (!per100 || (gramsUnknown && gEntry)) {
      if (gEntry) { per100 = scale(gEntry.n, 100 / gEntry.grams); gramsUnknown = false; servings.length = 0; }
      else { const u = unitOf(list[0]); per100 = scale(list[0].n, 1 / u.qty); gramsUnknown = true; servings.length = 0; servings.push({ label: u.unit, grams: 100, kind: 'custom', note: 'weight unknown (imported)' }); }
    }
    for (const e of list) {
      let ne: DiaryEntry = e;
      if (!isBaseL(e.serving)) {
        const u = unitOf(e); let sv = servings.find((s) => s.label === u.unit);
        if (!sv) { const g = gramsPerUnit(e.n, u.qty, per100!); if (g) { sv = { label: u.unit, grams: g, kind: 'custom', ...(gramsUnknown ? { note: 'weight unknown (imported)' } : {}) }; servings.push(sv); } }
        if (sv) { const { amountLabel, ...rest } = e; ne = { ...rest, serving: u.unit, qty: u.qty, grams: Math.round(u.qty * sv.grams * 10) / 10, ...(gramsUnknown ? { amountLabel: `${fmtQ(u.qty)} ${u.unit}` } : {}) } as DiaryEntry; }
      }
      if (!same(ne, e)) outD.push(ne);
    }
    const last = list[list.length - 1]; const lu = unitOf(last);
    const f: Food = { ...(prev || {}), id: fid, name: prev?.name || list[0].name, source: 'custom', per100: per100!, servings, unit: list.some((e) => e.serving === 'ml') ? 'ml' : prev?.unit || 'g', importSource: 'cronometer',
      ...(gramsUnknown ? { gramsUnknown: true } : { gramsUnknown: undefined }), lastUsed: Math.max(prev?.lastUsed || 0, last.created), useCount: Math.max(prev?.useCount || 0, list.length),
      lastServing: prev?.lastServing || { label: isBaseL(last.serving) ? last.serving : lu.unit, qty: isBaseL(last.serving) ? last.grams : lu.qty } };
    if (f.gramsUnknown === undefined) delete f.gramsUnknown;
    if (!prev || !same(prev, f)) outF.push(f);
  }
  return { diary: outD, foods: outF };
}
const scale = (n: Nutrients, f: number): Nutrients => { const o: any = {}; for (const [k, v] of Object.entries(n)) if (typeof v === 'number') o[k] = Math.round(v * f * 1000) / 1000; return o; };

export function reconcile(d: Data): Changes {
  const stats: Record<string, number> = { normalised: 0, remappedExercises: 0, prsChanged: 0, foods: 0, diary: 0 };
  // 2. imported custom duplicates of built-ins
  const builtIns = d.exercises.filter((e) => !e.custom); const remap: Record<string, string> = {};
  for (const e of d.exercises) if (e.custom && e.importSource === 'hevy') {
    const alias = d.exAliases?.[exKey(e.name)]; const t = alias && alias !== e.id ? d.exercises.find((x) => x.id === alias) : matchExercise(e.name, builtIns);
    if (t && t.id !== e.id) remap[e.id] = t.id;
  }
  stats.remappedExercises = Object.keys(remap).length;
  // 1. normalise (+ remap ids in every workout)
  const changed = new Map<string, Workout>();
  let all = d.workouts.map((w) => {
    const touchesRemap = w.exercises?.some((e) => remap[e.exerciseId]);
    if (w.importSource !== 'hevy' && !touchesRemap) return w;
    const nw = w.importSource === 'hevy' ? normaliseWorkout(w, remap, d.defaultRest) : { ...w, exercises: w.exercises.map((e) => ({ ...e, exerciseId: remap[e.exerciseId] || e.exerciseId })) };
    if (!same(nw, w)) { changed.set(w.id, nw); stats.normalised++; } return nw;
  });
  // 3. PRs over the whole finished history, in date order
  const fin = all.filter((w) => w.end).sort((a, b) => a.start - b.start);
  for (const w of fin) {
    const prs = detectPRs(w, fin); const old = w.prs || [];
    if (!same(prs, old) && !(prs.length === 0 && w.prs === undefined && !w.importSource)) { const nw = { ...w, prs }; changed.set(w.id, nw); stats.prsChanged++; all = all.map((x) => (x.id === w.id ? nw : x)); }
  }
  const routines = d.routines.filter((r) => r.exercises.some((e) => remap[e.exerciseId])).map((r) => ({ ...r, exercises: r.exercises.map((e) => ({ ...e, exerciseId: remap[e.exerciseId] || e.exerciseId })) }));
  let active: Workout | null | undefined;
  if (d.active && d.active.exercises.some((e) => remap[e.exerciseId])) active = { ...d.active, exercises: d.active.exercises.map((e) => ({ ...e, exerciseId: remap[e.exerciseId] || e.exerciseId })) };
  // 4. Cronometer foods
  const cf = cronFoods(d.diary, d.foods); stats.foods = cf.foods.length; stats.diary = cf.diary.length;
  return { workouts: [...changed.values()], routines, diary: cf.diary, foods: cf.foods, delExercises: Object.keys(remap), active, remapped: remap, stats };
}

/** 'Merge custom exercise into existing': every workout / routine / active set moves to `toId`; future imports of the name map there too. */
export function mergeExercise(d: Data, fromId: string, toId: string): Changes & { exAliases: Record<string, string> } {
  const from = d.exercises.find((e) => e.id === fromId); const remap = { [fromId]: toId };
  const mv = <T extends { exercises: { exerciseId: string }[] }>(x: T): T => ({ ...x, exercises: x.exercises.map((e) => ({ ...e, exerciseId: remap[e.exerciseId] || e.exerciseId })) });
  const exAliases = { ...(d.exAliases || {}), ...(from ? { [exKey(from.name)]: toId } : {}) };
  const workouts = d.workouts.map((w) => (w.exercises.some((e) => e.exerciseId === fromId) ? mv(w) : w));
  const r = reconcile({ ...d, workouts, exAliases, exercises: d.exercises.filter((e) => e.id !== fromId) });
  const byId = new Map(r.workouts.map((w) => [w.id, w]));
  for (const w of workouts) if (w !== d.workouts.find((x) => x.id === w.id) && !byId.has(w.id)) byId.set(w.id, w);
  return { ...r, workouts: [...byId.values()], routines: d.routines.filter((x) => x.exercises.some((e) => e.exerciseId === fromId)).map(mv),
    active: d.active && d.active.exercises.some((e) => e.exerciseId === fromId) ? mv(d.active) : r.active, delExercises: [fromId, ...r.delExercises], exAliases };
}
