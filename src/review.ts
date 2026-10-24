/** v1.11.0 Grug's Review: 7-day summary built on-device → coach proxy POST /review (prompt, strict-JSON validation and the weekly
 *  cap live in the Worker) → result stored on-device (kv 'grugReviews'). Stat tiles and stars are computed here, never by the model.
 *  Tip actions are only offered when they map to a real Lunk feature (validated again here against the user's routines/exercises). */
import { all, get, getSettings, put } from './db';
import { proxyHeaders, proxyReady, proxyUrl } from './coach';
import { loadDoseData, slotsFor } from './doses';
import { stepGoal, stepLog } from './steps';
import { computeStars, workoutGoal, type Stars, type StarInput, groupOf, GROUPS } from './stars';
import type { DiaryEntry, Exercise, Routine, Settings, Workout } from './types';
import { addDays, e1rm, netCarbs, r0, r1, uid, workingSets, ymd, WD } from './util';

/** Mirror of the Worker's REVIEW_WEEKLY_CAP (server is the source of truth). */
export const REVIEW_WEEKLY_CAP: number = 1;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtShort = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return `${WD[new Date(y, m - 1, dd).getDay()]} ${dd} ${MON[m - 1]}`; };
export const fmtRange = (from: string, to: string) => { const a = fmtShort(from), b = fmtShort(to); return from.slice(0, 7) === to.slice(0, 7) ? `${a.replace(/ \w+$/, '')} – ${b}` : `${a} – ${b}`; };

// ---------- Sydney week (same rule as the Worker: Monday 00:00 Australia/Sydney) ----------
function sydYmd(ts: number) { const o: any = {}; for (const p of new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ts))) o[p.type] = p.value; return `${o.year}-${o.month}-${o.day}`; }
export function sydWeek(now = Date.now()) {
  const d = sydYmd(now); const [y, m, dd] = d.split('-').map(Number); const dow = (new Date(Date.UTC(y, m - 1, dd)).getUTCDay() + 6) % 7;
  const mon = new Date(Date.UTC(y, m - 1, dd - dow)).toISOString().slice(0, 10); const next = new Date(Date.UTC(y, m - 1, dd - dow + 7)).toISOString().slice(0, 10);
  return { week: mon, nextMonday: next };
}

// ---------- types ----------
export type FoodOpt = { name: string; grams: number; kcal: number; protein: number; carbs: number; fat: number };
export type Action =
  | { type: 'add_food'; label: string; day: 'today' | 'tomorrow'; meal: 'breakfast' | 'lunch' | 'dinner' | 'snacks'; foods: FoodOpt[] }
  | { type: 'add_routine_set'; label: string; routine: string; exercise: string; sets: number; reps: number; kg: number | null }
  | { type: 'update_targets'; label: string; kcal?: number; protein?: number; carbs?: number; fat?: number }
  | { type: 'set_step_goal'; label: string; steps: number }
  | { type: 'set_workout_goal'; label: string; perWeek: number };
export type Tip = { icon: string; title: string; data: string; body: string; action: Action | null };
export type ReviewResult = { scores: { overall: number; training: number; nutrition: number; consistency: number }; headline: string; quote: string; summary: string; went_well: string[]; slipped: string[]; tips: Tip[] };
export type Tiles = { workouts: number; planned: number; kcalAvg: number | null; kcalTarget: number; proteinAvg: number | null; proteinTarget: number; stepsAvg: number | null; stepGoal: number; foodDays: number; entries: number; stepDays: number; doseDue: number; doseTaken: number };
export type Review = { id: string; created: number; week: string; nextMonday: string; from: string; to: string; result: ReviewResult; tiles: Tiles; prev?: number; saved?: boolean; done?: Record<number, string> };
type Store = { id: 'grugReviews'; list: Review[] };

