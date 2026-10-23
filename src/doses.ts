import type { Schedule, DoseLog, Supplement } from './types';
import { parseYmd, daysBetween, ymd } from './util';
import { all } from './db';

export function scheduledOn(s: Schedule, date: string): boolean {
  if (!s.active) return false;
  if (date < s.start) return false;
  if (s.end && date > s.end) return false;
  if (s.type === 'daily') return true;
  if (s.type === 'weekdays') return s.weekdays.includes(parseYmd(date).getDay());
  if (s.type === 'interval') return daysBetween(s.start, date) % Math.max(1, s.interval) === 0;
  return false;
}
export type Slot = { key: string; schedule: Schedule; supp: Supplement; date: string; time: string; log?: DoseLog; status: 'taken' | 'missed' | 'due' | 'upcoming' };
export const slotKey = (sid: string, date: string, time: string) => `${sid}|${date}|${time}`;

export function slotsFor(date: string, schedules: Schedule[], supps: Supplement[], logs: DoseLog[], now = new Date()): Slot[] {
  const sm = new Map(supps.map((s) => [s.id, s]));
  const lm = new Map(logs.filter((l) => l.scheduleId).map((l) => [slotKey(l.scheduleId!, l.date, l.slot || ''), l]));
  const today = ymd(now); const hm = now.getHours() * 60 + now.getMinutes();
  const out: Slot[] = [];
  for (const s of schedules) {
    const supp = sm.get(s.suppId);
    if (!supp || supp.archived || !scheduledOn(s, date)) continue;
    for (const time of s.times.length ? s.times : ['']) {
      // a schedule created today shouldn't count earlier slots of today as missed
      if (s.created && date === ymd(new Date(s.created)) && time) { const c = new Date(s.created); const [h, m] = time.split(':').map(Number); if (h * 60 + m < c.getHours() * 60 + c.getMinutes() - 5) continue; }
      const key = slotKey(s.id, date, time); const log = lm.get(key);
      let status: Slot['status'];
      if (log) status = 'taken';
      else if (date < today) status = 'missed';
      else if (date > today) status = 'upcoming';
      else { const [h, m] = (time || '23:59').split(':').map(Number); status = h * 60 + m + 120 < hm ? 'missed' : h * 60 + m <= hm ? 'due' : 'upcoming'; }
      out.push({ key, schedule: s, supp, date, time, log, status });
    }
  }
  return out.sort((a, b) => a.time.localeCompare(b.time) || a.supp.name.localeCompare(b.supp.name));
}
export function adherence(slots: Slot[]) {
  const past = slots.filter((s) => s.status === 'taken' || s.status === 'missed');
  const taken = past.filter((s) => s.status === 'taken').length;
  return { taken, total: past.length, pct: past.length ? Math.round((taken / past.length) * 100) : null };
}
export async function loadDoseData() {
  const [schedules, supps, logs] = await Promise.all([all<Schedule>('schedules'), all<Supplement>('supplements'), all<DoseLog>('doselogs')]);
  return { schedules, supps, logs };
}

// ---- Reminders ----
export async function scheduleReminders() {
  try {
    if (!('serviceWorker' in navigator) || typeof Notification === 'undefined' || Notification.permission !== 'granted') return { mode: 'off' };
    const set = (await (await import('./db')).getSettings());
    if (!set.reminders) return { mode: 'off' };
    const { schedules, supps, logs } = await loadDoseData();
    const now = new Date(); const today = ymd(now);
    const tomorrow = ymd(new Date(now.getTime() + 864e5));
    const rem: { id: string; at: number; title: string; body: string }[] = [];
    for (const d of [today, tomorrow]) for (const s of slotsFor(d, schedules, supps, logs, now)) {
      if (!s.schedule.reminders || s.log || !s.time) continue;
      const [h, m] = s.time.split(':').map(Number); const at = parseYmd(d); at.setHours(h, m, 0, 0);
      if (at.getTime() <= now.getTime()) continue;
      rem.push({ id: s.key, at: at.getTime(), title: `💊 ${s.supp.name}`, body: `${s.supp.doseAmount} ${s.supp.unit} due at ${s.time}` });
    }
    const reg = await navigator.serviceWorker.ready;
    // Notification Triggers (experimental, rarely available): schedule with the OS so they fire even if app is closed.
    const TT = (window as any).TimestampTrigger;
    if (TT) {
      const existing = await reg.getNotifications({ includeTriggered: false } as any).catch(() => []);
      existing.forEach((n: any) => n.close());
      for (const r of rem) await reg.showNotification(r.title, { body: r.body, tag: r.id, icon: 'icon-192.png', showTrigger: new TT(r.at) } as any);
      return { mode: 'triggers', count: rem.length };
    }
    reg.active?.postMessage({ type: 'schedule-reminders', reminders: rem });
    // page-level fallback timers too (in case the SW is stopped while page is open)
    pageTimers.forEach(clearTimeout); pageTimers = [];
    for (const r of rem) { const ms = r.at - Date.now(); if (ms < 2 ** 31 - 1) pageTimers.push(setTimeout(() => reg.showNotification(r.title, { body: r.body, tag: r.id, icon: 'icon-192.png' }), ms)); }
    return { mode: 'sw', count: rem.length };
  } catch (e) { console.warn('reminders', e); return { mode: 'error' }; }
}
let pageTimers: any[] = [];
