// v1.15.0 Invite friends: Settings row → #/settings/invite, Share (mocked navigator.share gets url + text with ?ref=<username>),
// Copy link fallback (no Web Share) with a "Copied" toast, local QR (svg, decodes back to the link), and ?ref handling for the invited person.
import { chromium, devices } from 'playwright';
import zx from '@zxing/library'; const { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } = zx;
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const SHOTS = process.env.SHOTS; const URL0 = 'https://zingerstackerburgerbox.github.io/grug-fit/';
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const b = await chromium.launch();
const mk = async (share) => {
  const ctx = await b.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, colorScheme: 'dark', timezoneId: 'Australia/Sydney', permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript((share) => { localStorage.setItem('offpackAuto', '0'); window.__shares = [];
    if (share) navigator.share = async (d) => { window.__shares.push(d); }; else { try { delete Navigator.prototype.share; } catch {} navigator.share = undefined; } }, share);
  const page = await ctx.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', (e) => fail('pageerror ' + e.message)); return { ctx, page };
};
const onboard = async (page, url = BASE, name = 'grug_tester') => { await page.goto(url); await page.fill('[data-testid=ob-username]', name); await page.click('[data-testid=ob-next]'); await page.click('[data-testid=ob-skip]'); await page.waitForSelector("text=Today's nutrition"); };

// 1. Share
{ const { ctx, page } = await mk(true); await onboard(page);
  await page.goto(BASE + '#/settings'); const row = page.locator('[data-testid=invite-row]'); await row.waitFor();
  const top = await row.evaluate((e) => e.getBoundingClientRect().top); log('Settings row at y =', Math.round(top)); if (top > 300) fail('invite row should be near the top');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/v1150-settings-row.png` });
  await row.click(); await page.waitForSelector('[data-testid=invite-page]');
  if (!(await page.evaluate(() => location.hash)).startsWith('#/settings/invite')) fail('route');
  const url = await page.textContent('[data-testid=invite-url]'); log('link:', url); if (url !== URL0 + '?ref=grug_tester') fail('link with ref');
  await page.click('[data-testid=invite-share]'); const sh = await page.evaluate(() => window.__shares); log('share called with', JSON.stringify(sh));
  if (sh.length !== 1 || sh[0].url !== URL0 + '?ref=grug_tester' || !/^Join me on Lunk, a free gym and food tracker\. Grug rates your training\./.test(sh[0].text)) fail('share payload');
  if (/\bAI\b/.test(JSON.stringify(sh) + (await page.textContent('[data-testid=invite-page]')))) fail('no "AI" in copy');
  // QR: an svg drawn locally that decodes back to the link
  const qr = page.locator('[data-testid=invite-qr] svg'); if (!(await qr.count())) fail('qr svg');
  const png = await page.locator('[data-testid=invite-qr]').screenshot(); const dec = await page.evaluate(async (b64) => b64, png.toString('base64'));
  const txt = await page.evaluate(() => document.querySelector('[data-testid=invite-install]').textContent); log('install line:', txt);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/v1150-invite.png`, fullPage: true });
  globalThis.__qrpng = dec; await ctx.close(); }
// decode the QR in a fresh page with zxing from node_modules (served by the test server is not needed: decode via data url in node)
{ const { ctx, page } = await mk(true); await page.goto(BASE);
  const px = await page.evaluate(async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; const l = []; for (let i = 0; i < d.length; i += 4) l.push((d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0); return { w: c.width, h: c.height, l }; }, globalThis.__qrpng);
  let v = null; try { v = new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(Uint8ClampedArray.from(px.l), px.w, px.h)))).getText(); } catch (e) { v = 'decode error ' + e; }
  const res = { v, w: px.w }; log('QR', res.w + 'px, decodes (zxing) to', res.v);
  if (res.v !== URL0 + '?ref=grug_tester') fail('qr decode'); await ctx.close(); }
// 2. Copy fallback (no Web Share)
{ const { ctx, page } = await mk(false); await onboard(page, BASE, 'copy.tester');
  await page.goto(BASE + '#/settings/invite'); await page.waitForSelector('[data-testid=invite-page]');
  if (await page.locator('[data-testid=invite-share]').count()) fail('share button hidden without Web Share');
  await page.click('[data-testid=invite-copy]'); await page.waitForSelector('text=Copied'); const clip = await page.evaluate(() => navigator.clipboard.readText());
  log('copy fallback: toast Copied, clipboard', clip); if (clip !== URL0 + '?ref=copy.tester') fail('clipboard'); await ctx.close(); }
// 3. ref handling for the invited person
{ const { ctx, page } = await mk(true); await page.goto(BASE + '?ref=grug_tester#/'); const g = page.locator('[data-testid=invite-greeting]'); await g.waitFor();
  const t = await g.textContent(); const addr = await page.evaluate(() => location.search); log('invited first open:', t.trim(), '| address bar search:', JSON.stringify(addr));
  if (!/grug_tester invited you/.test(t) || addr) fail('greeting / ref stripped');
  await page.fill('[data-testid=ob-username]', 'newbie'); await page.click('[data-testid=ob-next]'); await page.click('[data-testid=ob-skip]'); await page.waitForSelector("text=Today's nutrition");
  await page.reload(); await page.waitForSelector("text=Today's nutrition"); if (await g.count()) fail('greeting shown only once');
  await page.goto(BASE + '?ref=someone_else#/'); await page.waitForSelector("text=Today's nutrition"); await page.waitForTimeout(300);
  const by = await page.evaluate(() => localStorage.getItem('lunk-invited-by')); log('later ref ignored, invited by stays', by, '| greeting again:', await g.count());
  if (by !== 'grug_tester' || (await g.count())) fail('first ref wins');
  await page.goto(BASE + '?ref=<script>#/'); await page.waitForSelector("text=Today's nutrition"); log('bad ref ignored'); await ctx.close(); }
{ const { ctx, page } = await mk(true); await page.goto(BASE + '?ref=bad%20name!#/'); await page.waitForSelector('[data-testid=ob-username]'); await page.waitForTimeout(300);
  if (await page.locator('[data-testid=invite-greeting]').count()) fail('invalid ref should not greet'); else log('invalid ref: no greeting'); await ctx.close(); }
await b.close();
if (failed) { console.error(failed, 'FAILURES'); process.exit(1); } console.log('INVITE TESTS PASSED');
