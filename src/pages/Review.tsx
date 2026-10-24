/** v1.11.0 Grug's Review (Home card, loading, result, advice, saved) + Home star ratings. Layout follows Erik's approved mockups. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { go, useQuery, useSettings } from '../hooks';
import { Sheet, Top, toast } from '../ui';
import { r0 } from '../util';
import { GRUG_LINE, type Rating, type Stars } from '../stars';
import { actionUsable, applyAction, fetchReviewQuota, fmtRange, fmtShort, loadReviews, loadStars, readReviewQuota, requestReview, ReviewError, shareReview, snapshot, sydWeek, upsertReview,
  type Review, type ReviewQuota, type Snapshot, type Tip } from '../review';
import { all } from '../db';
import type { Exercise, Routine } from '../types';

export const GrugAv = () => <div class="gav" aria-hidden="true"><span style="font-size:24px;line-height:1">🧔</span><span class="bone">🦴</span></div>;
export function ScoreRing({ v, size = 128, sw = 11 }: { v: number; size?: number; sw?: number }) {
  const r = size / 2 - sw / 2 - 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, v / 10));
  return <svg width={size} height={size} style="flex:none" role="img" aria-label={`${v} out of 10`} data-testid="score-ring">
    <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--bg3)" stroke-width={sw} fill="none" />
    <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--acc)" stroke-width={sw} fill="none" stroke-linecap="round" stroke-dasharray={`${c * p} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    <text x="50%" y={size > 80 ? '52%' : '55%'} text-anchor="middle" dominant-baseline={size > 80 ? undefined : 'middle'} fill="var(--fg)" font-size={size / 3.4} font-weight="800">{v}</text>
    {size > 80 && <text x="50%" y="68%" text-anchor="middle" fill="var(--mut)" font-size={size / 10}>out of 10</text>}</svg>;
}
const Sub = ({ label, v, color }: { label: string; v: number; color: string }) => <div class="sub"><div class="row"><span>{label}</span><b>{v}<span class="mut" style="font-weight:400">/10</span></b></div><div class="bar"><i style={`width:${v * 10}%;background:${color}`} /></div></div>;
const starStr = (n: number) => <span class="st" aria-label={`${n} of 5 stars`}>{'★'.repeat(n)}<i>{'★'.repeat(5 - n)}</i></span>;
const kfmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));
const reviewLine = (q: ReviewQuota | null) => q?.owner ? 'Admin: unlimited reviews' : `Next review ${fmtShort(q?.nextMonday || sydWeek().nextMonday)}`;

// ---------- stars ----------
export function StarsRows({ stars, onOpen }: { stars: Stars; onOpen: () => void }) {
  if (!stars.ready) return <div class="stars-rows" data-testid="stars-building"><div class="stars-row" style="cursor:default"><span class="st"><i>★★★★★</i></span><span class="grow sm">Rating builds after 7 days</span><span class="mut xs">{stars.historyDays}/7</span></div></div>;
  const row = (label: string, r: Rating, k: string) => <button class="stars-row" data-testid={`stars-${k}`} data-stars={r.stars} onClick={onOpen} aria-label={`${label}: ${r.stars} of 5 stars. Details`}>
    <b class="sm" style="width:72px">{label}</b>{starStr(r.stars)}<span class="why grow">{r.weakest ? r.weakest.tip : GRUG_LINE[r.stars] || 'Every box ticked.'}</span><span class="mut">›</span></button>;
  return <div class="stars-rows">{row('Training', stars.training, 'training')}{row('Nutrition', stars.nutrition, 'nutrition')}</div>;
}
export function StarsSheet({ open, onClose, stars }: { open: boolean; onClose: () => void; stars: Stars }) {
  const block = (label: string, r: Rating, k: string) => <div class="card col" style="gap:8px" data-testid={`stars-sheet-${k}`}>
    <div class="row between"><b>{label} {starStr(r.stars)}</b><span class="mut sm">{r.score}/100</span></div>
    {GRUG_LINE[r.stars] && <div class="say" style="font-size:14px" data-testid={`grug-line-${k}`}>“{GRUG_LINE[r.stars]}”</div>}
    {r.parts.map((p) => <div style={p.applicable ? '' : 'opacity:.55'}><div class="row between sm"><span>{p.label}</span><span class="mut xs">{p.applicable ? `${r0(p.pts)} / ${p.max}` : 'not counted'}</span></div>
      <div class="bar" style="margin:4px 0"><i style={`width:${p.applicable ? (p.pts / p.max) * 100 : 0}%;background:${p.applicable && p.pts / p.max < 0.5 ? 'var(--warn)' : 'var(--acc)'}`} /></div><div class="mut xs">{p.detail}</div></div>)}
    {r.weakest && <div class="xs" style="color:var(--warn)">Weakest: {r.weakest.tip}</div>}</div>;
  return <Sheet open={open} onClose={onClose} title="Your stars · last 7 days"><div class="col" data-testid="stars-sheet">
    {block('Training', stars.training, 'training')}{block('Nutrition', stars.nutrition, 'nutrition')}
    <div class="mut xs">100-point scores: 90+ ★★★★★ · 75+ ★★★★ · 60+ ★★★ · 40+ ★★ · below ★. Nutrition counts the 7 days up to yesterday. A part that doesn't apply to you (no steps logged, no supplements scheduled, no lift history yet) is left out and its points shared out. Worked out on this phone; nothing is sent.</div>
    <button class="btn" onClick={onClose}>Close</button></div></Sheet>;
}

// ---------- Home card ----------
export function ReviewCard() {
  const reviews = useQuery(loadReviews, [], [] as Review[]) || []; const stars = useQuery(loadStars, []); const [sheet, setSheet] = useState(false);
  const s = useSettings(); const [q, setQ] = useState<ReviewQuota | null>(readReviewQuota());
  // only ask the service for the quota once the review has been used (or with admin) – a fresh install shows the default copy and sends nothing
  const ask = !!(q || reviews.length || s.adminToken);
  useEffect(() => { if (ask) fetchReviewQuota().then((x) => x && setQ(x)); }, [ask, s.adminToken]);
  useEffect(() => { const f = () => setQ(readReviewQuota()); addEventListener('review-quota', f); return () => removeEventListener('review-quota', f); }, []);
  const wk = sydWeek(); const cur = reviews.filter((r) => r.week === wk.week).sort((a, b) => b.created - a.created)[0]; const saved = reviews.filter((r) => r.saved).length;
  const usedNoLocal = !cur && q && !q.owner && q.remaining === 0;
  // the sheet lives outside the card: seasonal cards use isolation, which would trap a fixed sheet under the tab bar
  return <><div class="card grug rv" style="margin-bottom:12px" data-testid="review-card">
    <div class="row" style={`gap:12px;align-items:${cur ? 'center' : 'flex-start'}`}><GrugAv /><div class="grow"><b>Grug's Review</b>
      {cur ? <div class="mut sm">{fmtRange(cur.from, cur.to)}</div> : <div class="mut sm" style="margin-top:2px">Grug looks at your last 7 days of lifts, food and steps, then tells you straight.</div>}</div>
      {cur && <ScoreRing v={cur.result.scores.overall} size={50} sw={6} />}</div>
    {stars && <StarsRows stars={stars} onOpen={() => setSheet(true)} />}
    {cur ? <>
      <div class="say" style="margin-top:10px;font-size:14.5px" data-testid="review-quote">“{cur.result.quote || cur.result.headline}”</div>
      <a class="btn full" style="margin-top:10px" href={`#/review/${cur.id}`} data-testid="review-open">Open review ›</a>
      {q?.owner && <a class="btn g full sm" href="#/review/new" data-testid="review-new">Get a new review</a>}
      <div class="xs center premium" style="margin-top:8px" data-testid="review-note">{reviewLine(q)}{!q?.owner && <><br />Want more? <b>Lunk Premium</b> (coming soon)</>}</div>
    </> : usedNoLocal ? <div class="xs center premium" style="margin-top:12px" data-testid="review-note">This week's free review is used. {reviewLine(q)}<br />Want more? <b>Lunk Premium</b> (coming soon)</div>
    : <>
      <a class="btn p full" style="margin-top:12px" href="#/review/new" data-testid="review-get">Get this week's review</a>
      <div class="mut xs center" style="margin-top:8px" data-testid="review-note">{q?.owner ? 'Admin: unlimited reviews' : `1 free review a week · resets ${fmtShort(q?.nextMonday || wk.nextMonday)}`}</div></>}
    {saved > 0 && <a class="btn g full sm" href="#/review/saved" data-testid="review-saved-link">🔖 Saved reviews ({saved}) ›</a>}
  </div>{stars && <StarsSheet open={sheet} onClose={() => setSheet(false)} stars={stars} />}</>;
}

// ---------- page ----------
export function ReviewPage({ id }: { id: string }) {
  if (id === 'saved') return <SavedReviews />;
  if (id && id !== 'new') return <StoredReview id={id} />;
  return <NewReview />;
}
function StoredReview({ id }: { id: string }) {
  const [rv, setRv] = useState<Review | null | undefined>(undefined);
  useEffect(() => { loadReviews().then((l) => setRv(l.find((r) => r.id === id) || null)); }, [id]);
  if (rv === undefined) return <><Top title="Grug's Review" backBtn /><div class="page" /></>;
  if (!rv) return <><Top title="Grug's Review" backBtn /><div class="page"><div class="card empty">This review isn't on this device any more.</div></div></>;
  return <ReviewView rv={rv} onChange={setRv} />;
}
function NewReview() {
  const [snap, setSnap] = useState<Snapshot | null>(null); const [step, setStep] = useState(0); const [err, setErr] = useState<ReviewError | null>(null); const [rv, setRv] = useState<Review | null>(null);
  const ab = useRef<AbortController | null>(null);
  useEffect(() => {
    let live = true; ab.current = new AbortController();
    (async () => {
      const q = readReviewQuota(); const sn = await snapshot(); if (!live) return; setSnap(sn); setStep(2);
      if (q && !q.owner && q.remaining === 0) { setErr(new ReviewError('limit', `You've used this week's free review. Next review ${fmtShort(q.nextMonday || sydWeek().nextMonday)}.`)); return; }
      setTimeout(() => live && setStep(3), 700);
      try { const r = await requestReview(sn, ab.current!.signal); if (!live) return; setStep(4); history.replaceState(null, '', `#/review/${r.id}`); setRv(r); }
      catch (e: any) { if (live && e?.name !== 'AbortError') setErr(e instanceof ReviewError ? e : new ReviewError('failed', String(e?.message || e))); }
    })();
    return () => { live = false; ab.current?.abort(); };
  }, []);
  if (rv) return <ReviewView rv={rv} onChange={setRv} />;
  const t = snap?.tiles; const range = snap ? fmtRange(snap.from, snap.today).replace(/ \w+$/, '') : '';
  const st = (i: number, label: any, right?: any) => <div class={step < i ? 'pend' : ''} data-testid={`rv-step-${i}`}>{step > i ? <span class="ck">✓</span> : step === i ? <span class="sp" /> : <span class="wait" />}<span class="grow">{label}</span>{right && <span class="mut xs">{right}</span>}</div>;
  return <><Top title="Grug's Review" backBtn /><div class="page rv">
    {err ? <div class="card col" data-testid="review-error" data-kind={err.kind} style="margin-top:20px;border-color:var(--warn)">
      <div class="row" style="gap:10px;align-items:flex-start"><GrugAv /><div class="sm grow">{err.message}{err.kind === 'limit' && <div class="premium xs" style="margin-top:6px">Want more? <b>Lunk Premium</b> (coming soon)</div>}</div></div>
      <a class="btn" href="#/">Back to Home</a></div>
    : <><div class="rv-load" data-testid="review-loading"><div class="cave"><span class="spark" style="left:18px;top:52px">✦</span><span class="spark" style="right:22px;top:40px;font-size:14px">✦</span><span class="club">🦴</span><span class="rock">🪨</span><div class="ground" /></div>
      <h2 style="margin:16px 0 4px;font-size:20px">Grug is looking at your week…</h2><div class="mut sm">Grug count lifts, food and steps. Can take up to a minute.</div>
      <div class="steps">{st(0, t ? `${t.workouts} workout${t.workouts === 1 ? '' : 's'} found` : 'Counting workouts', t ? range : '')}{st(1, t ? `${t.foodDays} day${t.foodDays === 1 ? '' : 's'} of food logged` : 'Reading your food diary', t ? `${t.entries} entries` : '')}
        {st(2, 'Steps and doses')}{st(3, 'Grug thinking hard')}</div></div>
      <div class="card" style="margin-top:22px;opacity:.55"><div class="row" style="gap:14px"><div style="width:64px;height:64px;border-radius:50%;border:8px solid var(--bg3);flex:none" /><div class="grow col"><div class="skel" style="width:70%" /><div class="skel" style="width:90%" /><div class="skel" style="width:55%" /></div></div></div>
      <div class="center"><button class="btn g sm" data-testid="review-cancel" onClick={() => { ab.current?.abort(); go('/'); }}>Cancel</button></div></>}
  </div></>;
}

function TipCard({ tip, i, done, onDone }: { tip: Tip; i: number; done?: string; onDone: (i: number, line: string) => void }) {
  const [sel, setSel] = useState(0); const [busy, setBusy] = useState(false); const a = tip.action;
  const run = async () => { if (!a || busy) return; setBusy(true); try { onDone(i, await applyAction(a, { food: sel })); } catch (e: any) { toast(e?.message || "Couldn't do that"); } setBusy(false); };
  return <div class="card tip" data-testid="rv-tip"><div class="hd"><span class="tic">{tip.icon}</span><b class="grow">{tip.title}</b></div>
    {tip.data && <div class="data">{tip.data}</div>}<p>{tip.body}</p>
    {a?.type === 'add_food' && a.foods.length > 1 && !done && <div class="foods" role="radiogroup" aria-label="Pick a food">{a.foods.map((f, k) => <button class={k === sel ? 'on' : ''} role="radio" aria-checked={k === sel} onClick={() => setSel(k)} data-testid="rv-food"><b>+{r0(f.protein)} g</b>{f.name} {r0(f.grams)} g</button>)}</div>}
    {a && <div class="row" style="justify-content:flex-end;gap:6px">{done ? <span class="done" data-testid="rv-done">{done}</span>
      : <button class="btn sm acc" disabled={busy} data-testid="rv-action" data-type={a.type} onClick={run}>{a.type === 'add_food' || a.type === 'add_routine_set' ? '＋ ' : ''}{a.label}</button>}</div>}</div>;
}
function ReviewView({ rv, onChange }: { rv: Review; onChange: (r: Review) => void }) {
  const [more, setMore] = useState(false); const s = useSettings(); const q = readReviewQuota();
  const ctx = useQuery(async () => ({ routines: await all<Routine>('routines'), exercises: await all<Exercise>('exercises') }), []);
  const r = rv.result, t = rv.tiles; const sc = r.scores;
  // re-check actions against today's data (routine renamed, goal already changed, …); finished ones stay as done lines
  const tips = r.tips.map((tp, i) => ({ ...tp, action: rv.done?.[i] || (ctx && actionUsable(tp.action, { s, ...ctx })) ? tp.action : null }));
  const upd = async (x: Review) => { await upsertReview(x); onChange(x); };
  const share = async () => { const res = await shareReview(rv); if (res === 'downloaded') toast('Image saved · text copied'); };
  return <><Top title="Grug's Review" backBtn={() => go('/')} right={<button class="btn ic" aria-label="Share" style="font-size:20px" data-testid="rv-share-top" onClick={share}>↗</button>} />
    <div class="page rv" data-testid="review-result">
      <div class="mut sm" style="margin:-2px 2px 10px">{fmtRange(rv.from, rv.to)} · last 7 days</div>
      <div class="card"><div class="score"><ScoreRing v={sc.overall} /><div class="subs"><div><b style="font-size:18px" data-testid="rv-headline">{r.headline}</b>
        {rv.prev != null && <div class="mut xs">{sc.overall > rv.prev ? 'Better than' : sc.overall < rv.prev ? 'Below' : 'Same as'} last week ({rv.prev})</div>}</div>
        <Sub label="Training" v={sc.training} color="var(--acc)" /><Sub label="Nutrition" v={sc.nutrition} color="var(--warn)" /><Sub label="Consistency" v={sc.consistency} color="var(--acc2)" /></div></div>
        <div class="kpi" style="margin-top:14px" data-testid="rv-tiles">
          <div><b>{t.workouts}</b><span class="mut xs">workouts<br />{t.planned} planned</span></div>
          <div><b>{t.kcalAvg != null ? t.kcalAvg.toLocaleString('en-AU') : '–'}</b><span class="mut xs">kcal avg<br />of {t.kcalTarget.toLocaleString('en-AU')}</span></div>
          <div><b>{t.proteinAvg != null ? `${t.proteinAvg} g` : '–'}</b><span class="mut xs">protein avg<br />of {t.proteinTarget} g</span></div>
          <div><b>{t.stepsAvg != null ? kfmt(t.stepsAvg) : '–'}</b><span class="mut xs">steps avg<br />{t.stepGoal ? `of ${kfmt(t.stepGoal)}` : 'no goal'}</span></div></div></div>
      <div class="card"><div class="row" style="gap:10px;align-items:flex-start"><GrugAv /><div class="grow"><div class="b sm" style="margin-bottom:6px">Grug says</div><div class="say" data-testid="rv-summary">{r.summary}</div></div></div></div>
      {r.went_well.length > 0 && <><div class="lbl">What went well</div><div class="tagl" data-testid="rv-well">{r.went_well.map((x) => <span class="tag ok">✓ {x}</span>)}</div></>}
      {r.slipped.length > 0 && <><div class="lbl">What slipped</div><div class="tagl" data-testid="rv-slipped">{r.slipped.map((x) => <span class="tag warn">! {x}</span>)}</div></>}
      {!more ? <><button class="btn p full" style="margin-top:18px" data-testid="rv-more" onClick={() => setMore(true)}>View more · Grug's advice ▾</button>
        <div class="mut xs center" style="margin-top:10px">{q?.owner ? 'Admin: unlimited reviews' : `Free review used for this week · next ${fmtShort(rv.nextMonday)}`}</div></>
      : <><h2 style="margin-top:20px">Grug's advice <span class="mut sm" style="font-weight:400">· {tips.length} tip{tips.length === 1 ? '' : 's'}</span></h2>
        <div data-testid="rv-advice">{tips.map((tp, i) => <TipCard tip={tp} i={i} done={rv.done?.[i]} onDone={(k, line) => upd({ ...rv, done: { ...(rv.done || {}), [k]: line } })} />)}</div>
        <div class="grid2" style="margin-top:4px"><button class="btn" data-testid="rv-save" disabled={rv.saved} onClick={async () => { await upd({ ...rv, saved: true }); toast('Review saved on this phone'); }}>{rv.saved ? '✓ Saved' : '🔖 Save review'}</button>
          <button class="btn" data-testid="rv-share" onClick={share}>↗ Share card</button></div>
        <button class="btn g full sm" style="margin-top:6px" onClick={() => { setMore(false); scrollTo(0, 0); }}>Show less ▴</button></>}
      <div class="disc">Estimates and advice can be off. Not medical advice.</div>
    </div></>;
}
function SavedReviews() {
  const list = (useQuery(loadReviews, [], [] as Review[]) || []).filter((r) => r.saved);
  return <><Top title="Saved reviews" backBtn /><div class="page rv"><div class="list card" style="padding:4px 12px">{list.map((r) => <a class="item" href={`#/review/${r.id}`} style="color:inherit;text-decoration:none;gap:12px" data-testid="saved-review">
    <ScoreRing v={r.result.scores.overall} size={44} sw={5} /><div class="grow"><b>{r.result.headline}</b><div class="mut xs">{fmtRange(r.from, r.to)}</div></div><span class="mut">›</span></a>)}</div>
    {!list.length && <div class="card empty">No saved reviews yet. Tap “Save review” on a review to keep it here.</div>}</div></>;
}
