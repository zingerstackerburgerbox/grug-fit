// v1.8.2 private/incognito block screen (heuristic detector, mocked storage quota), escape + banner, standalone never blocked, storage status, persist().
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const FF = 'Mozilla/5.0 (Android 14; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0';
const b = await chromium.launch();
const open = async (o = {}) => {
  const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark', timezoneId: 'Australia/Sydney', ...(o.ua ? { userAgent: o.ua } : {}) });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  const page = await ctx.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', (e) => fail('pageerror ' + e.message)); page.on('dialog', (d) => d.accept());
  await page.addInitScript((o) => {
    window.__persistCalls = 0;
    const st = navigator.storage;
    if (o.quota) st.estimate = async () => ({ quota: o.quota, usage: 0 });
    st.persisted = async () => !!window.__persisted; st.persist = async () => { window.__persistCalls++; window.__persisted = !!o.grant; return !!o.grant; };
    if (o.noSW) Object.defineProperty(Navigator.prototype, 'serviceWorker', { get: () => undefined, configurable: true });
    if (o.standalone) { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false } : mm(q)); }
  }, o);
  await page.goto(BASE); return { ctx, page };
};
const G = 2 ** 30;
const visible = (page, s) => page.locator(s).isVisible();

// 1. Chrome with leaky-incognito headroom (9 GiB) → full-screen block, no onboarding, no tabs, no logging
{
  const { ctx, page } = await open({ quota: 9 * G });
  await page.waitForSelector('[data-testid=private-block]');
  const reason = await page.evaluate(() => document.documentElement.dataset.private); log('detected:', reason); if (reason !== 'chrome-headroom') fail('reason ' + reason);
  if (await page.locator('[data-testid=onboarding]').count()) fail('onboarding visible behind block');
  if (await page.locator('nav.tabs').count()) fail('tabs visible');
  await page.goto(BASE + '#/food'); await page.waitForTimeout(300); if (!(await visible(page, '[data-testid=private-block]')) || await page.locator('text=Add food').count()) fail('food route not blocked');
  const t = await page.textContent('[data-testid=private-block]'); if (!/Private\/incognito window detected/.test(t) || !/erased when this window closes/.test(t)) fail('copy text');
  await page.click('[data-testid=private-copy]'); const clip = await page.evaluate(() => navigator.clipboard.readText()); log('copied:', clip); if (clip !== BASE) fail('copied link ' + clip);
  await page.screenshot({ path: 'screenshots/48-private-block.png' });
  await page.click('[data-testid=private-install-steps]'); await page.waitForSelector('[data-testid=install-steps]'); log('install steps platform:', await page.getAttribute('[data-testid=install-steps]', 'data-platform'));
  await page.keyboard.press('Escape'); await page.goto(BASE); await page.waitForSelector('[data-testid=private-block]');
  // escape hatch → onboarding + persistent banner, remembered across reloads
  await page.click('[data-testid=private-continue]'); await page.waitForSelector('[data-testid=onboarding]');
  if (!(await visible(page, '[data-testid=private-banner]'))) fail('banner after continue');
  await page.click('[data-testid=ob-skip]'); await page.waitForSelector("text=Today's nutrition"); if (!(await visible(page, '[data-testid=private-banner]'))) fail('banner on home');
  await page.reload(); await page.waitForSelector("text=Today's nutrition"); if (await page.locator('[data-testid=private-block]').count() || !(await visible(page, '[data-testid=private-banner]'))) fail('reload: banner should persist, block gone');
  await page.screenshot({ path: 'screenshots/49-private-banner.png' }); log('escape → onboarding + persistent banner');
  await ctx.close();
}
// 2. Old Chromium-style small quota (600 MB) also blocks
{ const { ctx, page } = await open({ quota: 600e6, ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' }); await page.waitForSelector('[data-testid=private-block]'); log('old chrome 600MB → blocked'); await ctx.close(); }
// 3. Firefox private (no service worker) blocks
{ const { ctx, page } = await open({ ua: FF, noSW: true }); await page.waitForSelector('[data-testid=private-block]'); log('firefox no-SW → blocked:', await page.evaluate(() => document.documentElement.dataset.private)); await ctx.close(); }
// 4. Standalone is never blocked, even with incognito-like signals
{ const { ctx, page } = await open({ quota: 500e6, standalone: true }); await page.waitForSelector('[data-testid=onboarding]'); if (await page.locator('[data-testid=private-block], [data-testid=private-banner]').count()) fail('standalone blocked'); log('standalone → not blocked'); await ctx.close(); }
// 5. Normal window (real estimate = usage + 10 GiB): no block, no banner; persist() requested after onboarding and Settings shows Protected
{
  const { ctx, page } = await open({ grant: true }); await page.waitForSelector('[data-testid=onboarding]');
  if (await page.locator('[data-testid=private-block], [data-testid=private-banner]').count()) fail('normal window blocked');
  if (await page.evaluate(() => window.__persistCalls)) fail('persist asked before onboarding');
  await page.click('[data-testid=ob-skip]'); await page.waitForSelector("text=Today's nutrition"); await page.waitForTimeout(200);
  const pc = await page.evaluate(() => window.__persistCalls); log('persist() calls after onboarding:', pc); if (pc !== 1) fail('persist after onboarding');
  await page.goto(BASE + '#/settings'); await page.waitForSelector('[data-testid=storage-status][data-state=protected]');
  const s = await page.textContent('[data-testid=storage-status]'); log('settings:', s.slice(0, 60)); if (!/Protected/.test(s) || !/backup/i.test(s)) fail('settings storage text');
  await page.locator('[data-testid=storage-status]').scrollIntoViewIfNeeded(); await page.screenshot({ path: 'screenshots/50-storage-status.png' });
  await ctx.close();
}
// 6. Not granted → "Not protected"; returning user's first log re-asks once
{
  const { ctx, page } = await open({ grant: false }); await page.waitForSelector('[data-testid=onboarding]'); await page.click('[data-testid=ob-skip]'); await page.waitForSelector("text=Today's nutrition");
  await page.goto(BASE + '#/settings'); await page.waitForSelector('[data-testid=storage-status][data-state=unprotected]'); log('not granted → Not protected');
  await ctx.close();
}
await b.close();
if (failed) { console.error(failed + ' FAILURES'); process.exit(1); } console.log('PRIVATE TESTS PASSED');
