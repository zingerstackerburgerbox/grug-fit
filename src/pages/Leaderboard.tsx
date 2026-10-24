/** v1.12.0 Leaderboard: Weekly (default) / Daily tabs, ranked by Grug rating (Home stars, Training + Nutrition, out of 100).
 *  First open asks whether to show this lunk on the board; viewing works either way and never uses chat/estimate/review limits. */
import { useEffect, useState } from 'preact/hooks';
import { getSettings } from '../db';
import { useQuery } from '../hooks';
import { Top, toast } from '../ui';
import { addDays } from '../util';
import { fmtRange, fmtShort } from '../review';
import { fetchBoard, LbError, markAsked, MEDAL, setJoin, submitScores, type Board, type LbRow, type Period } from '../leaderboard';
import { UsernameModal } from './Username';

export const LbStars = ({ n }: { n: number }) => <span class="st" aria-label={`${n} of 5 stars`}>{'★'.repeat(n)}<i>{'★'.repeat(5 - n)}</i></span>;
function Row({ r }: { r: LbRow }) {
  return <div class={'lb-row' + (r.me ? ' me' : '')} data-testid="lb-row" data-rank={r.rank} data-me={r.me ? '1' : undefined}>
    <span class="lb-rank" aria-label={`Rank ${r.rank}`}>{MEDAL[r.rank] || r.rank}</span>
    <span class="lb-name grow">{r.name}{r.me && <span class="mut xs"> (you)</span>}</span>
    <LbStars n={r.stars} /><b class="lb-score" data-testid="lb-score">{r.score}</b></div>;
}
export function JoinPrompt({ onJoin, onLook }: { onJoin: () => void; onLook: () => void }) {
  return <div class="modal-bg" data-testid="lb-optin" role="dialog" aria-modal="true" aria-labelledby="lb-h"><div class="modal col">
    <div style="font-size:34px;line-height:1">🏆</div>
    <h2 id="lb-h" style="margin:0">Show you on the leaderboard?</h2>
    <div class="sm">Lunks are ranked by Grug rating: your Training and Nutrition stars, out of 100.</div>
    <div class="mut xs">Only your username and scores are shared. Never your weight, food, calories or photos. Change it any time in Settings.</div>
    <button class="btn p full" data-testid="lb-join" onClick={onJoin}>Show me on the leaderboard</button>
    <button class="btn full" data-testid="lb-look" onClick={onLook}>Just look</button>
  </div></div>;
}

