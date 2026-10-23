import { BurnBar, useDayEnergy } from './Burn';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { all, byBarcode, byDate, del, get, put } from '../db';
import { go, useQuery, useSettings } from '../hooks';
import type { DiaryEntry, DoseLog, Food, Meal, Nutrients, Serving, Settings, Supplement } from '../types';
import { Bar, BarChart, NumInput, Ring, Seg, Sheet, Top, confirmDo, num, toast } from '../ui';
import { addDays, energy, fmtDay, fmtDM, MICROS, netCarbs, r0, r1, scaleN, sumN, uid, ymd, EMPTY, NKEYS, parseYmd, WD } from '../util';
import { lookupBarcode, searchOFF } from '../off';
import { amountText, baseUnit, convertQty, matchUnit, normaliseServings, unitLabel, unitsFor } from '../servings';
import { Scanner } from '../scanner';

export const MEALS: [Meal, string][] = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snacks', 'Snacks']];
const eu = (s: Settings) => s.energyUnit;

/** Nutrients contributed by supplements logged on a date */
export async function suppNutrients(from: string, to: string) {
  const [logs, supps] = await Promise.all([byDate<DoseLog>('doselogs', from, to), all<Supplement>('supplements')]);
  const m = new Map(supps.map((s) => [s.id, s])); const per: Record<string, Nutrients> = {};
  for (const l of logs) { const s = m.get(l.suppId); if (!s?.nutrients) continue; per[l.date] = sumN([per[l.date] || EMPTY, scaleN(s.nutrients, l.amount || 1)]); }
  return per;
}
export async function dayTotals(date: string) {
  const [entries, sn] = await Promise.all([byDate<DiaryEntry>('diary', date, date), suppNutrients(date, date)]);
  return { entries: entries.sort((a, b) => a.created - b.created), food: sumN(entries.map((e) => e.n)), supp: sn[date] || EMPTY };
}

export function MacroSummary({ n, s, compact, kcalTarget }: { n: Nutrients; s: Settings; compact?: boolean; kcalTarget?: number }) {
  const t = { ...s.targets, kcal: kcalTarget ?? s.targets.kcal };
  return <div class="rings">
    <Ring value={energy(n.kcal, s)} target={energy(t.kcal, s)} color="var(--kcal)" label={eu(s)} sub={`${Math.max(0, energy(t.kcal - n.kcal, s))} left`} size={compact ? 74 : 84} />
    <Ring value={n.protein} target={t.protein} color="var(--pro)" label="Protein" sub="g" size={compact ? 74 : 84} />
    <Ring value={netCarbs(n)} target={t.carbs} color="var(--carb)" label="Net carbs" sub="g" size={compact ? 74 : 84} />
    <Ring value={n.fat} target={t.fat} color="var(--fat)" label="Fat" sub="g" size={compact ? 74 : 84} />
  </div>;
}
export function Micros({ n, s }: { n: Nutrients; s: Settings }) {
  const rows = [{ key: 'fibre', label: 'Fibre', unit: 'g' } as const, ...MICROS];
  return <div class="col" style="gap:10px">{rows.map((m) => { const v = (n as any)[m.key] || 0; const t = (s.targets as any)[m.key] || 0; const lim = m.key === 'sodium';
    return <div><div class="row between sm"><span>{m.label}{lim ? ' (limit)' : ''}</span><span class="mut">{v >= 100 ? r0(v) : r1(v)} / {t} {m.unit} · {t ? r0((v / t) * 100) : 0}%</span></div>
      <Bar value={v} target={t} color={lim ? (v > t ? '#ef4444' : '#22c55e') : undefined} /></div>; })}
    <div class="mut xs">Micronutrients only count where Open Food Facts / your custom food has data, so totals may be under-estimates.</div></div>;
}

