/** AI Coach: backend selection (proxy or user's own xAI key), compact data context, streaming client, action parsing, tiny markdown. */
import { all, get, getSettings } from './db';
import type { BodyWeight, DiaryEntry, DoseLog, Exercise, Routine, Schedule, Settings, Supplement, Workout } from './types';
import { addDays, e1rm, netCarbs, r0, r1, sumN, workingSets, ymd, EMPTY } from './util';
import { ageFromBirthYear, sortBW } from './energy';
import { slotsFor } from './doses';
import { workoutVolume } from './workoutLogic';

/** Coach proxy (Cloudflare Worker, coach-proxy/). A localStorage 'coachProxyUrl' override exists for testing; a URL containing REPLACE-ME means "not set up". */
export const COACH_PROXY_URL = 'https://grug-coach-proxy.grug-fitgrug-fitgrug-fit.workers.dev';
export const XAI_URL = 'https://api.x.ai/v1/chat/completions';
export const COACH_MODEL = 'grok-4.7';
export const proxyUrl = () => (localStorage.getItem('coachProxyUrl') || COACH_PROXY_URL).replace(/\/+$/, '');
export const proxyReady = () => !/REPLACE-ME/.test(proxyUrl()) && /^https?:\/\//.test(proxyUrl());
export function deviceId() {
  let id = localStorage.getItem('coachDevice');
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) { id = crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16)); localStorage.setItem('coachDevice', id); }
  return id;
}
export type CoachMode = 'own' | 'proxy' | 'setup';
export const coachMode = (s: Settings): CoachMode => (s.coachKey ? 'own' : proxyReady() ? 'proxy' : 'setup');

export class CoachError extends Error { constructor(public kind: 'offline' | 'limit' | 'disabled' | 'setup' | 'key' | 'http' | 'network' | 'too_long', msg: string, public extra: any = {}) { super(msg); } }

// ---------- remaining-messages bookkeeping ----------
export type Quota = { remaining: number | null; cap?: number; resetAt?: string; owner?: boolean; day: string };
export const readQuota = (): Quota | null => { try { const q = JSON.parse(localStorage.getItem('coachQuota') || 'null'); return q && q.day === ymd() ? q : null; } catch { return null; } };
const saveQuota = (q: Omit<Quota, 'day'>) => { localStorage.setItem('coachQuota', JSON.stringify({ ...q, day: ymd() })); dispatchEvent(new Event('coach-quota')); };
const proxyHeaders = (s: Settings): Record<string, string> => ({ 'X-Device-Id': deviceId(), ...(s.coachOwnerToken ? { 'X-Owner-Token': s.coachOwnerToken } : {}) });
export async function fetchStatus(): Promise<Quota | null> {
  const s = await getSettings(); if (coachMode(s) !== 'proxy') return null;
  try {
    const r = await fetch(proxyUrl() + '/status', { headers: proxyHeaders(s) }); const j = await r.json();
    if (!r.ok) { if (j?.error === 'disabled') saveQuota({ remaining: 0 }); return readQuota(); }
    const q = { remaining: j.owner ? null : j.remaining, cap: j.cap, resetAt: j.resetAt, owner: !!j.owner }; saveQuota(q); return { ...q, day: ymd() };
  } catch { return readQuota(); }
}

