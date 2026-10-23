/**
 * v1.9.1 Appearance: accent colour (8 presets + custom) and mode (Dark / Light / AMOLED black / System).
 * Everything is CSS variables (style.css): theme.ts sets --acc plus two derived colours that keep text readable:
 *  --acc-ink  text/icons ON accent backgrounds (buttons, ticks): white or a very dark shade, whichever contrasts more
 *  --acc-text accent-coloured text on the page: the accent, nudged toward the text colour until it reaches 4.5:1
 * Stored in settings (so it is in backups) and mirrored to localStorage so the right theme paints before the app loads.
 */
export type ThemeMode = 'dark' | 'light' | 'amoled' | 'system';
export type Theme = { mode: ThemeMode; accent: string };
export const PRESETS: [string, string][] = [['Green', '#22c55e'], ['Blue', '#3b82f6'], ['Purple', '#a855f7'], ['Orange', '#f97316'], ['Red', '#ef4444'], ['Pink', '#ec4899'], ['Teal', '#14b8a6'], ['Yellow', '#eab308']];
export const DEFAULT_THEME: Theme = { mode: 'dark', accent: '#22c55e' };
export const MODES: [ThemeMode, string][] = [['dark', 'Dark'], ['light', 'Light'], ['amoled', 'AMOLED'], ['system', 'System']];
const BG: Record<'dark' | 'light' | 'amoled', { page: string; card: string; fg: string }> = {
  dark: { page: '#0f1115', card: '#171a21', fg: '#e8eaed' }, light: { page: '#f4f5f7', card: '#ffffff', fg: '#14181f' }, amoled: { page: '#000000', card: '#0c0d10', fg: '#e8eaed' } };

export const normHex = (h: string) => { const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((h || '').trim()); if (!m) return null; const x = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]; return '#' + x.toLowerCase(); };
const rgb = (h: string) => { const x = normHex(h)!; return [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16)); };
const hex = (c: number[]) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
export const mix = (a: string, b: string, t: number) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
export const luminance = (h: string) => { const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a: string, b: string) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

export const resolveMode = (m: ThemeMode, prefersLight = typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches): 'dark' | 'light' | 'amoled' => (m === 'system' ? (prefersLight ? 'light' : 'dark') : m);
/** readable text on the accent: white, or the accent darkened to near-black */
export const inkOn = (acc: string) => { const dark = mix(acc, '#000000', 0.86); return contrast(acc, '#ffffff') >= contrast(acc, dark) ? '#ffffff' : dark; };
/** accent as text on this mode's backgrounds (checked against page and card colours), ≥ 4.5:1 */
export function accentText(acc: string, mode: 'dark' | 'light' | 'amoled') {
  const b = BG[mode]; let c = acc;
  for (let t = 0.05; t <= 1.0001 && Math.min(contrast(c, b.page), contrast(c, b.card)) < 4.5; t += 0.05) c = mix(acc, b.fg, t);
  return c;
}
export const themeOf = (t?: Partial<Theme> | null): Theme => ({ mode: (MODES.some(([m]) => m === t?.mode) ? t!.mode : 'dark') as ThemeMode, accent: normHex(t?.accent || '') || DEFAULT_THEME.accent });

let cur: Theme = DEFAULT_THEME; let mq: MediaQueryList | null = null;
export function applyTheme(t0?: Partial<Theme> | null) {
  const t = themeOf(t0); cur = t; const mode = resolveMode(t.mode); const r = document.documentElement;
  if (mode === 'dark') delete r.dataset.mode; else r.dataset.mode = mode;
  r.style.setProperty('--acc', t.accent); r.style.setProperty('--acc-ink', inkOn(t.accent)); r.style.setProperty('--acc-text', accentText(t.accent, mode));
  let meta = document.querySelector('meta[name=theme-color]') as HTMLMetaElement | null;
  if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
  meta.content = BG[mode].page;
  try { localStorage.setItem('theme', JSON.stringify(t)); } catch {}
  if (!mq && typeof matchMedia !== 'undefined') { mq = matchMedia('(prefers-color-scheme: light)'); mq.addEventListener?.('change', () => { if (cur.mode === 'system') applyTheme(cur); }); }
  return { ...t, resolved: mode };
}
/** before first render: last theme used on this device */
export function initTheme() { let t: any = null; try { t = JSON.parse(localStorage.getItem('theme') || 'null'); } catch {} applyTheme(t); }
