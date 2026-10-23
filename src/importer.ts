/**
 * v1.8.0: import history from Hevy (workouts CSV) and Cronometer (servings / daily nutrition / biometrics / exercises CSVs).
 * Pure parsing + planning (no DB access) so it is unit-testable; Import.tsx reads the DB, calls buildPlan, then applyPlan writes.
 * Everything runs on the device; files are never uploaded.
 */
import type { BodyWeight, DiaryEntry, Exercise, Meal, Nutrients, SetType, WExercise, WSet, Workout } from './types';
import { detectPRs } from './workoutLogic';
import { setMode } from './setKcal';

export type ImportSource = 'hevy' | 'cronometer';
export type FileKind = 'hevy' | 'cron-servings' | 'cron-daily' | 'cron-bio' | 'cron-exercises' | 'unknown';
export const KIND_LABEL: Record<FileKind, string> = {
  hevy: 'Hevy workouts', 'cron-servings': 'Cronometer food & recipe entries', 'cron-daily': 'Cronometer daily nutrition',
  'cron-bio': 'Cronometer biometrics', 'cron-exercises': 'Cronometer exercises', unknown: 'Not recognised'
};
const LB = 0.45359237, MILE = 1.609344;

// ---------------------------------------------------------------- CSV
/** RFC 4180: quoted fields, "" escapes, commas/newlines inside quotes, BOM, CRLF/CR/LF. Auto-detects ; or tab if there are no commas in the header. */
export function parseCSV(text: string): string[][] {
  text = text.replace(/^\uFEFF/, '');
  const first = text.slice(0, text.search(/\r?\n|$/));
  const delim = first.includes(',') ? ',' : first.includes(';') ? ';' : first.includes('\t') ? '\t' : ',';
  const rows: string[][] = []; let row: string[] = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"' && f === '') q = true;
    else if (c === delim) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}
export type Table = { headers: string[]; rows: Record<string, string>[] };
export function toTable(text: string): Table {
  const [h = [], ...data] = parseCSV(text); const headers = h.map((x) => x.trim());
  return { headers, rows: data.map((r) => Object.fromEntries(headers.map((k, i) => [k, (r[i] ?? '').trim()]))) };
}
export function detectKind(headers: string[]): FileKind {
  const H = new Set(headers.map((x) => x.toLowerCase()));
  if (H.has('exercise_title') && H.has('start_time') && (H.has('set_type') || H.has('reps'))) return 'hevy';
  if (H.has('food name') && H.has('energy (kcal)')) return 'cron-servings';
  if (H.has('metric') && H.has('amount') && (H.has('day') || H.has('date'))) return 'cron-bio';
  if (H.has('exercise') && (H.has('minutes') || H.has('calories burned'))) return 'cron-exercises';
  if (H.has('date') && H.has('energy (kcal)')) return 'cron-daily';
  return 'unknown';
}

// ---------------------------------------------------------------- helpers
/** cyrb53: fast stable 53-bit string hash → base36 */
export function hash(s: string) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
export const numOf = (s: string | undefined): number | null => { if (s == null) return null; const t = s.replace(/[,\s]/g, ''); if (t === '') return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
const pad = (n: number) => String(n).padStart(2, '0');
const ymdOf = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const MON: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
// Month / weekday names in the languages Hevy and spreadsheets use (built once from Intl; English fallback above).
const LOCALES = ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'sv', 'da', 'nb', 'fi', 'pl', 'cs', 'tr', 'ro', 'hu', 'id', 'ca'];
const fold = (w: string) => w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\./g, '');
let NAMES: { month: Map<string, number>; weekday: Set<string> } | null = null;
function names() {
  if (NAMES) return NAMES;
  const month = new Map<string, number>(Object.entries(MON)); const weekday = new Set<string>();
  try {
    for (const l of LOCALES) {
      for (let i = 0; i < 12; i++) for (const st of ['short', 'long'] as const) month.set(fold(new Intl.DateTimeFormat(l, { month: st, timeZone: 'UTC' }).format(new Date(Date.UTC(2026, i, 15)))), i);
      for (let d = 0; d < 7; d++) for (const st of ['short', 'long'] as const) weekday.add(fold(new Intl.DateTimeFormat(l, { weekday: st, timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 9, 18 + d)))));
    }
  } catch { /* no Intl: English only */ }
  month.set('sept', 8); month.set('mrt', 2);
  return (NAMES = { month, weekday });
}
export type DateOrder = 'dmy' | 'mdy';
/** Plausible workout date: 1990 … tomorrow. */
export const plausibleDate = (t: number | null | undefined, now = Date.now()) => t != null && Number.isFinite(t) && t >= Date.UTC(1990, 0, 1) && t <= now + 2 * 864e5;
/** Hevy launched ~2020 (and imports older logs from other apps), so a Hevy workout before 2010 means a misread date (e.g. 2001 / 1970 defaults). */
export const plausibleHevyDate = (t: number | null | undefined, now = Date.now()) => plausibleDate(t, now) && t! >= new Date(2010, 0, 1).getTime();
/**
 * Hevy start/end times. Real exports (2024-2026) use English "d MMM yyyy, HH:mm" local time, e.g. "21 May 2025, 20:44".
 * Also accepted, because files get re-saved by spreadsheets or come from other app versions/locales:
 * "Oct 23, 2026, 7:15 AM", 12h/24h, seconds, 2-digit years, ISO with or without a zone ("…Z" / "+11:00" keep the instant),
 * "2026-10-23 07:15:00", numeric "23/10/2026 07:15", "23.10.2026", "10/23/2026 7:15 PM" (day/month order from `order`,
 * or unambiguous when one part is > 12), and month names in 18 languages ("23 okt. 2026", "23 de oct. de 2026", "23. Oktober 2026").
 * Returns local ms, or null if it can't be read with confidence (never a guessed 1970/2001 date).
 */