export async function loadReviews(): Promise<Review[]> { return (await get<Store>('kv', 'grugReviews'))?.list || []; }
async function saveReviews(list: Review[]) { // keep every saved review + the 8 most recent
  const keep = list.sort((a, b) => b.created - a.created).filter((r, i) => r.saved || i < 8); await put('kv', { id: 'grugReviews', list: keep });
}
export async function upsertReview(r: Review) { const l = (await loadReviews()).filter((x) => x.id !== r.id); await saveReviews([r, ...l]); }
export async function getReview(id: string) { return (await loadReviews()).find((r) => r.id === id); }

// ---------- local snapshot ----------
export type Snapshot = { today: string; from: string; s: Settings; stars: Stars; tiles: Tiles; data: any; exercises: Exercise[]; routines: Routine[] };
export async function loadStarInput(today = ymd()): Promise<StarInput & { s: Settings; exList: Exercise[]; routines: Routine[] }> {
  const [s, diary, workouts, exList, routines, steps, dose] = await Promise.all([getSettings(), all<DiaryEntry>('diary'), all<Workout>('workouts'), all<Exercise>('exercises'), all<Routine>('routines'), stepLog(), loadDoseData()]);
  const doseSlots: { date: string; taken: boolean }[] = [];
  for (let i = 1; i <= 7; i++) for (const sl of slotsFor(addDays(today, -i), dose.schedules, dose.supps, dose.logs)) if (sl.status === 'taken' || sl.status === 'missed') doseSlots.push({ date: sl.date, taken: sl.status === 'taken' });
  return { today, diary, workouts, exercises: new Map(exList.map((e) => [e.id, e])), steps, settings: s, doseSlots, s, exList, routines };
}
export async function loadStars(): Promise<Stars> { return computeStars(await loadStarInput()); }

