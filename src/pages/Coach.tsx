import { useEffect, useRef, useState } from 'preact/hooks';
import { all, get, getSettings, put } from '../db';
import { go, useQuery, useSettings } from '../hooks';
import type { Exercise, Routine, RoutineEx, Settings } from '../types';
import { Top, confirmDo, toast } from '../ui';
import { uid } from '../util';
import { CoachError, coachMode, fetchStatus, matchExercise, readQuota, renderMarkdown, splitActions, streamChat, type CoachAction, type ChatMsg, type Quota } from '../coach';

type Msg = { id: string; role: 'user' | 'assistant'; content: string; ts: number; acts?: Record<number, 'saved' | 'dismissed'> };
const SUGGESTED = ['Why has my bench stalled?', 'What should I eat tonight to hit protein?', 'Build me a 4-day PPL plan', "How's my week looking?"];
const loadChat = async () => ((await get<{ id: string; messages: Msg[] }>('kv', 'coachChat'))?.messages || []);
const saveChat = (messages: Msg[]) => put('kv', { id: 'coachChat', messages: messages.slice(-200) });

export function useQuota() {
  const [q, setQ] = useState<Quota | null>(readQuota());
  useEffect(() => { const f = () => setQ(readQuota()); addEventListener('coach-quota', f); fetchStatus().then(f); return () => removeEventListener('coach-quota', f); }, []);
  return q;
}
export const quotaText = (q: Quota | null) => !q ? '' : q.owner || q.remaining == null ? 'Owner: unlimited' : `${q.remaining}${q.cap ? `/${q.cap}` : ''} messages left today`;

