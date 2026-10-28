import { useEffect, useMemo, useState } from 'preact/hooks';
import { all, del, get, put } from '../db';
import { go, useLatest, useQuery, useSettings } from '../hooks';
import type { DoseLog, Nutrients, Schedule, Supplement } from '../types';
import { Bar, NumInput, Seg, Sheet, Top, confirmDo, num, toast } from '../ui';
import { addDays, fmtDate, fmtDay, fmtDM, fmtTime, MICROS, MONTHS, parseYmd, r1, uid, WD, ymd } from '../util';
import { adherence, loadDoseData, scheduleReminders, slotsFor, type Slot } from '../doses';
import { NutrientInputs } from './Nutrition';
import { Scanner } from '../scanner';
import { IngredientEditor, DoseTotals } from './SuppNutrients';
import { legacyNutrients, suppIngredients, totals, type Ingredient } from '../nutrients';
import { LabelPhoto } from './LabelPhoto';
import { SRC_LABEL, keyIngredients, lookupSupp, prefill, rememberSupp, type SuppResult } from '../suppscan';

const COLORS = ['#22c55e', '#0ea5e9', '#f59e0b', '#ef4444', '#a78bfa', '#f472b6', '#14b8a6', '#eab308'];
const UNITS = ['mg', 'µg', 'g', 'IU', 'ml', 'capsule', 'tablet', 'scoop', 'drop'];
const FORMS = ['Capsule', 'Tablet', 'Softgel', 'Powder', 'Liquid', 'Gummy', 'Injection', 'Other'];
export const useDoseData = () => useQuery(loadDoseData, []);

export async function markTaken(supp: Supplement, opts: { scheduleId?: string; date: string; slot?: string; amount?: number }) {
  const amount = opts.amount ?? 1;
  const log: DoseLog = { id: uid(), suppId: supp.id, scheduleId: opts.scheduleId, date: opts.date, slot: opts.slot, takenAt: Date.now(), amount };
  await put('doselogs', log);
  const s = await get<Supplement>('supplements', supp.id);
  if (s && s.stock != null) { const stock = Math.max(0, s.stock - s.unitsPerDose * amount); await put('supplements', { ...s, stock }); if (stock <= s.lowStock) toast(`⚠️ ${s.name}: only ${r1(stock)} left`); }
  scheduleReminders(); return log;
}
export async function unmark(log: DoseLog) {
  await del('doselogs', log.id);
  const s = await get<Supplement>('supplements', log.suppId);
  if (s && s.stock != null) await put('supplements', { ...s, stock: s.stock + s.unitsPerDose * (log.amount || 1) });
  scheduleReminders();
}
export const toggleSlot = async (sl: Slot) => (sl.log ? unmark(sl.log) : markTaken(sl.supp, { scheduleId: sl.schedule.id, date: sl.date, slot: sl.time }));

export function SlotRow({ sl, showDate }: { sl: Slot; showDate?: boolean }) {
  const cls = { taken: 'ok', missed: 'bad', due: 'warn', upcoming: '' }[sl.status];
  return <button class="item" onClick={() => toggleSlot(sl)}>
    <span class="swatch" style={{ background: sl.supp.color }} />
    <div class="grow"><div class="b ell">{sl.supp.name}</div><div class="mut xs">{sl.supp.doseAmount} {sl.supp.unit}{sl.time ? ` · ${sl.time}` : ''}{showDate ? ` · ${fmtDay(sl.date)}` : ''}{sl.log ? ` · taken ${fmtTime(sl.log.takenAt)}` : ''}</div></div>
    <span class={'pill ' + cls}>{sl.status}</span>
    <span class={'check ' + (sl.log ? 'on' : '')} style="display:inline-flex;align-items:center;justify-content:center" aria-label={sl.log ? 'Taken — tap to undo' : 'Mark taken'}>✓</span>
  </button>;
}

