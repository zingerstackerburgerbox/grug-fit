// v1.9.3 Halloween overlay: on by default during the season (15 Oct – 3 Nov, local time) on top of ANY theme (dark + light shown),
// one-tap off (remembered), first-show notice with "Change", decorations behind content + pointer-events none, reduced motion,
// date boundaries (3 Nov 23:59 on → 4 Nov 00:00 off, live at midnight), toggle hidden outside the season. Screenshots in dark + light.
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const b = await chromium.launch(); const opts = { ...devices['Pixel 7'], colorScheme: 'dark', locale: 'en-AU', timezoneId: 'Australia/Sydney' };
const T = (s) => new Date(s + '+11:00');
async function fresh(at, extra = {}) {
  const ctx = await b.newContext({ ...opts, ...extra }); await ctx.clock.setFixedTime(T(at)); const page = await ctx.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => fail('pageerror ' + e.message)); page.on('dialog', (d) => d.accept());
  await page.goto(BASE); await page.fill('[data-testid=ob-username]', 'erik_lifts'); await page.click('[data-testid=ob-next]'); await page.click('[data-testid=ob-skip]'); await page.waitForSelector("text=Today's nutrition");
  return { ctx, page };
}
const st = (page) => page.evaluate(() => { const r = document.documentElement; const sp = document.querySelector('.hw-spider'); const layer = document.querySelector('.hw-layer');
  return { season: r.dataset.season || null, mode: r.dataset.mode || 'dark', acc: getComputedStyle(r).getPropertyValue('--acc').trim(), meta: document.querySelector('meta[name=theme-color]').content,
    decor: !!layer, pe: layer && getComputedStyle(layer).pointerEvents, z: layer && getComputedStyle(layer).zIndex, anim: sp && getComputedStyle(sp).animationName, spiders: document.querySelectorAll('.hw-spider').length }; });
const seed = (page) => page.evaluate(async () => { const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); });
  const put = (s, v) => new Promise((r) => { const q = d.transaction(s, 'readwrite').objectStore(s).put(v); q.onsuccess = r; });
  const t = new Date(); const ymd = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  const e = (id, meal, name, kcal, protein, carbs, fat) => put('diary', { id, date: ymd, meal, foodId: 'f' + id, name, grams: 100, qty: 1, serving: '100 g', n: { kcal, protein, carbs, fat, fibre: 4 }, created: Date.now() });
  await e('d1', 'breakfast', 'Oats with milk', 420, 18, 62, 10); await e('d2', 'lunch', 'Chicken & rice', 640, 52, 70, 14); await e('d3', 'snacks', 'Greek yoghurt', 180, 17, 12, 6);
  await put('bodyweight', { id: 'bw1', date: ymd, kg: 82 }); await put('kv', { id: 'stepLog', days: { [ymd]: 7400 } });
  for (let i = 1; i <= 4; i++) { const s0 = Date.now() - i * 2 * 864e5; await put('workouts', { id: 'w' + i, name: i % 2 ? 'Push day' : 'Pull day', start: s0, end: s0 + 3600e3, exercises: [{ id: 'x' + i, exerciseId: 'ex001', restSec: 90, sets: [1, 2, 3].map((k) => ({ id: `s${i}${k}`, type: 'normal', kg: 60 + i * 2.5, reps: 8, done: true, doneAt: s0 + k * 600e3 })) }] }); }
  d.close(); });
// nothing decorative may sit on top of real controls/text
const covered = (page) => page.evaluate(() => [...document.querySelectorAll('button, a, input, h2, .card b, .tabs a')].filter((el) => { const r = el.getBoundingClientRect(); if (!r.width || r.top < 0 || r.bottom > innerHeight) return false;
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return top && top.closest('.hw-layer'); }).length);
const shots = async (page, tag) => {
  await page.goto(BASE); await page.waitForSelector("text=Today's nutrition"); await page.waitForTimeout(500); await page.screenshot({ path: `screenshots/95-halloween-${tag}-home.png` });
  await page.goto(BASE + '#/workouts'); await page.waitForSelector('[data-testid=steps-card]'); await page.waitForTimeout(500); await page.screenshot({ path: `screenshots/96-halloween-${tag}-workout.png` });
  await page.goto(BASE + '#/food'); await page.waitForSelector('text=Oats with milk'); await page.waitForTimeout(500); await page.screenshot({ path: `screenshots/97-halloween-${tag}-food.png` });
  const c = await covered(page); if (c) fail(`${tag}: ${c} controls covered by decorations`);
};

