import { useEffect, useRef, useState } from 'preact/hooks';
import { scaleMacros } from '../targets';
import { InstallBanner } from './Install';
import { all, getSettings, put } from '../db';
import { go, useQuery } from '../hooks';
import { GOAL_LABEL, ageFromBirthYear, bmr, latestWeight, sedentaryBurn, suggestTargets, type Goal, type Sex } from '../energy';
import type { Settings } from '../types';
import { NumInput, Seg, toast } from '../ui';
import { saveUsername, UsernameField, USERNAME_HINT } from './Username';
import { usernameError } from '../username';
import { DEFAULT_SETTINGS, LB, r0, r1, ymd } from '../util';

const hp = () => new URLSearchParams(location.hash.split('?')[1] || '');
const STEPS = ['username', 'welcome', 'body', 'about', 'goal', 'result'] as const;
type Step = (typeof STEPS)[number];

/** Has this install got real user data / customised targets? Then never overwrite targets without asking. */
async function isExisting(s: Settings) {
  const [d, w, b, sp] = await Promise.all([all('diary'), all('workouts'), all('bodyweight'), all('supplements')]);
  const custom = (['kcal', 'protein', 'carbs', 'fat'] as const).some((k) => s.targets[k] !== DEFAULT_SETTINGS.targets[k]);
  return d.length + w.length + b.length + sp.length > 0 || custom;
}

