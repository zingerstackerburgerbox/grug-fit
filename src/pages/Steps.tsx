/** v1.9.1 manual steps: compact card on the Workout tab (today, goal progress, quick "Log steps"), #/steps page
 * (any date, 7-day chart, recent days), Settings › Steps goal. Calories feed burned-today (see steps.ts). */
import { useEffect, useRef, useState } from 'preact/hooks';
import { getSettings, put } from '../db';
import { go, useQuery, useSettings } from '../hooks';
import { Bar, BarChart, Top, num, toast } from '../ui';
import { addDays, fmtDay, parseYmd, WD, ymd } from '../util';
import { daySteps, MAX_STEPS, setSteps, STEP_BASELINE, stepGoal, stepLog } from '../steps';
import { dayEnergy } from '../energy';

export const fmtN = (n: number) => Math.round(n).toLocaleString('en-AU');
const useLog = () => useQuery(stepLog, [], {} as Record<string, number>) || {};

/** number input that saves a day's total (empty/0 clears it) */
function StepInput({ date, onDone, autoFocus }: { date: string; onDone?: () => void; autoFocus?: boolean }) {
  const log = useLog(); const [v, setV] = useState(log[date] ? String(log[date]) : ''); const ref = useRef<HTMLInputElement>(null);
  const prev = useRef(`${date}|${log[date] || ''}`); // re-sync only when the date or stored value really changes (not on mount)
  useEffect(() => { const k = `${date}|${log[date] || ''}`; if (k !== prev.current) { prev.current = k; setV(log[date] ? String(log[date]) : ''); } }, [date, log[date]]);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, []);
  const save = async () => { const n = num(v.replace(/[\s,]/g, '')); if (n != null && !(n >= 0 && n <= MAX_STEPS)) { toast(`Steps: 0 – ${fmtN(MAX_STEPS)}`); return; }
    await setSteps(date, n); toast(n ? `${fmtN(n)} steps saved for ${fmtDay(date).toLowerCase()}` : 'Steps cleared'); onDone?.(); };
  return <form class="row" style="gap:8px" onSubmit={(e) => { e.preventDefault(); save(); }}>
    <input ref={ref} inputMode="numeric" placeholder="Total steps" aria-label={`Steps on ${date}`} value={v} onInput={(e) => setV(e.currentTarget.value)} data-testid="steps-input" style="flex:1" />
    <button class="btn p" type="submit" data-testid="steps-save">Save</button>
    {onDone && <button class="btn g" type="button" onClick={onDone}>Cancel</button>}
  </form>;
}

/** Workout tab: today's steps, goal bar, step calories, quick log. Tap → #/steps */
export function WorkoutStepsCard() {
  const s = useSettings(); const log = useLog(); const today = ymd(); const n = log[today] || 0; const goal = stepGoal(s); const [edit, setEdit] = useState(false);
  const en = useQuery(() => dayEnergy(today, s), [s, n]);
  return <div class="card col" style="gap:8px" data-testid="steps-card">
    <div class="row between" style="align-items:center">
      <a href="#/steps" class="grow" style="color:inherit;text-decoration:none" data-testid="steps-open">
        <div class="mut xs">👣 Steps today</div>
        <div><b style="font-size:20px" data-testid="steps-today">{n ? fmtN(n) : '–'}</b>{goal ? <span class="mut sm"> / {fmtN(goal)}</span> : null}
          {en && en.stepKcal ? <span class="mut sm" data-testid="steps-kcal"> · +{en.stepKcal} kcal</span> : null}</div>
      </a>
      {!edit && <button class="btn sm" onClick={() => setEdit(true)} data-testid="steps-log">{n ? 'Edit' : 'Log steps'}</button>}
      <a class="btn ic" href="#/steps" aria-label="Steps history">›</a>
    </div>
    {goal ? <Bar value={n} target={goal} color="var(--acc)" /> : null}
    {edit && <StepInput date={today} onDone={() => setEdit(false)} autoFocus />}
  </div>;
}