export function parseHevyDate(raw: string, order: DateOrder = 'dmy'): number | null {
  const s = (raw || '').trim(); if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})$/i.test(s)) { const t = Date.parse(s.replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2')); return Number.isFinite(t) ? t : null; }
  const toks = s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/\d{1,2}:\d{2}(?::\d{2})?|\p{L}+|\d+/gu) || [];
  let time: number[] | null = null, mer: 'am' | 'pm' | null = null; const nums: string[] = []; const months: { m: number; w: string }[] = [];
  const N = names();
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.includes(':')) { if (time) return null; time = t.split(':').map(Number); continue; }
    if (/^\d+$/.test(t)) { nums.push(t); continue; }
    if (t === 'am' || t === 'pm') { mer = t; continue; }
    if ((t === 'a' || t === 'p') && toks[i + 1] === 'm') { mer = t === 'a' ? 'am' : 'pm'; i++; continue; }
    if (N.month.has(t)) months.push({ m: N.month.get(t)!, w: t });
    else if (t.length >= 3) { const hit = [...N.month.entries()].filter(([k]) => k.length > 3 && k.startsWith(t)).map(([, v]) => v); if (hit.length && hit.every((v) => v === hit[0])) months.push({ m: hit[0], w: t }); }
  }
  let mo: number | undefined;
  if (months.length) { let real = months.length > 1 ? months.filter((x) => !N.weekday.has(x.w)) : months; if (!real.length) real = months; if (new Set(real.map((x) => x.m)).size !== 1) return null; mo = real[0].m; }
  let y: number, m: number, d: number;
  if (mo != null) {
    // "23 Oct 2026", "Oct 23, 2026", "23 Oct 26" – the 4-digit (or last) number is the year
    const yi = nums.findIndex((x) => x.length === 4); const yr = yi >= 0 ? nums[yi] : nums.length >= 2 ? nums[nums.length - 1] : null; if (!yr) return null;
    const rest = nums.filter((_, i) => i !== (yi >= 0 ? yi : nums.length - 1)); if (rest.length !== 1) return null;
    y = +yr; m = mo; d = +rest[0];
  } else {
    if (nums.length !== 3) return null;
    if (nums[0].length === 4) { y = +nums[0]; m = +nums[1] - 1; d = +nums[2]; }
    else {
      const a = +nums[0], b = +nums[1]; y = +nums[2];
      const dmy = a > 12 ? true : b > 12 ? false : order === 'dmy';
      d = dmy ? a : b; m = (dmy ? b : a) - 1;
    }
  }
  if (y < 100) y += 2000;
  let hh = 0, mm = 0, ss = 0;
  if (time) { [hh, mm, ss = 0] = time; if (mer) { if (hh < 1 || hh > 12) return null; hh = (hh % 12) + (mer === 'pm' ? 12 : 0); } }
  if (m < 0 || m > 11 || d < 1 || d > 31 || hh > 23 || mm > 59 || ss > 59) return null;
  const dt = new Date(y, m, d, hh, mm, ss); if (dt.getDate() !== d || dt.getMonth() !== m) return null; // 31 Feb etc.
  return dt.getTime();
}
/** Pick day/month order for a whole file of numeric dates: any first part > 12 → dmy, any second part > 12 → mdy, else the phone's locale. */
export function dateOrderOf(values: string[], fallback: DateOrder = 'dmy'): DateOrder {
  for (const v of values) { const m = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(v); if (!m) continue; if (+m[1] > 12) return 'dmy'; if (+m[2] > 12) return 'mdy'; }
  return fallback;
}
const h12 = (h: number, ap?: string) => (!ap ? h : /p/i.test(ap) ? (h % 12) + 12 : h % 12);
/** "2026-10-20" + optional "07:15" / "7:15 AM" / "07:15:00" → local ms */
function localIso(day: string, time = ''): number | null {
  const d = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(day.trim());
  if (!d) { const t = Date.parse(day + (time ? ' ' + time : '')); return Number.isFinite(t) ? t : null; }
  let hh = d[4] != null ? +d[4] : 0, mm = d[5] != null ? +d[5] : 0, ss = d[6] != null ? +d[6] : 0;
  const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?$/i.exec(time.trim());
  if (t) { hh = h12(+t[1], t[4]); mm = +t[2]; ss = +(t[3] || 0); }
  return new Date(+d[1], +d[2] - 1, +d[3], hh, mm, ss).getTime();
}

