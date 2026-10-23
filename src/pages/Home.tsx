import { BurnBar, useDayEnergy } from './Burn';
import { all } from '../db';
import { useQuery, useSettings } from '../hooks';
import type { DiaryEntry, Exercise, Workout } from '../types';
import { Top } from '../ui';
import { addDays, energy, fmtDate, MONTHS, WD, ymd } from '../util';
import { dayTotals, MacroSummary } from './Nutrition';
import { slotsFor } from '../doses';
import { SlotRow, useDoseData } from './Supps';
import { startWorkout, useActive, useWorkouts, WorkoutCard } from './Workouts';
import { sumN } from '../util';
import { useExercises } from './ExercisePicker';

const weekStart = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };
export function Home() {
  const s = useSettings(); const today = ymd(); const d = useQuery(() => dayTotals(today), [today]); const en = useDayEnergy(today);
  const doses = useDoseData(); const ws = useWorkouts(); const active = useActive(); const exs = new Map(useExercises().map((e) => [e.id, e] as [string, Exercise]));
  const diaryDates = useQuery(() => all<DiaryEntry>('diary').then((l) => new Set(l.map((e) => e.date))), [], new Set<string>());
  const n = d ? sumN([d.food, d.supp]) : undefined;
  const slots = doses ? slotsFor(today, doses.schedules, doses.supps, doses.logs) : [];
  // streaks
  let foodStreak = 0; { let day = diaryDates?.has(today) ? today : addDays(today, -1); while (diaryDates?.has(day)) { foodStreak++; day = addDays(day, -1); } }
  let wkStreak = 0; { const weeks = new Set(ws.map((w) => weekStart(w.start))); let wk = weekStart(Date.now()); if (!weeks.has(wk)) wk = addDays(wk, -7); while (weeks.has(wk)) { wkStreak++; wk = addDays(wk, -7); } }
  let doseStreak = 0; if (doses) { let day = addDays(today, -1); for (let i = 0; i < 365; i++) { const sl = slotsFor(day, doses.schedules, doses.supps, doses.logs); if (!sl.length || sl.some((x) => !x.log)) break; doseStreak++; day = addDays(day, -1); } if (slots.length && slots.every((x) => x.log)) doseStreak++; }
  const weekWorkouts = ws.filter((w) => weekStart(w.start) === weekStart(Date.now())).length;
  const now = new Date();
  return <><Top title="Grug Fit" right={<a class="btn ic" href="#/settings" aria-label="Settings">⚙️</a>} /><div class="page">
    <div class="mut sm" style="margin:-2px 2px 10px">{WD[now.getDay()]} {now.getDate()} {MONTHS[now.getMonth()]}</div>
    <BurnBar date={today} />
    <a class="card" style="display:block;color:inherit;text-decoration:none" href={`#/food/${today}`}>
      <div class="row between" style="margin-bottom:8px"><b>Today's nutrition</b><span class="mut sm">{n ? `${energy(n.kcal, s)} ${s.energyUnit}` : ''} →</span></div>
      {n && <MacroSummary n={n} s={s} compact kcalTarget={en?.target} />}</a>
    <div class="kpi" style="margin-bottom:12px"><div><span class="mut xs">🏋️ Week streak</span><b>{wkStreak}</b><span class="mut xs">{weekWorkouts} this week</span></div><div><span class="mut xs">🍽 Logging streak</span><b>{foodStreak} d</b></div><div><span class="mut xs">💊 Dose streak</span><b>{doseStreak} d</b></div></div>
    <div class="card"><div class="row between"><b>Doses today</b><a class="btn g sm" href="#/calendar">Calendar →</a></div>
      <div class="list">{slots.map((sl) => <SlotRow sl={sl} />)}</div>
      {!slots.length && <div class="mut sm" style="padding:8px 0">No doses scheduled today. <a href="#/supp/new" style="color:var(--acc)">Add a supplement</a></div>}
      {slots.length > 0 && <div class="mut xs">{slots.filter((x) => x.log).length}/{slots.length} taken</div>}</div>
    {active ? <a class="btn p full" href="#/workout/active" style="margin-bottom:12px">▶ Resume {active.name}</a> : <button class="btn p full" style="margin-bottom:12px" onClick={() => startWorkout()}>+ Start workout</button>}
    {ws[0] ? <><div class="row between"><h2>Last workout</h2><a class="btn g sm" href="#/history">History →</a></div><WorkoutCard w={ws[0]} exs={exs} /></> : <div class="card empty">No workouts yet. Start one above or build a routine in the Workout tab.</div>}
    <div class="mut xs center" style="margin-top:10px">All data stays on this device — back up regularly in Settings. Last: {localStorage.getItem('lastBackup') ? fmtDate(+localStorage.getItem('lastBackup')!) : 'never'}</div>
  </div></>;
}