export function CoachPage() {
  const s = useSettings(); const mode = coachMode(s); const q = useQuota();
  const [msgs, setMsgs] = useState<Msg[] | null>(null); const [input, setInput] = useState(''); const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; kind: string; retry?: string } | null>(null); const abort = useRef<AbortController | null>(null); const end = useRef<HTMLDivElement>(null);
  useEffect(() => { loadChat().then(setMsgs); return () => abort.current?.abort(); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs?.length, msgs?.[msgs.length - 1]?.content.length, err]);
  const consent = !!s.coachConsent || mode === 'own';

  const send = async (text: string) => {
    text = text.trim(); if (!text || busy || !msgs) return; setErr(null);
    const user: Msg = { id: uid(), role: 'user', content: text, ts: Date.now() }; let list = [...msgs, user]; setMsgs(list); setInput(''); await saveChat(list);
    const bot: Msg = { id: uid(), role: 'assistant', content: '', ts: Date.now() }; setBusy(true); abort.current = new AbortController();
    try {
      const hist: ChatMsg[] = list.map((m) => ({ role: m.role, content: m.content }));
      let shown = false;
      const final = await streamChat(hist, (t) => { bot.content = t; if (!shown) { shown = true; } setMsgs([...list, { ...bot }]); }, abort.current.signal);
      bot.content = final || bot.content; if (!bot.content.trim()) throw new CoachError('http', 'The coach sent an empty reply. Try again.');
      list = [...list, { ...bot }]; setMsgs(list); await saveChat(list);
    } catch (e: any) {
      if (e?.name === 'AbortError') { if (bot.content) { list = [...list, { ...bot, content: bot.content + '\n\n_(stopped)_' }]; await saveChat(list); } setMsgs(list); }
      else { setMsgs(list); setErr({ text: e instanceof CoachError ? e.message : `Something went wrong (${e?.message || e}).`, kind: e?.kind || 'error', retry: text }); }
    } finally { setBusy(false); abort.current = null; }
  };
  const retry = async () => { if (!err?.retry || !msgs) return; const t = err.retry; const l = msgs[msgs.length - 1]?.role === 'user' && msgs[msgs.length - 1].content === t ? msgs.slice(0, -1) : msgs; setMsgs(l); await saveChat(l); setErr(null); setTimeout(() => send(t), 0); };
  const setAct = async (mid: string, i: number, v: 'saved' | 'dismissed') => { const l = (msgs || []).map((m) => (m.id === mid ? { ...m, acts: { ...(m.acts || {}), [i]: v } } : m)); setMsgs(l); await saveChat(l); };

  return <><Top title="Coach" right={<>{mode === 'proxy' && q && <span class="pill info" data-testid="coach-quota">{quotaText(q)}</span>}
    {!!msgs?.length && <button class="btn sm" data-testid="coach-clear" onClick={async () => { if (confirmDo('Clear the whole coach chat on this device?')) { abort.current?.abort(); setMsgs([]); setErr(null); await saveChat([]); } }}>Clear chat</button>}</>} />
    <div class="page coach" data-editing={busy ? '1' : undefined}>
      {mode === 'setup' && <div class="card col" data-testid="coach-setup" style="border-color:var(--acc2)">
        <b>🛠️ Coach is being set up</b>
        <div class="sm">The AI coach will be available here soon — nothing to do on your end. If you have your own xAI API key you can use it now in <a href="#/settings" style="color:var(--acc2)">Settings › Coach</a>.</div></div>}
      {mode !== 'setup' && !consent && <div class="card col" data-testid="coach-consent">
        <b>🔒 Before you chat</b>
        <div class="sm">To give personal advice, each message sends a <b>summary of your Grug Fit data</b> to xAI (the company behind Grok) through Grug Fit's small relay server:</div>
        <ul class="sm" style="margin:0;padding-left:18px"><li>profile (age, sex, height, goal) and targets</li><li>daily nutrition totals for the last 14 days</li><li>your last 10 workouts, PRs and body-weight trend</li><li>supplements/medications by name and how often you've taken them</li></ul>
        <div class="xs mut">Your chat history stays on this device. The relay only counts messages per anonymous device ID (to cap daily use) and doesn't store what you send. xAI processes the request under its own privacy policy. The coach isn't a doctor — check medications and supplement doses with yours.</div>
        <button class="btn p" data-testid="coach-accept" onClick={async () => { const cur = await getSettings(); await put('kv', { ...cur, coachConsent: Date.now() }); }}>I understand — start chatting</button></div>}
      {mode !== 'setup' && consent && msgs && !msgs.length && <div class="col" style="gap:8px;margin:6px 0 10px">
        <div class="mut sm">Ask about your training, food or recovery — the coach can see a summary of your logs.</div>
        {SUGGESTED.map((p) => <button class="btn sugg" data-testid="coach-suggest" onClick={() => send(p)}>{p}</button>)}</div>}
      <div class="chat" data-testid="coach-chat">{(msgs || []).map((m) => m.role === 'user' ? <div class="bubble me">{m.content}</div>
        : <Assistant m={m} onAct={(i, v) => setAct(m.id, i, v)} />)}
        {busy && msgs?.[msgs.length - 1]?.role === 'user' && <div class="bubble bot typing" data-testid="coach-typing"><span /><span /><span /></div>}
        {err && <div class="card col coach-err" data-testid="coach-error" data-kind={err.kind}><div class="sm">⚠️ {err.text}</div>{err.retry && !['limit', 'disabled', 'setup'].includes(err.kind) && <button class="btn sm" data-testid="coach-retry" onClick={retry}>↻ Try again</button>}</div>}
        <div ref={end} /></div>
    </div>
    {mode !== 'setup' && consent && <form class="composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
      <textarea rows={1} value={input} placeholder="Ask your coach…" aria-label="Message the coach" onInput={(e) => setInput(e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !(e as any).isComposing) { e.preventDefault(); send(input); } }} />
      {busy ? <button type="button" class="btn" aria-label="Stop" data-testid="coach-stop" onClick={() => abort.current?.abort()}>■</button>
        : <button type="submit" class="btn p" aria-label="Send" data-testid="coach-send" disabled={!input.trim()}>➤</button>}
    </form>}</>;
}

