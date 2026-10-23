import { useQuery, useNow, useSettings } from '../hooks';
import { dayEnergy } from '../energy';
import { energy, sumN, ymd } from '../util';
import { dayTotals } from './Nutrition';

/** Header strip: estimated calories burned today (sedentary + workouts) and calories remaining vs target. */
export function useDayEnergy(date: string) {
  const s = useSettings(); const now = useNow(30000);
  return useQuery(() => dayEnergy(date, s, Date.now()), [date, s, Math.floor(now / 30000)]);
}
export function BurnBar({ date = ymd() }: { date?: string }) {
  const s = useSettings(); const e = useDayEnergy(date);
  const d = useQuery(() => dayTotals(date), [date]);
  const eu = s.energyUnit; const today = date === ymd();
  if (!e) return null;
  if (e.burned == null) return <a class="burnbar" href="#/welcome?from=settings" data-testid="burnbar"><span>🔥 Set up your profile to see calories burned</span><b>→</b></a>;
  const eaten = d ? sumN([d.food, d.supp]).kcal : 0; const rem = e.target - eaten; const live = e.workouts.some((w) => w.live);
  return <div class="burnbar" data-testid="burnbar">
    <div><div class="mut xs">🔥 Burned {today ? 'today' : 'this day'}{live ? ' (live)' : ''}</div><b data-testid="burned">{energy(e.burned, s)} {eu}</b>
      <div class="mut xs" data-testid="burn-split">{energy(e.sedentary!, s)} resting{e.workoutKcal ? ` + ${energy(e.workoutKcal, s)} workout` : ''}</div></div>
    <div style="text-align:right" class={'rem ' + (rem < 0 ? 'over' : '')}><div class="mut xs">Remaining</div><b data-testid="remaining">{energy(Math.abs(rem), s)} {eu}{rem < 0 ? ' over' : ''}</b>
      <div class="mut xs">target {energy(e.target, s)}{e.eatBack && e.workoutKcal ? ' incl. workout' : ''} − eaten {energy(eaten, s)}</div></div>
  </div>;
}
