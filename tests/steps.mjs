// v1.9.0 Android-app features with a mocked native plugin (window.__grugNativeMock = the GrugNative Capacitor plugin):
// step permission → Home steps card + 7-day chart → step calories in burned-today (cardio workout not double-counted)
// → Settings › Step counter (goal, always-on) → backup saved natively → update banner → move-data import.
// Plus the plain web app: "Steps need the Grug Fit Android app" note + #/android download page.
import { chromium, devices } from 'playwright'; import { writeFileSync } from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const NOW = new Date('2026-10-23T18:00:00+11:00');
const b = await chromium.launch();
const MOCK = `(() => {
  const L = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime(); const st = { permission: 'prompt', alwaysOn: false, saved: [] };
  const days = { '2026-10-17': 7450, '2026-10-18': 11020, '2026-10-19': 5230, '2026-10-20': 8800, '2026-10-21': 3900, '2026-10-22': 9640, '2026-10-23': 9000 };
  const segs = [[L(23, 0), L(23, 7), 500], [L(23, 7), L(23, 7, 30), 3000], [L(23, 7, 30), L(23, 17, 45), 5500]];
  const status = () => ({ sensor: true, permission: st.permission, alwaysOn: st.alwaysOn, notifications: 'granted', readings: 40, bgReadings: 31, lastBgT: Date.now() - 9 * 60e3, lastT: Date.now(), lostReboots: 0 });
  window.__grugNativeState = st;
  window.__grugNativeMock = {
    info: async () => ({ versionName: '1.0.0', versionCode: 1, sdk: 35, device: 'Mock Pixel' }),
    stepStatus: async () => status(), requestStepPermission: async () => { st.permission = 'granted'; return status(); },
    steps: async () => st.permission === 'granted' ? { ...status(), days, segs } : { ...status(), days: {}, segs: [] },
    setAlwaysOn: async ({ enabled }) => { st.alwaysOn = enabled; return status(); }, openAppSettings: async () => {},
    saveFile: async (o) => { st.saved.push(o); return { saved: 'Downloads/' + o.name }; } };
})();`;
const mkctx = async (opts = {}) => { const c = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark', timezoneId: 'Australia/Sydney', locale: 'en-AU', ...opts }); await c.clock.install({ time: NOW }); return c; };
const helpers = (page) => ({
  idb: (src, arg) => page.evaluate(async ([src, arg]) => {
    const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); });
    const tx = (store, mode = 'readonly') => d.transaction(store, mode).objectStore(store); const p = (req) => new Promise((r, j) => { req.onsuccess = () => r(req.result); req.onerror = () => j(req.error); });
    const res = await new Function('tx', 'p', 'arg', `return (async () => { ${src} })()`)(tx, p, arg); d.close(); return res; }, [src, arg]) });
const hideToast = (page) => page.addStyleTag({ content: '.toast{display:none!important}' });