function Assistant({ m, onAct }: { m: Msg; onAct: (i: number, v: 'saved' | 'dismissed') => void }) {
  const { parts } = splitActions(m.content); let ai = -1;
  return <div class="bubble bot" data-testid="coach-reply">{parts.map((p) => {
    if (typeof p === 'string') return p.trim() ? <div class="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(p) }} /> : null;
    ai++; const i = ai;
    return p.action ? <ActionCard a={p.action} state={m.acts?.[i]} onDone={(v) => onAct(i, v)} /> : <div class="xs mut">(The coach suggested a change the app couldn't read.)</div>;
  })}</div>;
}

function ActionCard({ a, state, onDone }: { a: CoachAction; state?: 'saved' | 'dismissed'; onDone: (v: 'saved' | 'dismissed') => void }) {
  const s = useSettings(); const exs = (useQuery(() => all<Exercise>('exercises'), [], []) || []) as Exercise[];
  const [savedId, setSavedId] = useState<string | null>(null);
  if (a.type === 'create_routine') {
    const rows = a.exercises.map((e) => ({ e, m: matchExercise(e.name, exs) }));
    const save = async () => {
      const exercises: RoutineEx[] = [];
      for (const { e, m } of rows) {
        let id = m?.id;
        if (!id) { const ex: Exercise = { id: 'cx' + uid(), name: e.name, muscle: 'Other', equipment: 'Other', custom: true }; await put('exercises', ex); id = ex.id; }
        exercises.push({ exerciseId: id, sets: e.sets || 3, reps: e.reps, kg: e.kg, restSec: e.restSec ?? s.defaultRest });
      }
      const r: Routine = { id: uid(), name: a.name || 'Coach routine', exercises, updated: Date.now(), notes: 'Suggested by Grug Coach' };
      await put('routines', r); setSavedId(r.id); onDone('saved'); toast(`Routine “${r.name}” saved`);
    };
    return <div class={'card col action-card ' + (state || '')} data-testid="coach-action" data-type="create_routine">
      <div class="row between"><b class="sm">📋 New routine: {a.name}</b>{state && <span class={'pill ' + (state === 'saved' ? 'ok' : '')}>{state === 'saved' ? 'Saved' : 'Dismissed'}</span>}</div>
      <div class="xs">{rows.map(({ e, m }) => <div class="row between"><span class="ell">{m?.name || e.name}{!m && <span class="pill warn" style="margin-left:4px">new</span>}</span><span class="mut">{e.sets || 3}×{e.reps ?? '–'}{e.restSec ? ` · ${e.restSec}s` : ''}</span></div>)}</div>
      {!state && <div class="grid2"><button class="btn sm" data-testid="action-dismiss" onClick={() => onDone('dismissed')}>Dismiss</button><button class="btn sm p" data-testid="action-save" onClick={save}>Save routine</button></div>}
      {state === 'saved' && <button class="btn g sm" onClick={() => go(savedId ? `/routine/${savedId}` : '/workouts?list=1')}>Open in Workouts ›</button>}
    </div>;
  }
  const t = s.targets; const keys = (['kcal', 'protein', 'carbs', 'fat', 'fibre'] as const).filter((k) => a[k] != null);
  const label: Record<string, string> = { kcal: 'Calories', protein: 'Protein', carbs: 'Net carbs', fat: 'Fat', fibre: 'Fibre' };
  const save = async () => { const cur: Settings = await getSettings(); const nt = { ...cur.targets }; for (const k of keys) (nt as any)[k] = a[k]; await put('kv', { ...cur, targets: nt }); onDone('saved'); toast('Targets updated'); };
  return <div class={'card col action-card ' + (state || '')} data-testid="coach-action" data-type="update_targets">
    <div class="row between"><b class="sm">🎯 Update daily targets</b>{state && <span class={'pill ' + (state === 'saved' ? 'ok' : '')}>{state === 'saved' ? 'Saved' : 'Dismissed'}</span>}</div>
    <div class="xs">{keys.map((k) => <div class="row between"><span>{label[k]}</span><span>{state === 'saved' ? '' : <><span class="mut">{(t as any)[k]}</span> → </>}<b>{a[k]}</b> {k === 'kcal' ? 'kcal' : 'g'}</span></div>)}</div>
    {!state && <div class="grid2"><button class="btn sm" data-testid="action-dismiss" onClick={() => onDone('dismissed')}>Dismiss</button><button class="btn sm p" data-testid="action-save" onClick={save}>Save targets</button></div>}
  </div>;
}
