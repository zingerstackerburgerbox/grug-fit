import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Exercise } from '../types';
import { defFor, genericDef } from './defs';
import { renderSvg, type Def } from './rig';

const cache = new Map<string, string>();
const keyOf = (ex: Pick<Exercise, 'name' | 'muscle' | 'equipment' | 'icon' | 'custom'>) => `${ex.custom ? 'c' : 'b'}|${ex.name}|${ex.muscle}|${ex.equipment}|${ex.icon || ''}`;
export function thumbSvg(ex: Pick<Exercise, 'name' | 'muscle' | 'equipment' | 'icon' | 'custom'>) {
  const k = keyOf(ex); let s = cache.get(k);
  if (!s) { const d = defFor(ex); s = renderSvg(d, d.thumb ?? 0, { title: ex.name, fit: true }); cache.set(k, s); }
  return s;
}
/** Static start-pose thumbnail. */
export function ExThumb({ ex, size = 44, onClick }: { ex?: Pick<Exercise, 'name' | 'muscle' | 'equipment' | 'icon' | 'custom'> | null; size?: number; onClick?: (e: Event) => void }) {
  if (!ex) return <span class="exthumb" style={`width:${size}px;height:${size}px`} />;
  const html = thumbSvg(ex);
  return onClick
    ? <button type="button" class="exthumb tap" style={`width:${size}px;height:${size}px`} onClick={onClick} aria-label={`Show how to do ${ex.name}`} dangerouslySetInnerHTML={{ __html: html }} />
    : <span class="exthumb" style={`width:${size}px;height:${size}px`} dangerouslySetInnerHTML={{ __html: html }} />;
}
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Animated loop (rAF, ~2 s), paused when offscreen / tab hidden; reduced-motion shows start and end poses side by side. */
export function ExAnim({ ex, def: def0, size = 220 }: { ex?: Pick<Exercise, 'name' | 'muscle' | 'equipment' | 'icon' | 'custom'>; def?: Def; size?: number }) {
  const def = useMemo(() => def0 || (ex ? defFor(ex) : genericDef('Other', 'Bodyweight')), [def0, ex && keyOf(ex)]);
  const ref = useRef<HTMLDivElement>(null); const [rm] = useState(reduced);
  useEffect(() => {
    const el = ref.current; if (!el || rm) return;
    let raf = 0, visible = true, t0 = performance.now(); const dur = (def.dur || (def.keys.length > 2 ? 3.2 : 2.2)) * 1000;
    const tick = (now: number) => { raf = 0; if (!visible || document.hidden) return; const p = def.hold ? ((now - t0) % 4000) / 4000 : ((now - t0) % dur) / dur; el.innerHTML = renderSvg(def, p, { title: ex?.name }); el.dataset.phase = p.toFixed(2); raf = requestAnimationFrame(tick); };
    const start = () => { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(tick); };
    const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); if (visible) start(); }) : null; io?.observe(el);
    const vis = () => start(); document.addEventListener('visibilitychange', vis); start();
    return () => { if (raf) cancelAnimationFrame(raf); io?.disconnect(); document.removeEventListener('visibilitychange', vis); };
  }, [def, rm]);
  if (rm) return <div class="exanim rm" data-testid="exanim" style="display:flex;gap:8px;justify-content:center">
    <div style={`width:${size * 0.48}px;height:${size * 0.48}px`} dangerouslySetInnerHTML={{ __html: renderSvg(def, 0, { title: (ex?.name || '') + ' start' }) }} /><span class="mut" style="align-self:center">→</span>
    <div style={`width:${size * 0.48}px;height:${size * 0.48}px`} dangerouslySetInnerHTML={{ __html: renderSvg(def, 0.5, { title: (ex?.name || '') + ' end' }) }} /></div>;
  return <div ref={ref} class="exanim" data-testid="exanim" style={`width:${size}px;height:${size}px;margin:0 auto`} dangerouslySetInnerHTML={{ __html: renderSvg(def, 0, { title: ex?.name }) }} />;
}