export function Onboarding({ onDone }: { onDone?: () => void }) {
  const q = hp(); const fromSettings = q.get('from') === 'settings';
  const [step, setStep] = useState<Step>((q.get('step') as Step) || 'username'); const [uname, setUname] = useState('');
  const [s, setS] = useState<Settings | null>(null); const [existing, setExisting] = useState(false);
  const [hUnit, setHUnit] = useState<'cm' | 'ftin'>('cm'); const [cm, setCm] = useState<number | null>(null); const [ft, setFt] = useState<number | null>(null); const [inch, setInch] = useState<number | null>(null);
  const [wUnit, setWUnit] = useState<'kg' | 'lb'>('kg'); const [wv, setWv] = useState<number | null>(null); const [prevKg, setPrevKg] = useState<number | null>(null);
  const [ageMode, setAgeMode] = useState<'age' | 'year'>('age'); const [age, setAge] = useState<number | null>(null); const [by, setBy] = useState<number | null>(null);
  const [sex, setSex] = useState<Sex | null>(null); const [goal, setGoal] = useState<Goal | null>(null);
  const [t, setT] = useState<{ kcal: number | null; protein: number | null; fat: number | null; carbs: number | null }>({ kcal: null, protein: null, fat: null, carbs: null });
  const [err, setErr] = useState('');
  useEffect(() => { (async () => {
    const st = await getSettings(); setS(st); setExisting(await isExisting(st)); if (st.username) { setUname(st.username); if (fromSettings) setStep((x) => (x === 'username' ? 'welcome' : x)); }
    const kg = await latestWeight(); setPrevKg(kg);
    const p = st.profile;
    if (p) { setCm(p.heightCm); setHUnit(p.heightUnit || 'cm'); const ti = p.heightCm / 2.54; setFt(Math.floor(ti / 12)); setInch(r0(ti % 12)); setSex(p.sex); setGoal(p.goal); setAge(ageFromBirthYear(p.birthYear)); setBy(p.birthYear); setWUnit(p.bwUnit || 'kg'); }
    if (kg) setWv(r1((p?.bwUnit || 'kg') === 'lb' ? kg * LB : kg));
  })(); }, []);
  const heightCm = hUnit === 'cm' ? cm : ft != null ? r1(((ft || 0) * 12 + (inch || 0)) * 2.54) : null;
  const kg = wv == null ? null : wUnit === 'lb' ? wv / LB : wv;
  const birthYear = ageMode === 'age' ? (age != null ? new Date().getFullYear() - age : null) : by;
  const ageN = birthYear != null ? ageFromBirthYear(birthYear) : null;
  const B = heightCm && kg && ageN != null && sex ? bmr(kg, heightCm, ageN, sex) : null;
  const sed = B != null ? sedentaryBurn(B) : null;
  const sug = sed != null && kg && goal ? suggestTargets(kg, sed, goal) : null;
  // v1.8.5: protein / carbs / fat keep the current targets' ratio, scaled to the suggested calories
  const ratioBase = s ? { kcal: s.targets.kcal, protein: s.targets.protein, carbs: s.targets.carbs, fat: s.targets.fat } : null;
  const obBase = useRef<any>(null);
  useEffect(() => { if (step === 'result' && sug && ratioBase) { obBase.current = null; { const m = scaleMacros(ratioBase, sug.kcal); setT({ kcal: sug.kcal, protein: m.protein ?? null, carbs: m.carbs ?? null, fat: m.fat ?? null }); } } }, [step, sug?.kcal, s?.targets.kcal]);
  const setKcal = (v: number | null) => { obBase.current ||= { kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat }; { const m = scaleMacros(obBase.current, v); setT({ ...t, kcal: v as any, protein: m.protein ?? t.protein, carbs: m.carbs ?? t.carbs, fat: m.fat ?? t.fat }); } };
  const setMacro = (k: 'protein' | 'fat' | 'carbs', v: number | null) => { obBase.current = null; setT({ ...t, [k]: v as any }); };

  const idx = STEPS.indexOf(step);
  const next = async () => {
    setErr('');
    if (step === 'username') { const e = usernameError(uname); if (e) return setErr(e); setUname(await saveUsername(uname)); }
    if (step === 'body') { if (!heightCm || heightCm < 100 || heightCm > 250) return setErr('Enter your height (100–250 cm)'); if (!kg || kg < 30 || kg > 300) return setErr('Enter your weight'); }
    if (step === 'about') { if (ageN == null || ageN < 13 || ageN > 100) return setErr('Enter your age (13–100) or birth year'); if (!sex) return setErr('Pick male or female'); }
    if (step === 'goal' && !goal) return setErr('Pick a goal');
    setStep(STEPS[idx + 1]);
  };
  const finish = async (useNew: boolean) => {
    const cur = await getSettings();
    const profile = { heightCm: heightCm!, sex: sex!, birthYear: birthYear!, goal: goal!, heightUnit: hUnit, bwUnit: wUnit, updated: Date.now() };
    const targets = useNew ? { ...cur.targets, kcal: t.kcal ?? cur.targets.kcal, protein: t.protein ?? cur.targets.protein, fat: t.fat ?? cur.targets.fat, carbs: t.carbs ?? cur.targets.carbs } : cur.targets;
    await put('kv', { ...cur, profile, targets, onboarded: cur.onboarded || Date.now() });
    if (kg && (prevKg == null || Math.abs(prevKg - kg) > 0.05)) await put('bodyweight', { id: 'bw' + ymd(), date: ymd(), kg: r1(kg * 10) / 10 });
    toast(useNew ? 'Targets saved' : 'Profile saved — kept your current targets');
    onDone?.(); go(fromSettings ? '/settings' : '/');
  };
  const skip = async () => { const cur = await getSettings(); await put('kv', { ...cur, onboarded: cur.onboarded || Date.now() }); onDone?.(); go(fromSettings ? '/settings' : '/'); };
  if (!s) return <div class="empty">Loading…</div>;
  const opt = (on: boolean, onClick: () => void, children: any, tid?: string) => <button type="button" class={'ob-opt ' + (on ? 'on' : '')} onClick={onClick} data-testid={tid} aria-pressed={on}>{children}</button>;

  return <div class="onboard" data-testid="onboarding" data-step={step}>
    <div class="ob-top"><div class="ob-dots">{STEPS.map((x, i) => <i class={i <= idx ? 'on' : ''} />)}</div>
      {step !== 'username' || fromSettings ? <button class="btn g sm" onClick={skip} data-testid="ob-skip">{fromSettings ? 'Cancel' : 'Skip'}</button> : <span />}</div>
    <div class="ob-body col">
      {step === 'username' && <>
        <div class="ob-hero">💪</div><h1>Pick a username</h1>
        <p class="mut">This is how Lunk greets you. It's only stored on this device.</p>
        <UsernameField value={uname} onInput={(v) => { setUname(v); setErr(''); }} onEnter={next} autoFocus tid="ob-username" />
        <div class="mut xs">{USERNAME_HINT}</div>
      </>}
      {step === 'welcome' && <>
        <div class="ob-hero">💪🍗</div><h1>Welcome{existing ? ' back' : ''} to Lunk</h1>
        <p class="mut">{existing ? 'New: Lunk can now estimate how many calories you burn each day — including workouts — and suggest targets for your goal. Takes 30 seconds. Your existing data and targets stay untouched unless you choose otherwise.' : 'A few quick questions so Lunk can estimate your daily calorie burn and suggest calorie and protein targets. Takes about 30 seconds — you can change everything later in Settings.'}</p>
        {!existing && <InstallBanner compact />}
      </>}
      {step === 'body' && <>
        <h1>Your body</h1>
        <label class="f">Height<Seg value={hUnit} onChange={setHUnit} options={[['cm', 'cm'], ['ftin', 'ft / in']]} /></label>
        {hUnit === 'cm' ? <label class="f">Height (cm)<NumInput value={cm} onValue={setCm} placeholder="e.g. 180" aria-label="Height (cm)" /></label>
          : <div class="grid2"><label class="f">Feet<NumInput int value={ft} onValue={setFt} placeholder="5" aria-label="Feet" /></label><label class="f">Inches<NumInput value={inch} onValue={setInch} placeholder="11" aria-label="Inches" /></label></div>}
        <label class="f">Current weight<Seg value={wUnit} onChange={(u) => { if (wv != null && u !== wUnit) setWv(r1(u === 'lb' ? wv * LB : wv / LB)); setWUnit(u); }} options={[['kg', 'kg'], ['lb', 'lb']]} /></label>
        <label class="f">Weight ({wUnit})<NumInput value={wv} onValue={setWv} placeholder={wUnit === 'kg' ? 'e.g. 85' : 'e.g. 187'} aria-label="Weight" /></label>
        <div class="mut xs">Saved as a body-weight log entry. Later calculations always use your latest logged weight.</div>
      </>}
      {step === 'about' && <>
        <h1>About you</h1>
        <label class="f">Age<Seg value={ageMode} onChange={setAgeMode} options={[['age', 'Age'], ['year', 'Birth year']]} /></label>
        {ageMode === 'age' ? <label class="f">Age (years)<NumInput int value={age} onValue={setAge} placeholder="e.g. 30" aria-label="Age" /></label>
          : <label class="f">Birth year<NumInput int value={by} onValue={setBy} placeholder="e.g. 1996" aria-label="Birth year" /></label>}
        <div class="f">Sex<div class="grid2">{opt(sex === 'male', () => setSex('male'), 'Male', 'sex-male')}{opt(sex === 'female', () => setSex('female'), 'Female', 'sex-female')}</div></div>
        <div class="card sm mut">Why? The Mifflin-St Jeor formula estimates your resting burn from weight, height, age and sex — on average women burn ~166 kcal/day less at the same size. It's only used for this estimate and never leaves your phone.</div>
      </>}
      {step === 'goal' && <>
        <h1>Your goal</h1>
        {opt(goal === 'cut', () => setGoal('cut'), <><b>🔪 Cutting</b><span class="mut sm">Lose fat — about 20 % below your burn (~−500 kcal)</span></>, 'goal-cut')}
        {opt(goal === 'maintain', () => setGoal('maintain'), <><b>⚖️ Maintaining</b><span class="mut sm">Stay the same weight — eat what you burn</span></>, 'goal-maintain')}
        {opt(goal === 'bulk', () => setGoal('bulk'), <><b>🦍 Bulking</b><span class="mut sm">Build muscle — ~10–15 % above your burn (~+300 kcal)</span></>, 'goal-bulk')}
      </>}
      {step === 'result' && (sug && sed != null && B != null ? <>
        <h1>Your numbers</h1>
        <div class="card ob-burn"><div class="mut sm">Your sedentary burn</div><b data-testid="ob-sedentary">~{r0(sed)} kcal/day</b>
          <div class="mut xs">BMR <span data-testid="ob-bmr">{r0(B)}</span> kcal (Mifflin-St Jeor: {r1(kg!)} kg, {heightCm} cm, {ageN} y, {sex}) × 1.2 sedentary. Workouts are added on top each day.</div></div>
        <div class="card col"><div class="row between"><b>Suggested for {GOAL_LABEL[goal!]}</b><span class="pill">{goal === 'cut' ? `${r0(sug.kcal - sed)}` : goal === 'bulk' ? `+${r0(sug.kcal - sed)}` : '±0'} kcal</span></div>
          <div class="grid2">
            <label class="f">Calories (kcal)<NumInput int value={t.kcal} onValue={setKcal} aria-label="Target calories" /></label>
            <label class="f">Protein (g)<NumInput int value={t.protein} onValue={(v) => setMacro('protein', v)} aria-label="Target protein" /></label>
            <label class="f">Fat (g)<NumInput int value={t.fat} onValue={(v) => setMacro('fat', v)} aria-label="Target fat" /></label>
            <label class="f">Net carbs (g)<NumInput int value={t.carbs} onValue={(v) => setMacro('carbs', v)} aria-label="Target carbs" /></label></div>
          <div class="mut xs" data-testid="ob-ratio-note">Protein, carbs and fat keep the ratio of your current targets, scaled to these calories (changing calories here scales them too).{t.kcal && t.protein != null && t.fat != null && t.carbs != null && Math.abs(t.protein * 4 + t.fat * 9 + t.carbs * 4 - t.kcal) > 60 ? ` ⚠️ Your macros add up to ${r0(t.protein * 4 + t.fat * 9 + t.carbs * 4)} kcal.` : ''}</div></div>
        {existing ? <><div class="card sm" data-testid="ob-current">Your current targets: <b>{r0(s.targets.kcal)} kcal</b> · P {r0(s.targets.protein)} g · F {r0(s.targets.fat)} g · C {r0(s.targets.carbs)} g</div>
          <button class="btn p" onClick={() => finish(true)} data-testid="ob-use">Use these targets</button>
          <button class="btn" onClick={() => finish(false)} data-testid="ob-keep">Keep my current targets</button></>
          : <button class="btn p" onClick={() => finish(true)} data-testid="ob-use">Save these targets</button>}
      </> : <><h1>Almost there</h1><p class="mut">Some details are missing — go back and fill them in.</p></>)}
      {err && <div class="card sm" style="border-color:var(--warn)">{err}</div>}
    </div>
    <div class="ob-nav grid2">{idx > 0 ? <button class="btn" onClick={() => { setErr(''); setStep(STEPS[idx - 1]); }}>Back</button> : <span />}
      {step !== 'result' && <button class="btn p" onClick={next} data-testid="ob-next">{step === 'welcome' ? "Let's go" : 'Next'}</button>}</div>
  </div>;
}
export const needsOnboarding = async () => !(await getSettings()).onboarded;
export function useNeedsOnboarding() { return useQuery(needsOnboarding, [], undefined); }
