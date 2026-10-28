// v1.17.0 per-dose ingredients for supplements: searchable picker grouped by category (+ Custom), unit per row with IU↔µg/mg
// conversion, % of the Australian daily reference (NHMRC NRVs) and a gentle upper-level warning on today's dose totals.
import { useState } from 'preact/hooks';
import { CATS, CUSTOM_UNITS, NUT, fmtAmt, labelOf, pctRdi, rdiFor, searchNutrients, toCanon, unitsFor, ulWarnings, type Ingredient, type Sex } from '../nutrients';
import { NumInput, Sheet } from '../ui';

export function NutrientPicker({ open, onClose, onPick, have }: { open: boolean; onClose: () => void; onPick: (i: Ingredient) => void; have: string[] }) {
  const [q, setQ] = useState(''); const [custom, setCustom] = useState<{ name: string; unit: string } | null>(null);
  const list = searchNutrients(q);
  const close = () => { setQ(''); setCustom(null); onClose(); };
  return <Sheet open={open} onClose={close} title="Add a nutrient"><div class="col" data-testid="nutrient-picker">
    {!custom ? <>
      <input type="search" placeholder="Search e.g. zinc, B6, biotin, creatine" value={q} onInput={(e) => setQ(e.currentTarget.value)} data-testid="nutrient-search" />
      <div class="col" style="max-height:52vh;overflow:auto;gap:2px">
        {CATS.map((c) => { const l = list.filter((d) => d.cat === c); if (!l.length) return null;
          return <div data-testid={'cat-' + c}><div class="xs mut b" style="margin:8px 0 4px">{c}</div>
            {l.map((d) => <button class="item row between" style="width:100%" disabled={have.includes(d.key)} data-testid={'pick-' + d.key}
              onClick={() => { onPick({ key: d.key, amount: 0, unit: d.unit }); close(); }}><span>{d.label}</span><span class="mut xs">{d.unit}{d.iu ? ' / IU' : ''}{have.includes(d.key) ? ' · added' : ''}</span></button>)}</div>; })}
        {!list.length && <div class="mut sm">Nothing matches "{q}". Add it as a custom entry.</div>}
      </div>
      <button class="btn" data-testid="pick-custom" onClick={() => setCustom({ name: q.trim(), unit: 'mg' })}>+ Custom{q.trim() ? `: ${q.trim()}` : ''}</button>
    </> : <form class="col" onSubmit={(e) => { e.preventDefault(); if (!custom.name.trim()) return; onPick({ key: 'custom', name: custom.name.trim(), amount: 0, unit: custom.unit }); close(); }}>
      <label class="f">Name<input value={custom.name} data-testid="custom-name" onInput={(e) => setCustom({ ...custom, name: e.currentTarget.value })} placeholder="e.g. Turmeric extract" /></label>
      <label class="f">Unit<input list="custom-units" value={custom.unit} data-testid="custom-unit" onInput={(e) => setCustom({ ...custom, unit: e.currentTarget.value.slice(0, 12) })} /><datalist id="custom-units">{CUSTOM_UNITS.map((u) => <option value={u} />)}</datalist></label>
      <button class="btn p" type="submit" data-testid="custom-add">Add</button></form>}
  </div></Sheet>;
}

/** one line per ingredient: amount, unit, % daily */
export function IngredientEditor({ ingr, onChange, sex }: { ingr: Ingredient[]; onChange: (l: Ingredient[]) => void; sex: Sex }) {
  const [pick, setPick] = useState(false);
  const upd = (i: number, p: Partial<Ingredient>) => onChange(ingr.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return <div class="col" data-testid="ingr-editor">
    {!ingr.length && <div class="mut sm">None yet. Add vitamins, minerals or compounds (e.g. Zinc 15 mg, Vitamin D 1000 IU, Creatine 5 g).</div>}
    {ingr.map((x, i) => { const d = NUT.get(x.key); const pct = pctRdi(x, sex); const c = toCanon(x); const units = x.key === 'custom' ? [x.unit] : unitsFor(x.key);
      const over = d?.ul && c != null && c > d.ul;
      return <div class="ingr-row" data-testid="ingr-row" data-key={x.key}>
        <div class="row between"><b class="sm">{labelOf(x)}</b><button class="btn g sm" aria-label={'Remove ' + labelOf(x)} onClick={() => onChange(ingr.filter((_, j) => j !== i))}>✕</button></div>
        <div class="row" style="gap:6px;align-items:center">
          <NumInput value={x.amount || null} onValue={(n) => upd(i, { amount: n || 0 })} aria-label={labelOf(x) + ' amount'} />
          <select aria-label={labelOf(x) + ' unit'} value={x.unit} onChange={(e) => upd(i, { unit: e.currentTarget.value })} style="max-width:96px">{units.map((u) => <option>{u}</option>)}</select>
          <span class="xs mut" style="min-width:92px;text-align:right" data-testid="ingr-pct">{pct != null ? `${pct}% daily` : d?.rdi ? '' : 'no AU reference'}</span>
        </div>
        {x.unit === 'IU' && c != null && <div class="xs mut" data-testid="ingr-conv">= {fmtAmt(c)} {d!.unit}</div>}
        {over && <div class="xs" style="color:var(--warn)" data-testid="ingr-ul">Above the upper level ({d!.ul} {d!.unit}{d!.ulNote ? `, ${d!.ulNote}` : ''}) in one dose.</div>}
      </div>; })}
    <button class="btn sm" data-testid="add-nutrient" onClick={() => setPick(true)}>+ Add nutrient</button>
    <div class="xs mut">% daily = Australian reference (NHMRC Nutrient Reference Values, adult {sex === 'female' ? 'women' : sex === 'male' ? 'men' : '— set your sex in Settings › Profile for exact values'}). Food you eat counts too.</div>
    <NutrientPicker open={pick} onClose={() => setPick(false)} have={ingr.filter((x) => x.key !== 'custom').map((x) => x.key)} onPick={(n) => onChange([...ingr, n])} />
  </div>;
}

/** today's totals from logged doses, with a gentle note when one is over the upper level */
export function DoseTotals({ t, sex }: { t: Map<string, number>; sex: Sex }) {
  const warns = ulWarnings(t); const rows = [...t].filter(([k, v]) => v > 0 && NUT.has(k));
  if (!rows.length) return null;
  return <div class="card col" data-testid="dose-totals"><b class="sm">From today's doses</b>
    <div class="xs" style="display:flex;flex-wrap:wrap;gap:4px 12px">{rows.map(([k, v]) => { const d = NUT.get(k)!; const r = rdiFor(k, sex); return <span>{d.label.split(' (')[0]} {fmtAmt(v)} {d.unit}{r ? ` (${Math.round((v / r) * 100)}%)` : ''}</span>; })}</div>
    {warns.map((w) => <div class="xs" style="color:var(--warn)" data-testid="ul-warning">⚠️ {w.label}: {fmtAmt(w.total)} {w.unit} today from doses, above the {w.kind === 'ul' ? 'upper level' : 'usual guide'} of {w.limit} {w.unit}{w.note ? ` (${w.note})` : ''}. Worth checking with your GP or pharmacist.</div>)}
  </div>;
}
