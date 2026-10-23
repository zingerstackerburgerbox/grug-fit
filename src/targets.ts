/**
 * v1.8.5: when the daily calorie target changes, protein, carbs and fat follow it proportionally so their ratio stays the
 * same: new = old × newKcal / oldKcal, rounded to whole grams (2000 → 1000 kcal: protein 200 → 100, carbs 150 → 75).
 * Fibre and micronutrients are not touched. Editing one macro directly never changes the others.
 */
export const SCALED = ['protein', 'carbs', 'fat'] as const;
export type Macro = (typeof SCALED)[number];
export type MacroBase = { kcal: number | null | undefined } & Partial<Record<Macro, number | null | undefined>>;

export function scaleMacros(base: MacroBase, newKcal: number | null | undefined): Partial<Record<Macro, number>> {
  const out: Partial<Record<Macro, number>> = {};
  const ok = base.kcal != null && base.kcal > 0 && newKcal != null && Number.isFinite(newKcal) && newKcal > 0;
  for (const m of SCALED) { const v = base[m]; if (v == null || !Number.isFinite(v)) continue; out[m] = ok ? Math.round((v * newKcal!) / base.kcal!) : v; }
  return out;
}

/** apply a partial target change (Coach suggestion): explicitly given macros win, the rest scale with a calorie change */
export function applyTargetChange<T extends MacroBase>(cur: T, patch: Partial<Record<'kcal' | Macro | 'fibre', number | undefined>>): { next: T; scaled: Macro[] } {
  const next: any = { ...cur }; const scaled: Macro[] = [];
  for (const [k, v] of Object.entries(patch)) if (v != null) next[k] = v;
  if (patch.kcal != null && patch.kcal !== cur.kcal) { const s = scaleMacros(cur, patch.kcal); for (const m of SCALED) if (patch[m] == null && s[m] != null) { next[m] = s[m]; scaled.push(m); } }
  return { next, scaled };
}
