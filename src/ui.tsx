import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { back } from './hooks';

export function Top({ title, backBtn, right }: { title: ComponentChildren; backBtn?: boolean | (() => void); right?: ComponentChildren }) {
  return <header class="top">
    {backBtn && <button class="btn ic" aria-label="Back" onClick={() => (typeof backBtn === 'function' ? backBtn() : back())}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M15 18l-6-6 6-6" /></svg></button>}
    <h1>{title}</h1>{right}
  </header>;
}
export function Sheet({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ComponentChildren; title?: string }) {
  useEffect(() => {
    if (!open) return;
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); addEventListener('keydown', f);
    document.body.style.overflow = 'hidden';
    return () => { removeEventListener('keydown', f); document.body.style.overflow = ''; };
  }, [open]);
  if (!open) return null;
  return <div class="sheet-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
    <div class="sheet" role="dialog"><div class="grab" />{title && <h2 style="margin-top:0">{title}</h2>}{children}</div>
  </div>;
}
let toastSet: ((s: string | null) => void) | null = null;
export const toast = (s: string) => toastSet?.(s);
export function Toaster() {
  const [t, setT] = useState<string | null>(null);
  useEffect(() => { toastSet = setT; }, []);
  useEffect(() => { if (t) { const x = setTimeout(() => setT(null), 2400); return () => clearTimeout(x); } }, [t]);
  return t ? <div class="toast" role="status">{t}</div> : null;
}
export function Ring({ value, target, color, label, sub, size = 78 }: { value: number; target: number; color: string; label: string; sub?: string; size?: number }) {
  const r = size / 2 - 7, c = 2 * Math.PI * r; const p = target > 0 ? Math.min(1, value / target) : 0; const over = target > 0 && value > target * 1.05;
  return <div class="ring">
    <svg width={size} height={size}><circle cx={size / 2} cy={size / 2} r={r} stroke="#2b303b" stroke-width="8" fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke={over ? '#f59e0b' : color} stroke-width="8" fill="none" stroke-linecap="round" stroke-dasharray={`${c * p} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="48%" text-anchor="middle" fill="#e8eaed" font-size={size / 5} font-weight="700">{Math.round(value)}</text>
      <text x="50%" y="66%" text-anchor="middle" fill="#9aa1ad" font-size={size / 8.5}>/ {Math.round(target)}</text></svg>
    <span class="b">{label}</span>{sub && <span class="mut xs">{sub}</span>}
  </div>;
}
export function Bar({ value, target, color }: { value: number; target: number; color?: string }) {
  const p = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  return <div class="bar"><i style={{ width: p + '%', background: color || (p >= 100 ? '#22c55e' : p >= 50 ? '#0ea5e9' : '#64748b') }} /></div>;
}
/** Simple responsive SVG line chart */
export function LineChart({ points, color = '#22c55e', height = 160, fmtX, fmtY, target }: { points: { x: number; y: number }[]; color?: string; height?: number; fmtX?: (x: number) => string; fmtY?: (y: number) => string; target?: number }) {
  if (!points.length) return <div class="empty sm">No data yet</div>;
  const W = 340, H = height, pl = 38, pr = 10, pt = 10, pb = 22;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y).concat(target != null ? [target] : []);
  let x0 = Math.min(...xs), x1 = Math.max(...xs); if (x0 === x1) { x0 -= 1; x1 += 1; }
  let y0 = Math.min(...ys), y1 = Math.max(...ys); const padY = (y1 - y0) * 0.1 || Math.max(1, y1 * 0.1); y0 = Math.max(0, y0 - padY); y1 += padY;
  const X = (x: number) => pl + ((x - x0) / (x1 - x0)) * (W - pl - pr), Y = (y: number) => pt + (1 - (y - y0) / (y1 - y0)) * (H - pt - pb);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const ticks = [y0, (y0 + y1) / 2, y1];
  return <svg viewBox={`0 0 ${W} ${H}`} width="100%" style="display:block">
    {ticks.map((t) => <g><line x1={pl} x2={W - pr} y1={Y(t)} y2={Y(t)} stroke="#2b303b" /><text x={pl - 4} y={Y(t) + 4} fill="#9aa1ad" font-size="10" text-anchor="end">{fmtY ? fmtY(t) : Math.round(t)}</text></g>)}
    {target != null && <line x1={pl} x2={W - pr} y1={Y(target)} y2={Y(target)} stroke="#f59e0b" stroke-dasharray="4 4" />}
    <path d={d} fill="none" stroke={color} stroke-width="2.5" stroke-linejoin="round" />
    {points.map((p) => <circle cx={X(p.x)} cy={Y(p.y)} r="3.2" fill={color} />)}
    <text x={pl} y={H - 5} fill="#9aa1ad" font-size="10">{fmtX ? fmtX(points[0].x) : ''}</text>
    <text x={W - pr} y={H - 5} fill="#9aa1ad" font-size="10" text-anchor="end">{fmtX ? fmtX(points[points.length - 1].x) : ''}</text>
  </svg>;
}
export function BarChart({ bars, color = '#22c55e', height = 150, target }: { bars: { label: string; value: number; stack?: { v: number; c: string }[] }[]; color?: string; height?: number; target?: number }) {
  const W = 340, H = height, pb = 20, pt = 8; const max = Math.max(1, target || 0, ...bars.map((b) => b.value)) * 1.08;
  const bw = (W - 10) / bars.length;
  const Y = (v: number) => (v / max) * (H - pb - pt);
  return <svg viewBox={`0 0 ${W} ${H}`} width="100%" style="display:block">
    {bars.map((b, i) => {
      const x = 5 + i * bw + bw * 0.15, w = bw * 0.7;
      if (b.stack) { let acc = 0; return <g>{b.stack.map((s) => { const h = Y(s.v); const y = H - pb - acc - h; acc += h; return <rect x={x} y={y} width={w} height={Math.max(0, h)} fill={s.c} />; })}<text x={x + w / 2} y={H - 6} fill="#9aa1ad" font-size="10" text-anchor="middle">{b.label}</text></g>; }
      return <g><rect x={x} y={H - pb - Y(b.value)} width={w} height={Y(b.value)} rx="3" fill={color} /><text x={x + w / 2} y={H - 6} fill="#9aa1ad" font-size="10" text-anchor="middle">{b.label}</text></g>;
    })}
    {target != null && <line x1="0" x2={W} y1={H - pb - Y(target)} y2={H - pb - Y(target)} stroke="#f59e0b" stroke-dasharray="4 4" />}
  </svg>;
}
export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <div class="seg">{options.map(([v, l]) => <button class={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}</div>;
}
export const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
export function confirmDo(msg: string) { return window.confirm(msg); }

/** Numeric input that keeps its own text while typing (so "1." or "" aren't clobbered by re-renders) and reports parsed numbers on every keystroke. */
export function NumInput({ value, onValue, int, ...rest }: { value: number | string | null | undefined; onValue: (n: number | null) => void; int?: boolean; [k: string]: any }) {
  const str = (v: any) => (v == null || v === '' ? '' : String(v));
  const [t, setT] = useState(str(value)); const focused = useRef(false);
  useEffect(() => { if (!focused.current) setT(str(value)); }, [value]);
  return <input {...rest} inputMode={int ? 'numeric' : 'decimal'} value={t} onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; setT(str(value)); }}
    onInput={(e) => { const v = e.currentTarget.value; setT(v); const n = num(v); onValue(n != null && isNaN(n) ? null : n); }} />;
}
