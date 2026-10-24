/** v1.10.0 Smart Estimate (Food tab): first-open notice → describe/photo → editable review → Log (nothing is logged before that). */
import { useEffect, useRef, useState } from 'preact/hooks';
import { getSettings, put } from '../db';
import { go, useSettings } from '../hooks';
import type { DiaryEntry, Meal } from '../types';
import { NumInput, Top, toast } from '../ui';
import { r0, r1, uid, ymd } from '../util';
import { EST_DAILY_CAP, EstError, fetchEstQuota, photoToDataUrl, readEstQuota, usedText, runEstimate, type EstItem, type EstQuota, type EstResult } from '../estimate';
import { MEALS } from './Nutrition';

const CONF: Record<string, string> = { low: 'Low confidence', med: 'Medium confidence', high: 'High confidence' };

export function EstimateNotice({ onOk, onManual }: { onOk: () => void; onManual: () => void }) {
  return <div class="sheet-bg" data-testid="est-notice"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="est-notice-h"><div class="grab" />
    <h2 id="est-notice-h" style="margin-top:0">Before you use Smart Estimate</h2>
    <p data-testid="est-notice-text">Automated calorie estimates can be unreliable. Portion sizes, oils and hidden ingredients are hard to judge. If you know the exact calories (from a label or recipe), please enter them manually instead.</p>
    <p class="sm mut">To work out the numbers, your description (and photo, if you add one) is sent to Lunk's estimation service, provided by xAI. Nothing else from your diary is sent, photos aren't stored, and nothing is logged until you review it and tap Log. You get {EST_DAILY_CAP === 1 ? '1 Smart Estimate' : `${EST_DAILY_CAP} Smart Estimates`} a day.</p>
    <div class="grid2"><button class="btn" data-testid="est-manual" onClick={onManual}>Enter manually</button><button class="btn p" data-testid="est-ok" onClick={onOk}>Got it</button></div>
  </div></div>;
}

function QuotaLine({ q }: { q: EstQuota | null }) {
  if (!q) return null;
  if (q.owner || q.remaining == null) return <div class="mut sm" data-testid="est-quota">Smart Estimate: unlimited</div>;
  if (q.remaining > 0) return <div class="mut sm" data-testid="est-quota">Smart Estimate: {q.remaining} left today</div>;
  return null;
}

