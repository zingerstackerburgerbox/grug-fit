/** v1.10.0 Smart Estimate: describe (and optionally photograph) a meal, get an editable per-item calorie/macro estimate.
 *  Goes through the coach proxy's POST /estimate (prompt + strict-JSON validation + daily cap live in the Worker).
 *  The cap (EST_DAILY_CAP, 3/day for now) is enforced server-side; this file only mirrors it for the UI.
 *  Photos are downscaled in memory, sent once and never stored. */
import { getSettings } from './db';
import { proxyHeaders, proxyReady, proxyUrl } from './coach';
import type { Settings } from './types';

/** Mirror of the Worker's EST_DAILY_CAP default (server is the source of truth; raise both when a paid tier exists). */
export const EST_DAILY_CAP: number = 3;
/** 'You've used today's Smart Estimate(s). It/They reset at …' (singular only if the cap is ever 1). */
export const usedText = (resetAt?: string, cap = EST_DAILY_CAP) => cap === 1 ? `You've used today's Smart Estimate. It resets at ${resetTime(resetAt)}. You can still enter food manually.` : `You've used today's Smart Estimates. They reset at ${resetTime(resetAt)}. You can still enter food manually.`;
export type EstItem = { name: string; qty: string; grams: number; kcal: number; protein: number; carbs: number; fat: number; fibre: number };
export type EstResult = { items: EstItem[]; confidence: 'low' | 'med' | 'high'; note: string };
export type EstQuota = { remaining: number | null; cap?: number; resetAt?: string; owner?: boolean };
export type EstErrKind = 'offline' | 'network' | 'limit' | 'busy' | 'disabled' | 'setup' | 'nofood' | 'failed' | 'bad_input';
export class EstError extends Error { constructor(public kind: EstErrKind, msg: string, public resetAt?: string) { super(msg); } }

const KEY = 'estQuota';
export function readEstQuota(): EstQuota | null {
  try { const q = JSON.parse(localStorage.getItem(KEY) || 'null'); if (!q) return null; if (q.resetAt && Date.parse(q.resetAt) <= Date.now()) return null; return q; } catch { return null; }
}
const saveEstQuota = (q: EstQuota) => { localStorage.setItem(KEY, JSON.stringify(q)); dispatchEvent(new Event('est-quota')); };
const headers = (s: Settings): Record<string, string> => proxyHeaders(s);
export const resetTime = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }) : 'midnight UTC');

export async function fetchEstQuota(): Promise<EstQuota | null> {
  if (!proxyReady() || !navigator.onLine) return readEstQuota();
  try {
    const s = await getSettings(); const r = await fetch(proxyUrl() + '/status', { headers: headers(s) }); const j = await r.json();
    if (!r.ok || !j.estimate) return readEstQuota();
    const q: EstQuota = { remaining: j.owner ? null : j.estimate.remaining, cap: j.estimate.cap, resetAt: j.resetAt, owner: !!j.owner }; saveEstQuota(q); return q;
  } catch { return readEstQuota(); }
}

export async function runEstimate(input: { text: string; portion?: string; image?: string | null }, signal?: AbortSignal): Promise<EstResult> {
  const s = await getSettings();
  if (!proxyReady()) throw new EstError('setup', 'Smart Estimate is being set up.');
  if (!navigator.onLine) throw new EstError('offline', "You're offline. Smart Estimate needs an internet connection.");
  let r: Response;
  try {
    r = await fetch(proxyUrl() + '/estimate', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...headers(s) }, body: JSON.stringify({ text: input.text, portion: input.portion || '', ...(input.image ? { image: input.image } : {}) }) });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    throw new EstError(navigator.onLine ? 'network' : 'offline', navigator.onLine ? "Couldn't reach Smart Estimate. Check your connection and try again." : "You're offline. Smart Estimate needs an internet connection.");
  }
  let j: any = {}; try { j = await r.json(); } catch {}
  if (r.ok && Array.isArray(j.items)) { saveEstQuota({ remaining: j.owner ? null : j.remaining, cap: j.cap ?? undefined, resetAt: j.resetAt, owner: !!j.owner }); return { items: j.items, confidence: j.confidence, note: j.note || '' }; }
  if (r.status === 429 && (j.error === 'est_limit' || j.error === 'est_ip_limit')) {
    saveEstQuota({ remaining: 0, cap: j.cap, resetAt: j.resetAt });
    throw new EstError('limit', j.error === 'est_ip_limit' ? `Today's Smart Estimates for this network are used up. They reset at ${resetTime(j.resetAt)}. You can still enter food manually.` : usedText(j.resetAt, j.cap || EST_DAILY_CAP), j.resetAt);
  }
  if (r.status === 429) throw new EstError('busy', j.error === 'rate_limited' ? 'Too many requests in a short time. Wait a minute and try again.' : 'Smart Estimate is busy today. Try again tomorrow, or enter food manually.');
  if (r.status === 503) throw new EstError('disabled', 'Smart Estimate is switched off for now. You can still enter food manually.');
  if (r.status === 422) throw new EstError('nofood', `No food found: ${j.message || 'try describing what you ate.'}`);
  if (r.status === 400 || r.status === 413) throw new EstError('bad_input', j.message || 'Check your description or photo and try again.');
  throw new EstError('failed', (j.message || `Smart Estimate had a problem (HTTP ${r.status}).`) + (/used up/.test(j.message || '') ? '' : ' Nothing was used up – try again.'));
}

/** Downscale a photo to ≤1024 px JPEG (data URL) in memory, kept well under the Worker's 1.5 MB limit. */
export async function photoToDataUrl(file: Blob, max = 1024): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Not an image')); i.src = url; });
    const sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)); const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * sc)); c.height = Math.max(1, Math.round(img.naturalHeight * sc));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    for (const q of [0.8, 0.65, 0.5]) { const d = c.toDataURL('image/jpeg', q); if (d.length < 1_200_000) return d; }
    throw new Error('Photo too large');
  } finally { URL.revokeObjectURL(url); }
}
