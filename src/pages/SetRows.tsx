// v1.14.0 Hevy-style set rows shared by the live logger and Edit workout: swipe a row RIGHT (v1.14.1) to reveal a red Delete on the left
// (full swipe deletes), tap the set number for its type (W / 1 / D / F) and "Delete set", tap ✓ to complete (row tinted),
// a Previous column from last time, and "+ Add set" (copies the previous set's weight and reps).
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Settings, WSet } from '../types';
import { NumInput } from '../ui';
import { wDisp, wIn } from '../util';

export const SWIPE_OPEN = 88; // px of red Delete area shown when a row is left open
const ENGAGE = 16; // px of clearly horizontal movement before a swipe takes over (vertical scrolling is never blocked)
let closeOpen: (() => void) | null = null; // only one row open at a time

/** A row that slides right to reveal Delete on its left (v1.14.1: right-to-left swipes cross too many controls). Pointer events + `touch-action: pan-y`, so the browser keeps vertical scrolling. */
export function SwipeRow({ onDelete, children, class: cls = '', label }: { onDelete: () => void; children: any; class?: string; label: string }) {
  const row = useRef<HTMLDivElement>(null); const [dx, setDx] = useState(0); const [drag, setDrag] = useState(false); const [gone, setGone] = useState(false);
  const swiped = useRef(0);
  const g = useRef<{ id: number; x: number; y: number; base: number; on: boolean; off: boolean; prev: Element | null } | null>(null);
  useEffect(() => () => { if (closeOpen === close) closeOpen = null; }, []);
  function close() { setDx(0); if (closeOpen === close) closeOpen = null; }
  const remove = () => { setGone(true); setDx(row.current?.offsetWidth || 400); if (closeOpen === close) closeOpen = null; setTimeout(() => { onDelete(); setGone(false); setDx(0); }, 160); }; // rows are keyed by index, so reset for the set that slides into this slot
  const down = (e: PointerEvent) => {
    if (e.button > 0 || gone) return;
    if (closeOpen && closeOpen !== close) closeOpen();
    g.current = { id: e.pointerId, x: e.clientX, y: e.clientY, base: dx, on: false, off: false, prev: document.activeElement };
  };
  const move = (e: PointerEvent) => {
    const s = g.current; if (!s || s.id !== e.pointerId || s.off) return;
    if (e.pointerType === 'mouse' && e.buttons === 0) { g.current = null; return; } // button released off this row: drop the stale gesture
    const mx = e.clientX - s.x, my = e.clientY - s.y;
    if (!s.on) {
      if (Math.abs(my) > ENGAGE && Math.abs(my) > Math.abs(mx)) { s.off = true; return; } // a vertical scroll: let it be
      if (Math.abs(mx) < ENGAGE || Math.abs(mx) < Math.abs(my) * 1.5) return;
      if (mx < 0 && s.base === 0) { s.off = true; return; } // swiping left on a closed row does nothing
      s.on = true; setDrag(true); try { row.current?.setPointerCapture(e.pointerId); } catch {}
      // a swipe that started on an input must not leave it focused/selected (a tap still focuses normally)
      if (document.activeElement !== s.prev) (document.activeElement as HTMLElement | null)?.blur?.();
      getSelection()?.removeAllRanges();
    }
    e.preventDefault();
    const w = row.current?.offsetWidth || 360; setDx(Math.min(w, Math.max(0, s.base + mx)));
  };
  const up = (e: PointerEvent) => {
    const s = g.current; g.current = null; if (!s || s.id !== e.pointerId) return;
    if (!s.on) return; setDrag(false); swiped.current = Date.now();
    const w = row.current?.offsetWidth || 360; const cur = Math.min(w, Math.max(0, s.base + (e.clientX - s.x)));
    if (cur > w * 0.55) remove();
    else if (cur > SWIPE_OPEN * 0.5) { setDx(SWIPE_OPEN); if (closeOpen && closeOpen !== close) closeOpen(); closeOpen = close; }
    else close();
  };
  const cancel = () => { if (g.current?.on) { setDrag(false); close(); } g.current = null; };
  // a swipe must not also count as a tap on whatever is under the finger
  const clickCap = (e: MouseEvent) => {
    if (drag || Date.now() - swiped.current < 450) { e.preventDefault(); e.stopPropagation(); return; } // the click that ends a swipe
    if (dx !== 0) { e.preventDefault(); e.stopPropagation(); close(); } // tapping an open row closes it
  };
  return <div class={'swipe' + (gone ? ' gone' : '')} data-testid="swipe-row" data-open={dx !== 0 ? '1' : undefined}>
    <div class="swipe-del" aria-hidden={dx === 0 ? 'true' : undefined}><button type="button" tabIndex={dx === 0 ? -1 : 0} data-testid="swipe-delete" aria-label={'Delete ' + label} onClick={remove}>Delete</button></div>
    <div ref={row} class={'set-row ' + cls} style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: drag ? 'none' : undefined }}
      onPointerDown={down as any} onPointerMove={move as any} onPointerUp={up as any} onPointerCancel={cancel} onClickCapture={clickCap as any}>{children}</div>
  </div>;
}

