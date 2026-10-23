import type { Nutrients, WSet, Settings } from './types';
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s: string, n: number) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const daysBetween = (a: string, b: string) => Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 864e5);
export const fmtDate = (s: string | number | Date) => { const d = typeof s === 'string' ? parseYmd(s) : new Date(s); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
export const fmtDM = (s: string | number | Date) => { const d = typeof s === 'string' ? parseYmd(s) : new Date(s); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
export const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const fmtDay = (s: string) => { const d = parseYmd(s); const t = ymd(); if (s === t) return 'Today'; if (s === addDays(t, -1)) return 'Yesterday'; if (s === addDays(t, 1)) return 'Tomorrow'; return `${WD[d.getDay()]} ${fmtDM(s)}`; };
export const fmtTime = (t: number) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fmtDur = (ms: number) => { const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}h ${m}m` : m ? `${m}m ${pad(x)}s` : `${x}s`; };
export const fmtClock = (sec: number) => `${Math.floor(sec / 60)}:${pad(Math.max(0, Math.floor(sec % 60)))}`;
export const r1 = (n: number) => Math.round(n * 10) / 10;
export const r0 = (n: number) => Math.round(n);
export const e1rm = (kg: number, reps: number) => (reps <= 0 ? 0 : reps === 1 ? kg : kg * (1 + reps / 30)); // Epley
export const setVolume = (s: WSet) => (s.kg || 0) * (s.reps || 0);
export const workingSets = (sets: WSet[]) => sets.filter((s) => s.done && s.type !== 'W' && s.reps);

export const EMPTY: Nutrients = { kcal: 0, protein: 0, carbs: 0, fibre: 0, fat: 0 };
export const MICROS: { key: keyof Nutrients; label: string; unit: string }[] = [
  { key: 'calcium', label: 'Calcium', unit: 'mg' }, { key: 'iron', label: 'Iron', unit: 'mg' },
  { key: 'vitC', label: 'Vitamin C', unit: 'mg' }, { key: 'vitA', label: 'Vitamin A', unit: 'µg' },
  { key: 'vitD', label: 'Vitamin D', unit: 'µg' }, { key: 'b12', label: 'Vitamin B12', unit: 'µg' },
  { key: 'folate', label: 'Folate', unit: 'µg' }, { key: 'magnesium', label: 'Magnesium', unit: 'mg' },
  { key: 'potassium', label: 'Potassium', unit: 'mg' }, { key: 'sodium', label: 'Sodium', unit: 'mg' }
];
export const NKEYS: (keyof Nutrients)[] = ['kcal', 'protein', 'carbs', 'fibre', 'fat', 'satfat', 'sugar', ...MICROS.map((m) => m.key)];
export const scaleN = (n: Partial<Nutrients>, f: number): Nutrients => { const o: any = { ...EMPTY }; for (const k of NKEYS) if (n[k] != null) o[k] = (n[k] as number) * f; return o; };
export const addN = (a: Nutrients, b: Partial<Nutrients>): Nutrients => { const o: any = { ...a }; for (const k of NKEYS) if (b[k] != null) o[k] = (o[k] || 0) + (b[k] as number); return o; };
export const sumN = (list: Partial<Nutrients>[]) => list.reduce<Nutrients>((a, b) => addN(a, b), { ...EMPTY });
export const netCarbs = (n: Nutrients) => Math.max(0, (n.carbs || 0) - (n.fibre || 0));

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  targets: { kcal: 1800, protein: 157.5, carbs: 202.5 /* net carbs target */, fibre: 30, fat: 40,
    calcium: 1000, iron: 8, vitC: 45, vitA: 900, vitD: 15, b12: 2.4, folate: 400, magnesium: 420, potassium: 3800, sodium: 2000 },
  energyUnit: 'kcal', weightUnit: 'kg', defaultRest: 90, vibrate: true, reminders: false
};
export const KJ = 4.184;
export const energy = (kcal: number, s: Settings) => (s.energyUnit === 'kJ' ? r0(kcal * KJ) : r0(kcal));
export const LB = 2.20462;
export const wDisp = (kg: number | null | undefined, s: Settings) => (kg == null ? '' : s.weightUnit === 'lb' ? r1(kg * LB) : r1(kg));
export const wIn = (v: number, s: Settings) => (s.weightUnit === 'lb' ? v / LB : v);
export const vibrate = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch {} };
