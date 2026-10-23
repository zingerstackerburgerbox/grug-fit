import { vibrate } from './util';
type S = { end: number; total: number } | null;
let state: S = JSON.parse(localStorage.getItem('rest') || 'null');
const ls = new Set<() => void>();
let timer: any;
const save = () => { localStorage.setItem('rest', JSON.stringify(state)); ls.forEach((l) => l()); arm(); };
function arm() {
  clearTimeout(timer);
  if (!state) return;
  const ms = state.end - Date.now();
  if (ms <= 0) { state = null; save(); return; }
  timer = setTimeout(async () => {
    if (localStorage.getItem('vibrate') !== '0') vibrate([300, 120, 300, 120, 300]);
    try {
      if (document.visibilityState === 'hidden' && Notification.permission === 'granted') (await navigator.serviceWorker.ready).showNotification('Rest over', { body: 'Time for your next set 💪', tag: 'rest', icon: 'icon-192.png' });
    } catch {}
    state = null; save();
  }, ms);
}
arm();
export const rest = {
  get: () => state,
  start(sec: number) { state = { end: Date.now() + sec * 1000, total: sec }; save(); },
  add(sec: number) { if (state) { state = { end: state.end + sec * 1000, total: Math.max(1, state.total + sec) }; if (state.end <= Date.now()) state = null; save(); } },
  stop() { state = null; save(); },
  sub(l: () => void) { ls.add(l); return () => { ls.delete(l); }; }
};
