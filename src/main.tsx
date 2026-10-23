import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './style.css';
import { init } from './db';
import { useHash } from './hooks';
import { Toaster } from './ui';
import { ymd } from './util';
import { Home } from './pages/Home';
import { ActiveWorkout, BodyWeightPage, ExerciseDetail, ExercisesPage, HistoryPage, RestBar, RoutineEdit, WorkoutDetail, WorkoutsHome } from './pages/Workouts';
import { LabelScan } from './pages/LabelScan';
import { AddFood, Diary, FoodEdit, MyFoods, RecipeEdit, Trends } from './pages/Nutrition';
import { CalendarPage, SuppEdit, SuppsPage } from './pages/Supps';
import { SettingsPage } from './pages/Settings';
import { Onboarding } from './pages/Onboarding';
import { getSettings } from './db';
import { scheduleReminders } from './doses';
import { registerSW, showUpdatedToast } from './update';
import type { Meal } from './types';
import { checkStale } from './autoend';
import { AutoEndReview, WorkoutMiniBar } from './pages/AutoEndReview';
import { CoachPage } from './pages/Coach';
import { initInstall } from './install';

initInstall();

const I = {
  home: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z" /></svg>,
  lift: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 7v10M18 7v10M3 9v6M21 9v6M6 12h12" /></svg>,
  food: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 3v8a2 2 0 002 2v8M11 3v8M3 3v8a2 2 0 002 2M17 21V3c2.5 0 4 3 4 7s-1.5 4-4 4" /></svg>,
  coach: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z" /><path d="M8 10h.01M12 10h.01M16 10h.01" stroke-linecap="round" stroke-width="2.6" /></svg>,
  pill: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="8" width="18" height="8" rx="4" transform="rotate(-35 12 12)" /><path d="M9.5 8.5l5 6" /></svg>,
  gear: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z" /></svg>
};

function route(h: string) {
  const p = h.split('?')[0].split('/').filter(Boolean);
  switch (p[0]) {
    case undefined: return <Home />;
    case 'workouts': return <WorkoutsHome />;
    case 'workout': return <ActiveWorkout />;
    case 'routine': return <RoutineEdit id={p[1]} key={p[1]} />;
    case 'history': return p[1] ? <WorkoutDetail id={p[1]} /> : <HistoryPage />;
    case 'exercises': return <ExercisesPage />;
    case 'exercise': return <ExerciseDetail id={p[1]} />;
    case 'body': return <BodyWeightPage />;
    case 'food':
      if (p[1] === 'add') return <AddFood date={p[2]} meal={p[3] as Meal} />;
      if (p[1] === 'edit') return <FoodEdit id={p[2]} key={p[2]} />;
      if (p[1] === 'trends') return <Trends />;
      if (p[1] === 'label') return <LabelScan />;
      return <Diary date={p[1] || ymd()} />;
    case 'foods': return <MyFoods />;
    case 'recipe': return <RecipeEdit id={p[1]} key={p[1]} />;
    case 'supps': return <SuppsPage />;
    case 'supp': return <SuppEdit id={p[1]} key={p[1]} />;
    case 'calendar': return <CalendarPage />;
    case 'settings': return <SettingsPage />;
    case 'coach': return <CoachPage />;
    case 'welcome': return <Onboarding />;
    default: return <Home />;
  }
}
const TABS: [string, string, keyof typeof I, string[]][] = [
  ['/', 'Home', 'home', ['']], ['/workouts', 'Workout', 'lift', ['workouts', 'workout', 'routine', 'history', 'exercises', 'exercise', 'body']],
  ['/food', 'Food', 'food', ['food', 'foods', 'recipe']], ['/coach', 'Coach', 'coach', ['coach']], ['/supps', 'Doses', 'pill', ['supps', 'supp', 'calendar']], ['/settings', 'Settings', 'gear', ['settings']]
];
function UpdateBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => { const f = () => setShow(true); addEventListener('grug-update-ready', f); return () => removeEventListener('grug-update-ready', f); }, []);
  if (!show) return null;
  return <button class="update-banner" onClick={() => location.reload()} data-testid="update-banner">⬆️ Update ready – tap to refresh<span class="xs mut"> (finish your workout/edit first; nothing is lost)</span></button>;
}
function App() {
  const [ready, setReady] = useState(false); const h = useHash(); const [onboard, setOnboard] = useState(false);
  useEffect(() => {
    // stale-workout check before first render, so an abandoned workout is already ended (and its review shown) on launch
    init().then(() => checkStale()).catch(() => null).then(async () => { setOnboard(!(await getSettings()).onboarded); setReady(true); scheduleReminders(); showUpdatedToast(); });
    const v = () => { if (document.visibilityState === 'visible') { scheduleReminders(); checkStale(); } };
    document.addEventListener('visibilitychange', v); const t = setInterval(() => checkStale(), 60e3);
    return () => { document.removeEventListener('visibilitychange', v); clearInterval(t); };
  }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [h.split('?')[0]]);
  if (!ready) return <div class="empty">Loading…</div>;
  const seg = h.split('/').filter(Boolean)[0] || '';
  // first open (fresh or existing install upgraded to v1.3): show onboarding once, unless a workout is in progress
  if (onboard && seg !== 'workout') return <><main key="onboarding"><Onboarding onDone={() => setOnboard(false)} /></main><UpdateBanner /><Toaster /></>;
  return <>
    <main key={h}>{route(h)}</main>
    <div class="dock"><RestBar /><WorkoutMiniBar hidden={seg === 'workout'} /></div>
    <nav class="tabs">{TABS.map(([href, label, ic, segs]) => <a href={'#' + href} class={segs.includes(seg) ? 'on' : ''}>{I[ic]}<span>{label}</span></a>)}</nav>
    <AutoEndReview />
    <UpdateBanner />
    <Toaster />
  </>;
}
render(<App />, document.getElementById('app')!);

registerSW();