export type SetMode = 'reps' | 'hold' | 'cardio';
export const setLabels = (sets: WSet[]) => { let n = 0; return sets.map((st) => (st.type === 'N' ? String(++n) : st.type)); };
export const TYPE_LABEL: Record<WSet['type'], string> = { W: 'Warm-up', N: 'Normal', D: 'Drop set', F: 'Failure' };

/** The set grid for one exercise. `rpe` adds the RPE column (live logger). */
export function SetTable({ sets, prev, mode, s, rpe, onUpd, onToggle, onType, onDelete, onAdd }: {
  sets: WSet[]; prev: WSet[]; mode: SetMode; s: Settings; rpe?: boolean;
  onUpd: (si: number, p: Partial<WSet>) => void; onToggle: (si: number) => void; onType: (si: number) => void; onDelete: (si: number) => void; onAdd: () => void;
}) {
  const labels = setLabels(sets); const cols = rpe ? 'c6' : 'c5';
  return <><div class={'sets ' + cols}>
    <div class="sets-h"><span>Set</span><span>Previous</span><span>{mode === 'cardio' ? 'km' : s.weightUnit}</span><span>{mode === 'hold' ? 'Sec' : mode === 'cardio' ? 'Min' : 'Reps'}</span>{rpe && <span>RPE</span>}<span>✓</span></div>
    {sets.map((st, si) => { const pv = prev[si]; const label = labels[si];
      return <SwipeRow key={st.id} class={st.done ? 'done' : ''} label={`set ${label}`} onDelete={() => onDelete(si)}>
        <button class={'stype ' + st.type} onClick={() => onType(si)} aria-label={`Set ${label} type ${TYPE_LABEL[st.type]}`} data-testid="set-num">{label}</button>
        <span class="prev" data-testid="set-prev" onClick={() => pv && onUpd(si, { kg: pv.kg, reps: pv.reps })}>{pv ? (mode === 'cardio' ? `${pv.km ?? '—'} km · ${pv.reps ?? '—'}` : `${pv.kg != null ? wDisp(pv.kg, s) : '—'} × ${pv.reps ?? '—'}`) : '—'}</span>
        {mode === 'cardio' ? <NumInput placeholder={pv?.km != null ? String(pv.km) : '0'} value={st.km ?? null} onValue={(v) => onUpd(si, { km: v })} aria-label="Distance km" />
          : <NumInput placeholder={pv?.kg != null ? String(wDisp(pv.kg, s)) : '0'} value={st.kg != null ? wDisp(st.kg, s) : null} onValue={(v) => onUpd(si, { kg: v == null ? null : wIn(v, s) })} aria-label="Weight" />}
        <NumInput int placeholder={pv?.reps != null ? String(pv.reps) : '0'} value={st.reps} onValue={(v) => onUpd(si, { reps: v })} aria-label={mode === 'hold' ? 'Seconds' : mode === 'cardio' ? 'Minutes' : 'Reps'} />
        {rpe && <NumInput placeholder="–" value={st.rpe ?? null} onValue={(v) => onUpd(si, { rpe: v == null ? null : Math.min(10, Math.max(1, v)) })} aria-label="RPE" />}
        <button class={'check ' + (st.done ? 'on' : '')} onClick={() => onToggle(si)} aria-label="Complete set" aria-pressed={st.done}>✓</button>
      </SwipeRow>; })}
  </div>
  <button class="btn sm full add-set" style="margin-top:8px" data-testid="add-set" onClick={onAdd}>+ Add set</button></>;
}