// ---------------------------------------------------------------- exercise matching
const normWords = (s: string) => s.toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
export const exKey = (s: string) => normWords(s).join('');
const splitParen = (s: string) => { const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(s); return m ? { base: m[1], paren: m[2] } : { base: s, paren: '' }; };
/** Hevy names that differ from the built-in names */
export const HEVY_ALIASES: Record<string, string> = {
  'Triceps Pushdown': 'Triceps Pushdown (Cable)', 'Triceps Rope Pushdown': 'Triceps Pushdown (Cable)', 'Face Pull': 'Face Pull (Cable)',
  'Seated Cable Row - V Grip (Cable)': 'Seated Cable Row', 'Seated Cable Row - Bar Grip': 'Seated Cable Row', 'Seated Row (Cable)': 'Seated Cable Row',
  'Lat Pulldown - Close Grip (Cable)': 'Lat Pulldown (Cable)', 'Lat Pulldown (Machine)': 'Lat Pulldown (Cable)',
  'Skullcrusher (Barbell)': 'Skullcrusher (EZ Bar)', 'Skullcrusher (EZ Bar)': 'Skullcrusher (EZ Bar)', 'Preacher Curl (Barbell)': 'Preacher Curl (EZ Bar)', 'EZ Bar Biceps Curl': 'Bicep Curl (Barbell)',
  'Overhead Press (Dumbbell)': 'Shoulder Press (Dumbbell)', 'Seated Overhead Press (Dumbbell)': 'Shoulder Press (Dumbbell)', 'Seated Shoulder Press (Machine)': 'Shoulder Press (Machine)',
  'Standing Military Press (Barbell)': 'Overhead Press (Barbell)', 'Shoulder Press (Barbell)': 'Overhead Press (Barbell)',
  'Bent Over Row (Dumbbell)': 'Dumbbell Row', 'Single Arm Dumbbell Row': 'Dumbbell Row', 'Dumbbell Row': 'Dumbbell Row',
  'Butterfly (Pec Deck)': 'Pec Deck (Machine)', 'Chest Fly (Machine)': 'Pec Deck (Machine)', 'Rear Delt Reverse Fly (Dumbbell)': 'Rear Delt Fly (Dumbbell)', 'Rear Delt Reverse Fly (Machine)': 'Reverse Pec Deck (Machine)',
  'Seated Calf Raise': 'Seated Calf Raise (Machine)', 'Calf Raise (Machine)': 'Standing Calf Raise (Machine)', 'Ab Wheel': 'Ab Wheel Rollout', 'Lunge (Dumbbell)': 'Walking Lunge (Dumbbell)',
  'Triceps Extension (Cable)': 'Overhead Triceps Extension (Cable)', 'Triceps Extension (Dumbbell)': 'Overhead Triceps Extension (Dumbbell)', 'Bench Dip': 'Triceps Dip',
  'Straight Arm Lat Pulldown (Cable)': 'Straight Arm Pulldown', 'Lat Pulldown - Wide Grip (Cable)': 'Lat Pulldown (Cable)', 'Wide Grip Lat Pulldown (Cable)': 'Lat Pulldown (Cable)',
  'Seated Incline Curl (Dumbbell)': 'Incline Curl (Dumbbell)', 'Incline Dumbbell Curl': 'Incline Curl (Dumbbell)', 'Bench Press - Close Grip (Barbell)': 'Close Grip Bench Press', 'Close Grip Bench Press (Barbell)': 'Close Grip Bench Press',
  'Single Arm Lateral Raise (Cable)': 'Lateral Raise (Cable)', 'Single Arm Triceps Pushdown (Cable)': 'Triceps Pushdown (Cable)', 'Triceps Pushdown (Cable - Straight Bar)': 'Triceps Pushdown (Cable)',
  'Glute Kickback (Cable)': 'Cable Kickback', 'Cable Crossover': 'Cable Fly Crossovers', 'Cable Fly': 'Cable Fly Crossovers', 'Chest Fly (Cable)': 'Cable Fly Crossovers',
  'Iso-Lateral Row (Machine)': 'Seated Row (Machine)', 'Seated Row (Machine)': 'Seated Row (Machine)', 'Hammer Strength Row': 'Seated Row (Machine)',
  'Calf Raise': 'Calf Raise (Bodyweight)', 'Standing Calf Raise': 'Calf Raise (Bodyweight)', 'Standing Calf Raise (Bodyweight)': 'Calf Raise (Bodyweight)', 
  'Leg Extension': 'Leg Extension (Machine)', 'Leg Press': 'Leg Press (Machine)', 'Lying Leg Curl': 'Lying Leg Curl (Machine)', 'Seated Leg Curl': 'Seated Leg Curl (Machine)', 
  'Hip Thrust': 'Hip Thrust (Barbell)', 'Bulgarian Split Squat': 'Bulgarian Split Squat (Dumbbell)', 'Split Squat (Dumbbell)': 'Bulgarian Split Squat (Dumbbell)',
  'Walking Lunge': 'Walking Lunge (Dumbbell)', 'Lunge': 'Walking Lunge (Dumbbell)', 'Goblet Squat (Kettlebell)': 'Goblet Squat (Dumbbell)', 'Step Up': 'Step Up (Dumbbell)',
  'Romanian Deadlift': 'Romanian Deadlift (Barbell)', 'Stiff Leg Deadlift (Barbell)': 'Romanian Deadlift (Barbell)', 'Sumo Deadlift': 'Sumo Deadlift (Barbell)', 'Deadlift': 'Deadlift (Barbell)',
  'Bench Press': 'Bench Press (Barbell)', 'Incline Bench Press': 'Incline Bench Press (Barbell)', 'Squat': 'Squat (Barbell)', 'Back Squat (Barbell)': 'Squat (Barbell)', 'Front Squat': 'Front Squat (Barbell)',
  'Overhead Press': 'Overhead Press (Barbell)', 'Military Press (Barbell)': 'Overhead Press (Barbell)', 'Seated Overhead Press (Barbell)': 'Overhead Press (Barbell)', 'Shoulder Press (Machine Plates)': 'Shoulder Press (Machine)',
  'Bent Over Row': 'Bent Over Row (Barbell)', 'Barbell Row': 'Bent Over Row (Barbell)', 'T Bar Row': 'T-Bar Row', 'Chest Supported T Bar Row': 'T-Bar Row',
  'Pull Up (Weighted)': 'Pull Up', 'Chin Up (Weighted)': 'Chin Up', 'Push Up (Weighted)': 'Push Up', 'Chest Dip (Weighted)': 'Chest Dip', 'Triceps Dip (Weighted)': 'Triceps Dip', 'Dip': 'Chest Dip',
  'Hammer Curl': 'Hammer Curl (Dumbbell)', 'Bicep Curl': 'Bicep Curl (Dumbbell)', 'Biceps Curl (Dumbbell)': 'Bicep Curl (Dumbbell)', 'Biceps Curl (Barbell)': 'Bicep Curl (Barbell)', 'Biceps Curl (Cable)': 'Bicep Curl (Cable)',
  'Cable Curl': 'Bicep Curl (Cable)', 'Concentration Curl (Dumbbell)': 'Concentration Curl', 'Lying Triceps Extension (Barbell)': 'Skullcrusher (EZ Bar)', 'Overhead Triceps Extension': 'Overhead Triceps Extension (Dumbbell)',
  'Shrug': 'Shrug (Dumbbell)', 'Plank (Bodyweight)': 'Plank', 'Kneeling Cable Crunch': 'Cable Crunch', 
  'Kettlebell Swing (Kettlebell)': 'Kettlebell Swing', 'Farmers Walk': "Farmer's Walk (Dumbbell)", 'Farmer Carry': "Farmer's Walk (Dumbbell)", 'Clean (Barbell)': 'Power Clean (Barbell)', 'Thruster': 'Thruster (Barbell)',
  'Leg Press Horizontal (Machine)': 'Leg Press (Machine)', 'Hip Abduction (Machine)': 'Hip Abduction (Machine)', 'Back Extension (Hyperextension)': 'Back Extension'
};
const EQUIP: [RegExp, string][] = [[/smith|machine|assisted|lever|hammer strength|plate loaded/i, 'Machine'], [/ez bar|barbell|trap bar|landmine/i, 'Barbell'], [/dumbbell/i, 'Dumbbell'], [/cable|rope/i, 'Cable'], [/kettlebell/i, 'Kettlebell'], [/band/i, 'Band'], [/bodyweight|weighted/i, 'Bodyweight']];
const MUSCLE: [RegExp, string][] = [
  [/\b(run|running|jog|walk|walking|treadmill|cycling|bike|biking|spin|elliptical|stair|rowing machine|row erg|rower|swim|jump rope|skipping|hiking|cardio|sprint)\b/i, 'Cardio'],
  [/leg curl|romanian|rdl|good morning|hamstring|nordic/i, 'Hamstrings'], [/hip thrust|glute|abduct|kickback|bridge/i, 'Glutes'], [/calf|calves/i, 'Calves'],
  [/squat|lunge|leg press|leg extension|step up|split squat|sissy/i, 'Quadriceps'], [/shrug/i, 'Traps'],
  [/crunch|plank|\bab\b|abs|leg raise|twist|sit up|situp|core|oblique|dead bug|hollow|pallof/i, 'Core'],
  [/tricep|pushdown|skull|dip|close grip/i, 'Triceps'], [/curl/i, 'Biceps'], [/wrist|forearm|grip/i, 'Forearms'],
  [/bench|chest|fly|pec|push ?up|press up/i, 'Chest'], [/row|pulldown|pull ?up|chin ?up|deadlift|back extension|lat\b|pullover/i, 'Back'],
  [/overhead|shoulder|military|lateral|delt|raise|arnold|upright|face pull/i, 'Shoulders'], [/clean|snatch|thruster|burpee|swing|carry|farmer/i, 'Full Body']
];
export function guessExercise(name: string): Pick<Exercise, 'muscle' | 'equipment'> {
  const { paren } = splitParen(name);
  const equipment = (EQUIP.find(([re]) => re.test(paren)) || EQUIP.find(([re]) => re.test(name)))?.[1] || (paren ? 'Other' : 'Bodyweight');
  const muscle = MUSCLE.find(([re]) => re.test(name))?.[1] || 'Other';
  return { muscle, equipment: muscle === 'Cardio' && !paren ? 'Other' : equipment };
}
const eqOf = (paren: string) => (/smith/i.test(paren) ? 'Smith' : EQUIP.find(([re]) => re.test(paren))?.[1]);
/** Find an existing exercise for a Hevy title: user merge alias → exact (normalised) → alias → base name with the same equipment
 *  (a bare built-in, or a built-in whose bracket is the same kind of equipment, e.g. "(Barbell)" ≈ "(EZ Bar)"; Smith ≠ Machine) if unique. */