// ---------- context ----------
const md = (d: string) => d.slice(5); // MM-DD
/** Compact JSON summary of the user's data (kept to a few thousand tokens). */
export async function buildContext(now = new Date()): Promise<any> {
  const s = await getSettings(); const today = ymd(now); const from14 = addDays(today, -13);
  const [diary, workouts, bws, supps, schedules, logs, exs, active] = await Promise.all([
    all<DiaryEntry>('diary'), all<Workout>('workouts'), all<BodyWeight>('bodyweight'), all<Supplement>('supplements'), all<Schedule>('schedules'), all<DoseLog>('doselogs'), all<Exercise>('exercises'), get<{ w: Workout | null }>('kv', 'active')]);
  const exName = new Map(exs.map((e) => [e.id, e.name]));
  const bw = sortBW(bws); const latest = bw[bw.length - 1]; const ago30 = bw.filter((x) => x.date <= addDays(today, -30)).pop() || bw[0];
  const p = s.profile; const t = s.targets;
  const days: any[] = []; const totals: any[] = [];
  for (let i = 0; i < 14; i++) {
    const d = addDays(from14, i); const es = diary.filter((e) => e.date === d); if (!es.length) continue;
    const n = sumN(es.map((e) => e.n)); totals.push(n); days.push([md(d), r0(n.kcal), r0(n.protein), r0(netCarbs(n)), r0(n.fat)]);
  }
  const avg = totals.length ? sumN(totals) : EMPTY; const k = totals.length || 1;
  const done = workouts.filter((w) => w.end).sort((a, b) => b.start - a.start);
  const recent = done.slice(0, 10).map((w) => ({
    d: md(ymd(new Date(w.start))), name: w.name, min: Math.round(((w.end || w.start) - w.start) / 60000), volKg: r0(workoutVolume(w)),
    ex: w.exercises.map((e) => { const ws = workingSets(e.sets); const top = ws.sort((a, b) => e1rm(b.kg || 0, b.reps || 0) - e1rm(a.kg || 0, a.reps || 0))[0];
      return [exName.get(e.exerciseId) || '?', top ? `${r1(top.kg || 0)}x${top.reps}` : '-', ws.length]; }).filter((x) => x[2])
  }));
  const prs = done.slice(0, 30).flatMap((w) => (w.prs || []).map((pr) => [md(ymd(new Date(w.start))), exName.get(pr.exerciseId) || '?', pr.kind, r1(pr.value)])).slice(0, 15);
  const slots14: Record<string, { due: number; taken: number }> = {};
  for (let i = 0; i < 14; i++) for (const sl of slotsFor(addDays(from14, i), schedules, supps, logs, now)) { if (sl.status === 'upcoming' || sl.status === 'due') continue; const o = (slots14[sl.supp.id] ||= { due: 0, taken: 0 }); o.due++; if (sl.status === 'taken') o.taken++; }
  const ctx: any = {
    today, weekday: now.toLocaleDateString('en-AU', { weekday: 'short' }), units: { energy: s.energyUnit, weight: s.weightUnit },
    profile: p ? { sex: p.sex, age: ageFromBirthYear(p.birthYear, now), heightCm: p.heightCm, goal: p.goal, weightKg: latest ? r1(latest.kg) : null } : (latest ? { weightKg: r1(latest.kg) } : null),
    targets: { kcal: t.kcal, protein: t.protein, netCarbs: t.carbs, fat: t.fat, fibre: t.fibre },
    nutrition14d: { cols: 'MM-DD,kcal,protein,netCarbs,fat', days, loggedDays: totals.length, avgPerLoggedDay: { kcal: r0(avg.kcal / k), protein: r0(avg.protein / k), netCarbs: r0(netCarbs(avg) / k), fat: r0(avg.fat / k) } },
    workouts: { cols: 'exercise,topSet(kg x reps),workingSets', recent, totalLogged: done.length },
    prs,
    bodyWeight: latest ? { latestKg: r1(latest.kg), latestDate: md(latest.date), change30dKg: ago30 ? r1(latest.kg - ago30.kg) : null, recent: bw.slice(-8).map((x) => [md(x.date), r1(x.kg)]) } : null,
    supplements: supps.filter((x) => !x.archived).map((x) => ({ name: x.name, kind: x.kind, dose: `${x.doseAmount} ${x.unit}`, adherence14d: slots14[x.id] ? `${slots14[x.id].taken}/${slots14[x.id].due}` : 'no schedule' })),
    routines: (await all<Routine>('routines')).slice(0, 8).map((r) => r.name)
  };
  if (active?.w) ctx.workoutInProgress = { name: active.w.name, startedMinAgo: Math.round((Date.now() - active.w.start) / 60000) };
  let j = JSON.stringify(ctx);
  if (j.length > 9000) { ctx.workouts.recent = ctx.workouts.recent.slice(0, 5); ctx.prs = ctx.prs.slice(0, 6); j = JSON.stringify(ctx); }
  return ctx;
}
export const SYSTEM_PROMPT = `You are Grug Coach, the in-app fitness coach of Grug Fit (a workout, nutrition and supplement tracker).
Style: supportive, direct and concise (short paragraphs or bullet points; no fluff). Use Markdown. Australian English, metric units unless the user's units say otherwise.
Evidence: base advice on mainstream, well-established sports science and nutrition guidance; say when evidence is weak or mixed. Don't invent numbers about the user — use the DATA below, and say if data is missing (e.g. no food logged).
Safety: you are not a doctor. Don't diagnose. For medications, supplement doses beyond standard label/evidence-based ranges, injuries, pain, eating disorders, pregnancy or medical conditions, give general information only and tell the user to check with their doctor or pharmacist.
Actions: you may PROPOSE changes the app can apply after the user taps Save. Put each proposal in its own fenced block with the language tag grug-action containing one JSON object, after your explanation:
\`\`\`grug-action
{"type":"create_routine","name":"Push A","exercises":[{"name":"Bench Press (Barbell)","sets":3,"reps":8,"restSec":120}]}
\`\`\`
\`\`\`grug-action
{"type":"update_targets","kcal":2400,"protein":170,"carbs":250,"fat":70}
\`\`\`
For create_routine use common exercise names (e.g. "Squat (Barbell)", "Lat Pulldown (Cable)"); for a multi-day plan propose one create_routine per day. update_targets values are daily kcal and grams (carbs = net carbs); include only fields you want to change. Never claim a change was made — the user decides.`;
export async function systemMessage() { return `${SYSTEM_PROMPT}\n\nDATA (the user's own logs, JSON):\n${JSON.stringify(await buildContext())}`; }