export async function snapshot(today = ymd()): Promise<Snapshot> {
  const inp = await loadStarInput(today); const { s, exList, routines } = inp; const stars = computeStars(inp);
  const from = addDays(today, -6); const days = Array.from({ length: 7 }, (_, i) => addDays(from, i)); const exName = (id: string) => (inp.exercises as Map<string, Exercise>).get(id)?.name || 'Exercise';
  const t0 = new Date(from + 'T00:00:00').getTime();
  const ws = inp.workouts.filter((w) => w.end && w.start >= t0).sort((a, b) => a.start - b.start);
  const prior = inp.workouts.filter((w) => w.end && w.start < t0 && w.start >= t0 - 28 * 864e5);
  const diary = inp.diary.filter((e) => e.date >= from && e.date <= today);
  const dayRows = days.map((d) => { const es = diary.filter((e) => e.date === d); const sum = (k: 'kcal' | 'protein' | 'fat') => es.reduce((a, e) => a + (e.n[k] || 0), 0);
    return { d, n: es.length, kcal: sum('kcal'), protein: sum('protein'), carbs: es.reduce((a, e) => a + netCarbs(e.n), 0), fat: sum('fat'), meals: new Set(es.map((e) => e.meal)).size }; });
  const logged = dayRows.filter((x) => x.n); const sg = stepGoal(s); const stepDays = days.map((d) => [d, inp.steps[d] || 0] as const).filter(([, v]) => v > 0);
  const doseDays = new Map<string, { name: string; taken: number; due: number }>(); const dose = await loadDoseData();
  for (const d of days) for (const sl of slotsFor(d, dose.schedules, dose.supps, dose.logs)) { if (sl.status === 'upcoming' || sl.status === 'due') continue; const o = doseDays.get(sl.supp.id) || { name: sl.supp.name, taken: 0, due: 0 }; o.due++; if (sl.status === 'taken') o.taken++; doseDays.set(sl.supp.id, o); }
  const doseList = [...doseDays.values()];
  const tiles: Tiles = { workouts: ws.length, planned: workoutGoal(s), kcalAvg: logged.length ? r0(logged.reduce((a, x) => a + x.kcal, 0) / logged.length) : null, kcalTarget: r0(s.targets.kcal),
    proteinAvg: logged.length ? r0(logged.reduce((a, x) => a + x.protein, 0) / logged.length) : null, proteinTarget: r0(s.targets.protein),
    stepsAvg: stepDays.length ? r0(stepDays.reduce((a, [, v]) => a + v, 0) / stepDays.length) : null, stepGoal: sg, foodDays: logged.length, entries: diary.length, stepDays: stepDays.length,
    doseDue: doseList.reduce((a, x) => a + x.due, 0), doseTaken: doseList.reduce((a, x) => a + x.taken, 0) };
  // main lifts: best set last 7 days vs the 4 weeks before
  const bestOf = (list: Workout[]) => { const m = new Map<string, { v: number; t: string }>(); for (const w of list) for (const e of w.exercises) for (const x of workingSets(e.sets)) { const v = (x.kg || 0) > 0 ? e1rm(x.kg || 0, x.reps || 0) : x.reps || 0; const o = m.get(e.exerciseId); if (!o || v > o.v) m.set(e.exerciseId, { v, t: (x.kg || 0) > 0 ? `${x.kg}x${x.reps}` : `${x.reps} reps` }); } return m; };
  const rb = bestOf(ws), pb = bestOf(prior);
  const sets: Record<string, number> = Object.fromEntries(GROUPS.map((g) => [g, 0]));
  for (const w of ws) for (const e of w.exercises) { const g = groupOf((inp.exercises as Map<string, Exercise>).get(e.exerciseId)?.muscle || ''); if (g) sets[g] += workingSets(e.sets).length; }
  const prev = (await loadReviews()).find((r) => r.week !== sydWeek().week);
  const part = (r: Stars['training']) => ({ score: r.score, stars: r.stars, parts: r.parts.map((p) => ({ metric: p.label, pts: p.pts, max: p.max, counted: p.applicable, detail: p.detail })) });
  const data: any = {
    range: { from, to: today, today: WD[new Date(today + 'T12:00:00').getDay()] }, units: { energy: s.energyUnit, weight: s.weightUnit }, goal: s.profile?.goal || null,
    targets: { kcal: r0(s.targets.kcal), protein: r0(s.targets.protein), netCarbs: r0(s.targets.carbs), fat: r0(s.targets.fat) }, goals: { workoutsPerWeek: workoutGoal(s), stepsPerDay: sg || null },
    stars: { training: part(stars.training), nutrition: part(stars.nutrition), note: 'nutrition stars use the 7 days up to yesterday' },
    food: { cols: 'day,entries,kcal,protein,netCarbs,fat,mealsLogged', days: dayRows.map((x) => [fmtShort(x.d), x.n, r0(x.kcal), r0(x.protein), r0(x.carbs), r0(x.fat), x.meals]) },
    workouts: ws.slice(-8).map((w) => ({ day: fmtShort(ymd(new Date(w.start))), name: w.name, ex: w.exercises.map((e) => [exName(e.exerciseId), workingSets(e.sets).map((x) => ((x.kg || 0) > 0 ? `${x.kg}x${x.reps}` : `${x.reps}`)).join(',')]).filter((x) => x[1]) })),
    lifts: [...rb.entries()].slice(0, 8).map(([id, r]) => ({ exercise: exName(id), bestThisWeek: r.t, best4WeeksBefore: pb.get(id)?.t || null })),
    hardSetsPerGroup: sets,
    steps: { goal: sg || null, days: stepDays.map(([d, v]) => [fmtShort(d), v]) },
    doses: doseList,
    routines: routines.slice(0, 10).map((r) => ({ name: r.name, exercises: r.exercises.map((e) => exName(e.exerciseId)) })),
    ...(prev ? { prevReview: { overall: prev.result.scores.overall, week: prev.week } } : {})
  };
  // keep the request small
  while (JSON.stringify(data).length > 14000 && data.workouts.length > 2) data.workouts.shift();
  return { today, from, s, stars, tiles, data, exercises: exList, routines };
}