export function Diary({ date }: { date: string }) {
  const s = useSettings(); const d = useQuery(() => dayTotals(date), [date]); const en = useDayEnergy(date);
  const [edit, setEdit] = useState<DiaryEntry | null>(null); const [menu, setMenu] = useState<Meal | null>(null);
  const total = d ? sumN([d.food, d.supp]) : EMPTY;
  const copyMeal = async (meal: Meal, from: string) => {
    const src = (await byDate<DiaryEntry>('diary', from, from)).filter((e) => e.meal === meal);
    if (!src.length) { toast(`Nothing in ${meal} on ${fmtDay(from)}`); return; }
    for (const e of src) await put('diary', { ...e, id: uid(), date, created: Date.now() + Math.random() });
    toast(`Copied ${src.length} item${src.length > 1 ? 's' : ''}`); setMenu(null);
  };
  return <><Top title="Food diary" right={<><a class="btn sm" href="#/food/trends">Trends</a><a class="btn sm" href="#/foods">My foods</a></>} />
    <div class="page">
      <div class="row between" style="margin-bottom:10px"><button class="btn ic" aria-label="Previous day" onClick={() => go(`/food/${addDays(date, -1)}`)}>◀</button>
        <label class="b" style="position:relative">{fmtDay(date)} <span class="mut sm">{WD[parseYmd(date).getDay()]} {fmtDM(date)}</span><input type="date" value={date} onInput={(e) => e.currentTarget.value && go(`/food/${e.currentTarget.value}`)} style="position:absolute;inset:0;opacity:0" aria-label="Pick date" /></label>
        <button class="btn ic" aria-label="Next day" onClick={() => go(`/food/${addDays(date, 1)}`)}>▶</button></div>
      <BurnBar date={date} />
      <div class="card"><MacroSummary n={total} s={s} kcalTarget={en?.target} />
        <div class="row between sm mut" style="margin-top:8px"><span>Fibre {r1(total.fibre)} g</span><span>Total carbs {r1(total.carbs)} g</span>{d && d.supp.kcal + (d.supp.calcium || 0) + (d.supp.vitD || 0) > 0 && <span class="pill info">incl. supplements</span>}</div></div>
      {MEALS.map(([m, label]) => { const es = (d?.entries || []).filter((e) => e.meal === m); const mt = sumN(es.map((e) => e.n));
        return <div class="card" style="padding:10px 12px">
          <div class="row between"><div><b>{label}</b> <span class="mut sm">{energy(mt.kcal, s)} {eu(s)} · P {r0(mt.protein)} · C {r0(netCarbs(mt))} · F {r0(mt.fat)}</span></div>
            <button class="btn ic" aria-label={`${label} menu`} onClick={() => setMenu(m)}>⋮</button></div>
          <div class="list">{es.map((e) => <button class="item" style="min-height:48px;padding:8px 0" onClick={() => setEdit(e)}>
            <div class="grow"><div class="ell">{e.name}</div><div class="mut xs">{amountText(e)}</div></div>
            <div class="sm" style="text-align:right">{energy(e.n.kcal, s)}<div class="mut xs">P{r0(e.n.protein)} C{r0(netCarbs(e.n))} F{r0(e.n.fat)}</div></div></button>)}</div>
          <div class="row" style="margin-top:4px;gap:6px"><a class="btn g sm grow" href={`#/food/add/${date}/${m}`}>+ Add food</a><a class="btn sm b2" href={`#/food/add/${date}/${m}?scan=1`} aria-label={`Scan barcode into ${label}`}>▥ Scan</a></div>
        </div>; })}
      <h2>Nutrients</h2>
      <div class="card"><Micros n={total} s={s} /></div>
    </div>
    <FoodAmountSheet open={!!edit} entry={edit || undefined} onClose={() => setEdit(null)} date={date} meal={edit?.meal || 'snacks'} />
    <Sheet open={!!menu} onClose={() => setMenu(null)} title={MEALS.find((x) => x[0] === menu)?.[1]}>
      {menu && <div class="col"><button class="btn" onClick={() => copyMeal(menu, addDays(date, -1))}>Copy {menu} from previous day</button>
        <button class="btn" onClick={async () => { const all7 = await byDate<DiaryEntry>('diary', addDays(date, -7), addDays(date, -1)); const last = all7.filter((e) => e.meal === menu).sort((a, b) => b.date.localeCompare(a.date))[0]; if (last) copyMeal(menu, last.date); else toast('No recent meal found'); }}>Copy most recent {menu} (last 7 days)</button>
        <button class="btn d" onClick={async () => { const es = (d?.entries || []).filter((e) => e.meal === menu); if (es.length && confirmDo(`Clear ${es.length} item(s)?`)) { for (const e of es) await del('diary', e.id); setMenu(null); } }}>Clear meal</button></div>}
    </Sheet></>;
}

