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
  /** Hevy import: start/end text exactly as in the CSV (provenance / lets a later version re-derive dates) */
  srcStart?: string; srcEnd?: string;
  /** ended automatically at the last completed set; needsReview until the user confirms/edits/resumes */ autoEnded?: boolean; needsReview?: boolean; autoEndedAt?: number };
export type PR = { exerciseId: string; kind: '1rm' | 'weight' | 'volume' | 'reps'; value: number };
export type RoutineEx = { exerciseId: string; sets: number; reps?: number; kg?: number; restSec: number };
export type Routine = { id: string; name: string; exercises: RoutineEx[]; notes?: string; updated: number };
export type BodyWeight = ImportTag & { id: string; date: string; kg: number };
/** A unit of a food. `grams` = grams (or ml for liquids) in ONE of this unit. Base units 'g'/'ml' are implicit and not stored. */
export type Serving = { label: string; grams: number; note?: string; kind?: 'serving' | 'package' | 'custom' };
export type Food = ImportTag & {
  /** imported foods logged in units of unknown weight (e.g. Cronometer '1 cup'): per100 is per 100 'pseudo-grams' = 1 unit; the grams unit is hidden */
  gramsUnknown?: boolean;
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
export type DiaryEntry = ImportTag & { id: string; date: string; meal: Meal; foodId: string; name: string; grams: number; qty: number; serving: string; n: Nutrients; created: number; /** imported entries whose grams are unknown: amount as logged in the other app, e.g. '1 cup' */ amountLabel?: string;
  /** v1.10.0 logged from a Smart Estimate (shown with an 'est.' badge): overall confidence + the one-line assumption note */ est?: { conf: 'low' | 'med' | 'high'; note?: string } };
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
  /** v1.9.1 manual steps: daily goal (undefined = 8,000, 0 = no goal) */
  stepGoal?: number;
  /** v1.9.2 display name, kept on this device (sent only if you join the v1.12.0 leaderboard; a future account id would be separate) */
  username?: string;
  /** Home 'Fitness fact of the day' card: open (default), collapsed, or off */
  factCard?: 'open' | 'collapsed' | 'off';
  /** v1.9.2 Settings › Appearance (also mirrored to localStorage for a flash-free start) */
  theme?: { mode: 'dark' | 'light' | 'amoled' | 'system'; accent: string };
  /** v1.9.3 seasonal overlay choice per season+year, e.g. { 'halloween-2026': 'off' } (default on during the season) */
  seasonal?: Record<string, 'on' | 'off'>;
  /** v1.10.0 Smart Estimate first-open notice accepted ('Got it', timestamp; also covers sending the description/photo) */
  estNotice?: number;
  /** v1.11.0 weekly workout goal for the Training stars (default 3) */
  workoutGoal?: number;
  /** v1.11.0 per-device admin token issued by the coach proxy after a valid admin code (the code itself is never stored) */
  adminToken?: string;
  /** v1.12.0 leaderboard: opted in (shares username + Grug rating), and when the first-open question was answered */
  lbJoin?: boolean; lbAsked?: number;
  /** onboarding finished/skipped (timestamp) */
  onboarded?: number;
};
export type Profile = { heightCm: number; sex: 'male' | 'female'; birthYear: number; goal: 'cut' | 'maintain' | 'bulk'; heightUnit?: 'cm' | 'ftin'; bwUnit?: 'kg' | 'lb'; updated?: number };