// ---------- quota mirror + API ----------
export type ReviewQuota = { remaining: number | null; cap?: number; nextMonday?: string; week?: string; owner?: boolean };
const QK = 'reviewQuota';
export function readReviewQuota(): ReviewQuota | null { try { const q = JSON.parse(localStorage.getItem(QK) || 'null'); return q && q.week === sydWeek().week ? q : null; } catch { return null; } }
const saveQuota = (q: ReviewQuota) => { localStorage.setItem(QK, JSON.stringify({ ...q, week: q.week || sydWeek().week })); dispatchEvent(new Event('review-quota')); };
export async function fetchReviewQuota(): Promise<ReviewQuota | null> {
  if (!proxyReady() || !navigator.onLine) return readReviewQuota();
  try { const r = await fetch(proxyUrl() + '/status', { headers: proxyHeaders(await getSettings()) }); const j = await r.json(); if (!r.ok || !j.review) return readReviewQuota();
    const q: ReviewQuota = { remaining: j.owner ? null : j.review.remaining, cap: j.review.cap, nextMonday: j.review.nextMonday, week: j.review.week, owner: !!j.owner }; saveQuota(q); return q; } catch { return readReviewQuota(); }
}
export type RvErrKind = 'offline' | 'network' | 'limit' | 'busy' | 'disabled' | 'setup' | 'failed';
export class ReviewError extends Error { constructor(public kind: RvErrKind, msg: string, public nextMonday?: string) { super(msg); } }
export async function requestReview(snap: Snapshot, signal?: AbortSignal): Promise<Review> {
  if (!proxyReady()) throw new ReviewError('setup', "Grug's Review is being set up.");
  if (!navigator.onLine) throw new ReviewError('offline', "You're offline. Grug's Review needs an internet connection.");
  let r: Response;
  try { r = await fetch(proxyUrl() + '/review', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...proxyHeaders(snap.s) }, body: JSON.stringify({ data: snap.data }) }); }
  catch (e: any) { if (e?.name === 'AbortError') throw e; throw new ReviewError(navigator.onLine ? 'network' : 'offline', navigator.onLine ? "Couldn't reach Grug. Check your connection and try again." : "You're offline. Grug's Review needs an internet connection."); }
  let j: any = {}; try { j = await r.json(); } catch {}
  if (r.ok && j.review) {
    saveQuota({ remaining: j.owner ? null : j.remaining, cap: j.cap, nextMonday: j.nextMonday, week: j.week, owner: !!j.owner });
    const result = cleanResult(j.review, snap);
    const prev = (await loadReviews()).find((x) => x.week !== j.week);
    const rv: Review = { id: uid(), created: Date.now(), week: j.week || sydWeek().week, nextMonday: j.nextMonday || sydWeek().nextMonday, from: snap.from, to: snap.today, result, tiles: snap.tiles, ...(prev ? { prev: prev.result.scores.overall } : {}) };
    await upsertReview(rv); return rv;
  }
  if (r.status === 429 && /review_(ip_)?limit/.test(j.error || '')) { saveQuota({ remaining: 0, cap: j.cap, nextMonday: j.nextMonday, week: j.week }); throw new ReviewError('limit', j.error === 'review_ip_limit' ? `This week's free reviews for this network are used up. Next review ${fmtShort(j.nextMonday)}.` : `You've used this week's free review. Next review ${fmtShort(j.nextMonday)}.`, j.nextMonday); }
  if (r.status === 429) throw new ReviewError('busy', j.error === 'rate_limited' ? 'Too many requests in a short time. Wait a minute and try again.' : 'Grug is busy today. Try again tomorrow.');
  if (r.status === 503) throw new ReviewError('disabled', "Grug's Review is switched off for now.");
  throw new ReviewError('failed', (j.message || `Grug had a problem (HTTP ${r.status}).`) + (/used up/.test(j.message || '') ? '' : ' Nothing was used up – try again.'));
}