// ── in the Android app (mocked plugin) ──
{
  const ctx = await mkctx(); await ctx.addInitScript(MOCK);
  await ctx.route('https://api.github.com/repos/zingerstackerburgerbox/grug-fit/releases/latest', (r) => r.fulfill({ json: { tag_name: 'android-v1.0.1' } }));
  const page = await ctx.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', (e) => fail('pageerror ' + e.message)); page.on('dialog', (d) => d.accept());
  const { idb } = helpers(page);
  await page.goto(BASE); await page.click('[data-testid=ob-skip]'); await page.waitForSelector("text=Today's nutrition");
  log('move-data card on empty app:', await page.locator('[data-testid=move-data]').count());
  await idb(`const s = await p(tx('kv').get('settings')); s.profile = { heightCm: 180, sex: 'male', birthYear: 1990, goal: 'maintain' }; await p(tx('kv','readwrite').put(s));
    await p(tx('bodyweight','readwrite').put({ id: 'bw1', date: '2026-10-01', kg: 80 }));
    await p(tx('exercises','readwrite').put({ id: 'runx', name: 'Running', muscle: 'Cardio', equipment: 'Other', custom: true }));
    await p(tx('workouts','readwrite').put({ id: 'run1', name: 'Morning run', start: new Date(2026, 9, 23, 7).getTime(), end: new Date(2026, 9, 23, 7, 30).getTime(), exercises: [{ id: 'e', exerciseId: 'runx', restSec: 0, sets: [{ id: 's', type: 'N', km: 4, min: 30, reps: null, kg: null, done: true }] }], prs: [] }));`);
  await page.reload(); await page.waitForSelector('[data-testid=steps-allow]');
  if (await page.locator('[data-testid=install-banner]').count()) fail('install banner should be hidden in the app');
  await page.click('[data-testid=steps-allow-go]'); await page.waitForSelector('[data-testid=steps-card]');
  const today = await page.textContent('[data-testid=steps-today]'); const kc = await page.textContent('[data-testid=steps-kcal]'); const bars = await page.locator('[data-testid=steps-chart] rect').count();
  const split = await page.textContent('[data-testid=burn-split]'); const burned = await page.textContent('[data-testid=burned]');
  log('steps card:', today, '|', kc, '| bars', bars, '| burned', burned, '|', split);
  // 9,000 − 3,000 (during the logged run) − 2,000 allowance = 4,000 × 0.747 m × 0.5 × 80 kg = 120 kcal
  if (today !== '9,000' || !/\+120 kcal/.test(kc) || bars !== 7 || !/\+ 120 steps/.test(split)) fail('steps card / burned split');
  if (!(await page.textContent('[data-testid=steps-card]')).includes('3,000 steps during cardio workouts not double-counted')) fail('cardio exclusion note');
  const upd = await page.textContent('[data-testid=shell-update]').catch(() => ''); log('update banner:', upd); if (!/1\.0\.1/.test(upd)) fail('shell update banner');
  await hideToast(page); await page.evaluate(() => document.querySelector('[data-testid=shell-update]')?.remove()); await page.screenshot({ path: 'screenshots/60-app-home-steps.png' });
  // settings
  await page.click('[data-testid=steps-card]'); await page.waitForSelector('[data-testid=step-settings]'); await page.waitForTimeout(300);
  log('settings status:', await page.textContent('[data-testid=step-perm]'), '|', (await page.textContent('[data-testid=step-diag]')).slice(0, 80));
  await page.fill('[data-testid=step-goal]', '10000'); await page.click('[data-testid=step-settings] button:has-text("Save")'); await page.click('[data-testid=steps-always]'); await page.waitForTimeout(300);
  const ao = await page.evaluate(() => window.__grugNativeState.alwaysOn); log('always-on →', ao); if (!ao) fail('always-on toggle');
  await hideToast(page); await page.locator('#step-settings').scrollIntoViewIfNeeded(); await page.evaluate(() => scrollBy(0, -60)); await page.screenshot({ path: 'screenshots/61-app-settings-steps.png' });
  await page.goto(BASE + '#/'); await page.waitForSelector('[data-testid=steps-card]'); const g = await page.textContent('[data-testid=steps-card]'); if (!g.includes('/ 10,000')) fail('goal on card');
  // backup in the app → native save
  await page.goto(BASE + '#/settings'); await page.click('text=Export all data (JSON)'); await page.waitForTimeout(400);
  const saved = await page.evaluate(() => window.__grugNativeState.saved.map((x) => ({ name: x.name, n: JSON.parse(x.data).data.workouts.length })));
  const toast = await page.textContent('.toast').catch(() => ''); log('backup:', JSON.stringify(saved), '|', toast); if (saved.length !== 1 || saved[0].n !== 1 || !/Downloads\/grugfit-backup-2026-10-23\.json/.test(toast)) fail('native backup save');
  const backup = JSON.parse(await page.evaluate(() => window.__grugNativeState.saved[0].data)); writeFileSync('/tmp/grug-backup-test.json', JSON.stringify(backup));
  await ctx.close();
}
// ── move data into a fresh app install ──
{
  const ctx = await mkctx(); await ctx.addInitScript(MOCK); const page = await ctx.newPage(); page.setDefaultTimeout(15000); page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => fail('pageerror ' + e.message));
  await page.goto(BASE); await page.click('[data-testid=ob-skip]'); await page.waitForSelector('[data-testid=move-data]');
  await page.click('[data-testid=move-data] a'); await page.waitForSelector('[data-testid=move-import]'); await hideToast(page); await page.screenshot({ path: 'screenshots/62-app-move-data.png' });
  const fc = page.waitForEvent('filechooser'); await page.click('[data-testid=move-import]'); await (await fc).setFiles('/tmp/grug-backup-test.json');
  await page.waitForFunction(() => location.hash === '#/'); await page.waitForSelector("text=Today's nutrition");
  const { idb } = helpers(page); const n = await idb(`return (await p(tx('workouts').getAll())).length`); log('after move: workouts', n, '| move card', await page.locator('[data-testid=move-data]').count());
  if (n !== 1 || await page.locator('[data-testid=move-data]').count()) fail('move data import');
  await ctx.close();
}
// ── plain web app (Android Chrome) ──
{
  const ctx = await mkctx(); const page = await ctx.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', (e) => fail('pageerror ' + e.message));
  await page.goto(BASE); await page.click('[data-testid=ob-skip]'); await page.waitForSelector('[data-testid=steps-web]');
  log('web note:', (await page.textContent('[data-testid=steps-web]')).slice(0, 40));
  await page.click('[data-testid=steps-get-app]'); await page.waitForSelector('[data-testid=apk-download]');
  const href = await page.getAttribute('[data-testid=apk-download]', 'href'); log('APK link:', href); if (href !== 'https://github.com/zingerstackerburgerbox/grug-fit/releases/latest/download/grug-fit.apk') fail('apk link');
  await page.screenshot({ path: 'screenshots/63-web-android-page.png', fullPage: false });
  await page.goto(BASE + '#/settings'); await page.waitForSelector('[data-testid=step-settings-web]'); if (!(await page.locator('[data-testid=settings-get-android]').count())) fail('settings get-app link');
  await ctx.close();
}
// ── desktop / iPhone: note without a download link ──
{
  const ctx = await mkctx({ ...devices['iPhone 15'] }); const page = await ctx.newPage(); await page.goto(BASE); await page.click('[data-testid=ob-skip]'); await page.waitForSelector('[data-testid=steps-web]');
  if (await page.locator('[data-testid=steps-get-app]').count()) fail('no APK link on iPhone'); log('iPhone: note without download link'); await ctx.close();
}
await b.close();
if (failed) { console.error(failed + ' FAILURES'); process.exit(1); } console.log('STEPS TESTS PASSED');