export function SuppsPage() {
  const d = useDoseData(); const today = ymd(); const set0 = useSettings();
  const [adhoc, setAdhoc] = useState<Supplement | null>(null);
  if (!d) return <Top title="Supplements" />;
  const supps = d.supps.filter((s) => !s.archived).sort((a, b) => a.name.localeCompare(b.name));
  const todayLogs = d.logs.filter((l) => l.date === today).sort((a, b) => b.takenAt - a.takenAt); const sm = new Map(d.supps.map((s) => [s.id, s]));
  return <><Top title="Supplements & meds" right={<a class="btn p sm" href="#/supp/new">+ Add</a>} /><div class="page">
    <a class="btn b2 full" href="#/calendar">📅 Dose calendar</a>
    {supps.filter((s) => s.stock != null && s.stock <= s.lowStock).map((s) => <div class="card sm" style="border-color:var(--warn);margin-top:10px">⚠️ <b>{s.name}</b> is running low: {r1(s.stock!)} {s.form.toLowerCase()}(s) left.</div>)}
    <h2>Library</h2>
    {!supps.length && <div class="card empty">Add your supplements and medications (e.g. Creatine 5 g, Vitamin D 1000 IU) then set a schedule.</div>}
    {supps.map((s) => { const sch = d.schedules.filter((x) => x.suppId === s.id && x.active); const doses = s.stock != null ? Math.floor(s.stock / Math.max(0.0001, s.unitsPerDose)) : null;
      return <div class="card"><div class="row"><span class="swatch" style={{ background: s.color }} /><a class="grow" style="color:inherit;text-decoration:none" href={`#/supp/${s.id}`}>
        <div class="b">{s.name} {s.kind === 'medication' && <span class="pill info">med</span>}</div>
        <div class="mut sm">{s.doseAmount} {s.unit} · {s.form}{sch.length ? ` · ${sch.map(describeSchedule).join('; ')}` : ' · no schedule'}</div>
        {s.stock != null && <div class={'sm ' + (s.stock <= s.lowStock ? '' : 'mut')} style={s.stock <= s.lowStock ? 'color:var(--warn)' : ''}>Stock: {r1(s.stock)} left{doses != null ? ` (~${doses} doses)` : ''}</div>}</a>
        <button class="btn sm p" onClick={() => setAdhoc(s)}>Log</button></div></div>; })}
    <DoseTotals t={totals(todayLogs.map((l) => [suppIngredients(sm.get(l.suppId) || {}), l.amount || 1] as [Ingredient[], number]))} sex={set0?.profile?.sex} />
    <h2>Taken today</h2>
    <div class="list card" style="padding:4px 12px">{todayLogs.map((l) => <div class="item"><span class="swatch" style={{ background: sm.get(l.suppId)?.color }} /><div class="grow">{sm.get(l.suppId)?.name || '?'} <span class="mut sm">× {l.amount}{l.slot ? ` · ${l.slot} dose` : ' · extra'}</span></div><span class="mut sm">{fmtTime(l.takenAt)}</span><button class="btn ic" onClick={() => unmark(l)} aria-label="Undo">↺</button></div>)}
      {!todayLogs.length && <div class="empty">Nothing logged today</div>}</div>
    <Sheet open={!!adhoc} onClose={() => setAdhoc(null)} title={`Log ${adhoc?.name}`}>{adhoc && <AdhocLog s={adhoc} slots={slotsFor(today, d.schedules, d.supps, d.logs).filter((x) => x.supp.id === adhoc.id && !x.log)} onDone={() => setAdhoc(null)} />}</Sheet>
  </div></>;
}
function AdhocLog({ s, slots, onDone }: { s: Supplement; slots: Slot[]; onDone: () => void }) {
  const [amt, setAmt] = useState('1'); const [date, setDate] = useState(ymd());
  return <div class="col">
    {slots.length > 0 && <><div class="mut sm">Scheduled today, not yet taken:</div>{slots.map((sl) => <button class="btn b2" onClick={async () => { await toggleSlot(sl); toast('Marked taken'); onDone(); }}>Mark {sl.time || 'today\'s'} dose taken</button>)}<div class="mut sm">or log an extra dose:</div></>}
    <div class="grid2"><label class="f">Doses ({s.doseAmount} {s.unit} each)<input inputMode="decimal" value={amt} onInput={(e) => setAmt(e.currentTarget.value)} /></label><label class="f">Date<input type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} /></label></div>
    <button class="btn p" onClick={async () => { await markTaken(s, { date, amount: num(amt) || 1 }); toast('Dose logged'); onDone(); }}>Log extra dose</button></div>;
}
export function describeSchedule(s: Schedule) {
  const t = s.times.length ? ` at ${s.times.join(', ')}` : '';
  if (s.type === 'daily') return `Daily${t}`;
  if (s.type === 'weekdays') return `${s.weekdays.sort().map((d) => WD[d]).join('/')}${t}`;
  return `Every ${s.interval} days${t}`;
}