export function FoodAmountSheet({ open, onClose, food: food0, entry, date, meal, onAdded }: { open: boolean; onClose: () => void; food?: Food; entry?: DiaryEntry; date: string; meal: Meal; onAdded?: () => void }) {
  const s = useSettings(); const [food, setFood] = useState<Food | undefined>(food0);
  const [qty, setQty] = useState<number | null>(1); const [ui, setUi] = useState(0); const [m, setM] = useState<Meal>(meal);
  const [defOpen, setDefOpen] = useState(false); const [defLabel, setDefLabel] = useState('serving'); const [defG, setDefG] = useState<number | null>(null);
  useEffect(() => {
    if (!open) return; setM(entry?.meal || meal); setDefOpen(false);
    if (entry) {
      get<Food>('foods', entry.foodId).then((f) => {
        // food may have been deleted: rebuild a grams-only food from the entry's snapshot so it stays editable
        const ff: Food = f || { id: entry.foodId, name: entry.name, source: 'custom', per100: scaleN(entry.n, 100 / Math.max(entry.grams, 0.001)), servings: [] };
        const units = unitsFor(ff); const i = matchUnit(units, entry);
        setFood(ff); setUi(i); setQty(i === 0 ? r1(entry.grams) : Math.round((entry.grams / units[i].grams) * 100) / 100);
      });
    } else if (food0) {
      const units = unitsFor(food0); setFood(food0);
      const last = food0.lastServing; const li = last ? units.findIndex((u) => u.label === last.label) : -1;
      if (li >= 0) { setUi(li); setQty(last!.qty); }
      else { const si = units.findIndex((u, i) => i > 0 && u.kind !== 'package'); if (si > 0) { setUi(si); setQty(1); } else { setUi(0); setQty(100); } } // whole packages are rarely eaten: default to a serving, else 100 g
    }
  }, [open, entry?.id, food0?.id]);
  if (!open || !food) return null;
  const units = unitsFor(food); const unit = units[Math.min(ui, units.length - 1)]; const base = baseUnit(food);
  const q = qty || 0; const grams = q * unit.grams; const n = scaleN(food.per100, grams / 100);
  const switchUnit = (i: number) => { if (i === ui) return; setQty(qty == null ? null : i === 0 ? r1(convertQty(qty, unit, units[i])) : convertQty(qty, unit, units[i])); setUi(i); };
  const defineServing = async () => {
    if (!defG || defG <= 0) return;
    const sv: Serving = { label: defLabel.trim() || 'serving', grams: defG, kind: 'custom' };
    const stored = (await get<Food>('foods', food.id)) || food;
    const nf = { ...stored, servings: [...normaliseServings(stored.servings).filter((x) => x.label !== sv.label), sv] };
    await put('foods', nf); setFood(nf);
    const ni = unitsFor(nf).findIndex((u) => u.label === sv.label); setQty(convertQty(q, unit, sv)); setUi(ni); setDefOpen(false); toast('Serving saved');
  };
  const save = async () => {
    if (grams <= 0) return;
    const label = ui === 0 ? base : unit.label;
    const e: DiaryEntry = { id: entry?.id || uid(), date: entry?.date || date, meal: m, foodId: food.id, name: food.brand ? `${food.name} (${food.brand})` : food.name, grams, qty: q, serving: label, n, created: entry?.created || Date.now() };
    await put('diary', e);
    const stored = (await get<Food>('foods', food.id)) || food;
    await put('foods', { ...stored, servings: stored.servings, lastServing: { label, qty: q }, ...(entry ? {} : { lastUsed: Date.now(), useCount: (stored.useCount || 0) + 1 }) });
    toast(entry ? 'Updated' : `Added to ${m}`); onClose(); onAdded?.();
  };
  return <Sheet open={open} onClose={onClose} title={food.name}>
    <div class="col amount-sheet">
      {(food.brand || food.barcode) && <div class="mut sm" style="margin-top:-8px">{food.brand}{food.brand && food.barcode ? ' · ' : ''}{food.barcode ? `▥ ${food.barcode}` : ''}</div>}
      <label class="f">Unit
        <div class="unitchips" role="radiogroup" aria-label="Unit">{units.map((u, i) => <button type="button" role="radio" aria-checked={i === ui} class={'chip ' + (i === ui ? 'on' : '')} onClick={() => switchUnit(i)}>{i === 0 ? (base === 'ml' ? 'ml' : 'grams') : unitLabel(u, food)}</button>)}
          <button type="button" class="chip" onClick={() => { setDefOpen(!defOpen); setDefG(null); }} aria-label="Define a serving">＋ serving</button></div></label>
      {units.length === 1 && !defOpen && <div class="mut xs">No serving size for this product — logging in {base}. Tap “＋ serving” to define one (e.g. 1 slice = 35 {base}).</div>}
      {defOpen && <div class="card col" style="margin:0"><div class="grid2"><label class="f">Serving name<input value={defLabel} onInput={(e) => setDefLabel(e.currentTarget.value)} placeholder="e.g. slice, cup, scoop" /></label>
        <label class="f">Size ({base})<NumInput value={defG} onValue={setDefG} placeholder="e.g. 35" aria-label="Serving size" /></label></div>
        <button class="btn sm b2" disabled={!defG} onClick={defineServing}>Save serving</button></div>}
      <label class="f">Amount ({ui === 0 ? base : `× ${unit.label}`})
        <div class="row"><button type="button" class="btn" aria-label="Decrease" onClick={() => setQty(Math.max(0, r1(q - (ui === 0 ? 10 : 0.5))))}>−</button>
          <NumInput value={qty} onValue={setQty} aria-label="Amount" style="text-align:center;font-size:20px;font-weight:700" />
          <button type="button" class="btn" aria-label="Increase" onClick={() => setQty(r1(q + (ui === 0 ? 10 : 0.5)))}>＋</button></div></label>
      {ui === 0 ? <div class="chips">{[25, 50, 100, 150, 200, 250].map((g) => <button class="chip" onClick={() => setQty(g)}>{g} {base}</button>)}</div>
        : <div class="chips">{[0.5, 1, 1.5, 2, 3].map((g) => <button class="chip" onClick={() => setQty(g)}>{g}×</button>)}</div>}
      <Seg value={m} onChange={setM} options={MEALS.map(([k, l]) => [k, l.slice(0, 5)] as [Meal, string])} />
      <div class="kpi" style="grid-template-columns:repeat(4,1fr)" data-testid="preview"><div><span class="mut xs">{eu(s)}</span><b data-k="kcal">{energy(n.kcal, s)}</b></div><div><span class="mut xs">Protein</span><b data-k="protein">{r1(n.protein)}</b></div><div><span class="mut xs">Net C</span><b data-k="carbs">{r1(netCarbs(n))}</b></div><div><span class="mut xs">Fat</span><b data-k="fat">{r1(n.fat)}</b></div></div>
      <div class="mut xs" data-testid="grams">= {r1(grams)} {base} · fibre {r1(n.fibre)} g{MICROS.filter((x) => n[x.key] != null && (n[x.key] as number) > 0).map((x) => ` · ${x.label} ${r1(n[x.key] as number)} ${x.unit}`).join('')}</div>
      <button class="btn p" disabled={grams <= 0} onClick={save}>{entry ? 'Save changes' : 'Add to diary'}</button>
      {entry && <button class="btn d" onClick={async () => { await del('diary', entry.id); onClose(); }}>Remove from diary</button>}
      {(food.source !== 'off') && <a class="btn g" href={food.source === 'recipe' ? `#/recipe/${food.id}` : `#/food/edit/${food.id}`} onClick={onClose}>Edit {food.source === 'recipe' ? 'recipe' : 'food'}</a>}
    </div></Sheet>;
}

