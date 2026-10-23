// Verifies that deploying a new build updates an already-open client:
//  - safe state  -> auto reload + "Updated to vX" toast, data preserved
//  - mid-workout -> no reload, "Update ready – tap to refresh" banner; tapping it updates; workout preserved
import { chromium, devices } from 'playwright';
import { execSync, spawn } from 'child_process';
import fs from 'fs';
const ROOT = '/tmp/grugfit-update-test'; const PORT = 4174; const BASE = `http://127.0.0.1:${PORT}/`;
const log = (...a) => console.log('•', ...a); let failed = false; const fail = (m) => { console.error('FAIL:', m); failed = true; };
fs.rmSync(ROOT, { recursive: true, force: true });
for (const id of ['A', 'B', 'C']) execSync(`npx vite build --outDir ${ROOT}/${id} --emptyOutDir`, { env: { ...process.env, BUILD_ID: 'build' + id }, stdio: 'ignore' });
const deploy = (id) => { fs.rmSync(`${ROOT}/live`, { recursive: true, force: true }); fs.cpSync(`${ROOT}/${id}`, `${ROOT}/live`, { recursive: true }); log('deployed build', id); };
deploy('A');
const srv = spawn('node', ['tests/serve.mjs', `${ROOT}/live`, String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch(); const ctx = await browser.newContext({ ...devices['Pixel 7'] }); const page = await ctx.newPage(); page.setDefaultTimeout(15000);
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
const buildId = async () => { await page.goto(BASE + '#/settings'); await page.waitForSelector('[data-testid=build-id]'); return page.textContent('[data-testid=build-id]'); };
const triggerCheck = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // app returning to foreground -> registration.update()
try {
  await page.goto(BASE); await page.click('[data-testid=ob-skip]').catch(() => {}); await page.waitForSelector("text=Today's nutrition");
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  log('initial build:', await buildId());
  await page.goto(BASE + '#/body'); await page.locator('label:has-text("Weight") input').fill('81.7'); await page.click('text=Log weight'); await page.waitForTimeout(300);
  await page.goto(BASE + '#/');  await page.waitForSelector("text=Today's nutrition");
  // --- safe auto-reload ---
  deploy('B');
  await page.evaluate(() => { window.__marker = 'old-page'; });
  const nav = page.waitForEvent('framenavigated', { timeout: 20000 });
  await triggerCheck(); await nav; await page.waitForSelector("text=Today's nutrition");
  const marker = await page.evaluate(() => window.__marker || null);
  const toastTxt = await page.waitForSelector('.toast', { timeout: 5000 }).then((t) => t.textContent()).catch(() => '');
  log('after deploy B: page reloaded =', marker === null, '| toast:', toastTxt);
  if (marker !== null) fail('page did not reload'); if (!/Updated to v/.test(toastTxt)) fail('no updated toast');
  const idB = await buildId(); log('build now:', idB); if (!/buildB/.test(idB)) fail('not on build B');
  await page.goto(BASE + '#/body'); await page.waitForSelector('.list .item', { timeout: 5000 }).catch(() => {}); const bw = await page.locator('.list .item').allTextContents(); log('body weight after update:', bw.join(' | ')); if (!bw.some((t) => t.includes('81.7'))) fail('data lost across update');
  const caches1 = await page.evaluate(() => caches.keys()); log('caches:', caches1.join(', '));
  // --- unsafe: workout in progress -> banner ---
  await page.goto(BASE + '#/workouts'); await page.click('text=+ Start empty workout'); await page.waitForSelector('text=+ Add exercise');
  await page.evaluate(() => { window.__marker = 'mid-workout'; });
  deploy('C'); await triggerCheck();
  await page.waitForSelector('[data-testid=update-banner]', { timeout: 20000 });
  const still = await page.evaluate(() => window.__marker); log('mid-workout: banner shown, page not reloaded =', still === 'mid-workout'); if (still !== 'mid-workout') fail('reloaded mid-workout');
  await page.screenshot({ path: 'screenshots/15-update-banner.png' });
  const nav2 = page.waitForEvent('framenavigated'); await page.click('[data-testid=update-banner]'); await nav2;
  await page.waitForSelector('text=+ Add exercise'); log('after tapping banner: workout screen restored');
  const idC = await buildId(); log('build now:', idC); if (!/buildC/.test(idC)) fail('not on build C');
  await page.goto(BASE + '#/workouts?list=1'); await page.waitForSelector('text=in progress', { timeout: 5000 }).catch(() => {}); const resume = await page.locator('text=in progress').count(); log('workout still in progress after update:', resume > 0); if (!resume) fail('workout lost');
  const caches2 = await page.evaluate(() => caches.keys()); log('caches:', caches2.join(', ')); if (caches2.filter((k) => k.startsWith('grugfit-precache-')).length > 2) fail('old caches not cleaned');
} catch (e) { fail(e.message); }
await browser.close(); srv.kill();
console.log(failed ? 'UPDATE TEST FAILED' : 'UPDATE TEST PASSED'); process.exitCode = failed ? 1 : 0;
