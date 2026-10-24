/** v1.12.0 Leaderboard (opt-in); v1.12.1: a TRAINING leaderboard. The score is the Home Training stars' score (out of 100), computed on
 *  this phone with the same functions as the Home stars (stars.ts); nutrition is not used (most people don't log food). Daily = today's
 *  training score; Weekly = the average of this Sydney week's daily training scores so far (Monday 00:00 Australia/Sydney). Only the username and these two integers are ever sent (coach proxy /leaderboard*);
 *  never weight, calories, food or photos. Submits are quiet and debounced (at most once per 5 minutes). */
import { all, getSettings, put } from './db';
import { deviceId, proxyHeaders, proxyReady, proxyUrl } from './coach';
import { loadDoseData, slotsFor } from './doses';
import { stepLog } from './steps';
import { computeStars, type Stars } from './stars';
import { sydWeek, sydYmd } from './review';
import type { DiaryEntry, Exercise, Workout } from './types';
import { addDays, ymd } from './util';

export type Period = 'weekly' | 'daily';
export type LbRow = { rank: number; name: string; score: number; stars: number; me?: boolean };
export type Board = { period: Period; key: string; total: number; top: LbRow[]; me: LbRow | null; joined: boolean; resetAt?: string };
export type Payload = { deviceId: string; username: string; kind: 'training'; daily: { score: number; date: string }; weekly: { score: number; weekKey: string } };
export class LbError extends Error { constructor(public kind: 'offline' | 'error' | 'setup', msg: string) { super(msg); } }

export const DEBOUNCE_MS = 5 * 60e3;
/** v1.12.1: the leaderboard score = the Training stars' score (0–100). */
export const lbScoreOf = (st: Pick<Stars, 'training'>) => Math.round(st.training.score);
export const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

/** Today's and this week's training score. Past days of the week are re-computed as they stood at the end of that day. */
export async function lbScores(now = new Date()): Promise<{ daily: number; weekly: number; day: string; week: string; days: number }> {
  const [s, diary, workouts, exList, steps, dose] = await Promise.all([getSettings(), all<DiaryEntry>('diary'), all<Workout>('workouts'), all<Exercise>('exercises'), stepLog(), loadDoseData()]);
  const exercises = new Map(exList.map((e) => [e.id, e])); const today = ymd(now);
  const at = (date: string) => {
    const end = new Date(addDays(date, 1) + 'T00:00:00').getTime(); const doseSlots: { date: string; taken: boolean }[] = [];
    for (let i = 1; i <= 7; i++) for (const sl of slotsFor(addDays(date, -i), dose.schedules, dose.supps, dose.logs, now)) if (sl.status === 'taken' || sl.status === 'missed') doseSlots.push({ date: sl.date, taken: sl.status === 'taken' });
    return lbScoreOf(computeStars({ today: date, diary, workouts: workouts.filter((w) => w.start < end), exercises, steps, settings: s, doseSlots }));
  };
  const week = sydWeek(now.getTime()).week; const days: string[] = [];
  for (let d = week, i = 0; d <= today && i < 7; d = addDays(d, 1), i++) days.push(d);
  if (!days.includes(today)) days.push(today);
  const scores = days.map(at); const daily = scores[scores.length - 1];
  return { daily, weekly: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length), day: sydYmd(now.getTime()), week, days: days.length };
}
export async function buildPayload(now = new Date()): Promise<Payload | null> {
  const s = await getSettings(); if (!s.username) return null; const x = await lbScores(now);
  return { deviceId: deviceId(), username: s.username, kind: 'training', daily: { score: x.daily, date: x.day }, weekly: { score: x.weekly, weekKey: x.week } };
}