function FoodRow({ f, onPick, s }: { f: Food; onPick: () => void; s: Settings }) {
  const sv = unitsFor(f)[1]; const n = scaleN(f.per100, (sv ? sv.grams : 100) / 100);
  return <button class="item" onClick={onPick}>
    {f.image ? <img class="thumb" src={f.image} loading="lazy" alt="" /> : <div class="thumb" style="display:flex;align-items:center;justify-content:center">{f.source === 'recipe' ? '🍲' : f.source === 'custom' ? '✏️' : '🛒'}</div>}
    <div class="grow"><div class="ell">{f.name}</div><div class="mut xs ell">{f.brand ? f.brand + ' · ' : ''}{sv ? unitLabel(sv, f) : `100 ${baseUnit(f)}`} · P{r0(n.protein)} C{r0(netCarbs(n))} F{r0(n.fat)}</div></div>
    <div class="sm">{energy(n.kcal, s)}<span class="mut xs"> {eu(s)}</span></div></button>;
}

export function useLocalFoods() { return (useQuery(() => all<Food>('foods'), [], []) || []) as Food[]; }
const hashParams = () => new URLSearchParams(location.hash.split('?')[1] || '');

export function AddFood({ date, meal }: { date: string; meal: Meal }) {
  const s = useSettings(); const foods = useLocalFoods();
  const [tab, setTab] = useState<'search' | 'recent' | 'frequent' | 'mine'>('recent');
  const [q, setQ] = useState(''); const [res, setRes] = useState<Food[] | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [pick, setPick] = useState<Food | undefined>(); const [scan, setScan] = useState(false);
  const [lookup, setLookup] = useState(''); const [notFound, setNotFound] = useState<string | null>(null); const [partialName, setPartialName] = useState('');
  useEffect(() => {
    const hp = hashParams();
    if (hp.get('scan') === '1') setScan(true);
    const pid = hp.get('pick'); if (pid) get<Food>('foods', pid).then((f) => f && setPick(f));
    if (hp.get('scan') || pid) history.replaceState(null, '', `#/food/add/${date}/${meal}`);
  }, []);
  const doSearch = async () => {
    if (!q.trim()) return; setTab('search'); setErr(''); setNotFound(null);
    if (/^\d{8,14}$/.test(q.trim())) { await barcode(q.trim()); return; }
    setBusy(true); setRes(null);
    try { setRes(await searchOFF(q.trim())); } catch (e: any) { setErr(navigator.onLine ? 'Open Food Facts search failed (' + (e?.message || 'error') + '). Try again shortly.' : 'You are offline — showing your saved foods only.'); setRes([]); }
    setBusy(false);
  };
  const barcode = async (code: string) => {
    setErr(''); setNotFound(null);
    const local = await byBarcode(code); if (local) { setScan(false); setPick(local); return; }
    setLookup(`Looking up ${code} on Open Food Facts…`);
    try {
      const f = await lookupBarcode(code); setLookup(''); setScan(false); setPartialName('');
      if (f && 'partial' in f) { setPartialName(f.partial); setNotFound(code); }
      else if (f) { const ex = await get<Food>('foods', f.id); const keep = ex ? { ...f, lastServing: ex.lastServing, useCount: ex.useCount, lastUsed: ex.lastUsed, servings: [...f.servings, ...(ex.servings || []).filter((x) => x.kind === 'custom')] } : f; await put('foods', keep); setPick(keep); }
      else setNotFound(code);
    } catch (e: any) { setLookup(''); setScan(false); setErr(`Couldn't look up ${code}: ${navigator.onLine ? e?.message || 'network error' : 'you are offline'}. Try again, or create it as a custom food.`); setNotFound(code); }
  };
  const ql = q.toLowerCase().trim();
  const localMatch = ql ? foods.filter((f) => (f.name + ' ' + (f.brand || '') + ' ' + (f.barcode || '')).toLowerCase().includes(ql)) : [];
  const list = tab === 'search' ? [...localMatch, ...(res || []).filter((r) => !localMatch.some((l) => l.id === r.id))]
    : tab === 'recent' ? foods.filter((f) => f.lastUsed).sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0)).slice(0, 40)
      : tab === 'frequent' ? foods.filter((f) => f.useCount).sort((a, b) => (b.useCount || 0) - (a.useCount || 0)).slice(0, 40)
        : foods.filter((f) => f.source !== 'off').sort((a, b) => a.name.localeCompare(b.name));
  return <><Top title={`Add to ${MEALS.find((m) => m[0] === meal)?.[1]}`} backBtn /><div class="page">
    <button class="btn b2 full" style="min-height:56px;font-size:17px;margin-bottom:10px" data-scan-open onClick={() => { setNotFound(null); setScan(true); }}>▥ Scan barcode</button>
    <form class="row" onSubmit={(e) => { e.preventDefault(); doSearch(); }}><input type="search" placeholder="Search foods or type a barcode" value={q} onInput={(e) => { setQ(e.currentTarget.value); if (e.currentTarget.value) setTab('search'); }} enterKeyHint="search" />
      <button class="btn p" type="submit" aria-label="Search">🔍</button><button class="btn b2" type="button" onClick={() => setScan(true)} aria-label="Scan barcode">▥</button></form>
    {lookup && !scan && <div class="card sm" style="margin-top:10px">⏳ {lookup}</div>}
    {notFound && <div class="card col" style="border-color:var(--warn);margin-top:10px" data-testid="notfound">
      <div class="sm">{partialName ? <>Open Food Facts knows <b>{partialName}</b> ({notFound}) but has no nutrition data for it.</> : <><b>Barcode {notFound}</b> isn't in Open Food Facts{err ? ' (or lookup failed)' : ''}.</>} Create it as a custom food from the label — next time you scan it, Grug Fit will find it instantly.</div>
      <a class="btn p" data-testid="scan-label-notfound" href={`#/food/label?barcode=${notFound}&ret=${date}/${meal}${partialName ? `&name=${encodeURIComponent(partialName)}` : ''}`}>📷 Scan nutrition label</a>
      <a class="btn" href={`#/food/edit/new?barcode=${notFound}&ret=${date}/${meal}${partialName ? `&name=${encodeURIComponent(partialName)}` : ''}`}>Type it in manually</a>
      <button class="btn sm" onClick={() => setScan(true)}>Scan again</button></div>}
    <div class="chips" style="margin:10px 0">{([['search', 'Search'], ['recent', 'Recent'], ['frequent', 'Frequent'], ['mine', 'My foods & recipes']] as const).map(([k, l]) => <button class={'chip ' + (tab === k ? 'on' : '')} onClick={() => setTab(k)}>{l}</button>)}</div>
    <div class="grid3"><a class="btn sm" href={`#/food/label?ret=${date}/${meal}`} data-testid="scan-label">📷 Scan label</a><a class="btn sm" href={`#/food/edit/new?ret=${date}/${meal}`}>+ Custom food</a><a class="btn sm" href="#/recipe/new">+ Recipe</a></div>
    {busy && <div class="empty">Searching Open Food Facts…</div>}
    {err && !notFound && <div class="card sm" style="border-color:var(--warn);margin-top:10px">{err}</div>}
    <div class="list" style="margin-top:6px">{list.map((f) => <FoodRow f={f} s={s} onPick={() => setPick(f)} />)}</div>
    {!busy && !list.length && <div class="empty">{tab === 'search' ? (res ? 'No results. Try fewer words, or add a custom food.' : 'Type a food name and press search.') : tab === 'mine' ? 'No custom foods or recipes yet.' : 'Foods you log will appear here.'}</div>}
    {tab === 'search' && res && <div class="mut xs center" style="margin-top:8px">Data © Open Food Facts contributors (ODbL). Check values against the label.</div>}
    <FoodAmountSheet open={!!pick} food={pick} onClose={() => setPick(undefined)} date={date} meal={meal} />
    <Scanner open={scan} onClose={() => { setScan(false); setLookup(''); }} onCode={barcode} busy={lookup} />
  </div></>;
}