// ---------- tip actions ----------
const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function findExercise(name: string, exs: Exercise[]) { const n = norm(name); return exs.find((e) => norm(e.name) === n) || null; }
export function findRoutine(name: string, rs: Routine[]) { const n = norm(name); return rs.find((r) => norm(r.name) === n) || null; }
/** Keep only actions that map to something real (routine + exercise exist, goal not already set, …). */
export function actionUsable(a: Action | null, ctx: { s: Settings; routines: Routine[]; exercises: Exercise[] }): boolean {
  if (!a) return false;
  switch (a.type) {
    case 'add_food': return a.foods.length > 0;
    case 'add_routine_set': return !!findRoutine(a.routine, ctx.routines) && !!findExercise(a.exercise, ctx.exercises);
    case 'update_targets': return (['kcal', 'protein', 'carbs', 'fat'] as const).some((k) => a[k] != null && Math.round(ctx.s.targets[k]) !== a[k]);
    case 'set_step_goal': return a.steps !== stepGoal(ctx.s);
    case 'set_workout_goal': return a.perWeek !== workoutGoal(ctx.s);
    default: return false;
  }
}
export function cleanResult(res: ReviewResult, ctx: { s: Settings; routines: Routine[]; exercises: Exercise[] }): ReviewResult {
  return { ...res, tips: res.tips.map((t) => ({ ...t, action: actionUsable(t.action, ctx) ? t.action : null })) };
}
const MEAL_LABEL: Record<string, string> = { breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner', snacks: 'snacks' };
/** Apply one action; returns the "done" line shown in place of the button. */
export async function applyAction(a: Action, opt: { food?: number } = {}): Promise<string> {
  const s = await getSettings();
  if (a.type === 'add_food') {
    const f = a.foods[Math.max(0, Math.min(a.foods.length - 1, opt.food || 0))]; const date = a.day === 'today' ? ymd() : addDays(ymd(), 1);
    const e: DiaryEntry = { id: uid(), date, meal: a.meal, foodId: 'est:' + uid(), name: f.name, grams: f.grams, qty: f.grams, serving: 'g', created: Date.now(), amountLabel: `~${r0(f.grams)} g`,
      n: { kcal: f.kcal, protein: f.protein, carbs: f.carbs, fibre: 0, fat: f.fat }, est: { conf: 'med', note: "Added from Grug's Review" } };
    await put('diary', e); return `✓ ${f.name} added to ${a.day === 'today' ? 'today' : 'tomorrow'}’s ${MEAL_LABEL[a.meal]}`;
  }
  if (a.type === 'add_routine_set') {
    const [rs, exs] = await Promise.all([all<Routine>('routines'), all<Exercise>('exercises')]); const r = findRoutine(a.routine, rs), ex = findExercise(a.exercise, exs);
    if (!r || !ex) throw new Error('That routine or exercise no longer exists.');
    await put('routines', { ...r, exercises: [...r.exercises, { exerciseId: ex.id, sets: a.sets, reps: a.reps, ...(a.kg != null ? { kg: a.kg } : {}), restSec: s.defaultRest }], updated: Date.now() });
    return `✓ Added ${a.sets} × ${a.reps}${a.kg != null ? ` @ ${r1(a.kg)} kg` : ''} ${ex.name} to “${r.name}”`;
  }
  if (a.type === 'update_targets') {
    const t = { ...s.targets }; for (const k of ['kcal', 'protein', 'carbs', 'fat'] as const) if (a[k] != null) t[k] = a[k]!;
    await put('kv', { ...s, targets: t }); return `✓ Targets updated${a.kcal != null ? ` · ${a.kcal} kcal` : ''}${a.protein != null ? ` · protein ${a.protein} g` : ''}`;
  }
  if (a.type === 'set_step_goal') { await put('kv', { ...s, stepGoal: a.steps }); return `✓ Step goal set to ${a.steps.toLocaleString('en-AU')}`; }
  if (a.type === 'set_workout_goal') { await put('kv', { ...s, workoutGoal: a.perWeek }); return `✓ Goal set to ${a.perWeek} workouts a week`; }
  throw new Error('Unknown action');
}

// ---------- share card ----------
export function shareText(r: Review) { const s = r.result.scores; return `Grug's Review (${fmtRange(r.from, r.to)}): ${s.overall}/10 – ${r.result.headline}. Training ${s.training} · Nutrition ${s.nutrition} · Consistency ${s.consistency}. “${r.result.quote || r.result.summary}” – Lunk`; }
export async function shareImage(r: Review): Promise<Blob> {
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d')!;
  const css = getComputedStyle(document.documentElement); const v = (k: string, d: string) => css.getPropertyValue(k).trim() || d;
  const bg = v('--bg', '#0f1115'), bg2 = v('--bg2', '#171a21'), bg3 = v('--bg3', '#232733'), fg = v('--fg', '#e8eaed'), mut = v('--mut', '#9aa3b2'), acc = v('--acc', '#22c55e'), warn = v('--warn', '#f59e0b'), acc2 = v('--acc2', '#0ea5e9');
  g.fillStyle = bg; g.fillRect(0, 0, W, H); g.fillStyle = bg2; g.beginPath(); (g as any).roundRect ? (g as any).roundRect(60, 60, W - 120, H - 120, 48) : g.rect(60, 60, W - 120, H - 120); g.fill();
  const font = (w: number, px: number) => `${w} ${px}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
  g.fillStyle = fg; g.font = font(800, 64); g.fillText("🧔 Grug's Review", 120, 190); g.fillStyle = mut; g.font = font(400, 36); g.fillText(`${fmtRange(r.from, r.to)} · last 7 days`, 120, 250);
  const cx = 300, cy = 500, rad = 150, s = r.result.scores;
  g.lineWidth = 30; g.strokeStyle = bg3; g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = acc; g.lineCap = 'round'; g.beginPath(); g.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (s.overall / 10)); g.stroke();
  g.fillStyle = fg; g.textAlign = 'center'; g.font = font(800, 110); g.fillText(String(s.overall), cx, cy + 30); g.fillStyle = mut; g.font = font(400, 32); g.fillText('out of 10', cx, cy + 80); g.textAlign = 'left';
  g.fillStyle = fg; g.font = font(800, 54); g.fillText(r.result.headline, 520, 400);
  ([['Training', s.training, acc], ['Nutrition', s.nutrition, warn], ['Consistency', s.consistency, acc2]] as const).forEach(([l, val, col], i) => { const y = 470 + i * 95;
    g.fillStyle = fg; g.font = font(500, 34); g.fillText(l, 520, y); g.textAlign = 'right'; g.font = font(700, 34); g.fillText(`${val}/10`, 960, y); g.textAlign = 'left';
    g.fillStyle = bg3; g.fillRect(520, y + 18, 440, 16); g.fillStyle = col; g.fillRect(520, y + 18, 440 * (val / 10), 16); });
  // quote bubble
  const text = r.result.summary; g.font = font(400, 40); const words = text.split(/\s+/); const lines: string[] = []; let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > 760) { lines.push(line); line = w; } else line = t; } if (line) lines.push(line);
  const shown = lines.slice(0, 7); const bh = shown.length * 56 + 70; g.fillStyle = bg3; g.beginPath(); (g as any).roundRect ? (g as any).roundRect(120, 760, W - 240, bh, 32) : g.rect(120, 760, W - 240, bh); g.fill();
  g.fillStyle = fg; shown.forEach((l, i) => g.fillText(i === shown.length - 1 && lines.length > shown.length ? l + '…' : l, 160, 830 + i * 56));
  g.fillStyle = mut; g.font = font(400, 30); g.fillText('Lunk · estimates and advice can be off. Not medical advice.', 120, H - 110);
  return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('No image'))), 'image/png'));
}
export async function shareReview(r: Review): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const text = shareText(r); let blob: Blob | null = null; try { blob = await shareImage(r); } catch {}
  const file = blob ? new File([blob], `grugs-review-${r.to}.png`, { type: 'image/png' }) : null;
  try {
    if (file && (navigator as any).canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: "Grug's Review", text }); return 'shared'; }
    if (navigator.share) { await navigator.share({ title: "Grug's Review", text }); return 'shared'; }
  } catch (e: any) { if (e?.name === 'AbortError') return 'cancelled'; }
  if (file) { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
  try { await navigator.clipboard?.writeText(text); } catch {}
  return 'downloaded';
}