export function EstimatePage({ date: date0, meal: meal0 }: { date: string; meal: Meal }) {
  const s = useSettings(); const [ready, setReady] = useState(false); const [notice, setNotice] = useState(false);
  const [text, setText] = useState(''); const [portion, setPortion] = useState(''); const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<EstError | null>(null);
  const [res, setRes] = useState<EstResult | null>(null); const [items, setItems] = useState<EstItem[]>([]);
  const [date, setDate] = useState(date0 || ymd()); const [meal, setMeal] = useState<Meal>(meal0 || 'snacks');
  const [q, setQ] = useState<EstQuota | null>(readEstQuota()); const abort = useRef<AbortController | null>(null);
  const cam = useRef<HTMLInputElement>(null); const gal = useRef<HTMLInputElement>(null);
  const manual = () => go(`/food/add/${date}/${meal}`);
  useEffect(() => { getSettings().then((st) => { setNotice(!st.estNotice); setReady(true); }); fetchEstQuota().then((x) => x && setQ(x)); return () => abort.current?.abort(); }, []);
  const used = !!q && !q.owner && q.remaining === 0;
  const pick = async (f?: File | null) => { if (!f) return; try { setPhoto(await photoToDataUrl(f)); } catch (e: any) { toast(e?.message || "Couldn't read that photo"); } };
  const estimate = async () => {
    if (busy || (!text.trim() && !photo)) return; setBusy(true); setErr(null); abort.current = new AbortController();
    try { const r = await runEstimate({ text: text.trim(), portion: portion.trim(), image: photo }, abort.current.signal); setRes(r); setItems(r.items.map((x) => ({ ...x }))); setPhoto(null); }
    catch (e: any) { if (e?.name !== 'AbortError') setErr(e instanceof EstError ? e : new EstError('failed', String(e?.message || e))); }
    finally { setBusy(false); setQ(readEstQuota()); }
  };
  const upd = (i: number, k: keyof EstItem, v: any) => setItems(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const tot = items.reduce((a, x) => ({ kcal: a.kcal + (x.kcal || 0), protein: a.protein + (x.protein || 0), carbs: a.carbs + (x.carbs || 0), fat: a.fat + (x.fat || 0) }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  const log = async () => {
    if (!res || !items.length) return; const now = Date.now();
    for (const [i, x] of items.entries()) {
      const grams = x.grams > 0 ? x.grams : 100; const fibre = Math.min(x.fibre || 0, x.carbs || 0);
      const e: DiaryEntry = { id: uid(), date, meal, foodId: 'est:' + uid(), name: x.name.trim() || 'Estimated item', grams, qty: grams, serving: 'g', created: now + i,
        n: { kcal: x.kcal || 0, protein: x.protein || 0, carbs: x.carbs || 0, fibre, fat: x.fat || 0 },
        ...(x.qty ? { amountLabel: x.grams > 0 ? `${x.qty} · ~${r0(x.grams)} g` : x.qty } : {}), est: { conf: res.confidence, ...(res.note ? { note: res.note } : {}) } };
      await put('diary', e);
    }
    toast(`Logged ${items.length} estimated item${items.length > 1 ? 's' : ''}`); go(`/food/${date}`);
  };
  const okNotice = async () => { const cur = await getSettings(); await put('kv', { ...cur, estNotice: Date.now() }); setNotice(false); };

  return <><Top title="Smart Estimate" backBtn /><div class="page est">
    {ready && notice && <EstimateNotice onOk={okNotice} onManual={manual} />}
    {!res && <>
      {used ? <div class="card col" data-testid="est-used" style="border-color:var(--warn)">
        <div class="sm">{usedText(q?.resetAt, q?.cap || EST_DAILY_CAP)}</div>
        {/* room for a future 'More with Lunk Pro' line (no paid UI yet) */}
        <button class="btn p" data-testid="est-used-manual" onClick={manual}>Enter manually</button></div>
      : <div class="col" style="gap:10px">
        <QuotaLine q={q} />
        <label class="f">What did you eat?<textarea data-testid="est-text" rows={3} maxLength={1000} value={text} placeholder="e.g. 2 eggs scrambled with butter, 2 slices toast" onInput={(e) => setText(e.currentTarget.value)} /></label>
        <label class="f">Portion note (optional)<input data-testid="est-portion" maxLength={300} value={portion} placeholder="e.g. large plate, about 300 g, shared half" onInput={(e) => setPortion(e.currentTarget.value)} /></label>
        <div class="row" style="gap:8px;align-items:center">
          <button class="btn sm" type="button" data-testid="est-camera" onClick={() => cam.current?.click()}>📷 Take photo</button>
          <button class="btn sm" type="button" data-testid="est-gallery" onClick={() => gal.current?.click()}>🖼️ Choose photo</button>
          {photo && <span class="row" style="gap:6px;align-items:center"><img src={photo} alt="Meal photo" data-testid="est-photo" style="width:46px;height:46px;object-fit:cover;border-radius:8px" /><button class="btn ic sm" aria-label="Remove photo" onClick={() => setPhoto(null)}>✕</button></span>}
          <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { pick(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
          <input ref={gal} type="file" accept="image/*" hidden data-testid="est-file" onChange={(e) => { pick(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
        </div>
        <div class="xs mut">Optional. A photo helps with portions; it's only used for this estimate and not saved.</div>
        <button class="btn p" data-testid="est-go" disabled={busy || (!text.trim() && !photo)} onClick={estimate}>{busy ? 'Estimating…' : 'Estimate'}</button>
        {busy && <div class="mut sm center" data-testid="est-busy">Working it out – this usually takes 5–20 seconds.</div>}
        <button class="btn g sm" data-testid="est-manual-link" onClick={manual}>Enter manually instead</button>
      </div>}
      {err && <div class="card col" data-testid="est-error" data-kind={err.kind} style="border-color:var(--warn);margin-top:10px">
        <div class="sm">⚠️ {err.message}</div>
        <button class="btn" data-testid="est-err-manual" onClick={manual}>Enter manually</button></div>}
    </>}
    {res && <div class="col" style="gap:10px" data-testid="est-review">
      <div class="xs" data-testid="est-reminder" style="color:var(--warn)">Estimates can be off. Check the numbers, or enter exact values manually if you know them.</div>
      <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap"><span class={'pill ' + (res.confidence === 'high' ? 'ok' : res.confidence === 'low' ? 'bad' : 'info')} data-testid="est-conf">{CONF[res.confidence] || 'Confidence unknown'}</span>
        {res.note && <span class="sm mut" data-testid="est-note">{res.note}</span>}</div>
      {items.map((x, i) => <div class="card col" style="gap:6px;padding:10px 12px" data-testid="est-item">
        <div class="row" style="gap:6px"><input class="grow" aria-label="Item name" data-testid="est-name" value={x.name} onInput={(e) => upd(i, 'name', e.currentTarget.value)} />
          <button class="btn ic" aria-label={`Remove ${x.name}`} data-testid="est-remove" onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button></div>
        {x.qty && <div class="xs mut">{x.qty}</div>}
        <div class="grid5" style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px">
          {([['grams', 'g'], ['kcal', 'kcal'], ['protein', 'Prot g'], ['carbs', 'Carb g'], ['fat', 'Fat g']] as const).map(([k, l]) =>
            <label class="f" style="font-size:11px">{l}<NumInput data-testid={`est-${k}`} value={x[k]} onValue={(v) => upd(i, k, v ?? 0)} style="min-width:0;padding:6px" /></label>)}
        </div></div>)}
      {!items.length && <div class="empty">All items removed. Start over or enter food manually.</div>}
      <div class="card"><div class="kpi" style="grid-template-columns:repeat(4,1fr)" data-testid="est-total">
        <div><span class="mut xs">kcal</span><b data-k="kcal">{r0(tot.kcal)}</b></div><div><span class="mut xs">Protein</span><b>{r1(tot.protein)}</b></div>
        <div><span class="mut xs">Carbs</span><b>{r1(tot.carbs)}</b></div><div><span class="mut xs">Fat</span><b>{r1(tot.fat)}</b></div></div>
        {s.energyUnit === 'kJ' && <div class="xs mut center" style="margin-top:6px">≈ {r0(tot.kcal * 4.184)} kJ</div>}</div>
      <div class="grid2"><label class="f">Meal<select data-testid="est-meal" value={meal} onChange={(e) => setMeal(e.currentTarget.value as Meal)}>{MEALS.map(([m, l]) => <option value={m}>{l}</option>)}</select></label>
        <label class="f">Date<input type="date" data-testid="est-date" value={date} onInput={(e) => e.currentTarget.value && setDate(e.currentTarget.value)} /></label></div>
      <button class="btn p" data-testid="est-log" disabled={!items.length} onClick={log}>Log {items.length} item{items.length === 1 ? '' : 's'}</button>
      <div class="grid2"><button class="btn sm" data-testid="est-restart" onClick={() => { setRes(null); setItems([]); }}>Start over</button><button class="btn sm g" onClick={manual}>Enter manually</button></div>
    </div>}
  </div></>;
}