const NFIELDS: { key: keyof Nutrients; label: string }[] = [
  { key: 'kcal', label: 'Energy (kcal)' }, { key: 'protein', label: 'Protein (g)' }, { key: 'carbs', label: 'Total carbs (g, incl. fibre)' }, { key: 'fibre', label: 'Fibre (g)' }, { key: 'fat', label: 'Fat (g)' }, { key: 'satfat', label: 'Saturated fat (g)' }, { key: 'sugar', label: 'Sugars (g)' },
  ...MICROS.map((m) => ({ key: m.key, label: `${m.label} (${m.unit})` }))
];
export function NutrientInputs({ vals, set, energyUnit }: { vals: Record<string, string>; set: (k: string, v: string) => void; energyUnit?: 'kcal' | 'kJ' }) {
  return <div class="grid2">{NFIELDS.map((f) => <label class="f">{f.key === 'kcal' && energyUnit === 'kJ' ? 'Energy (kJ)' : f.label}<input inputMode="decimal" value={vals[f.key] ?? ''} onInput={(e) => set(f.key, e.currentTarget.value)} /></label>)}</div>;
}

export function FoodEdit({ id }: { id: string }) {
  const s = useSettings();
  const [f, setF] = useState<Food | null>(null); const [basis, setBasis] = useState('100'); const [vals, setVals] = useState<Record<string, string>>({});
  const [svLabel, setSvLabel] = useState('serving'); const [svG, setSvG] = useState('');
  useEffect(() => {
    if (id === 'new') { setF({ id: 'cf' + uid(), name: hashParams().get('name') || '', source: 'custom', per100: { ...EMPTY }, servings: [], barcode: hashParams().get('barcode') || undefined }); return; }
    get<Food>('foods', id).then((x) => { if (!x) return; setF(x); const sv = unitsFor(x)[1]; if (sv) { setSvLabel(sv.label); setSvG(String(sv.grams)); }
      const v: Record<string, string> = {}; for (const k of NKEYS) if (x.per100[k] != null) v[k] = String(r1(k === 'kcal' && s.energyUnit === 'kJ' ? (x.per100[k] as number) * 4.184 : (x.per100[k] as number))); setVals(v); });
  }, [id]);
  if (!f) return <Top title="Food" backBtn />;
  const save = async () => {
    const b = num(basis) || 100; const per100: any = {};
    for (const k of NKEYS) { const v = num(vals[k] ?? ''); if (v != null) per100[k] = (k === 'kcal' && s.energyUnit === 'kJ' ? v / 4.184 : v) * (100 / b); }
    for (const k of ['kcal', 'protein', 'carbs', 'fibre', 'fat']) per100[k] ??= 0;
    const g = num(svG); const first: Serving | null = g && g > 0 ? { label: svLabel.trim() || 'serving', grams: g, kind: 'custom' } : null;
    const others = unitsFor(f).slice(1).filter((x, i) => i > 0 || !first); // keep extra servings defined on the amount screen
    const servings = [...(first ? [first] : []), ...others.filter((x) => !first || x.label !== first.label)];
    const code = f.barcode?.trim() || undefined;
    if (code) { const dup = await byBarcode(code); if (dup && dup.id !== f.id && !confirmDo(`Barcode ${code} is already used by "${dup.name}". Use it for this food too?`)) return; }
    const saved = { ...f, barcode: code, name: f.name.trim() || 'Custom food', per100, servings };
    await put('foods', saved); toast('Food saved');
    const ret = hashParams().get('ret');
    if (ret) go(`/food/add/${ret}?pick=${saved.id}`); else history.back();
  };
  return <><Top title={id === 'new' ? 'New custom food' : 'Edit food'} backBtn right={<button class="btn p sm" onClick={save}>Save</button>} /><div class="page col">
    <label class="f">Name<input value={f.name} onInput={(e) => setF({ ...f, name: e.currentTarget.value })} placeholder="e.g. Homemade protein oats" /></label>
    <div class="grid2"><label class="f">Brand (optional)<input value={f.brand || ''} onInput={(e) => setF({ ...f, brand: e.currentTarget.value })} /></label>
      <label class="f">Barcode (optional)<input inputMode="numeric" value={f.barcode || ''} onInput={(e) => setF({ ...f, barcode: e.currentTarget.value || undefined })} /></label></div>
    <div class="grid2"><label class="f">Serving name<input value={svLabel} onInput={(e) => setSvLabel(e.currentTarget.value)} placeholder="e.g. 1 scoop" /></label>
      <label class="f">Serving size (g or ml, optional)<input inputMode="decimal" value={svG} onInput={(e) => setSvG(e.currentTarget.value)} placeholder="e.g. 30" /></label></div>
    <label class="f">Nutrition values below are per … g<input inputMode="decimal" value={basis} onInput={(e) => setBasis(e.currentTarget.value)} /></label>
    <NutrientInputs vals={vals} set={(k, v) => setVals({ ...vals, [k]: v })} energyUnit={s.energyUnit} />
    <button class="btn p" onClick={save}>Save food</button>
    {id !== 'new' && <button class="btn d" onClick={async () => { if (confirmDo('Delete this food? Diary entries keep their values.')) { await del('foods', f.id); history.back(); } }}>Delete food</button>}
  </div></>;
}

