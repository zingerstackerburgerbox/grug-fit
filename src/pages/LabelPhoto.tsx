// v1.17.0 "Photo of label": camera or gallery → automated label read → prefill (the user reviews and taps Save).
import { useRef, useState } from 'preact/hooks';
import { LabelError, applyLabel, readLabel, type LabelRead } from '../labelread';
import { NUT } from '../nutrients';
import type { Supplement } from '../types';
import { Sheet, toast } from '../ui';

const OK_KEY = 'labelReadOk';
export function LabelPhoto({ onResult }: { onResult: (r: { read: LabelRead; apply: (cur: Supplement) => ReturnType<typeof applyLabel> }) => void }) {
  const file = useRef<HTMLInputElement>(null); const [busy, setBusy] = useState(false); const [ask, setAsk] = useState(false);
  const [res, setRes] = useState<LabelRead | null>(null); const [err, setErr] = useState('');
  const start = () => { if (localStorage.getItem(OK_KEY)) file.current?.click(); else setAsk(true); };
  const go = async (f: File | undefined) => {
    if (!f) return; setBusy(true); setErr(''); setRes(null); const t0 = performance.now();
    try { const r = await readLabel(f); setRes({ ...r, ms: r.ms ?? Math.round(performance.now() - t0) }); onResult({ read: r, apply: (cur) => applyLabel(r, cur) }); toast('Label read. Check the details'); }
    catch (e: any) { setErr(e instanceof LabelError ? e.message : 'The label read had a problem. Try again.'); }
    finally { setBusy(false); if (file.current) file.current.value = ''; }
  };
  return <>
    <button class="btn b2" data-testid="label-photo" disabled={busy} onClick={start}>{busy ? 'Reading label…' : '📷 Photo of label'}</button>
    <input ref={file} type="file" accept="image/*" style="display:none" data-testid="label-file" onChange={(e) => go(e.currentTarget.files?.[0])} />
    {(busy || res || err) && <div class="card col" style="grid-column:1/-1" data-testid="label-result">
      {busy && <div class="sm">Reading the label… this usually takes 5–20 seconds.</div>}
      {err && <div class="sm" style="color:var(--warn)" data-testid="label-error">{err}</div>}
      {res && <><div class="sm">Read <b>{res.name || 'a label'}</b>{res.brand ? ` by ${res.brand}` : ''}: {res.ingredients.length} ingredient{res.ingredients.length === 1 ? '' : 's'}{res.serving?.text ? `, serving ${res.serving.text}` : ''}{res.servingsPerContainer ? `, ${res.servingsPerContainer} servings` : ''}.</div>
        <div class="xs" data-testid="label-ingredients">{res.ingredients.map((i) => `${NUT.get(i.key)?.label.split(' (')[0] || i.name} ${i.amount} ${i.unit}`).join(' · ')}</div>
        {res.note && <div class="xs mut">{res.note}</div>}
        <div class="xs mut">Automated reads can be wrong. Check every amount against the label, then Save.</div></>}
    </div>}
    <Sheet open={ask} onClose={() => setAsk(false)} title="Automated label read"><div class="col" data-testid="label-disclaimer">
      <div class="sm">Take a clear photo of the supplement facts panel. The photo is shrunk on your phone, sent once to the Lunk coach service to read it, and not stored.</div>
      <div class="sm"><b>Automated reads can be wrong</b>: always check the name, amounts and units against the label before saving.</div>
      <button class="btn p" data-testid="label-ok" onClick={() => { localStorage.setItem(OK_KEY, String(Date.now())); setAsk(false); setTimeout(() => file.current?.click(), 50); }}>Got it, take photo</button>
    </div></Sheet>
  </>;
}
