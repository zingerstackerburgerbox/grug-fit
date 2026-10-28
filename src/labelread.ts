/** v1.17.0 automated label read: a photo of the back of a supplement bottle → the dose form, for the user to check.
 *  Goes through the coach proxy's POST /supp/label (prompt + strict JSON schema live in the Worker; no daily limit for now,
 *  only a per-network hourly rate limit). The photo is downscaled on the phone, sent once and never stored. */
import { getSettings } from './db';
import { proxyHeaders, proxyReady, proxyUrl } from './coach';
import { photoToDataUrl } from './estimate';
import { NUT, toCanon, toIngredient, type Ingredient } from './nutrients';
import type { Supplement } from './types';

export type LabelIngr = { key: string; name: string; amount: number; unit: string };
export type LabelRead = { name: string; brand?: string; form?: string; serving?: { qty?: number; unit?: string; text?: string }; servingsPerContainer?: number; ingredients: LabelIngr[]; note?: string; ms?: number };
export class LabelError extends Error { constructor(public kind: 'offline' | 'setup' | 'busy' | 'bad_input' | 'nolabel' | 'failed', msg: string) { super(msg); } }
export const LABEL_MAX_PX = 1600;
const FORMS = ['Capsule', 'Tablet', 'Softgel', 'Powder', 'Liquid', 'Gummy', 'Injection', 'Other'];

export async function readLabel(file: Blob, signal?: AbortSignal): Promise<LabelRead> {
  if (!navigator.onLine) throw new LabelError('offline', "You're offline. Reading a label needs a connection.");
  if (!proxyReady()) throw new LabelError('setup', 'Label reading is being set up.');
  const image = await photoToDataUrl(file, LABEL_MAX_PX).catch((e) => { throw new LabelError('bad_input', e?.message || 'Not an image'); });
  const s = await getSettings(); let r: Response;
  try { r = await fetch(proxyUrl() + '/supp/label', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...proxyHeaders(s) }, body: JSON.stringify({ image }) }); }
  catch (e: any) { if (e?.name === 'AbortError') throw e; throw new LabelError('offline', 'Could not reach the label reader. Check your connection and try again.'); }
  let j: any = {}; try { j = await r.json(); } catch {}
  if (r.ok && j?.name !== undefined) return j as LabelRead;
  if (r.status === 429) throw new LabelError('busy', j.message || 'Too many label reads from this network in an hour. Try again later.');
  if (r.status === 422) throw new LabelError('nolabel', j.message || "Couldn't find a supplement label in that photo. Try a closer, sharper photo of the panel.");
  if (r.status === 400 || r.status === 413) throw new LabelError('bad_input', j.message || 'That photo could not be used. Try another.');
  throw new LabelError('failed', j.message || `The label read had a problem (HTTP ${r.status}). Try again.`);
}

/** the form fields a read suggests (nothing is saved until the user taps Save) */
export function applyLabel(l: LabelRead, cur: Supplement): { supp: Supplement; ingr: Ingredient[] } {
  const ingr: Ingredient[] = [];
  for (const x of l.ingredients || []) {
    if (!(x.amount > 0)) continue;
    const u = x.unit === 'mcg' ? 'µg' : x.unit;
    const i = x.key && x.key !== 'custom' && NUT.has(x.key) && toCanon({ key: x.key, amount: x.amount, unit: u }) != null ? { key: x.key, amount: x.amount, unit: u } : toIngredient(x.name || x.key, x.amount, u);
    if (!ingr.some((y) => y.key === i.key && i.key !== 'custom')) ingr.push(i);
  }
  const form = l.form && FORMS.includes(l.form) ? l.form : cur.form;
  const su = (l.serving?.unit || '').toLowerCase(); const q = l.serving?.qty || 0;
  let doseAmount = cur.doseAmount, unit = cur.unit, unitsPerDose = cur.unitsPerDose;
  if (q > 0) {
    if (/caps|softgel/.test(su)) { doseAmount = q; unit = 'capsule'; unitsPerDose = q; }
    else if (/tab|caplet/.test(su)) { doseAmount = q; unit = 'tablet'; unitsPerDose = q; }
    else if (/scoop/.test(su)) { doseAmount = q; unit = 'scoop'; unitsPerDose = q; }
    else if (/gumm/.test(su)) { doseAmount = q; unit = 'tablet'; unitsPerDose = q; }
    else if (/drop/.test(su)) { doseAmount = q; unit = 'drop'; unitsPerDose = q; }
    else if (/^(g|mg|ml)$/.test(su)) { doseAmount = q; unit = su; unitsPerDose = q; }
  }
  const note = 'Read from a label photo. Check it against the label.';
  return { supp: { ...cur, name: l.name || cur.name, brand: l.brand || cur.brand, form, doseAmount, unit, unitsPerDose, serving: l.serving?.text || cur.serving,
    servings: l.servingsPerContainer || cur.servings, stock: cur.stock, notes: cur.notes }, ingr };
}