/** #/steps?date=YYYY-MM-DD */
export function StepsPage() {
  const s = useSettings(); const log = useLog(); const today = ymd();
  const [date, setDate] = useState(() => { const m = /[?&]date=(\d{4}-\d{2}-\d{2})/.exec(location.hash); return m && m[1] <= today ? m[1] : today; });
  const goal = stepGoal(s); const n = log[date] || 0;
  const en = useQuery(() => dayEnergy(date, s), [s, date, n]);
  const days = Array.from({ length: 7 }, (_, i) => addDays(date, i - 6)); const vals = days.map((d) => log[d] || 0);
  const recent = Array.from({ length: 14 }, (_, i) => addDays(today, -i));
  const logged = vals.filter((v) => v > 0);
  return <><Top title="Steps" backBtn /><div class="page">
    <div class="card col">
      <div class="row between" style="align-items:center">
        <button class="btn ic" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}>◀</button>
        <label class="col" style="align-items:center;gap:2px"><b data-testid="steps-date">{fmtDay(date)}</b>
          <input type="date" value={date} max={today} onChange={(e) => e.currentTarget.value && setDate(e.currentTarget.value)} data-testid="steps-date-input" style="min-height:32px;padding:2px 8px;font-size:13px" /></label>
        <button class="btn ic" aria-label="Next day" disabled={date >= today} onClick={() => setDate(addDays(date, 1))}>▶</button>
      </div>
      <StepInput key={date} date={date} />
      <div class="sm" data-testid="steps-day-summary">{n ? <>{fmtN(n)} steps{goal ? ` · ${Math.round((n / goal) * 100)}% of goal` : ''}{en?.steps.km ? ` · ≈ ${en.steps.km} km` : ''}{en ? ` · +${en.stepKcal} kcal burned` : ''}</> : <span class="mut">No steps logged for this day.</span>}</div>
    </div>
    <div class="card"><h3>7 days to {fmtDay(date).toLowerCase()}</h3>
      <div data-testid="steps-chart"><BarChart color="var(--acc)" height={120} target={goal || undefined} bars={days.map((d, i) => ({ label: WD[parseYmd(d).getDay()].slice(0, 2), value: vals[i] }))} /></div>
      <div class="mut xs">{logged.length ? `Average ${fmtN(logged.reduce((a, b) => a + b, 0) / logged.length)} on ${logged.length} logged day${logged.length > 1 ? 's' : ''}` : 'Nothing logged in these 7 days.'}{goal ? ` · goal ${fmtN(goal)}` : ''}</div>
    </div>
    <h2>Recent days</h2>
    <div class="list card" style="padding:4px 12px" data-testid="steps-recent">{recent.map((d) => <button class={'item row between' + (d === date ? ' b' : '')} style="width:100%;background:none;border:0;color:inherit;font:inherit;text-align:left;cursor:pointer" onClick={() => { setDate(d); scrollTo({ top: 0, behavior: 'smooth' }); }}>
      <span>{fmtDay(d)}</span><span class={log[d] ? '' : 'mut'}>{log[d] ? fmtN(log[d]) : '–'}{goal && log[d] >= goal ? ' ✓' : ''}</span></button>)}</div>
    <div class="card mut xs col" style="gap:4px" data-testid="steps-explain">
      <div><b>How step calories work:</b> distance ≈ steps × your stride (height × 0.415, or × 0.413 for women), × 0.5 kcal per kg of body weight per km – the energy walking adds on top of resting burn.</div>
      <div>The first {fmtN(STEP_BASELINE)} steps a day are already part of your resting burn, so only steps above that are added to burned-today.</div>
      <div>If you also logged a walk or run as a workout, those steps are counted twice – leave them out of the total here.</div>
      {!s.profile && <div>Set up your profile (Settings) to see step calories.</div>}
    </div>
    <a class="btn g sm" href="#/settings?steps=1">Step goal settings</a>
  </div></>;
}

/** Settings › Steps */
export function StepGoalSetting() {
  const s = useSettings(); const g = stepGoal(s); const [v, setV] = useState(g ? String(g) : '');
  const prevG = useRef(g); useEffect(() => { if (g !== prevG.current) { prevG.current = g; setV(g ? String(g) : ''); } }, [g]); // not on mount (would clobber fast typing)
  useEffect(() => { if (/[?&]steps=1/.test(location.hash)) setTimeout(() => document.getElementById('step-settings')?.scrollIntoView({ block: 'start' }), 80); }, []);
  const save = async () => { const n = num(v.replace(/[\s,]/g, '')); if (n != null && n !== 0 && !(n >= 500 && n <= 100000)) { toast('Goal: 500 – 100,000 steps (empty = no goal)'); return; }
    await put('kv', { ...(await getSettings()), stepGoal: n ? Math.round(n) : 0 }); toast(n ? 'Step goal saved' : 'Step goal off'); };
  return <div class="card col" id="step-settings" data-testid="step-settings">
    <label class="f">Daily step goal<div class="row" style="gap:8px"><input inputMode="numeric" placeholder="No goal" value={v} onInput={(e) => setV(e.currentTarget.value)} data-testid="step-goal" /><button class="btn" onClick={save} data-testid="step-goal-save">Save</button></div></label>
    <div class="mut xs">Log steps on the Workout tab (from your phone or watch's step count). Leave empty for no goal.</div>
    <a class="btn g sm" href="#/steps" onClick={(e) => { e.preventDefault(); go('/steps'); }}>Open steps log</a>
  </div>;
}