export function matchExercise(title: string, exercises: Exercise[], userAliases: Record<string, string> = {}): Exercise | undefined {
  const byKey = new Map<string, Exercise>(); for (const e of exercises) if (!byKey.has(exKey(e.name)) || !e.custom) byKey.set(exKey(e.name), e);
  const k = exKey(title);
  if (userAliases[k]) { const u = exercises.find((e) => e.id === userAliases[k]); if (u) return u; }
  if (byKey.has(k)) return byKey.get(k);
  const alias = Object.entries(HEVY_ALIASES).find(([a]) => exKey(a) === k)?.[1]; if (alias && byKey.has(exKey(alias))) return byKey.get(exKey(alias));
  const { base, paren } = splitParen(title); const bk = exKey(base); const eq = paren ? eqOf(paren) : undefined;
  const same = exercises.filter((e) => exKey(splitParen(e.name).base) === bk);
  let cands = same.filter((e) => { const sp = splitParen(e.name); return !paren || (!sp.paren && e.equipment === eq); });
  if (!cands.length && paren && eq) cands = same.filter((e) => { const sp = splitParen(e.name); return !e.custom && !!sp.paren && eqOf(sp.paren) === eq; });
  if (cands.length > 1) { const builtIn = cands.filter((e) => !e.custom); if (builtIn.length === 1) cands = builtIn; }
  return cands.length === 1 ? cands[0] : undefined;
}

