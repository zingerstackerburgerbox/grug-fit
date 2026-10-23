export type Nutrients = {
  kcal: number; protein: number; carbs: number; fibre: number; fat: number; sugar?: number;
  calcium?: number; iron?: number; vitC?: number; vitA?: number; vitD?: number; b12?: number;
  folate?: number; magnesium?: number; potassium?: number; sodium?: number;
};
export type Exercise = { id: string; name: string; muscle: string; equipment: string; custom?: boolean };
export type SetType = 'W' | 'N' | 'D' | 'F';
export type WSet = { id: string; type: SetType; kg: number | null; reps: number | null; rpe?: number | null; done: boolean };
export type WExercise = { id: string; exerciseId: string; sets: WSet[]; restSec: number; notes?: string };
export type Workout = { id: string; name: string; start: number; end?: number; routineId?: string; exercises: WExercise[]; prs?: PR[]; notes?: string };
export type PR = { exerciseId: string; kind: '1rm' | 'weight' | 'volume' | 'reps'; value: number };
export type RoutineEx = { exerciseId: string; sets: number; reps?: number; kg?: number; restSec: number };
export type Routine = { id: string; name: string; exercises: RoutineEx[]; notes?: string; updated: number };
export type BodyWeight = { id: string; date: string; kg: number };
export type Serving = { label: string; grams: number };
export type Food = {
  id: string; name: string; brand?: string; barcode?: string; source: 'off' | 'custom' | 'recipe';
  per100: Nutrients; servings: Serving[]; lastUsed?: number; useCount?: number;
  ingredients?: { foodId: string; name: string; grams: number }[]; recipeServings?: number; image?: string;
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
};