// ---------- submit / leave ----------
const LAST = 'lbLast', PEND_LEAVE = 'lbLeavePending';
const readLast = (): { sig: string; at: number } | null => { try { return JSON.parse(localStorage.getItem(LAST) || 'null'); } catch { return null; } };
export type SubmitResult = 'sent' | 'same' | 'off' | 'nouser' | 'offline' | 'error';
/** Send the scores if opted in and they changed (or the last send is >12 h old). Quiet: never throws. */
export async function submitScores(): Promise<SubmitResult> {
  try {
    const s = await getSettings(); if (!s.lbJoin) return 'off'; if (!s.username) return 'nouser';
    if (!proxyReady()) return 'error'; if (!navigator.onLine) return 'offline';
    const p = await buildPayload(); if (!p) return 'nouser'; const sig = JSON.stringify(p); const last = readLast();
    if (last && last.sig === sig && Date.now() - last.at < 12 * 3600e3) return 'same';
    const r = await fetch(proxyUrl() + '/leaderboard/submit', { method: 'POST', headers: { 'Content-Type': 'application/json', ...proxyHeaders(s) }, body: sig });
    if (!r.ok) return 'error';
    const j = await r.json().catch(() => ({})); if (j && j.stored === false) return 'error';
    localStorage.setItem(LAST, JSON.stringify({ sig, at: Date.now() }));
    if (!(await getSettings()).lbJoin) await leaveBoard(); // left while this was in flight
    return 'sent';
  } catch { return navigator.onLine ? 'error' : 'offline'; }
}
/** Delete this device's entry on the server. If offline, remember and retry on the next app open. */
export async function leaveBoard(): Promise<boolean> {
  localStorage.removeItem(LAST);
  try {
    const r = await fetch(proxyUrl() + '/leaderboard/leave', { method: 'POST', headers: proxyHeaders(await getSettings()) });
    if (r.ok) { localStorage.removeItem(PEND_LEAVE); return true; }
  } catch {}
  localStorage.setItem(PEND_LEAVE, '1'); return false;
}
/** Join or leave. Joining sends the scores straight away; leaving deletes the server entry. */
export async function setJoin(join: boolean): Promise<SubmitResult | boolean> {
  const s = await getSettings(); await put('kv', { ...s, lbJoin: join, lbAsked: s.lbAsked || Date.now() });
  if (join) { localStorage.removeItem(PEND_LEAVE); localStorage.removeItem(LAST); return submitScores(); }
  return leaveBoard();
}
export async function markAsked() { const s = await getSettings(); if (!s.lbAsked) await put('kv', { ...s, lbAsked: Date.now() }); }

let timer: ReturnType<typeof setTimeout> | undefined;
/** Debounced background submit: at most once per DEBOUNCE_MS (trailing), only when opted in. */
export function scheduleSubmit(delay = 2000) {
  if (timer) return; const last = readLast()?.at || 0; const wait = Math.max(delay, last + DEBOUNCE_MS - Date.now());
  timer = setTimeout(async () => { timer = undefined; await submitScores(); }, wait);
}
let inited = false;
export function initLeaderboard() {
  if (inited) return; inited = true;
  getSettings().then((s) => { if (localStorage.getItem(PEND_LEAVE) && !s.lbJoin) leaveBoard(); else if (s.lbJoin) scheduleSubmit(); }).catch(() => {});
  // submitScores itself checks the opt-in, so these stay cheap (one pending timer at most, e.g. during a big import)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSubmit(); });
  addEventListener('lunk-logged', () => scheduleSubmit());
}

// ---------- view ----------
export async function fetchBoard(period: Period): Promise<Board> {
  if (!proxyReady()) throw new LbError('setup', 'The leaderboard is being set up.');
  if (!navigator.onLine) throw new LbError('offline', "You're offline. The leaderboard needs an internet connection.");
  let r: Response;
  try { r = await fetch(proxyUrl() + '/leaderboard?period=' + period, { headers: proxyHeaders(await getSettings()) }); }
  catch { throw new LbError(navigator.onLine ? 'error' : 'offline', navigator.onLine ? "Grug can't reach the board right now. Check your connection and try again." : "You're offline. The leaderboard needs an internet connection."); }
  let j: any = null; try { j = await r.json(); } catch {}
  if (!r.ok || !j || !Array.isArray(j.top)) throw new LbError('error', r.status === 503 ? 'The leaderboard is switched off for now.' : "Grug can't reach the board right now. Try again in a bit.");
  return j as Board;
}