// ---------------------------------------------------------------- plan
export type FileSummary = { name: string; kind: FileKind; source?: ImportSource; rows: number; from?: string; to?: string; counts: Record<string, number>; note?: string };
export type Existing = { exercises: Exercise[]; workouts: Workout[]; diaryIds: Set<string>; diaryCronDates: Set<string>; bodyweight: BodyWeight[]; defaultRest: number; /** exKey(name) → exercise id, from 'Merge into existing' */ exAliases?: Record<string, string> };
export type Plan = {
  files: FileSummary[]; workouts: Workout[]; activities: Workout[]; exercises: Exercise[]; diary: DiaryEntry[]; bodyweight: BodyWeight[];
  matched: string[]; created: string[]; skipped: { workouts: number; diary: number; days: number; weighIns: number; activities: number; badDates?: number }; sets: number; warnings: string[];
};
export type Input = { name: string; text: string };
const NUTR: [keyof Nutrients, string, number?][] = [
  ['kcal', 'Energy (kcal)'], ['protein', 'Protein (g)'], ['carbs', 'Carbs (g)'], ['fibre', 'Fiber (g)'], ['fat', 'Fat (g)'], ['satfat', 'Saturated (g)'], ['sugar', 'Sugars (g)'],
  ['calcium', 'Calcium (mg)'], ['iron', 'Iron (mg)'], ['vitC', 'Vitamin C (mg)'], ['vitA', 'Vitamin A (µg)'], ['vitD', 'Vitamin D (IU)', 1 / 40], ['b12', 'B12 (Cobalamin) (µg)'],
  ['folate', 'Folate (µg)'], ['magnesium', 'Magnesium (mg)'], ['potassium', 'Potassium (mg)'], ['sodium', 'Sodium (mg)']
];
function nutrients(r: Record<string, string>): Nutrients {
  const n: any = { kcal: 0, protein: 0, carbs: 0, fibre: 0, fat: 0 };
  for (const [k, col, f] of NUTR) { const v = numOf(r[col] ?? r[col.replace('µ', 'u')]); if (v != null) n[k] = v * (f ?? 1); }
  // some exports only carry net carbs: total = net + fibre
  if (!(numOf(r['Carbs (g)']) != null) && numOf(r['Net Carbs (g)']) != null) n.carbs = numOf(r['Net Carbs (g)'])! + (n.fibre || 0);
  return n;
}
export function mealOf(group: string, t: number | null): Meal {
  if (/breakfast|morning/i.test(group)) return 'breakfast'; if (/lunch/i.test(group)) return 'lunch'; if (/dinner|supper|tea/i.test(group)) return 'dinner';
  if (!group.trim() && t != null) { const h = new Date(t).getHours(); return h < 11 ? 'breakfast' : h < 15 ? 'lunch' : h >= 17 && h < 22 ? 'dinner' : 'snacks'; }
  return 'snacks';
}
const range = (ts: number[]) => (ts.length ? { from: ymdOf(Math.min(...ts)), to: ymdOf(Math.max(...ts)) } : {});

