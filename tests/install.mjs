// v1.8.1 install path: banner on Home + onboarding, Settings item, native prompt when captured, manual steps per browser, in-app browsers, snooze, appinstalled, standalone.
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const UA = {
  'android-chrome': 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  'ios-safari': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  messenger: 'Mozilla/5.0 (Linux; Android 14; SM-S921B Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/480.0.0.40.97;]',
  instagram: 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 Instagram 350.0.0.42.92 Android',
  'fb-ios': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.38.101;FBBV/123;FBDV/iPhone15,2]',
  snapchat: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/13.40.0.40 (like Safari/8618.1.15.10.15, panda)'
};
const b = await chromium.launch();
const open = async (ua, o = {}) => {
  const ctx = await b.newContext({ ...devices['Pixel 7'], userAgent: ua, colorScheme: 'dark', timezoneId: 'Australia/Sydney' }); const page = await ctx.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', (e) => fail('pageerror ' + e.message)); page.on('dialog', (d) => d.accept());
  if (o.standalone) await page.addInitScript(() => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false } : mm(q)); });
  if (o.time) await page.clock.install({ time: o.time });
  await page.goto(BASE); await page.waitForSelector('[data-testid=onboarding]'); return page;
};
const home = async (page) => { await page.click('[data-testid=ob-skip]'); await page.waitForSelector("text=Today's nutrition"); };
const fakeBip = (page, outcome = 'accepted') => page.evaluate((outcome) => { const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = async () => { window.__prompted = (window.__prompted || 0) + 1; }; e.userChoice = Promise.resolve({ outcome }); dispatchEvent(e); window.__bipDefaultPrevented = () => e.defaultPrevented; }, outcome);