export function RecipeEdit({ id }: { id: string }) {
  const s = useSettings(); const foods = useLocalFoods();
  const [r, setR] = useState<Food | null>(null); const [add, setAdd] = useState(false); const [q, setQ] = useState(''); const [res, setRes] = useState<Food[]>([]); const [busy, setBusy] = useState(false);
  useEffect(() => { if (id === 'new') setR({ id: 'rc' + uid(), name: '', source: 'recipe', per100: { ...EMPTY }, servings: [], ingredients: [], recipeServings: 1 }); else get<Food>('foods', id).then((x) => setR(x || null)); }, [id]);
  const fm = useMemo(() => new Map(foods.map((f) => [f.id, f])), [foods]);
  if (!r) return <Top title="Recipe" backBtn />;
  const ing = r.ingredients || []; const totalG = ing.reduce((a, i) => a + i.grams, 0);
  const tot = sumN(ing.map((i) => { const f = fm.get(i.foodId); return f ? scaleN(f.per100, i.grams / 100) : EMPTY; }));
  const nServ = r.recipeServings || 1;
  const save = async () => {
    if (!ing.length || totalG <= 0) { toast('Add at least one ingredient'); return; }
    const per100 = scaleN(tot, 100 / totalG);
    await put('foods', { ...r, name: r.name.trim() || 'Recipe', per100, servings: [{ label: 'serving', note: `1/${nServ} recipe`, grams: totalG / nServ, kind: 'serving' }, { label: 'whole recipe', grams: totalG, kind: 'package' }] });
    toast('Recipe saved'); history.back();
  };
  const ql = q.toLowerCase();
  const local = ql ? foods.filter((f) => f.id !== r.id && f.name.toLowerCase().includes(ql)) : foods.filter((f) => f.id !== r.id && f.lastUsed).sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0)).slice(0, 15);
  const pickIng = async (f: Food) => { if (!fm.has(f.id)) await put('foods', f); const g = num(prompt(`Grams of ${f.name}?`, String(r1(unitsFor(f)[1]?.grams || 100))) || ''); if (!g) return; setR({ ...r, ingredients: [...ing, { foodId: f.id, name: f.name, grams: g }] }); setAdd(false); setQ(''); setRes([]); };
  return <><Top title={id === 'new' ? 'New recipe' : 'Edit recipe'} backBtn right={<button class="btn p sm" onClick={save}>Save</button>} /><div class="page col">
    <label class="f">Recipe name<input value={r.name} onInput={(e) => setR({ ...r, name: e.currentTarget.value })} placeholder="e.g. Chicken burrito bowl" /></label>
    <label class="f">Number of servings<NumInput int value={nServ} onValue={(n) => setR((o) => o && { ...o, recipeServings: Math.max(1, n || 1) })} /></label>
    <h2>Ingredients</h2>
    <div class="list card" style="padding:4px 12px">{ing.map((i, idx) => { const f = fm.get(i.foodId); const n = f ? scaleN(f.per100, i.grams / 100) : EMPTY;
      return <div class="item"><div class="grow"><div class="ell">{i.name}</div><div class="mut xs">{energy(n.kcal, s)} {eu(s)} · P{r0(n.protein)}</div></div>
        <NumInput style="width:80px" value={i.grams} onValue={(g) => setR((o) => o && { ...o, ingredients: (o.ingredients || []).map((x, j) => (j === idx ? { ...x, grams: g || 0 } : x)) })} aria-label="grams" /><span class="mut sm">g</span>
        <button class="btn ic" onClick={() => setR({ ...r, ingredients: ing.filter((_, j) => j !== idx) })} aria-label="Remove">✕</button></div>; })}
      {!ing.length && <div class="empty">No ingredients yet</div>}</div>
    <button class="btn" onClick={() => setAdd(true)}>+ Add ingredient</button>
    <div class="card"><div class="b">Per serving ({r0(totalG / nServ)} g)</div><div class="sm mut">{energy(tot.kcal / nServ, s)} {eu(s)} · Protein {r1(tot.protein / nServ)} g · Net carbs {r1(netCarbs(tot) / nServ)} g · Fat {r1(tot.fat / nServ)} g</div>
      <div class="xs mut" style="margin-top:4px">Whole recipe: {r0(totalG)} g, {energy(tot.kcal, s)} {eu(s)}</div></div>
    {id !== 'new' && <button class="btn d" onClick={async () => { if (confirmDo('Delete recipe?')) { await del('foods', r.id); history.back(); } }}>Delete recipe</button>}
    <Sheet open={add} onClose={() => setAdd(false)} title="Add ingredient"><div class="col">
      <form class="row" onSubmit={async (e) => { e.preventDefault(); if (!q.trim()) return; setBusy(true); try { setRes(await searchOFF(q)); } catch { toast('Search failed'); } setBusy(false); }}>
        <input type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Search saved foods / Open Food Facts" /><button class="btn p" type="submit">🔍</button></form>
      {busy && <div class="mut sm">Searching…</div>}
      <div class="list">{[...local, ...res].map((f) => <FoodRow f={f} s={s} onPick={() => pickIng(f)} />)}</div>
    </div></Sheet>
  </div></>;
}