// ── in season, untouched user (Dark + Green): overlay on, own accent kept, notice once ──
{
  const { ctx, page } = await fresh('2026-10-24T12:00:00');
  const n = await page.textContent('[data-testid=season-notice]').catch(() => ''); log('notice:', n.trim()); if (!/Happy Halloween 🎃 — theme on until 3 Nov/.test(n)) fail('first-show notice');
  await page.screenshot({ path: 'screenshots/94-halloween-notice.png' }); await page.click('[data-testid=season-change]'); await page.waitForSelector('[data-testid=season-box]'); log('Change → Settings › Appearance');
  await seed(page); await page.goto(BASE); await page.reload(); await page.waitForSelector('[data-testid=season-decor]');
  let s = await st(page); log('24 Oct, new user:', JSON.stringify(s));
  if (s.season !== 'halloween' || s.mode !== 'dark' || s.acc !== '#22c55e' || s.meta !== '#0f1115' || s.pe !== 'none' || s.z !== '-1' || s.anim !== 'hw-sway' || s.spiders < 2) fail('overlay on top of Dark + Green');
  await page.waitForTimeout(400);
  if (await page.locator('[data-testid=season-notice]').count()) fail('notice shown twice'); else log('notice only on first show');
  await shots(page, 'dark');
  // Appearance: toggle off (remembered), on again
  await page.goto(BASE + '#/settings?appearance=1'); await page.waitForSelector('[data-testid=season-box]'); await page.waitForTimeout(300); await page.screenshot({ path: 'screenshots/98-halloween-appearance.png' });
  await page.click('[data-testid=halloween-off]'); await page.waitForTimeout(200); s = await st(page);
  const pref = await page.evaluate(async () => { const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); }); const v = await new Promise((r) => { const q = d.transaction('kv').objectStore('kv').get('settings'); q.onsuccess = () => r(q.result); }); d.close(); return v.seasonal; });
  log('turned off:', s.season, s.decor, JSON.stringify(pref)); if (s.season || s.decor || pref?.['halloween-2026'] !== 'off') fail('turn off');
  await page.reload(); await page.waitForSelector('[data-testid=season-box]'); if ((await st(page)).season) fail('off not remembered'); else log('off survives reload');
  await page.click('[data-testid=halloween-on]'); await page.waitForTimeout(200); if ((await st(page)).season !== 'halloween') fail('turn on again');
  // user with their own theme (Light + Blue): overlay stays, their theme stays, cards stay white
  await page.click('[data-testid=appearance] .seg >> text=Light'); await page.click('[data-testid=swatch-blue]'); await page.waitForTimeout(250);
  s = await st(page); const card = await page.evaluate(() => getComputedStyle(document.querySelector('.card')).backgroundColor);
  log('Light + Blue:', s.season, s.mode, s.acc, s.meta, 'card', card); if (s.season !== 'halloween' || s.mode !== 'light' || s.acc !== '#3b82f6' || s.meta !== '#f4f5f7' || card !== 'rgb(255, 255, 255)') fail('overlay over Light + Blue');
  await page.waitForTimeout(100); await page.screenshot({ path: 'screenshots/98-halloween-appearance-light.png' });
  await shots(page, 'light');
  await ctx.close();
}
// ── v1.9.2 user who had picked a theme (stored AMOLED + Pink) also gets the overlay; their theme is untouched ──
{
  const { ctx, page } = await fresh('2026-11-02T09:00:00');
  await page.evaluate(async () => { const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); }); const tx = d.transaction('kv', 'readwrite').objectStore('kv');
    const s = await new Promise((r) => { const q = tx.get('settings'); q.onsuccess = () => r(q.result); }); s.theme = { mode: 'amoled', accent: '#ec4899' }; await new Promise((r) => { const q = d.transaction('kv', 'readwrite').objectStore('kv').put(s); q.onsuccess = r; }); d.close(); });
  await page.reload(); await page.waitForSelector('[data-testid=season-decor]'); const s = await st(page); log('2 Nov, AMOLED + Pink user:', s.season, s.mode, s.acc); if (s.season !== 'halloween' || s.mode !== 'amoled' || s.acc !== '#ec4899') fail('explicit theme + overlay');
  await ctx.close();
}
// ── reduced motion: decorations stay, spiders don't move ──
{
  const { ctx, page } = await fresh('2026-10-31T20:00:00', { reducedMotion: 'reduce' }); const s = await st(page); log('reduced motion: spider animation =', s.anim); if (s.anim !== 'none' || !s.decor) fail('reduced motion'); await ctx.close();
}
// ── end of season: 3 Nov 23:59 on → 4 Nov 00:00 off (live, without reopening); toggle hidden ──
{
  const { ctx, page } = await fresh('2026-11-03T23:59:00'); let s = await st(page); log('3 Nov 23:59:', s.season); if (s.season !== 'halloween') fail('3 Nov 23:59 on');
  await ctx.clock.setFixedTime(T('2026-11-04T00:00:00')); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await page.waitForTimeout(300);
  s = await st(page); log('4 Nov 00:00 (app left open):', s.season, 'decor', s.decor, s.acc); if (s.season || s.decor || s.acc !== '#22c55e') fail('4 Nov 00:00 off');
  await page.goto(BASE + '#/settings'); await page.waitForSelector('[data-testid=appearance]'); if (await page.locator('[data-testid=season-box]').count()) fail('toggle visible after the season'); else log('4 Nov: Halloween toggle hidden');
  await ctx.close();
}
{
  const { ctx, page } = await fresh('2026-11-04T08:00:00'); const s = await st(page); if (s.season || await page.locator('[data-testid=season-notice]').count()) fail('fresh install on 4 Nov'); else log('fresh install on 4 Nov: plain theme, no notice'); await ctx.close();
}
await b.close(); if (failed) { console.error(failed + ' FAILURES'); process.exit(1); } console.log('HALLOWEEN TESTS PASSED');
