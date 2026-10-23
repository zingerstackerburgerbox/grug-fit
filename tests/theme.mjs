// v1.9.1 e2e: Settings › Appearance – modes (Dark/Light/AMOLED/System), accent presets + custom picker, live apply,
// readable button text, theme-color meta, persisted across reloads, carried in Backup (export → restore elsewhere), screenshots.
import { chromium, devices } from 'playwright'; import { readFileSync } from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const b = await chromium.launch(); const opts = { ...devices['Pixel 7'], colorScheme: 'dark', locale: 'en-AU', timezoneId: 'Australia/Sydney' };
const OFF_SEASON = new Date('2026-06-15T12:00:00+10:00'); // v1.9.3: outside the Halloween season so the plain defaults apply
const ctx = await b.newContext(opts); await ctx.clock.setFixedTime(OFF_SEASON); const page = await ctx.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', (e) => fail('pageerror ' + e.message)); page.on('dialog', (d) => d.accept());
const state = (p = page) => p.evaluate(() => { const cs = getComputedStyle(document.documentElement); const btn = document.querySelector('.btn.p'); const bs = btn && getComputedStyle(btn);
  return { mode: document.documentElement.dataset.mode || 'dark', acc: cs.getPropertyValue('--acc').trim(), bg: getComputedStyle(document.body).backgroundColor, meta: document.querySelector('meta[name=theme-color]')?.content,
    btnBg: bs?.backgroundColor, btnFg: bs?.color, ls: localStorage.getItem('theme') }; });
const lum = (s) => { const [r, g, bb] = s.match(/\d+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bb; };
const cr = (a, c) => { const x = lum(a), y = lum(c); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const stored = () => page.evaluate(async () => { const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); }); const s = await new Promise((r) => { const q = d.transaction('kv').objectStore('kv').get('settings'); q.onsuccess = () => r(q.result); }); d.close(); return s.theme; });
const gotoAppearance = async (p = page) => { await p.goto(BASE + '#/settings'); await p.waitForSelector('[data-testid=appearance]'); await p.locator('[data-testid=appearance]').scrollIntoViewIfNeeded(); };

await page.goto(BASE); await page.fill('[data-testid=ob-username]', 'grug_tester').then(() => page.click('[data-testid=ob-next]')).then(() => page.click('[data-testid=ob-skip]')); await page.waitForSelector("text=Today's nutrition");
await page.evaluate(async () => { const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); });
  const put = (st, v) => new Promise((r) => { const q = d.transaction(st, 'readwrite').objectStore(st).put(v); q.onsuccess = r; });
  const t = new Date(); const ymd = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  const e = (id, meal, name, kcal, protein, carbs, fat) => put('diary', { id, date: ymd, meal, foodId: 'f' + id, name, grams: 100, qty: 1, serving: '100 g', n: { kcal, protein, carbs, fat, fibre: 4 }, created: Date.now() });
  await e('d1', 'breakfast', 'Oats with milk', 420, 18, 62, 10); await e('d2', 'lunch', 'Chicken & rice', 640, 52, 70, 14); await e('d3', 'snacks', 'Greek yoghurt', 180, 17, 12, 6);
  await put('bodyweight', { id: 'bw1', date: ymd, kg: 82 });
  for (let i = 1; i <= 4; i++) { const st = Date.now() - i * 2 * 864e5; await put('workouts', { id: 'w' + i, name: i % 2 ? 'Push day' : 'Pull day', start: st, end: st + 3600e3, exercises: [{ id: 'x' + i, exerciseId: 'ex001', restSec: 90, sets: [1, 2, 3].map((k) => ({ id: `s${i}${k}`, type: 'normal', kg: 60 + i * 2.5, reps: 8, done: true, doneAt: st + k * 600e3 })) }] }); }
  d.close(); });