export function SuppEdit({ id }: { id: string }) {
  const set = useSettings();
  const [s, setS, getS] = useLatest<Supplement | null>(null); const [stock, setStock] = useState(''); const [ingr, setIngr, getIngr] = useLatest<Ingredient[]>([]);
  const [sch, setSch, getSch] = useLatest<Schedule[]>([]); const [removed, setRemoved] = useState<string[]>([]);
  const [scan, setScan] = useState(false); const [busy, setBusy] = useState(''); const [found, setFound] = useState<SuppResult | null>(null); const [fv, setFv] = useState(0);
  useEffect(() => {
    if (id === 'new') { setS({ id: 'sp' + uid(), name: '', kind: 'supplement', doseAmount: 1, unit: 'capsule', form: 'Capsule', unitsPerDose: 1, lowStock: 7, stock: null, color: COLORS[Math.floor(Math.random() * COLORS.length)] }); setSch([]); return; }
    get<Supplement>('supplements', id).then((x) => { if (!x) return; setS(x); setStock(x.stock != null ? String(x.stock) : ''); setIngr(suppIngredients(x)); });
    all<Schedule>('schedules').then((l) => setSch(l.filter((x) => x.suppId === id)));
  }, [id]);
  if (!s) return <Top title="Supplement" backBtn />;
  const upd = (p: Partial<Supplement>) => setS((o) => o && { ...o, ...p });
  const onCode = async (code: string) => {
    setBusy('Looking up ' + code + '…'); const r = await lookupSupp(code); setBusy(''); setScan(false); setFound(r);
    if (r.status === 'found') { const p = prefill(r, getS()!); setS(p.supp); mergeIngr(p.ingr); setFv((x) => x + 1); }
    else if (r.status === 'none') upd({ barcode: code });
  };
  /** scanned / label-read ingredients replace same-key rows and keep the rest */
  const mergeIngr = (add: Ingredient[]) => setIngr((o) => [...o.filter((x) => !add.some((a) => a.key === x.key && (a.key !== 'custom' || a.name === x.name))), ...add]);
  const updSch = (i: number, p: Partial<Schedule>) => setSch((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const save = async () => {
    const s = getS()!; const sch = getSch();
    if (!s.name.trim()) { toast('Name required'); return; }
    const ing = getIngr().filter((x) => x.amount > 0); const nutrients = legacyNutrients(ing);
    await put('supplements', { ...s, name: s.name.trim(), brand: s.brand?.trim() || undefined, stock: num(stock), nutrients, ingr: ing });
    if (s.barcode) await rememberSupp(s.barcode, { ...s, name: s.name.trim() });
    for (const x of sch) await put('schedules', { ...x, times: x.times.filter(Boolean).sort() });
    for (const r of removed) await del('schedules', r);
    if (sch.some((x) => x.reminders) && typeof Notification !== 'undefined' && Notification.permission === 'default') await Notification.requestPermission();
    scheduleReminders(); toast('Saved'); if (id === 'new') go('/supps'); else history.back();
  };
  return <><Top title={id === 'new' ? 'New supplement' : 'Edit supplement'} backBtn right={<button class="btn p sm" onClick={save}>Save</button>} /><div class="page col">
    <div class="grid2"><button class="btn b2" data-scan-open data-testid="supp-scan" onClick={() => { setFound(null); setScan(true); }}>▥ Scan barcode</button>
      <LabelPhoto onResult={(r) => { setFound(null); const p = r.apply(getS()!); setS(p.supp); mergeIngr(p.ingr); setFv((x) => x + 1); }} /></div>
    {found?.status === 'found' && <div class="card col" data-testid="supp-found"><div class="sm">Found <b>{found.name}</b>{found.brand ? ` by ${found.brand}` : ''} <span class="mut">(from {SRC_LABEL[found.src]})</span></div>
      {!!keyIngredients(found).length && <div class="xs" data-testid="supp-ingredients">{keyIngredients(found).map((i) => `${i.name} ${i.amount} ${i.unit}`).join(' · ')}</div>}
      <div class="xs mut">Grug filled the form below. Check it against the label, then Save.</div></div>}
    {found?.status === 'saved' && <div class="card col" data-testid="supp-saved"><div class="sm"><b>{found.supp.name}</b> is already in your doses.</div><a class="btn sm" href={'#/supp/' + found.supp.id}>Open it</a></div>}
    {found?.status === 'none' && <div class="card col" data-testid="supp-notfound"><b class="sm">Not found{found.offline ? ' (offline or lookup unavailable)' : ''}</b>
      <div class="xs mut">Enter it below. Lunk remembers barcode {s.barcode} on this device, so the next scan finds it.</div>
      <button class="btn sm" onClick={() => setScan(true)}>Scan again</button></div>}
    <Seg value={s.kind} onChange={(kind) => upd({ kind })} options={[['supplement', 'Supplement'], ['medication', 'Medication']]} />
    <label class="f">Name<input value={s.name} data-testid="supp-name" onInput={(e) => upd({ name: e.currentTarget.value })} placeholder="e.g. Vitamin D3" /></label>
    <label class="f">Brand (optional)<input value={s.brand || ''} data-testid="supp-brand" onInput={(e) => upd({ brand: e.currentTarget.value })} /></label>
    <div class="grid3" key={fv}><label class="f">Dose<NumInput value={s.doseAmount} onValue={(n) => upd({ doseAmount: n || 0 })} /></label>
      <label class="f">Unit<select value={s.unit} onChange={(e) => upd({ unit: e.currentTarget.value })}>{UNITS.map((u) => <option>{u}</option>)}</select></label>
      <label class="f">Form<select value={s.form} onChange={(e) => upd({ form: e.currentTarget.value })}>{FORMS.map((u) => <option>{u}</option>)}</select></label></div>
    <div class="grid3" key={"b" + fv}><label class="f">Stock left<input inputMode="decimal" value={stock} placeholder="untracked" onInput={(e) => setStock(e.currentTarget.value)} /></label>
      <label class="f">Units per dose<NumInput value={s.unitsPerDose} onValue={(n) => upd({ unitsPerDose: n || 1 })} /></label>
      <label class="f">Warn at ≤<NumInput value={s.lowStock} onValue={(n) => upd({ lowStock: n || 0 })} /></label></div>
    <div class="mut xs">Stock is counted in {s.form.toLowerCase()}s/units (e.g. 60 capsules, 2 capsules per dose). For powders, use grams.</div>
    <label class="f">Colour<div class="row">{COLORS.map((c) => <button aria-label={c} onClick={() => upd({ color: c })} style={{ width: '36px', height: '36px', borderRadius: '50%', background: c, border: s.color === c ? '3px solid #fff' : '0' }} />)}</div></label>
    <label class="f">Notes<textarea data-testid="supp-notes" value={s.notes || ''} onInput={(e) => upd({ notes: e.currentTarget.value })} placeholder="e.g. take with food" /></label>

    <h2>Schedules</h2>
    {sch.map((x, i) => <div class="card col">
      <Seg value={x.type} onChange={(type) => updSch(i, { type })} options={[['daily', 'Daily'], ['weekdays', 'Weekdays'], ['interval', 'Every N days']]} />
      {x.type === 'weekdays' && <div class="row" style="gap:4px">{WD.map((d, wd) => <button class={'chip ' + (x.weekdays.includes(wd) ? 'on' : '')} style="flex:1;justify-content:center;padding:6px 0" onClick={() => updSch(i, { weekdays: x.weekdays.includes(wd) ? x.weekdays.filter((y) => y !== wd) : [...x.weekdays, wd] })}>{d.slice(0, 2)}</button>)}</div>}
      {x.type === 'interval' && <label class="f">Every how many days?<NumInput int value={x.interval} onValue={(n) => updSch(i, { interval: Math.max(1, n || 1) })} /></label>}
      <label class="f">Times of day</label>
      <div class="col" style="gap:6px">{x.times.map((t, ti) => <div class="row"><input type="time" value={t} onInput={(e) => updSch(i, { times: x.times.map((y, j) => (j === ti ? e.currentTarget.value : y)) })} /><button class="btn ic" onClick={() => updSch(i, { times: x.times.filter((_, j) => j !== ti) })} aria-label="Remove time">✕</button></div>)}
        <button class="btn sm" onClick={() => updSch(i, { times: [...x.times, x.times.length ? '20:00' : '08:00'] })}>+ Add time</button></div>
      <div class="grid2"><label class="f">Start date<input type="date" value={x.start} onInput={(e) => updSch(i, { start: e.currentTarget.value || ymd() })} /></label>
        <label class="f">End date (optional)<input type="date" value={x.end || ''} onInput={(e) => updSch(i, { end: e.currentTarget.value || undefined })} /></label></div>
      <label class="row sm"><input type="checkbox" style="width:24px;min-height:24px" checked={x.reminders} onChange={(e) => updSch(i, { reminders: e.currentTarget.checked })} /> Remind me (see Settings → Reminders)</label>
      <label class="row sm"><input type="checkbox" style="width:24px;min-height:24px" checked={x.active} onChange={(e) => updSch(i, { active: e.currentTarget.checked })} /> Active</label>
      <button class="btn d sm" onClick={() => { setRemoved([...removed, x.id]); setSch(sch.filter((_, j) => j !== i)); }}>Remove schedule</button>
    </div>)}
    <button class="btn" onClick={() => setSch([...sch, { id: 'sc' + uid(), suppId: s.id, type: 'daily', weekdays: [1, 3, 5], interval: 2, times: ['08:00'], start: ymd(), reminders: set.reminders, active: true, created: Date.now() }])}>+ Add schedule</button>

    <h2>Nutrients per dose (optional)</h2>
    <div class="mut xs">Vitamins, minerals and compounds in one dose. Protein, fibre and the vitamins/minerals the Food diary tracks count toward your daily nutrition when you mark a dose taken.</div>
    <IngredientEditor ingr={ingr} onChange={setIngr} sex={set.profile?.sex} />
    <button class="btn p" onClick={save}>Save</button>
    {id !== 'new' && <button class="btn d" onClick={async () => { if (confirmDo(`Delete ${s.name}? Its schedules are removed; logged history stays (hidden).`)) { await put('supplements', { ...s, archived: true }); for (const x of sch) await del('schedules', x.id); scheduleReminders(); go('/supps'); } }}>Delete</button>}
    <Scanner open={scan} onClose={() => { setScan(false); setBusy(''); }} onCode={onCode} busy={busy} />
  </div></>;
}

export function CalendarPage() {
  const d = useDoseData(); const today = ymd();
  const [sel, setSel] = useState(today); const [mon, setMon] = useState(() => { const t = new Date(); return { y: t.getFullYear(), m: t.getMonth() }; });
  const [view, setView] = useState<'month' | 'day'>('month');
  const month = useMemo(() => {
    if (!d) return null;
    const first = new Date(mon.y, mon.m, 1); const start = addDays(ymd(first), -first.getDay());
    const cells: { date: string; slots: Slot[]; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) { const dt = addDays(start, i); cells.push({ date: dt, inMonth: parseYmd(dt).getMonth() === mon.m, slots: slotsFor(dt, d.schedules, d.supps, d.logs) }); }
    return cells;
  }, [d, mon.y, mon.m]);
  if (!d || !month) return <Top title="Dose calendar" backBtn />;
  const daySlots = slotsFor(sel, d.schedules, d.supps, d.logs);
  const extra = d.logs.filter((l) => l.date === sel && !l.scheduleId); const sm = new Map(d.supps.map((s) => [s.id, s]));
  const mAdh = adherence(month.filter((c) => c.inMonth).flatMap((c) => c.slots));
  const last30: Slot[] = []; for (let i = 0; i < 30; i++) last30.push(...slotsFor(addDays(today, -i), d.schedules, d.supps, d.logs));
  const a30 = adherence(last30);
  const perSupp = d.supps.filter((s) => !s.archived).map((s) => ({ s, a: adherence(last30.filter((x) => x.supp.id === s.id)) })).filter((x) => x.a.total);
  const shift = (n: number) => { const t = new Date(mon.y, mon.m + n, 1); setMon({ y: t.getFullYear(), m: t.getMonth() }); };
  return <><Top title="Dose calendar" backBtn right={<a class="btn sm" href="#/supps">Supplements</a>} /><div class="page">
    <Seg value={view} onChange={setView} options={[['month', 'Month'], ['day', 'Day']]} />
    <div class="kpi" style="margin-top:10px;grid-template-columns:1fr 1fr"><div><span class="mut xs">Adherence (30 days)</span><b>{a30.pct == null ? '—' : a30.pct + '%'}</b><span class="mut xs">{a30.taken}/{a30.total} doses</span></div>
      <div><span class="mut xs">{MONTHS[mon.m]} so far</span><b>{mAdh.pct == null ? '—' : mAdh.pct + '%'}</b><span class="mut xs">{mAdh.taken}/{mAdh.total} doses</span></div></div>
    {view === 'month' && <div class="card" style="margin-top:12px;padding:10px">
      <div class="row between" style="margin-bottom:6px"><button class="btn ic" onClick={() => shift(-1)} aria-label="Previous month">◀</button><b>{MONTHS[mon.m]} {mon.y}</b><button class="btn ic" onClick={() => shift(1)} aria-label="Next month">▶</button></div>
      <div class="cal">{WD.map((w) => <div class="h">{w.slice(0, 2)}</div>)}
        {month.map((c) => { const t = c.slots.filter((x) => x.status === 'taken').length, m = c.slots.filter((x) => x.status === 'missed').length, u = c.slots.length - t - m;
          return <button class={[c.inMonth ? '' : 'out', c.date === today ? 'today' : '', c.date === sel ? 'sel' : ''].join(' ')} onClick={() => setSel(c.date)} aria-label={`${fmtDate(c.date)}: ${t} taken, ${m} missed, ${u} pending`}>
            <span>{parseYmd(c.date).getDate()}</span><span class="dots">{t > 0 && <i class="dot-t" />}{m > 0 && <i class="dot-m" />}{u > 0 && <i class={c.date === today ? 'dot-d' : 'dot-u'} />}</span></button>; })}</div>
      <div class="row xs mut" style="gap:12px;justify-content:center;margin-top:8px"><span><i class="swatch dot-t" style="display:inline-block;width:8px;height:8px" /> taken</span><span><i class="swatch dot-m" style="display:inline-block;width:8px;height:8px" /> missed</span><span><i class="swatch dot-u" style="display:inline-block;width:8px;height:8px" /> scheduled</span></div></div>}
    <div class="row between" style="margin-top:14px"><button class="btn ic" onClick={() => setSel(addDays(sel, -1))} aria-label="Previous day">◀</button><h2 style="margin:0">{fmtDay(sel)} <span class="mut sm">{fmtDate(sel)}</span></h2><button class="btn ic" onClick={() => setSel(addDays(sel, 1))} aria-label="Next day">▶</button></div>
    <div class="card list" style="padding:4px 12px;margin-top:8px">{daySlots.map((sl) => <SlotRow sl={sl} />)}
      {extra.map((l) => <div class="item"><span class="swatch" style={{ background: sm.get(l.suppId)?.color }} /><div class="grow">{sm.get(l.suppId)?.name} <span class="mut xs">extra dose × {l.amount} · {fmtTime(l.takenAt)}</span></div><button class="btn ic" onClick={() => unmark(l)} aria-label="Undo">↺</button></div>)}
      {!daySlots.length && !extra.length && <div class="empty">Nothing scheduled on this day.{!d.schedules.length && <><br /><br /><a class="btn p" href="#/supp/new">Add a supplement & schedule</a></>}</div>}</div>
    {sel > today && <div class="mut xs">Tapping a future dose marks it taken in advance.</div>}
    {perSupp.length > 0 && <><h2>Per supplement (30 days)</h2><div class="card col">{perSupp.map(({ s, a }) => <div><div class="row between sm"><span><span class="swatch" style={{ background: s.color, display: 'inline-block', marginRight: '6px' }} />{s.name}</span><span class="mut">{a.pct}% · {a.taken}/{a.total}</span></div><Bar value={a.taken} target={a.total} color={s.color} /></div>)}</div></>}
  </div></>;
}
export { fmtDM };