export function MyFoods() {
  const s = useSettings(); const foods = useLocalFoods(); const [tab, setTab] = useState<'custom' | 'recipe' | 'off'>('custom');
  const l = foods.filter((f) => f.source === tab).sort((a, b) => a.name.localeCompare(b.name));
  return <><Top title="My foods" backBtn /><div class="page">
    <Seg value={tab} onChange={setTab} options={[['custom', 'Custom'], ['recipe', 'Recipes'], ['off', 'Saved (OFF)']]} />
    <div class="grid2" style="margin-top:10px"><a class="btn sm" href="#/food/edit/new">+ Custom food</a><a class="btn sm" href="#/recipe/new">+ Recipe</a></div>
    <div class="list" style="margin-top:6px">{l.map((f) => <FoodRow f={f} s={s} onPick={() => f.source === 'recipe' ? go(`/recipe/${f.id}`) : f.source === 'custom' ? go(`/food/edit/${f.id}`) : (confirmDo(`Remove "${f.name}" from saved foods?`) && del('foods', f.id))} />)}</div>
    {!l.length && <div class="empty">Nothing here yet.</div>}
  </div></>;
}

export function Trends() {
  const s = useSettings(); const [range, setRange] = useState<'7' | '30' | '84'>('7');
  const days = +range; const to = ymd(); const from = addDays(to, -(days - 1));
  const data = useQuery(async () => { const [es, sn] = await Promise.all([byDate<DiaryEntry>('diary', from, to), suppNutrients(from, to)]); const m: Record<string, Nutrients> = {};
    for (let i = 0; i < days; i++) m[addDays(from, i)] = sn[addDays(from, i)] || { ...EMPTY };
    for (const e of es) m[e.date] = sumN([m[e.date], e.n]); return m; }, [from, to]);
  if (!data) return <Top title="Trends" backBtn />;
  const list = Object.entries(data).sort(); const logged = list.filter(([, n]) => n.kcal > 0);
  const avg = logged.length ? scaleN(sumN(logged.map(([, n]) => n)), 1 / logged.length) : EMPTY;
  let bars: { label: string; value: number; stack?: { v: number; c: string }[] }[];
  if (days <= 30) bars = list.map(([d, n]) => ({ label: days === 7 ? WD[parseYmd(d).getDay()].slice(0, 2) : (parseYmd(d).getDate() % 5 === 0 ? String(parseYmd(d).getDate()) : ''), value: energy(n.kcal, s),
    stack: [{ v: energy(n.protein * 4, s), c: '#38bdf8' }, { v: energy(netCarbs(n) * 4, s), c: '#a78bfa' }, { v: energy(n.fat * 9, s), c: '#f472b6' }] }));
  else { bars = []; for (let w = 0; w < days / 7; w++) { const wk = list.slice(w * 7, w * 7 + 7).filter(([, n]) => n.kcal > 0); bars.push({ label: fmtDM(list[w * 7][0]), value: wk.length ? energy(wk.reduce((a, [, n]) => a + n.kcal, 0) / wk.length, s) : 0 }); } }
  return <><Top title="Nutrition trends" backBtn /><div class="page">
    <Seg value={range} onChange={setRange} options={[['7', '7 days'], ['30', '30 days'], ['84', '12 weeks']]} />
    <div class="card" style="margin-top:12px"><h3>{days > 30 ? `Weekly average ${eu(s)}` : `Daily ${eu(s)}`}</h3><BarChart bars={bars} target={energy(s.targets.kcal, s)} />
      {days <= 30 && <div class="row xs mut" style="gap:12px;justify-content:center"><span><i class="swatch" style="display:inline-block;background:#38bdf8" /> Protein</span><span><i class="swatch" style="display:inline-block;background:#a78bfa" /> Net carbs</span><span><i class="swatch" style="display:inline-block;background:#f472b6" /> Fat</span><span style="color:#f59e0b">--- target</span></div>}</div>
    <div class="card"><h3>Average per logged day ({logged.length} of {days})</h3>
      {[['Energy', energy(avg.kcal, s), energy(s.targets.kcal, s), eu(s)], ['Protein', avg.protein, s.targets.protein, 'g'], ['Net carbs', netCarbs(avg), s.targets.carbs, 'g'], ['Fat', avg.fat, s.targets.fat, 'g'], ['Fibre', avg.fibre, s.targets.fibre, 'g']].map(([l, v, t, u]) =>
        <div style="margin-bottom:8px"><div class="row between sm"><span>{l}</span><span class="mut">{r0(v as number)} / {r0(t as number)} {u}</span></div><Bar value={v as number} target={t as number} /></div>)}</div>
    <div class="card"><h3>Protein per day (g)</h3><BarChart color="#38bdf8" target={s.targets.protein} bars={days > 30 ? bars.map((b, w) => { const wk = list.slice(w * 7, w * 7 + 7).filter(([, n]) => n.kcal > 0); return { label: b.label, value: wk.length ? wk.reduce((a, [, n]) => a + n.protein, 0) / wk.length : 0 }; }) : list.map(([d, n], i) => ({ label: bars[i].label, value: n.protein }))} /></div>
    <div class="card"><h3>Average micronutrients</h3><Micros n={avg} s={s} /></div>
  </div></>;
}