let s = await state(); log('default:', s.mode, s.acc, s.bg, 'meta', s.meta); if (s.mode !== 'dark' || s.acc !== '#22c55e' || s.meta !== '#0f1115') fail('default theme');
await gotoAppearance(); await page.evaluate(() => { const h = [...document.querySelectorAll('h2')].find((x) => x.textContent === 'Appearance'); h.scrollIntoView(); scrollBy(0, -60); });
await page.waitForTimeout(200); await page.screenshot({ path: 'screenshots/70-appearance-default.png' });
// Light + Blue, applied instantly (live preview, no save button)
await page.click('[data-testid=appearance] .seg >> text=Light'); await page.click('[data-testid=swatch-blue]'); await page.waitForTimeout(250);
s = await state(); log('Light + Blue:', s.mode, s.acc, 'bg', s.bg, 'meta', s.meta, 'button', s.btnBg, 'on', s.btnFg, cr(s.btnBg, s.btnFg).toFixed(1) + ':1');
if (s.mode !== 'light' || s.acc !== '#3b82f6' || s.bg !== 'rgb(244, 245, 247)' || s.meta !== '#f4f5f7' || s.btnBg !== 'rgb(59, 130, 246)') fail('light+blue applied');
if (cr(s.btnBg, s.btnFg) < 4.5) fail('button text contrast');
const st = await stored(); log('stored in settings:', JSON.stringify(st), '· localStorage:', s.ls); if (st?.mode !== 'light' || st?.accent !== '#3b82f6' || !s.ls?.includes('#3b82f6')) fail('persisted');
await page.waitForTimeout(100); await page.screenshot({ path: 'screenshots/71-appearance-light-blue.png' });
// reload → painted with the stored theme before the app renders
await page.reload(); const early = await page.evaluate(() => document.documentElement.dataset.mode); await page.waitForSelector('[data-testid=appearance]');
s = await state(); log('after reload:', early, s.mode, s.acc); if (s.mode !== 'light' || s.acc !== '#3b82f6') fail('survives reload');
await page.goto(BASE); await page.waitForSelector("text=Today's nutrition"); await page.waitForTimeout(400); await page.screenshot({ path: 'screenshots/72-home-light-blue.png' });
// AMOLED + Orange
await gotoAppearance(); await page.click('[data-testid=appearance] .seg >> text=AMOLED'); await page.click('[data-testid=swatch-orange]'); await page.waitForTimeout(250);
s = await state(); log('AMOLED + Orange:', s.mode, s.acc, s.bg, s.meta, 'button text', s.btnFg, cr(s.btnBg, s.btnFg).toFixed(1) + ':1');
if (s.mode !== 'amoled' || s.bg !== 'rgb(0, 0, 0)' || s.meta !== '#000000' || s.acc !== '#f97316' || cr(s.btnBg, s.btnFg) < 4.5) fail('amoled+orange');
await page.goto(BASE); await page.waitForSelector("text=Today's nutrition"); await page.waitForTimeout(400); await page.screenshot({ path: 'screenshots/73-home-amoled-orange.png' });
// custom colour (dark navy → white button text) + every preset keeps readable button text
await gotoAppearance(); await page.click('[data-testid=appearance] .seg >> text=Dark');
await page.locator('[data-testid=accent-custom]').evaluate((el) => { el.value = '#1e3a8a'; el.dispatchEvent(new Event('input', { bubbles: true })); }); await page.waitForTimeout(250);
s = await state(); log('custom #1e3a8a:', s.acc, 'button text', s.btnFg, cr(s.btnBg, s.btnFg).toFixed(1) + ':1'); if (s.acc !== '#1e3a8a' || s.btnFg !== 'rgb(255, 255, 255)') fail('custom colour + light ink');
if (!(await page.textContent('[data-testid=appearance]')).includes('Custom #1e3a8a')) fail('custom label');
for (const n of ['green', 'blue', 'purple', 'orange', 'red', 'pink', 'teal', 'yellow']) { await page.click(`[data-testid=swatch-${n}]`); await page.waitForTimeout(60); const x = await state(); if (cr(x.btnBg, x.btnFg) < 4.5) fail('contrast ' + n); }
log('all 8 presets: button text ≥ 4.5:1');
// System follows the OS live
await page.click('[data-testid=swatch-purple]'); await page.click('[data-testid=appearance] .seg >> text=System'); await page.waitForTimeout(200);
const sysDark = (await state()).mode; await page.emulateMedia({ colorScheme: 'light' }); await page.waitForTimeout(250); const sysLight = await state();
log('System: OS dark →', sysDark, '· OS light →', sysLight.mode, 'meta', sysLight.meta); if (sysDark !== 'dark' || sysLight.mode !== 'light' || sysLight.meta !== '#f4f5f7') fail('system mode');
await page.goto(BASE + '#/workouts'); await page.waitForTimeout(500); await page.screenshot({ path: 'screenshots/74-workouts-system-light-purple.png' });
await page.goto(BASE + '#/food'); await page.waitForTimeout(500); await page.screenshot({ path: 'screenshots/75-food-system-light-purple.png' });
// Backup carries the theme → restore on a fresh device
await page.goto(BASE + '#/settings'); await page.waitForSelector('text=Export all data');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Export all data')]); const file = await dl.path();
const bj = JSON.parse(readFileSync(file, 'utf8')); const bt = (bj.data.kv || []).find((r) => r.id === 'settings' || r.key === 'settings')?.theme; log('theme in backup:', JSON.stringify(bt)); if (bt?.mode !== 'system' || bt?.accent !== '#a855f7') fail('backup has theme');
const ctx2 = await b.newContext(opts); await ctx2.clock.setFixedTime(OFF_SEASON); const p2 = await ctx2.newPage(); p2.on('dialog', (d) => d.accept()); p2.on('pageerror', (e) => fail('pageerror2 ' + e.message));
await p2.goto(BASE); await p2.fill('[data-testid=ob-username]', 'grug_tester').then(() => p2.click('[data-testid=ob-next]')).then(() => p2.click('[data-testid=ob-skip]')); await p2.waitForSelector("text=Today's nutrition"); await p2.goto(BASE + '#/settings'); await p2.waitForSelector('text=Import (replace)');
const [fc] = await Promise.all([p2.waitForEvent('filechooser'), p2.click('text=Import (replace)')]); await fc.setFiles(file); await p2.waitForTimeout(800);
const s2 = await state(p2); log('fresh device after restore:', s2.mode, s2.acc, s2.ls); if (s2.acc !== '#a855f7' || !s2.ls?.includes('system')) fail('restore applies theme');
await ctx2.close();
// reset
await page.goto(BASE + '#/settings'); await page.click('[data-testid=theme-reset]'); await page.waitForTimeout(200); s = await state(); if (s.mode !== 'dark' || s.acc !== '#22c55e') fail('reset'); log('reset → Dark, Green');
await b.close(); if (failed) { console.error(failed + ' FAILURES'); process.exit(1); } console.log('THEME TESTS PASSED');
