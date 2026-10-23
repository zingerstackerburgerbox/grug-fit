import { useEffect, useRef, useState } from 'preact/hooks';
import { put, byBarcode } from '../db';
import { go, useSettings } from '../hooks';
import type { Food, Nutrients, Serving } from '../types';
import { NumInput, Top, confirmDo, toast } from '../ui';
import { MICROS, r0, r1, uid } from '../util';
import type { Crop, OcrResult } from '../ocr/ocr';
import { toPer100, type Parsed } from '../ocr/parse';

const FIELDS: { key: keyof Nutrients; label: string; unit: string }[] = [
  { key: 'kcal', label: 'Energy', unit: 'kcal' }, { key: 'protein', label: 'Protein', unit: 'g' }, { key: 'fat', label: 'Fat, total', unit: 'g' }, { key: 'satfat', label: '– saturated', unit: 'g' },
  { key: 'carbs', label: 'Carbohydrate', unit: 'g' }, { key: 'sugar', label: 'Sugars', unit: 'g' }, { key: 'fibre', label: 'Dietary fibre', unit: 'g' },
  { key: 'sodium', label: 'Sodium', unit: 'mg' }, ...MICROS.filter((m) => m.key !== 'sodium').map((m) => ({ key: m.key, label: m.label, unit: m.unit }))
];
const hp = () => new URLSearchParams(location.hash.split('?')[1] || '');

function CropBox({ crop, setCrop }: { crop: Crop; setCrop: (c: Crop) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const start = (e: PointerEvent, mode: string) => {
    e.preventDefault(); e.stopPropagation(); const box = ref.current!.parentElement!.getBoundingClientRect(); const c0 = { ...crop }; const x0 = e.clientX, y0 = e.clientY;
    const mv = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / box.width, dy = (ev.clientY - y0) / box.height; let { x, y, w, h } = c0;
      if (mode === 'move') { x = Math.min(1 - w, Math.max(0, x + dx)); y = Math.min(1 - h, Math.max(0, y + dy)); }
      if (mode.includes('l')) { const nx = Math.min(x + w - 0.08, Math.max(0, x + dx)); w += x - nx; x = nx; }
      if (mode.includes('r')) w = Math.min(1 - x, Math.max(0.08, w + dx));
      if (mode.includes('t')) { const ny = Math.min(y + h - 0.08, Math.max(0, y + dy)); h += y - ny; y = ny; }
      if (mode.includes('b')) h = Math.min(1 - y, Math.max(0.08, h + dy));
      setCrop({ x, y, w, h });
    };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  };
  return <div ref={ref} class="cropbox" style={{ left: crop.x * 100 + '%', top: crop.y * 100 + '%', width: crop.w * 100 + '%', height: crop.h * 100 + '%' }} onPointerDown={(e) => start(e as any, 'move')} data-testid="cropbox">
    {['tl', 'tr', 'bl', 'br'].map((m) => <i class={'h ' + m} onPointerDown={(e) => start(e as any, m)} />)}
  </div>;
}

