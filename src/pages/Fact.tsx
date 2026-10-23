import { useEffect, useState } from 'preact/hooks';
import { getSettings, put } from '../db';
import { useSettings } from '../hooks';
import { toast } from '../ui';
import { dayNumber, factFor, FACTS } from '../facts';

/** Small original line icon: a lightbulb. */
const Bulb = () => <svg class="fact-ic" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z" /></svg>;

export const setFactCard = async (factCard: 'open' | 'collapsed' | 'off') => { const s = await getSettings(); await put('kv', { ...s, factCard }); };

/** "Fitness fact of the day" on Home: same fact all day (local date), changes at midnight, walks the whole list before repeating. */
export function FactCard() {
  const s = useSettings(); const [day, setDay] = useState(dayNumber()); const [off, setOff] = useState(0);
  useEffect(() => { const t = setInterval(() => { const d = dayNumber(); if (d !== day) { setDay(d); setOff(0); } }, 60000); return () => clearInterval(t); }, [day]);
  const mode = s.factCard || 'open'; if (mode === 'off') return null;
  const f = factFor(new Date(), off);
  return <div class={'card fact' + (mode === 'collapsed' ? ' collapsed' : '')} data-testid="fact-card" data-idx={f.idx}>
    <div class="row between" style="gap:8px">
      <button type="button" class="fact-h" aria-expanded={mode !== 'collapsed'} onClick={() => setFactCard(mode === 'collapsed' ? 'open' : 'collapsed')} data-testid="fact-toggle">
        <Bulb /><b class="sm">{off ? 'Another fitness fact' : 'Fitness fact of the day'}</b><span class="pill">{f.c}</span><span class="mut xs">{mode === 'collapsed' ? '▸' : '▾'}</span></button>
      <button type="button" class="btn ic sm" aria-label="Hide fitness facts" data-testid="fact-hide" onClick={async () => { await setFactCard('off'); toast('Fitness facts hidden — turn back on in Settings'); }}>✕</button></div>
    {mode !== 'collapsed' && <>
      <div class="fact-t" data-testid="fact-text">{f.t}</div>
      <div class="row between" style="margin-top:8px"><span class="mut xs" data-testid="fact-src">Source: {f.s}</span>
        <span class="row" style="gap:6px">{off > 0 && <button type="button" class="btn g sm" data-testid="fact-today" onClick={() => setOff(0)}>Today's</button>}
          <button type="button" class="btn sm" data-testid="fact-next" onClick={() => setOff((o) => (o + 1) % FACTS.length)}>Another ›</button></span></div></>}
  </div>;
}
