/** v1.9.2: username field (onboarding, one-time prompt for existing users, Settings › Profile). On-device only. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { getSettings, put } from '../db';
import { useQuery } from '../hooks';
import { toast } from '../ui';
import { cleanUsername, usernameError } from '../username';

export async function saveUsername(v: string) { const u = cleanUsername(v); const cur = await getSettings(); await put('kv', { ...cur, username: u }); return u; }

export function UsernameField({ value, onInput, onEnter, autoFocus, tid = 'username-input' }: { value: string; onInput: (v: string) => void; onEnter?: () => void; autoFocus?: boolean; tid?: string }) {
  const ref = useRef<HTMLInputElement>(null); useEffect(() => { if (autoFocus) setTimeout(() => ref.current?.focus(), 50); }, []);
  return <input ref={ref} value={value} maxLength={24} autoCapitalize="none" autoCorrect="off" spellcheck={false} autoComplete="username" placeholder="e.g. erik_lifts" aria-label="Username"
    data-testid={tid} onInput={(e) => onInput(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter?.(); } }} />;
}
export const USERNAME_HINT = '3–20 characters: letters, numbers, _ or . Stays on this device.';

/** existing users who finished onboarding before v1.9.2: one quick, unskippable prompt */
export function UsernameGate() {
  const s = useQuery(getSettings, []); const [v, setV] = useState(''); const [err, setErr] = useState('');
  if (!s || !s.onboarded || s.username) return null;
  const save = async () => { const e = usernameError(v); if (e) return setErr(e); const u = await saveUsername(v); toast(`Hi, ${u} 👋`); };
  return <div class="modal-bg" data-testid="username-modal" role="dialog" aria-modal="true" aria-labelledby="un-h">
    <div class="modal col">
      <h2 id="un-h" style="margin:0">Add a username</h2>
      <div class="mut sm">Grug Fit now uses a username. It's only stored on this device.</div>
      <UsernameField value={v} onInput={(x) => { setV(x); setErr(''); }} onEnter={save} autoFocus />
      <div class={err ? 'sm' : 'mut xs'} style={err ? 'color:var(--bad)' : ''} data-testid="username-err">{err || USERNAME_HINT}</div>
      <button class="btn p full" onClick={save} data-testid="username-save">Save</button>
    </div>
  </div>;
}

/** Settings › Profile */
export function UsernameSetting() {
  const s = useQuery(getSettings, []); const [v, setV] = useState<string | null>(null); const [err, setErr] = useState('');
  const val = v ?? s?.username ?? '';
  const save = async () => { const e = usernameError(val); if (e) return setErr(e); await saveUsername(val); setV(null); toast('Username saved'); };
  return <div class="card col" data-testid="username-setting">
    <label class="f">Username<div class="row" style="gap:8px"><UsernameField value={val} onInput={(x) => { setV(x); setErr(''); }} onEnter={save} tid="set-username" /><button class="btn" onClick={save} data-testid="set-username-save" disabled={v == null || cleanUsername(v) === s?.username}>Save</button></div></label>
    <div class={err ? 'sm' : 'mut xs'} style={err ? 'color:var(--bad)' : ''}>{err || USERNAME_HINT}</div>
  </div>;
}