export function LabelScan() {
  const s = useSettings(); const q = hp(); const barcode = q.get('barcode') || ''; const ret = q.get('ret') || ''; const hintName = q.get('name') || '';
  const [step, setStep] = useState<'pick' | 'crop' | 'reading' | 'review'>('pick');
  const [bmp, setBmp] = useState<ImageBitmap | null>(null); const [url, setUrl] = useState(''); const [crop, setCrop] = useState<Crop>({ x: 0.03, y: 0.03, w: 0.94, h: 0.94 });
  const [prog, setProg] = useState({ p: 0, s: '' }); const [res, setRes] = useState<OcrResult | null>(null); const [err, setErr] = useState('');
  const [vals, setVals] = useState<Record<string, number | null>>({}); const [touched, setTouched] = useState<Set<string>>(new Set());
  const [name, setName] = useState(hintName || (barcode ? `Product ${barcode}` : '')); const [brand, setBrand] = useState(''); const [code, setCode] = useState(barcode);
  const [ss, setSs] = useState<number | null>(null); const [ssLabel, setSsLabel] = useState('serving'); const [spp, setSpp] = useState<number | null>(null); const [liquid, setLiquid] = useState(false);
  const [style, setStyle] = useState<Parsed['style']>('AU');
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  // warm up the OCR engine while the user frames the crop
  useEffect(() => { if (step === 'crop') import('../ocr/ocr').then((m) => m.getWorker()).catch(() => {}); }, [step]);

  const onFile = async (f?: File | null) => {
    if (!f) return; setErr('');
    try { const { loadBitmap } = await import('../ocr/ocr'); const b = await loadBitmap(f); setBmp(b); setUrl(URL.createObjectURL(f)); setCrop({ x: 0.03, y: 0.03, w: 0.94, h: 0.94 }); setStep('crop'); }
    catch (e: any) { setErr('Could not open that image: ' + (e?.message || e)); }
  };
  const read = async () => {
    if (!bmp) return; setStep('reading'); setProg({ p: 0, s: 'loading OCR engine' });
    try {
      const { readLabel } = await import('../ocr/ocr');
      const r = await readLabel(bmp, crop, (p, st) => setProg({ p, s: st }));
      (window as any).__ocr = r; setRes(r);
      const v: Record<string, number | null> = {}; for (const f of FIELDS) v[f.key] = r.parsed.per100[f.key] ?? null; setVals(v); setTouched(new Set());
      setSs(r.parsed.servingSize ?? null); setSpp(r.parsed.servingsPerPack ?? null); setLiquid(r.parsed.servingUnit === 'ml'); setStyle(r.parsed.style === 'unknown' ? 'AU' : r.parsed.style);
      setStep('review');
    } catch (e: any) { setErr('Text recognition failed: ' + (e?.message || e) + (navigator.onLine ? '' : ' — the OCR engine has to be downloaded once while online (Settings → make label scanning available offline).')); setStep('crop'); }
  };
  const save = async () => {
    if (vals.kcal == null && vals.protein == null) { toast('Enter at least energy or protein'); return; }
    const per: Partial<Nutrients> = {}; for (const f of FIELDS) if (vals[f.key] != null) (per as any)[f.key] = vals[f.key];
    const per100 = { kcal: 0, protein: 0, carbs: 0, fibre: 0, fat: 0, ...toPer100({ ...(res?.parsed as Parsed), style, per100: per }) } as Nutrients;
    const servings: Serving[] = [];
    if (ss && ss > 0) servings.push({ label: ssLabel.trim() || 'serving', grams: ss, kind: 'serving' });
    if (ss && spp && spp > 0) servings.push({ label: 'package', grams: r1(ss * spp), note: `${spp} servings`, kind: 'package' });
    const bc = code.trim() || undefined;
    if (bc) { const dup = await byBarcode(bc); if (dup && !confirmDo(`Barcode ${bc} is already linked to "${dup.name}". Link it to this new food instead?`)) return; if (dup) await put('foods', { ...dup, barcode: undefined }); }
    const food: Food = { id: 'cf' + uid(), name: name.trim() || 'Scanned food', brand: brand.trim() || undefined, barcode: bc, source: 'custom', unit: liquid ? 'ml' : 'g', per100, servings };
    await put('foods', food); toast('Saved as custom food');
    if (ret) go(`/food/add/${ret}?pick=${food.id}`); else go(`/food/edit/${food.id}`);
  };
  const p = res?.parsed; const low = (k: string) => !touched.has(k) && vals[k] != null && ((p?.conf as any)?.[k] ?? 1) < 0.75 || (!touched.has(k) && p?.flagged.includes(k as any));
  const missing = (k: string) => vals[k] == null && ['kcal', 'protein', 'fat', 'carbs'].includes(k);
  const set = (k: string, v: number | null) => { setVals({ ...vals, [k]: v }); setTouched(new Set([...touched, k])); };
  const pv = (k: string) => (vals[k] != null && ss ? r1((vals[k]! * ss) / 100) : null);
  const unitBase = liquid ? 'ml' : 'g';

  return <><Top title="Scan nutrition label" backBtn /><div class="page col">
    {step === 'pick' && <>
      <div class="card sm">Take a clear, flat, well-lit photo of the <b>Nutrition Information</b> panel. Text is read on your phone — nothing is uploaded.{barcode && <> This food will be linked to barcode <b>{barcode}</b>.</>}</div>
      <label class="btn p full" style="min-height:60px;font-size:17px">📷 Take photo<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFile(e.currentTarget.files?.[0])} data-testid="label-camera" /></label>
      <label class="btn full">🖼 Choose from gallery<input type="file" accept="image/*" hidden onChange={(e) => onFile(e.currentTarget.files?.[0])} data-testid="label-file" /></label>
      {err && <div class="card sm" style="border-color:var(--warn)">{err}</div>}
    </>}
    {step === 'crop' && <>
      <div class="mut sm">Drag the box (or its corners) around the nutrition table, then tap Read.</div>
      <div class="cropwrap"><img src={url} alt="Label photo" draggable={false} /><CropBox crop={crop} setCrop={setCrop} /></div>
      {err && <div class="card sm" style="border-color:var(--warn)">{err}</div>}
      <div class="grid2"><button class="btn" onClick={() => setStep('pick')}>Retake</button><button class="btn p" onClick={read} data-testid="read-label">Read label</button></div>
    </>}
    {step === 'reading' && <div class="card col center"><b>Reading label…</b><div class="bar"><i style={{ width: Math.round(prog.p * 100) + '%' }} /></div><div class="mut xs">{prog.s} {Math.round(prog.p * 100)}%</div><div class="mut xs">First use downloads the OCR engine (~6 MB); after that it works offline.</div></div>}
    {step === 'review' && p && <div class="col" data-testid="label-review">
      {p.warnings.length > 0 && <div class="card sm col" style="border-color:var(--warn);gap:4px" data-testid="ocr-warnings">{p.warnings.map((w) => <div>⚠️ {w}</div>)}</div>}
      <div class="mut xs">Detected {p.style === 'US' ? 'US “Nutrition Facts”' : p.style === 'AU' ? 'AU/NZ “Nutrition Information”' : 'unknown'} format · <span class="lowconf-key">highlighted</span> fields are uncertain — please check them against the label.</div>
      <label class="f">Product name<input value={name} onInput={(e) => setName(e.currentTarget.value)} data-testid="label-name" /></label>
      <div class="grid2"><label class="f">Brand<input value={brand} onInput={(e) => setBrand(e.currentTarget.value)} /></label><label class="f">Barcode<input inputMode="numeric" value={code} onInput={(e) => setCode(e.currentTarget.value.replace(/\D/g, ''))} data-testid="label-barcode" /></label></div>
      <div class="grid3"><label class={'f ' + (p.flagged.includes('servingSize') || (p.conf.servingSize ?? 1) < 0.75 ? 'lowconf' : '')}>Serving size ({unitBase})<NumInput value={ss} onValue={setSs} data-testid="label-ss" /></label>
        <label class="f">Serving name<input value={ssLabel} onInput={(e) => setSsLabel(e.currentTarget.value)} /></label>
        <label class="f">Servings / pack<NumInput value={spp} onValue={setSpp} data-testid="label-spp" /></label></div>
      <label class="row sm"><input type="checkbox" style="width:24px;min-height:24px" checked={liquid} onChange={(e) => setLiquid(e.currentTarget.checked)} /> Liquid (values per 100 mL)</label>
      <div class="row between"><h3 style="margin:6px 0 0">Per 100 {unitBase}</h3><select style="width:auto;min-height:36px" value={style} onChange={(e) => setStyle(e.currentTarget.value as any)} aria-label="Label format"><option value="AU">AU/NZ label</option><option value="US">US label</option></select></div>
      <div class="mut xs">{style === 'US' ? 'US “Total Carbohydrate” includes fibre.' : 'AU/NZ “Carbohydrate” excludes fibre (net carbs); fibre is added back for total carbs.'}</div>
      <div class="grid2" data-testid="label-fields">{FIELDS.filter((f) => vals[f.key] != null || ['kcal', 'protein', 'fat', 'satfat', 'carbs', 'sugar', 'fibre', 'sodium'].includes(f.key)).map((f) =>
        <label class={'f ' + (low(f.key) ? 'lowconf' : '') + (missing(f.key) ? ' missing' : '')} data-field={f.key}>{f.label} ({f.unit}){f.key === 'kcal' && vals.kcal != null ? <span class="xs"> = {r0(vals.kcal * 4.184)} kJ</span> : ''}
          <NumInput value={vals[f.key]} onValue={(v) => set(f.key, v)} aria-label={f.label} />
          {pv(f.key) != null && <span class="xs mut">per serving: {pv(f.key)} {f.unit}</span>}</label>)}</div>
      <details class="card"><summary class="sm b">Add other nutrients</summary><div class="grid2" style="margin-top:8px">{FIELDS.filter((f) => vals[f.key] == null && !['kcal', 'protein', 'fat', 'satfat', 'carbs', 'sugar', 'fibre', 'sodium'].includes(f.key)).map((f) => <label class="f">{f.label} ({f.unit})<NumInput value={vals[f.key]} onValue={(v) => set(f.key, v)} /></label>)}</div></details>
      <details class="card"><summary class="sm b">Recognised text ({res!.pass} pass, {(res!.ms / 1000).toFixed(1)} s)</summary><pre class="xs" style="white-space:pre-wrap;margin:8px 0 0" data-testid="ocr-text">{res!.lines.map((l) => `${Math.round(l.conf)}%  ${l.text}`).join('\n')}</pre></details>
      <button class="btn p" onClick={save} data-testid="label-save">Save food{ret ? ' & log it' : ''}</button>
      <div class="grid2"><button class="btn" onClick={() => setStep('crop')}>Adjust crop</button><button class="btn" onClick={() => setStep('pick')}>Retake photo</button></div>
    </div>}
  </div></>;
}