// ---------- streaming client ----------
export type ChatMsg = { role: 'user' | 'assistant'; content: string };
export async function streamChat(history: ChatMsg[], onDelta: (text: string) => void, signal?: AbortSignal): Promise<string> {
  const s = await getSettings(); const mode = coachMode(s);
  if (mode === 'setup') throw new CoachError('setup', 'Coach is being set up.');
  if (!navigator.onLine) throw new CoachError('offline', "You're offline — the coach needs an internet connection.");
  const sys = await systemMessage();
  // keep the request small: last 12 turns, total under ~20k chars
  const hist: ChatMsg[] = []; let chars = sys.length;
  for (const m of [...history].reverse()) { if (hist.length >= 12 || chars + m.content.length > 20000) break; hist.unshift(m); chars += m.content.length; }
  const messages = [{ role: 'system', content: sys }, ...hist];
  let r: Response;
  try {
    r = mode === 'own'
      ? await fetch(XAI_URL, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.coachKey}` }, body: JSON.stringify({ model: COACH_MODEL, messages, stream: true, max_tokens: 1200 }) })
      : await fetch(proxyUrl() + '/chat', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...proxyHeaders(s) }, body: JSON.stringify({ messages, stream: true }) });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    throw new CoachError(navigator.onLine ? 'network' : 'offline', navigator.onLine ? "Couldn't reach the coach. Check your connection and try again." : "You're offline — the coach needs an internet connection.");
  }
  if (mode === 'proxy') { const rem = r.headers.get('X-Coach-Remaining'); if (rem != null) saveQuota({ remaining: rem === 'unlimited' ? null : +rem, owner: rem === 'unlimited', resetAt: r.headers.get('X-Coach-Reset') || undefined, cap: +(r.headers.get('X-Coach-Cap') || 0) || undefined }); }
  if (!r.ok) {
    let j: any = {}; try { j = await r.json(); } catch {}
    if (r.status === 429 && mode === 'proxy' && j.error === 'rate_limited') throw new CoachError('limit', 'Too many messages in a short time – wait a minute and try again.', j);
    if (r.status === 429 && mode === 'proxy' && j.error === 'ip_limit') { saveQuota({ remaining: 0, resetAt: j.resetAt, cap: j.cap }); throw new CoachError('limit', `Daily coach limit reached for this network (${j.cap} messages, shared by everyone on this Wi-Fi/connection). It resets ${j.resetAt ? 'at ' + new Date(j.resetAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }) : 'tomorrow'}.`, j); }
    if (r.status === 429 && mode === 'proxy') { saveQuota({ remaining: 0, resetAt: j.resetAt, cap: j.cap }); throw new CoachError('limit', j.error === 'global_limit' ? "The coach has hit today's shared limit. Try again tomorrow." : `You've used today's ${j.cap || ''} coach messages. They reset ${j.resetAt ? 'at ' + new Date(j.resetAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }) : 'tomorrow'}.`.replace('  ', ' '), j); }
    if (r.status === 503 && j.error === 'disabled') throw new CoachError('disabled', 'The coach is switched off for now. Try again later.');
    if (r.status === 413) throw new CoachError('too_long', 'This chat is too long for the coach. Tap “Clear chat” and ask again.');
    if (mode === 'own' && (r.status === 401 || r.status === 403)) throw new CoachError('key', 'xAI rejected your API key — check it in Settings › Coach.');
    if (mode === 'own' && r.status === 429) throw new CoachError('limit', 'xAI says your key is rate-limited or out of credit.');
    throw new CoachError('http', `The coach had a problem (${j.message || 'HTTP ' + r.status}). Try again.`);
  }
  let text = '';
  if (!/event-stream/.test(r.headers.get('content-type') || '') || !r.body) { const j = await r.json(); text = j.choices?.[0]?.message?.content || ''; onDelta(text); return text; }
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true }); let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue; const data = line.slice(5).trim(); if (data === '[DONE]') continue;
      try { const d = JSON.parse(data).choices?.[0]?.delta?.content; if (d) { text += d; onDelta(text); } } catch {}
    }
  }
  return text;
}

// ---------- actions ----------
export type CoachAction = { type: 'create_routine'; name: string; exercises: { name: string; sets?: number; reps?: number; restSec?: number; kg?: number }[] } | { type: 'update_targets'; kcal?: number; protein?: number; carbs?: number; fat?: number; fibre?: number };
/** Split assistant text into markdown parts and grug-action blocks (complete ones only, so streaming text doesn't flash half a card). */
export function splitActions(text: string): { parts: (string | { action: CoachAction | null; raw: string })[] } {
  const parts: (string | { action: CoachAction | null; raw: string })[] = []; const re = /```grug-action\s*\n([\s\S]*?)```/g; let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) { parts.push(text.slice(last, m.index)); let a: any = null; try { a = JSON.parse(m[1]); } catch {} parts.push({ action: validAction(a), raw: m[1] }); last = m.index + m[0].length; }
  let rest = text.slice(last); const open = rest.indexOf('```grug-action'); if (open >= 0) rest = rest.slice(0, open) + '\n\n_…preparing a suggestion…_';
  parts.push(rest); return { parts };
}
const inR = (v: any, lo: number, hi: number) => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;
export function validAction(a: any): CoachAction | null {
  if (!a || typeof a !== 'object') return null;
  if (a.type === 'create_routine' && typeof a.name === 'string' && Array.isArray(a.exercises) && a.exercises.length && a.exercises.length <= 20 && a.exercises.every((e: any) => e && typeof e.name === 'string' && e.name.trim()))
    return { type: 'create_routine', name: a.name.slice(0, 60), exercises: a.exercises.map((e: any) => ({ name: e.name.trim().slice(0, 60), sets: inR(e.sets, 1, 10) ? Math.round(e.sets) : 3, reps: inR(e.reps, 1, 100) ? Math.round(e.reps) : undefined, restSec: inR(e.restSec, 0, 600) ? Math.round(e.restSec) : undefined, kg: inR(e.kg, 0, 500) ? e.kg : undefined })) };
  if (a.type === 'update_targets') {
    const o: any = { type: 'update_targets' }; const lim: Record<string, [number, number]> = { kcal: [1000, 6000], protein: [30, 400], carbs: [0, 800], fat: [20, 300], fibre: [10, 80] };
    for (const [k, [lo, hi]] of Object.entries(lim)) if (a[k] != null) { if (!inR(a[k], lo, hi)) return null; o[k] = Math.round(a[k]); }
    return Object.keys(o).length > 1 ? o : null;
  }
  return null;
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
/** Map a suggested exercise name to the library: exact, then contains, then best word overlap; null = new custom exercise. */
export function matchExercise(name: string, list: Exercise[]): Exercise | null {
  const n = norm(name); const exact = list.find((e) => norm(e.name) === n); if (exact) return exact;
  const base = n.replace(/ (barbell|dumbbell|cable|machine|bodyweight)$/, '');
  const cont = list.filter((e) => norm(e.name).startsWith(base) || norm(e.name).includes(n)); if (cont.length) return cont.sort((a, b) => a.name.length - b.name.length)[0];
  const words = new Set(n.split(' ')); let best: Exercise | null = null, score = 0;
  for (const e of list) { const w = norm(e.name).split(' '); const hit = w.filter((x) => words.has(x)).length / Math.max(w.length, words.size); if (hit > score) { score = hit; best = e; } }
  return score >= 0.6 ? best : null;
}

// ---------- markdown (escape first; small safe subset) ----------
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = (s: string) => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>')
  .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
export function renderMarkdown(src: string): string {
  const out: string[] = []; const lines = src.replace(/\r/g, '').split('\n'); let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) { const buf: string[] = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`); continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(l); if (h) { const lv = Math.min(4, h[1].length + 2); out.push(`<h${lv}>${inline(h[2])}</h${lv}>`); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const row = (r: string) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = row(l); i += 2; const body: string[][] = []; while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(row(lines[i++]));
      out.push(`<div class="md-table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`); continue;
    }
    if (/^\s*[-*•]\s+/.test(l)) { const it: string[] = []; while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) it.push(lines[i++].replace(/^\s*[-*•]\s+/, '')); out.push(`<ul>${it.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`); continue; }
    if (/^\s*\d+[.)]\s+/.test(l)) { const it: string[] = []; while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) it.push(lines[i++].replace(/^\s*\d+[.)]\s+/, '')); out.push(`<ol>${it.map((x) => `<li>${inline(x)}</li>`).join('')}</ol>`); continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (!l.trim()) { i++; continue; }
    const para: string[] = []; while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*[-*•]\s|\s*\d+[.)]\s|\s*\|)/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) { para.push(l); i++; }
    out.push(`<p>${para.map(inline).join('<br>')}</p>`);
  }
  return out.join('');
}