// 1. Android Chrome, no captured prompt: banner on onboarding + Home, manual steps
{
  const page = await open(UA['android-chrome']);
  if (!(await page.locator('[data-testid=onboarding] [data-testid=install-banner]').count())) fail('install card missing on onboarding welcome'); else log('onboarding welcome shows the install card');
  await home(page); await page.waitForSelector('[data-testid=install-banner]'); await page.waitForTimeout(300);
  await page.screenshot({ path: 'screenshots/45-install-banner.png' });
  await page.click('[data-testid=install-go]'); await page.waitForSelector('[data-testid=install-steps]');
  const pl = await page.getAttribute('[data-testid=install-steps]', 'data-platform'); const t = await page.textContent('[data-testid=install-mine]'); log(pl, '→', t);
  if (pl !== 'android-chrome' || !/⋮/.test(t) || !/Install app/.test(t) || !/Add to Home screen/.test(t)) fail('Android Chrome steps');
  await page.waitForTimeout(300); await page.screenshot({ path: 'screenshots/46-install-steps.png' });
  await page.click('[data-testid=install-steps] >> text=Close');
  // native prompt captured → Install calls prompt(); accepted → banner hides
  await fakeBip(page); await page.waitForTimeout(100);
  if (!(await page.evaluate(() => window.__bipDefaultPrevented()))) fail('beforeinstallprompt should be captured (preventDefault)');
  await page.click('[data-testid=install-go]'); await page.waitForTimeout(300);
  if ((await page.evaluate(() => window.__prompted)) !== 1) fail('prompt() not called'); else log('captured beforeinstallprompt → native prompt() called');
  if (await page.locator('[data-testid=install-steps] >> visible=true').count()) fail('manual sheet should not open when native prompt is available');
  if (await page.locator('[data-testid=install-banner]').count()) fail('banner should hide after accepting'); else log('accepted → banner hidden');
  // uninstalled later → Chrome fires the event again → banner back; appinstalled → hidden
  await fakeBip(page); await page.waitForSelector('[data-testid=install-banner]'); log('event fired again → banner back');
  await page.evaluate(() => dispatchEvent(new Event('appinstalled'))); await page.waitForTimeout(200);
  if (await page.locator('[data-testid=install-banner]').count()) fail('appinstalled should hide the banner'); else log('appinstalled → banner hidden');
  await page.reload(); await page.waitForSelector("text=Today's nutrition"); if (await page.locator('[data-testid=install-banner]').count()) fail('banner back after reload despite appinstalled');
  await page.context().close();
}
// 2. Not now → hidden for 3 days, Settings item still there; reappears after 3 days
{
  const t0 = Date.parse('2026-10-23T09:00:00+11:00');
  const page = await open(UA['android-chrome'], { time: t0 }); await home(page); await page.waitForSelector('[data-testid=install-banner]');
  await page.click('[data-testid=install-later]'); await page.waitForTimeout(200); if (await page.locator('[data-testid=install-banner]').count()) fail('Not now should hide');
  await page.reload(); await page.waitForSelector("text=Today's nutrition"); if (await page.locator('[data-testid=install-banner]').count()) fail('snooze not remembered');
  await page.goto(BASE + '#/settings'); await page.waitForSelector('[data-testid=settings-install]'); log('settings item:', (await page.textContent('[data-testid=settings-install]')).trim());
  await page.click('[data-testid=settings-install-go]'); await page.waitForSelector('[data-testid=install-steps]'); log('settings → manual steps sheet');
  await page.clock.setSystemTime(t0 + 2 * 864e5); await page.goto(BASE + '#/'); await page.reload(); await page.waitForSelector("text=Today's nutrition"); if (await page.locator('[data-testid=install-banner]').count()) fail('banner back too early (2 days)');
  await page.clock.setSystemTime(t0 + 3 * 864e5 + 60e3); await page.reload(); await page.waitForSelector('[data-testid=install-banner]'); log('Not now → hidden, back after 3 days');
  await page.context().close();
}
// 3. per-browser steps + in-app browsers
const expect = { samsung: [/Add page to/, /Home screen/], 'ios-safari': [/Share/, /Add to Home Screen/], messenger: [/Open in Chrome/], instagram: [/Open in Chrome/], 'fb-ios': [/Open in Safari/], snapchat: [/Open in Safari/] };
for (const [k, res] of Object.entries(expect)) {
  const page = await open(UA[k]); await home(page); await page.waitForSelector('[data-testid=install-banner]');
  await page.click('[data-testid=install-go]'); await page.waitForSelector('[data-testid=install-steps]');
  const pl = await page.getAttribute('[data-testid=install-steps]', 'data-platform'); const t = await page.textContent('[data-testid=install-steps]');
  const inapp = ['messenger', 'instagram', 'fb-ios', 'snapchat'].includes(k);
  if (inapp !== (pl === 'inapp') || !res.every((r) => r.test(t))) fail(`${k}: platform ${pl}, text mismatch`); else log(`${k} → ${pl} ✓`);
  if (k === 'ios-safari' && !/own storage/.test(t)) fail('iOS storage note missing');
  if (k === 'messenger') { await page.waitForTimeout(300); await page.screenshot({ path: 'screenshots/47-install-inapp.png' }); }
  await page.context().close();
}
// 4. running as an installed app: no banner, Settings says installed
{
  const page = await open(UA['android-chrome'], { standalone: true });
  if (await page.locator('[data-testid=install-banner]').count()) fail('no install card on onboarding when standalone');
  await home(page); await page.waitForTimeout(300); if (await page.locator('[data-testid=install-banner]').count()) fail('banner shown in standalone');
  await page.goto(BASE + '#/settings'); await page.waitForSelector('[data-testid=settings-installed]'); log('standalone → no banner, Settings:', (await page.textContent('[data-testid=settings-installed]')).trim());
  await page.context().close();
}
// 5. manifest
{
  const r = await (await fetch(BASE + 'manifest.webmanifest')).json(); log('manifest id/start/scope/display:', r.id, r.start_url, r.scope, r.display, r.icons.map((i) => i.sizes + ':' + i.purpose).join(' '));
  if (r.id !== '/grug-fit/' || r.display !== 'standalone' || !r.icons.some((i) => i.purpose === 'maskable') || !r.icons.some((i) => i.sizes === '192x192')) fail('manifest');
}
await b.close();
if (failed) { console.log(`INSTALL TEST FAILED (${failed})`); process.exit(1); } console.log('INSTALL TEST PASSED');