export function buildPlan(inputs: Input[], ex: Existing, opts: { cronExercises?: boolean; dateOrder?: DateOrder; now?: number } = {}): Plan {
  const plan: Plan = { files: [], workouts: [], activities: [], exercises: [], diary: [], bodyweight: [], matched: [], created: [], skipped: { workouts: 0, diary: 0, days: 0, weighIns: 0, activities: 0 }, sets: 0, warnings: [] };
  const wIds = new Set(ex.workouts.map((w) => w.id)); const exList = [...ex.exercises]; const exCache = new Map<string, Exercise>();
  const bwDates = new Set(ex.bodyweight.map((b) => b.date)); const servDates = new Set<string>(ex.diaryCronDates);
  const tables = inputs.map((f) => { const t = toTable(f.text); return { f, t, kind: detectKind(t.headers) }; });
  const resolveEx = (title: string): Exercise => {
    const k = exKey(title); if (exCache.has(k)) return exCache.get(k)!;
    let e = matchExercise(title, exList, ex.exAliases);
    if (e) { if (!plan.matched.includes(title)) plan.matched.push(title); }
    else { e = { id: 'cx-hevy-' + hash(k), name: title.trim(), ...guessExercise(title), custom: true, importSource: 'hevy' }; exList.push(e); plan.exercises.push(e); plan.created.push(title.trim()); }
    exCache.set(k, e); return e;
  };
  // servings first so daily totals can skip days that have per-food entries
  const order: FileKind[] = ['hevy', 'cron-servings', 'cron-daily', 'cron-bio', 'cron-exercises', 'unknown'];
  tables.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  for (const { f, t, kind } of tables) {
    const fs: FileSummary = { name: f.name, kind, rows: t.rows.length, counts: {} }; plan.files.push(fs);
    if (kind === 'unknown') { fs.note = 'Unrecognised columns – expected a Hevy workouts export or a Cronometer export.'; continue; }
    fs.source = kind === 'hevy' ? 'hevy' : 'cronometer';
    if (kind === 'hevy') {
      const H = new Set(t.headers); const lbs = H.has('weight_lbs') && !H.has('weight_kg'); const miles = H.has('distance_miles') && !H.has('distance_km');
      const order = dateOrderOf(t.rows.map((r) => r.start_time), opts.dateOrder);
      const groups = new Map<string, Record<string, string>[]>();
      for (const r of t.rows) { const k = `${r.title}\u0001${r.start_time}`; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); }
      const ts: number[] = []; let nw = 0, ns = 0;
      for (const rows of groups.values()) {
        const r0 = rows[0]; const start = parseHevyDate(r0.start_time, order);
        if (!plausibleHevyDate(start, opts.now)) { plan.warnings.push(`${f.name}: skipped a workout with an unreadable date “${r0.start_time}”`); plan.skipped.badDates = (plan.skipped.badDates || 0) + 1; continue; }
        ts.push(start!); const id = 'hevy-' + hash(`hevy|${r0.start_time}|${r0.title}`);
        if (wIds.has(id)) { plan.skipped.workouts++; continue; }
        const endP = parseHevyDate(r0.end_time || '', order); const end = endP != null && endP > start! && endP - start! < 24 * 3600e3 ? endP : start! + 3600e3;
        const exercises: WExercise[] = []; let cur: WExercise | null = null; let curTitle = '';
        rows.forEach((r, i) => {
          const title = r.exercise_title || 'Exercise';
          if (!cur || title !== curTitle) { const e = resolveEx(title); cur = { id: `${id}-e${exercises.length}`, exerciseId: e.id, restSec: ex.defaultRest, sets: [], ...(r.exercise_notes ? { notes: r.exercise_notes } : {}) }; exercises.push(cur); curTitle = title; }
          else if (r.exercise_notes && !cur.notes) cur.notes = r.exercise_notes;
          const e = exCache.get(exKey(title))!; const mode = setMode(e);
          const w = numOf(lbs ? r.weight_lbs : r.weight_kg); const kg = w == null ? null : Math.round((lbs ? w * LB : w) * 1000) / 1000;
          const dist = numOf(miles ? r.distance_miles : r.distance_km); const km = dist == null ? null : Math.round((miles ? dist * MILE : dist) * 1000) / 1000;
          const dur = numOf(r.duration_seconds); let reps = numOf(r.reps);
          if (mode === 'hold' && reps == null && dur != null) reps = dur;
          if (mode === 'cardio') reps = dur != null ? Math.round((dur / 60) * 10) / 10 : reps;
          if (kg == null && reps == null && km == null && dur == null) return;
          const st = (r.set_type || 'normal').toLowerCase().replace(/[\s_-]/g, '');
          const type: SetType = st === 'warmup' ? 'W' : st === 'failure' ? 'F' : st === 'dropset' ? 'D' : st === 'cooldown' ? 'W' : 'N';
          const set: WSet = { id: `${id}-s${i}`, type, kg: mode === 'cardio' ? null : kg, reps, rpe: numOf(r.rpe), done: true, ...(km != null ? { km } : {}) };
          cur!.sets.push(set); ns++;
        });
        const wo: Workout = { id, name: r0.title || 'Workout', start: start!, end, exercises: exercises.filter((e) => e.sets.length), importSource: 'hevy', srcStart: r0.start_time, srcEnd: r0.end_time || '', ...(r0.description ? { notes: r0.description } : {}) };
        if (!wo.exercises.length) continue;
        plan.workouts.push(wo); wIds.add(id); nw++;
      }
      plan.sets += ns; Object.assign(fs, range(ts)); fs.counts = { workouts: nw, sets: ns };
      if (lbs) fs.note = 'Weights in lb, converted to kg'; if (miles) fs.note = (fs.note ? fs.note + '; ' : '') + 'distances in miles, converted to km';
    }
    if (kind === 'cron-servings') {
      const seen = new Map<string, number>(); const ts: number[] = []; let n = 0;
      for (const r of t.rows) {
        const name = r['Food Name']; const day = r.Day || r.Date; if (!name || !day) continue;
        const t0 = localIso(day, r.Time || ''); if (t0 == null) continue; const date = ymdOf(localIso(day) ?? t0); ts.push(t0);
        const base = `cron|${day}|${r.Time || ''}|${r.Group || ''}|${name}|${r.Amount || ''}|${r['Energy (kcal)'] || ''}`; const occ = seen.get(base) || 0; seen.set(base, occ + 1);
        const id = 'cron-' + hash(base + '|' + occ); servDates.add(date);
        if (ex.diaryIds.has(id)) { plan.skipped.diary++; continue; }
        const am = /^\s*([\d.,]+)\s*(.*)$/.exec(r.Amount || ''); const qty = am ? numOf(am[1]) ?? 1 : 1; const unit = (am?.[2] || '').trim();
        const isG = /^(g|grams?)$/i.test(unit), isMl = /^(ml|millilit(re|er)s?)$/i.test(unit);
        const e: DiaryEntry = { id, date, meal: mealOf(r.Group || '', r.Time ? t0 : null), foodId: 'import-' + hash(name.toLowerCase()), name, n: nutrients(r), created: t0, importSource: 'cronometer',
          ...(isG || isMl ? { grams: qty, qty, serving: isMl ? 'ml' : 'g' } : { grams: 100, qty, serving: 'serving', amountLabel: r.Amount ? r.Amount.replace(/(\d)\.00\b/, '$1') : '1 serving' }) } as DiaryEntry;
        plan.diary.push(e); n++;
      }
      Object.assign(fs, range(ts)); fs.counts = { 'food entries': n };
    }
    if (kind === 'cron-daily') {
      const hasGroup = t.headers.includes('Group'); const ts: number[] = []; let n = 0; const covered: string[] = [];
      for (const r of t.rows) {
        const day = r.Date || r.Day; const t0 = day ? localIso(day) : null; if (t0 == null) continue; const date = ymdOf(t0);
        const nn = nutrients(r); if (!(nn.kcal > 0 || nn.protein > 0 || nn.carbs > 0 || nn.fat > 0)) continue; ts.push(t0);
        if (hasGroup && !r.Group) continue; // with "Include diary group rows" use the per-meal rows
        if (servDates.has(date)) { if (!covered.includes(date)) covered.push(date); plan.skipped.days++; continue; }
        const id = 'cron-day-' + hash(`cron-day|${date}|${r.Group || ''}`); if (ex.diaryIds.has(id)) { plan.skipped.diary++; continue; }
        plan.diary.push({ id, date, meal: hasGroup ? mealOf(r.Group, null) : 'snacks', foodId: 'import-cron-day', name: hasGroup ? `Cronometer ${r.Group} total` : 'Cronometer daily total', grams: 100, qty: 1, serving: 'serving', amountLabel: hasGroup ? `${r.Group} total` : 'daily total', n: nn, created: t0, importSource: 'cronometer' } as DiaryEntry);
        n++;
      }
      Object.assign(fs, range(ts)); fs.counts = { [hasGroup ? 'meal totals' : 'daily totals']: n };
      if (covered.length) fs.note = `${covered.length} day(s) skipped: they already have individual food entries`;
    }
    if (kind === 'cron-bio') {
      const last = new Map<string, { kg: number; t: number }>(); const ts: number[] = []; let other = 0;
      for (const r of t.rows) {
        if (!/^(body\s*)?weight$/i.test(r.Metric || '')) { other++; continue; }
        const day = r.Day || r.Date; const t0 = day ? localIso(day, r.Time || '') : null; const v = numOf(r.Amount); if (t0 == null || v == null || v <= 0) continue;
        const kg = /lb/i.test(r.Unit || '') ? v * LB : /st/i.test(r.Unit || '') ? v * 6.35029318 : v; const date = ymdOf(localIso(day!) ?? t0); ts.push(t0);
        const p = last.get(date); if (!p || t0 >= p.t) last.set(date, { kg: Math.round(kg * 100) / 100, t: t0 });
      }
      let n = 0; for (const [date, v] of last) { if (bwDates.has(date)) { plan.skipped.weighIns++; continue; } plan.bodyweight.push({ id: 'bw' + date, date, kg: v.kg, importSource: 'cronometer' } as BodyWeight); bwDates.add(date); n++; }
      Object.assign(fs, range(ts)); fs.counts = { 'weigh-ins': n }; if (other) fs.note = `${other} other biometric row(s) (not weight) not imported`;
    }
    if (kind === 'cron-exercises') {
      const ts: number[] = []; let n = 0; const seen = new Map<string, number>();
      for (const r of t.rows) {
        const name = r.Exercise; const day = r.Day || r.Date; const t0 = day ? localIso(day, r.Time || '') : null; if (!name || t0 == null) continue; ts.push(t0);
        const min = numOf(r.Minutes) ?? 0; const kcal = Math.abs(numOf(r['Calories Burned']) ?? 0);
        if (!opts.cronExercises) continue;
        const base = `cron-ex|${day}|${r.Time || ''}|${name}|${r.Minutes || ''}|${r['Calories Burned'] || ''}`; const occ = seen.get(base) || 0; seen.set(base, occ + 1);
        const id = 'cron-ex-' + hash(base + '|' + occ); if (wIds.has(id)) { plan.skipped.activities++; continue; }
        const start = r.Time ? t0 : t0 + 12 * 3600e3;
        plan.activities.push({ id, name, start, end: start + Math.max(1, min) * 60e3, exercises: [], kcalOverride: Math.round(kcal), importSource: 'cronometer', notes: 'Imported from Cronometer (calories as logged there)' }); wIds.add(id); n++;
      }
      Object.assign(fs, range(ts)); fs.counts = { activities: opts.cronExercises ? n : 0 };
      fs.note = opts.cronExercises ? 'Logged as calorie-only activities (calories from Cronometer)' : `${t.rows.length} exercise row(s) found – tick the box below to import them as calorie-only activities`;
    }
  }
  // PRs: chronological, against existing + earlier imported workouts
  const hist = [...ex.workouts]; for (const w of [...plan.workouts].sort((a, b) => a.start - b.start)) { w.prs = detectPRs(w, hist); hist.push(w); }
  return plan;
}