export function LeaderboardPage() {
  const s = useQuery(getSettings, []); const [tab, setTab] = useState<Period>('weekly');
  const [boards, setBoards] = useState<Partial<Record<Period, Board | LbError>>>({}); const [ask, setAsk] = useState(false); const [needName, setNeedName] = useState(false); const [n, setN] = useState(0);
  const load = async () => { const res = await Promise.all((['weekly', 'daily'] as Period[]).map((p) => fetchBoard(p).catch((e) => (e instanceof LbError ? e : new LbError('error', String(e))))));
    setBoards({ weekly: res[0], daily: res[1] }); };
  useEffect(() => { (async () => { const st = await getSettings(); if (!st.lbAsked) setAsk(true); if (st.lbJoin) await submitScores(); await load(); })(); }, [n]);
  const join = async () => { const st = await getSettings(); setAsk(false); if (!st.username) { setNeedName(true); return; }
    const r = await setJoin(true); toast(r === 'sent' || r === 'same' ? "You're on the leaderboard" : "You're in. Your score goes up when you're back online"); setBoards({}); setN((x) => x + 1); };
  const look = async () => { setAsk(false); await markAsked(); };
  const b = boards[tab];
  const head = tab === 'weekly' ? `This week · ${b && !(b instanceof LbError) ? fmtRange(b.key, addDays(b.key, 6)) : ''}` : `Today · ${b && !(b instanceof LbError) ? fmtShort(b.key) : ''}`;
  return <><Top title="Leaderboard" backBtn right={<button class="btn ic" aria-label="Refresh" data-testid="lb-refresh" onClick={() => { setBoards({}); setN((x) => x + 1); }}>↻</button>} />
    <div class="page lb" data-testid="leaderboard">
      <div class="seg" role="tablist" style="margin-bottom:10px">{(['weekly', 'daily'] as Period[]).map((p) => <button role="tab" aria-selected={tab === p} class={tab === p ? 'on' : ''} data-testid={`lb-tab-${p}`} onClick={() => setTab(p)}>{p === 'weekly' ? 'Weekly' : 'Daily'}</button>)}</div>
      <div class="mut sm" style="margin:0 2px 10px" data-testid="lb-period">{head.replace(/ · $/, '')}</div>
      {s && !s.lbJoin && s.lbAsked && <div class="card row" style="gap:10px;padding:10px 12px" data-testid="lb-looking"><span class="sm grow">You're just looking. Join to see your own rank.</span><button class="btn sm p" data-testid="lb-join-inline" onClick={join}>Show me</button></div>}
      {!b ? <div class="card col" data-testid="lb-loading"><div class="skel" style="width:70%" /><div class="skel" style="width:85%" /><div class="skel" style="width:60%" /></div>
      : b instanceof LbError ? <div class="card col" data-testid="lb-error" data-kind={b.kind} style="border-color:var(--warn)"><div class="row" style="gap:10px"><span style="font-size:26px">🪨</span><div class="sm grow">{b.message}</div></div>
          <button class="btn" data-testid="lb-retry" onClick={() => { setBoards({}); setN((x) => x + 1); }}>Try again</button></div>
      : !b.top.length ? <div class="card empty" data-testid="lb-empty"><div style="font-size:30px">🏔️</div><b>No lunks on the board yet</b><div class="mut xs" style="margin-top:4px">{s?.lbJoin ? 'Log food or a workout and your rating shows up here.' : 'Be the first: tap “Show me”.'}</div></div>
      : <div class="card lb-list" data-testid={`lb-list-${tab}`}>{b.top.map((r) => <Row r={r} />)}
          {b.me && !b.top.some((r) => r.me) && <><div class="lb-gap mut">⋯</div><Row r={b.me} /></>}</div>}
      {b && !(b instanceof LbError) && b.top.length > 0 && <div class="mut xs center" data-testid="lb-total">{b.total} lunk{b.total === 1 ? '' : 's'} on the board{s?.lbJoin && !b.me ? ' · your score shows up after your next update' : ''}</div>}
      <div class="disc" data-testid="lb-note">Grug rating = your Training and Nutrition stars combined, out of 100, worked out on each phone. Weekly is the average of this week's daily ratings (resets Monday). Only usernames and scores are shared.</div>
    </div>
    {ask && <JoinPrompt onJoin={join} onLook={look} />}
    {needName && <UsernameModal title="Pick a username" note="The leaderboard shows your username. Pick one first." onCancel={() => { setNeedName(false); markAsked(); }} onSaved={() => { setNeedName(false); join(); }} />}
  </>;
}

/** Settings › Leaderboard: join or leave (leaving deletes the entry on the server). */
export function LeaderboardSetting() {
  const s = useQuery(getSettings, []); const [busy, setBusy] = useState(false);
  const flip = async (on: boolean) => {
    if (busy) return; const st = await getSettings(); if (on && !st.username) { toast('Add a username first (Profile above)'); return; }
    setBusy(true); const r = await setJoin(on); setBusy(false);
    toast(on ? (r === 'sent' || r === 'same' ? "You're on the leaderboard" : "You're in. Your score goes up when you're back online") : r ? 'Removed from the leaderboard' : "Left. You'll be removed when you're back online");
  };
  return <div class="card col" data-testid="lb-setting">
    <label class="row sm"><input type="checkbox" style="width:24px;min-height:24px" checked={!!s?.lbJoin} disabled={!s || busy} data-testid="set-lb-join" onChange={(e) => flip(e.currentTarget.checked)} /> Show me on the leaderboard</label>
    <div class="mut xs">Shares only your username and Grug rating (scores out of 100). Never weight, food or photos. Turning it off removes you from the board.</div>
    <a class="btn g sm" style="justify-content:flex-start" href="#/leaderboard" data-testid="set-lb-view">🏆 View leaderboard ›</a>
  </div>;
}
