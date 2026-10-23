// Live end-to-end: deployed app → deployed Worker proxy → xAI. Uses 1 message of the device's daily quota.
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'https://zingerstackerburgerbox.github.io/grug-fit/';
const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark', timezoneId: 'Australia/Sydney' });
const page = await ctx.newPage(); page.setDefaultTimeout(90000); let bad = 0; page.on('pageerror', (e) => { console.error('pageerror', e.message); bad++; });
const calls = []; page.on('response', (r) => { if (/workers\.dev/.test(r.url())) calls.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
await page.goto(BASE); await page.click('[data-testid=ob-skip]'); await page.waitForSelector("text=Today's nutrition");
await page.click('nav.tabs a:has-text("Coach")');
await page.waitForSelector('[data-testid=coach-consent], .composer');
if (await page.locator('[data-testid=coach-setup]').count()) { console.error('FAIL: live app still shows setup'); process.exit(1); }
if (await page.locator('[data-testid=coach-accept]').count()) await page.click('[data-testid=coach-accept]');
await page.fill('textarea[aria-label="Message the coach"]', 'Give me 3 quick tips to recover better between gym sessions. Keep it short.');
await page.click('[data-testid=coach-send]');
await page.waitForSelector('[data-testid=coach-reply]');
await page.waitForFunction(() => !document.querySelector('[data-testid=coach-stop]') && !document.querySelector('[data-testid=coach-typing]'), null, { timeout: 120000 });
const reply = (await page.locator('[data-testid=coach-reply]').last().innerText()).trim();
const err = await page.locator('[data-testid=coach-error]').count();
const quota = (await page.locator('[data-testid=coach-quota]').count()) ? await page.textContent('[data-testid=coach-quota]') : '';
console.log('proxy calls:', calls.join(' | ')); console.log('quota:', quota); console.log('reply:', reply.slice(0, 400).replace(/\n+/g, ' ⏎ '));
await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: 'screenshots/41-coach-live.png' });
await b.close();
if (bad || err || reply.length < 40 || !calls.some((c) => /POST \/chat 200/.test(c))) { console.error('COACH LIVE FAILED'); process.exit(1); } console.log('COACH LIVE PASSED');
