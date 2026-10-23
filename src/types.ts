export type Nutrients = {
  kcal: number; protein: number; carbs: number; fibre: number; fat: number; satfat?: number; sugar?: number;
  calcium?: number; iron?: number; vitC?: number; vitA?: number; vitD?: number; b12?: number;
  folate?: number; magnesium?: number; potassium?: number; sodium?: number;
};
export type Exercise = { id: string; name: string; muscle: string; equipment: string; custom?: boolean; /** custom exercises: generic visual 'g:<Muscle>' (default: from muscle group) */ icon?: string };
export type SetType = 'W' | 'N' | 'D' | 'F';
export type WSet = { id: string; type: SetType; kg: number | null; reps: number | null; rpe?: number | null; done: boolean };
export type WExercise = { id: string; exerciseId: string; sets: WSet[]; restSec: number; notes?: string };
export type Workout = { id: string; name: string; start: number; end?: number; routineId?: string; exercises: WExercise[]; prs?: PR[]; notes?: string;
  /** calorie estimate inputs: MET intensity (default moderate) and optional manual kcal override */
  intensity?: 'light' | 'moderate' | 'vigorous'; kcalOverride?: number | null };
export type PR = { exerciseId: string; kind: '1rm' | 'weight' | 'volume' | 'reps'; value: number };
export type RoutineEx = { exerciseId: string; sets: number; reps?: number; kg?: number; restSec: number };
export type Routine = { id: string; name: string; exercises: RoutineEx[]; notes?: string; updated: number };
export type BodyWeight = { id: string; date: string; kg: number };
/** A unit of a food. `grams` = grams (or ml for liquids) in ONE of this unit. Base units 'g'/'ml' are implicit and not stored. */
export type Serving = { label: string; grams: number; note?: string; kind?: 'serving' | 'package' | 'custom' };
export type Food = {
  id: string; name: string; brand?: string; barcode?: string; source: 'off' | 'custom' | 'recipe';
  per100: Nutrients; servings: Serving[]; lastUsed?: number; useCount?: number;
  ingredients?: { foodId: string; name: string; grams: number }[]; recipeServings?: number; image?: string;
  /** base unit: grams (default) or ml for liquids (OFF per-100ml values treated as per-100g, density ≈ 1) */
  unit?: 'g' | 'ml';
  /** last unit + quantity the user logged this food with */
  lastServing?: { label: string; qty: number };
};
export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snacks';
export type DiaryEntry = { id: string; date: string; meal: Meal; foodId: string; name: string; grams: number; qty: number; serving: string; n: Nutrients; created: number };
export type Supplement = {
  id: string; name: string; kind: 'supplement' | 'medication'; doseAmount: number; unit: string; form: string; notes?: string;
  nutrients?: Partial<Nutrients>; stock?: number | null; unitsPerDose: number; lowStock: number; color: string; archived?: boolean;
};
export type Schedule = {
  id: string; suppId: string; type: 'daily' | 'weekdays' | 'interval'; weekdays: number[]; interval: number;
  times: string[]; start: string; end?: string; reminders: boolean; active: boolean; created?: number;
};
export type DoseLog = { id: string; suppId: string; scheduleId?: string; date: string; slot?: string; takenAt: number; amount: number };
export type Settings = {
  id: 'settings'; targets: Nutrients; energyUnit: 'kcal' | 'kJ'; weightUnit: 'kg' | 'lb'; defaultRest: number;
  vibrate: boolean; reminders: boolean;
  /** body profile for BMR (weight comes from the latest body-weight log) */
  profile?: Profile;
  /** add today's workout calories to the calorie target ("eat back"); undefined = default for goal */
  eatBack?: boolean;
  /** onboarding finished/skipped (timestamp) */
  onboarded?: number;
};
export type Profile = { heightCm: number; sex: 'male' | 'female'; birthYear: number; goal: 'cut' | 'maintain' | 'bulk'; heightUnit?: 'cm' | 'ftin'; bwUnit?: 'kg' | 'lb'; updated?: number };
