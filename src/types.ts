export type Nutrients = {
  kcal: number; protein: number; carbs: number; fibre: number; fat: number; satfat?: number; sugar?: number;
  calcium?: number; iron?: number; vitC?: number; vitA?: number; vitD?: number; b12?: number;
  folate?: number; magnesium?: number; potassium?: number; sodium?: number;
};
export type ImportTag = { /** set on items created by a Hevy/Cronometer import (for 'Remove imported data') */ importSource?: 'hevy' | 'cronometer' };
export type Exercise = ImportTag & { id: string; name: string; muscle: string; equipment: string; custom?: boolean; /** built-ins: short how-to text */ how?: string; /** custom exercises: generic visual 'g:<Muscle>' (default: from muscle group) */ icon?: string };
export type SetType = 'W' | 'N' | 'D' | 'F';
export type WSet = { id: string; type: SetType; kg: number | null; reps: number | null; rpe?: number | null; done: boolean; /** when it was ticked complete */ doneAt?: number; /** cardio: distance in km (reps then holds minutes) */ km?: number | null };
export type WExercise = { id: string; exerciseId: string; sets: WSet[]; restSec: number; notes?: string };
export type Workout = ImportTag & { id: string; name: string; start: number; end?: number; routineId?: string; exercises: WExercise[]; prs?: PR[]; notes?: string;
  /** optional manual kcal override (intensity is legacy, unused since v1.6.1: calories come from completed sets) */
  intensity?: 'light' | 'moderate' | 'vigorous'; kcalOverride?: number | null;
  /** last edit while in progress (auto-end after 2 h idle) */ lastActivityAt?: number;
  /** ended automatically at the last completed set; needsReview until the user confirms/edits/resumes */ autoEnded?: boolean; needsReview?: boolean; autoEndedAt?: number };
export type PR = { exerciseId: string; kind: '1rm' | 'weight' | 'volume' | 'reps'; value: number };
export type RoutineEx = { exerciseId: string; sets: number; reps?: number; kg?: number; restSec: number };
export type Routine = { id: string; name: string; exercises: RoutineEx[]; notes?: string; updated: number };
export type BodyWeight = ImportTag & { id: string; date: string; kg: number };
/** A unit of a food. `grams` = grams (or ml for liquids) in ONE of this unit. Base units 'g'/'ml' are implicit and not stored. */
export type Serving = { label: string; grams: number; note?: string; kind?: 'serving' | 'package' | 'custom' };
export type Food = {
  id: string; name: string; brand?: string; barcode?: string; source: 'off' | 'usda' | 'custom' | 'recipe'; /** USDA FoodData Central id (source 'usda') */ fdcId?: number;
  per100: Nutrients; servings: Serving[]; lastUsed?: number; useCount?: number;
  ingredients?: { foodId: string; name: string; grams: number }[]; recipeServings?: number; image?: string;
  /** base unit: grams (default) or ml for liquids (OFF per-100ml values treated as per-100g, density ≈ 1) */
  unit?: 'g' | 'ml';
  /** last unit + quantity the user logged this food with */
  lastServing?: { label: string; qty: number };
  /** servings the user edited on the amount screen: replace the source's list and survive OFF/USDA re-fetch */
  userServings?: Serving[];
  /** label of the default unit for new entries ('' = grams/ml); undefined = first serving */
  defaultServing?: string;
};
export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snacks';
export type DiaryEntry = ImportTag & { id: string; date: string; meal: Meal; foodId: string; name: string; grams: number; qty: number; serving: string; n: Nutrients; created: number; /** imported entries whose grams are unknown: amount as logged in the other app, e.g. '1 cup' */ amountLabel?: string };
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
  /** optional personal api.data.gov key for USDA FoodData Central (falls back to the shared DEMO_KEY) */
  usdaKey?: string;
  /** add today's workout calories to the calorie target ("eat back"); undefined = default for goal */
  eatBack?: boolean;
  /** AI Coach: optional own xAI key (calls api.x.ai directly), owner token for the proxy, privacy notice accepted (timestamp) */
  coachKey?: string; coachOwnerToken?: string; coachConsent?: number;
  /** Home 'Fitness fact of the day' card: open (default), collapsed, or off */
  factCard?: 'open' | 'collapsed' | 'off';
  /** onboarding finished/skipped (timestamp) */
  onboarded?: number;
};
export type Profile = { heightCm: number; sex: 'male' | 'female'; birthYear: number; goal: 'cut' | 'maintain' | 'bulk'; heightUnit?: 'cm' | 'ftin'; bwUnit?: 'kg' | 'lb'; updated?: number };
