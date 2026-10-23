/**
 * v1.9.3 seasonal overlay (Halloween) on top of ANY theme (dark, light, AMOLED, any accent): tiny inline SVGs, no images.
 * Everything sits BEHIND the content (fixed layer at z-index -1, card corner webs at z-index -1 inside each card),
 * is pointer-events: none + aria-hidden, low opacity, and only the spiders move (gentle sway; none with prefers-reduced-motion).
 */
import { useEffect, useState } from 'preact/hooks';
import { go } from '../hooks';
import { currentTheme, seasonEndLabel, SEASONS, type Applied } from '../theme';

/** corner cobweb, origin at the top-left (mirror for other corners) */
export function webSvg(stroke = '#cdbfe6', mirror = false) {
  const R = [24, 46, 68, 90], A = [0, 22, 45, 68, 90].map((a) => (a * Math.PI) / 180);
  const pt = (r: number, a: number) => [r * Math.cos(a), r * Math.sin(a)];
  let d = A.map((a) => { const [x, y] = pt(100, a); return `M0 0L${x.toFixed(1)} ${y.toFixed(1)}`; }).join('');
  for (const r of R) for (let i = 0; i < A.length - 1; i++) {
    const [x1, y1] = pt(r, A[i]), [x2, y2] = pt(r, A[i + 1]), [cx, cy] = pt(r * 0.8, (A[i] + A[i + 1]) / 2);
    d += `M${x1.toFixed(1)} ${y1.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${d}" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"${mirror ? ' transform="translate(100 0) scale(-1 1)"' : ''}/></svg>`;
}
export function pumpkinSvg(lit = true) {
  const face = lit ? '#fde68a' : '#2a1206';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 36"><path d="M19 7c0-3 1-5 4-6" stroke="#65a30d" stroke-width="3" fill="none" stroke-linecap="round"/>` +
    `<ellipse cx="12" cy="21" rx="10" ry="12" fill="#ea580c"/><ellipse cx="28" cy="21" rx="10" ry="12" fill="#ea580c"/><ellipse cx="20" cy="21" rx="10" ry="13" fill="#f97316"/>` +
    `<path d="M11 17l5-4 1 6zM29 17l-5-4-1 6z" fill="${face}"/><path d="M10 25l3 3 3-3 4 3 4-3 3 3 3-3c-2 6-18 6-20 0z" fill="${face}"/></svg>`;
}
const spider = (c: string) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g stroke="' + c + '" stroke-width="1.3" fill="none" stroke-linecap="round">' +
  '<path d="M9 12L4 9 2 5M9 14L3 13 1 10M9 15L3 17 1 21M10 16L6 20 5 23M15 12l5-3 2-4M15 14l6-1 2-3M15 15l6 2 2 4M14 16l4 4 1 3"/></g>' +
  '<ellipse cx="12" cy="15" rx="3.6" ry="4.4" fill="' + c + '"/><circle cx="12" cy="9.6" r="2.4" fill="' + c + '"/><circle cx="11.1" cy="9.3" r=".6" fill="#84cc16"/><circle cx="12.9" cy="9.3" r=".6" fill="#84cc16"/></svg>';
const uri = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
let cssDone = false;
/** CSS variables used by style.css (card corner webs, background pattern) */
export function installSeasonCss() {
  if (cssDone || typeof document === 'undefined') return; cssDone = true; const r = document.documentElement.style;
  // light grey-lilac on dark backgrounds, dark plum on light ones (style.css picks per mode); pumpkins are orange in both
  for (const [k, c] of [['', '#cdbfe6'], ['-d', '#3b2a4f']] as const) {
    r.setProperty('--hw-web-tr' + k, uri(webSvg(c, true))); r.setProperty('--hw-web-tl' + k, uri(webSvg(c))); r.setProperty('--hw-spider' + k, uri(spider(c))); r.setProperty('--hw-thread' + k, c);
  }
  r.setProperty('--hw-pumpkin', uri(pumpkinSvg(true)));
  // faint pattern tile: two small pumpkins (26 px / 18 px) in a 180 px tile
  const inner = (x: number, y: number, w: number) => pumpkinSvg(true).replace('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 36">', `<svg x="${x}" y="${y}" width="${w}" height="${w * 0.9}" viewBox="0 0 40 36">`);
  r.setProperty('--hw-tile', uri(`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180">${inner(30, 40, 26)}${inner(120, 128, 18)}</svg>`));
}

export const useAppliedTheme = () => { const [t, setT] = useState<Applied | null>(currentTheme());
  useEffect(() => { const f = (e: any) => setT(e.detail); addEventListener('grug-theme', f); setT(currentTheme()); return () => removeEventListener('grug-theme', f); }, []); return t; };

/** fixed background layer: corner webs, dangling spiders, a few jack-o'-lanterns, faint pumpkin pattern */
export function SeasonDecor() {
  const t = useAppliedTheme(); if (t?.season?.id !== 'halloween') return null; installSeasonCss();
  const spiders: [string, number, number][] = [['left:1px', 70, 6.5], ['right:1px', 150, 8], ['right:1px', 330, 7.2]] // side gutters only: never over text;
  return <div class="hw-layer" aria-hidden="true" data-testid="season-decor">
    <i class="hw-vignette" /><i class="hw-pattern" />
    <i class="hw-web tl" /><i class="hw-web tr" /><i class="hw-web bl" /><i class="hw-web br" />
    {spiders.map(([pos, len, dur], i) => <i class="hw-spider" style={`${pos};--len:${len}px;animation-duration:${dur}s;animation-delay:-${i * 1.7}s`} />)}
    <i class="hw-pumpkin" style="left:4%" /><i class="hw-pumpkin big" style="left:calc(50% - 15px)" /><i class="hw-pumpkin" style="right:4%" />
  </div>;
}

/** first time the seasonal default shows: tiny dismissible notice with a "Change" link (once per season per device) */
export function SeasonNotice() {
  const t = useAppliedTheme(); const se = SEASONS.find((x) => x.id === 'halloween')!; const key = `season-seen-${se.id}-${new Date().getFullYear()}`;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!t?.season || localStorage.getItem(key)) return;
    localStorage.setItem(key, '1'); setOpen(true); const h = setTimeout(() => setOpen(false), 12000); return () => clearTimeout(h);
  }, [t?.season?.id]);
  if (!open) return null;
  return <div class="season-notice" role="status" data-testid="season-notice">
    <span>Happy Halloween {se.emoji} — theme on until {seasonEndLabel(se)}</span>
    <button class="btn g sm" onClick={() => { setOpen(false); go('/settings?appearance=1'); }} data-testid="season-change">Change</button>
    <button class="btn g sm" aria-label="Dismiss" onClick={() => setOpen(false)} data-testid="season-dismiss">✕</button>
  </div>;
}
