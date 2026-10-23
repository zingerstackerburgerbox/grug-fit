import { useState } from 'preact/hooks';
import { all, put } from '../db';
import { useQuery } from '../hooks';
import { MUSCLES, EQUIPMENT } from '../seed';
import type { Exercise } from '../types';
import { Sheet, toast } from '../ui';
import { uid } from '../util';
import { ExThumb } from '../exviz/ExViz';
import { GENERIC_MUSCLES } from '../exviz/defs';

export function useExercises() { return useQuery(() => all<Exercise>('exercises').then((l) => l.sort((a, b) => a.name.localeCompare(b.name))), [], []) as Exercise[]; }

export function ExerciseFilter({ list, onPick, selected, multi }: { list: Exercise[]; onPick: (e: Exercise) => void; selected?: Set<string>; multi?: boolean }) {
  const [q, setQ] = useState(''); const [m, setM] = useState('');
  const ql = q.toLowerCase().trim();
  const f = list.filter((e) => (!m || e.muscle === m) && (!ql || ql.split(/\s+/).every((w) => (e.name + ' ' + e.equipment + ' ' + e.muscle).toLowerCase().includes(w))));
  return <div class="col">
    <input type="search" placeholder="Search exercises" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
    <div class="chips"><button class={'chip ' + (!m ? 'on' : '')} onClick={() => setM('')}>All</button>{MUSCLES.filter((x) => list.some((e) => e.muscle === x)).map((x) => <button class={'chip ' + (m === x ? 'on' : '')} onClick={() => setM(x)}>{x}</button>)}</div>
    <div class="list">{f.map((e) => <button class="item" onClick={() => onPick(e)} style="gap:10px">
      <ExThumb ex={e} size={48} /><div class="grow" style="min-width:0"><div class="b ell">{e.name}</div><div class="mut sm">{e.muscle} · {e.equipment}{e.custom ? ' · custom' : ''}</div></div>
      {multi && <span class={'check ' + (selected?.has(e.id) ? 'on' : '')} style="display:inline-flex;align-items:center;justify-content:center">✓</span>}
    </button>)}{!f.length && <div class="empty">No exercises match. Create a custom one below.</div>}</div>
  </div>;
}

export function CustomExerciseForm({ onSaved, initial }: { onSaved: (e: Exercise) => void; initial?: Exercise }) {
  const [name, setName] = useState(initial?.name || ''); const [muscle, setMuscle] = useState(initial?.muscle || 'Chest'); const [eq, setEq] = useState(initial?.equipment || 'Barbell');
  const [icon, setIcon] = useState<string>(initial?.icon || '');
  return <div class="col">
    <label class="f">Name<input value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="e.g. Landmine Press" /></label>
    <div class="grid2"><label class="f">Muscle group<select value={muscle} onChange={(e) => setMuscle(e.currentTarget.value)}>{MUSCLES.map((m) => <option>{m}</option>)}</select></label>
      <label class="f">Equipment<select value={eq} onChange={(e) => setEq(e.currentTarget.value)}>{EQUIPMENT.map((m) => <option>{m}</option>)}</select></label></div>
    <div class="f">Picture<div class="iconpick" data-testid="iconpick">{['', ...GENERIC_MUSCLES.map((m) => 'g:' + m)].map((ic) => <button type="button" class={icon === ic ? 'on' : ''} onClick={() => setIcon(ic)} aria-label={ic ? `Picture: ${ic.slice(2)}` : 'Picture: automatic'} aria-pressed={icon === ic}>
      <ExThumb ex={{ name, muscle, equipment: eq, custom: true, icon: ic || undefined }} size={52} /><div class="ell">{ic ? ic.slice(2) : 'Auto'}</div></button>)}</div>
      <span class="mut xs">Auto picks a picture from the muscle group; equipment is drawn in the figure's hands.</span></div>
    <button class="btn p" disabled={!name.trim()} onClick={async () => { const ex: Exercise = { id: initial?.id || 'cx' + uid(), name: name.trim(), muscle, equipment: eq, custom: true, icon: icon || undefined }; await put('exercises', ex); toast('Exercise saved'); onSaved(ex); }}>Save exercise</button>
  </div>;
}

export function ExercisePicker({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (ids: string[]) => void }) {
  const list = useExercises(); const [sel, setSel] = useState<string[]>([]); const [custom, setCustom] = useState(false);
  const close = () => { setSel([]); setCustom(false); onClose(); };
  return <Sheet open={open} onClose={close} title={custom ? 'New custom exercise' : 'Add exercises'}>
    {custom ? <CustomExerciseForm onSaved={(e) => { setSel([...sel, e.id]); setCustom(false); }} /> : <>
      <ExerciseFilter list={list} multi selected={new Set(sel)} onPick={(e) => setSel(sel.includes(e.id) ? sel.filter((x) => x !== e.id) : [...sel, e.id])} />
      <div style="position:sticky;bottom:-20px;background:var(--bg2);padding:10px 0" class="row">
        <button class="btn" onClick={() => setCustom(true)}>+ Custom</button>
        <button class="btn p grow" disabled={!sel.length} onClick={() => { onAdd(sel); close(); }}>Add {sel.length || ''} exercise{sel.length === 1 ? '' : 's'}</button>
      </div></>}
  </Sheet>;
}
