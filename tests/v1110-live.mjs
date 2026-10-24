// v1.11.0 live check + screenshots on the deployed site (Pixel 7, dark): seeded "Erik" week, Home stars + review card,
// stars sheet, admin code (1 wrong attempt, then the real code read from /home/box/.lunk-admin-code – never printed),
// one real Grug's Review with the admin token, advice, chat remaining count (separate non-admin device), then Remove.
import fs from 'fs';
import { chromium, devices } from 'playwright';
import { seedWeek } from './seed-week.mjs';
const BASE = process.env.BASE || 'https://zingerstackerburgerbox.github.io/grug-fit/';
const OUT = process.env.OUT || '/cursor/stores/store-ba4c5ff4-98dd-4ddd-94fb-5537ced61e1d/screenshots';
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const b = await chromium.launch();
const mk = async () => { const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark', timezoneId: 'Australia/Sydney' }); const page = await ctx.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => fail('pageerror ' + e.message)); page.on('dialog', (d) => d.accept());
  await page.goto(BASE); await page.fill('[data-testid=ob-username]', 'Erik'); await page.click('[data-testid=ob-next]'); await page.click('[data-testid=ob-skip]'); await page.waitForSelector("text=Today's nutrition");
  await seedWeek(page); await page.reload(); await page.waitForSelector('[data-testid=stars-training]');
  const nn = page.locator('text=Not now'); if (await nn.count()) await nn.first().click();
  return { ctx, page }; };
const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/v1110-${name}.png` }); log('screenshot', `v1110-${name}.png`); };
const { page } = await mk();
await page.goto(BASE + '#/settings'); const ver = (await page.textContent('[data-testid=app-version]')).trim(); if (ver !== '1.11.0') fail('live version ' + ver); else log('live About: v' + ver);

// Home (free state: nothing sent yet)
await page.goto(BASE + '#/'); await page.waitForSelector('[data-testid=review-get]');
await page.evaluate(() => { const c = document.querySelector('[data-testid=review-card]'); scrollTo(0, c.getBoundingClientRect().top + scrollY - 300); });
log('home note:', (await page.textContent('[data-testid=review-note]')).trim(), '· stars', await page.getAttribute('[data-testid=stars-training]', 'data-stars'), await page.getAttribute('[data-testid=stars-nutrition]', 'data-stars'));
await shot(page, 'home');
await page.click('[data-testid=stars-training]'); await page.waitForSelector('[data-testid=stars-sheet]'); await shot(page, 'stars-sheet'); await page.keyboard.press('Escape');

// admin: one wrong attempt, then the real code (from the file; not printed, not logged)
await page.goto(BASE + '#/settings'); await page.click('[data-testid=admin-open]');
await page.fill('[data-testid=admin-code]', 'NOT-THE-CODE-1'); await page.click('[data-testid=admin-unlock]'); await page.waitForSelector('[data-testid=admin-msg]');
const wm = (await page.textContent('[data-testid=admin-msg]')).trim(); if (wm !== 'Code not recognised') fail('wrong code message: ' + wm); else log('live wrong code → "' + wm + '"');
await page.fill('[data-testid=admin-code]', fs.readFileSync('/home/box/.lunk-admin-code', 'utf8').trim()); await page.click('[data-testid=admin-unlock]');
await page.waitForSelector('[data-testid=admin-on]'); await page.waitForSelector('.toast', { state: 'detached', timeout: 8000 }).catch(() => {}); log('live real code →', (await page.textContent('[data-testid=admin-on]')).trim());
await page.locator('[data-testid=admin-box]').scrollIntoViewIfNeeded(); await page.evaluate(() => scrollBy(0, 120)); await shot(page, 'settings-admin');

// one real review with the admin token
await page.goto(BASE + '#/'); await page.waitForSelector('[data-testid=review-get], [data-testid=review-new]'); await page.click('[data-testid=review-get], [data-testid=review-new]');
const t0 = Date.now(); await page.waitForSelector('[data-testid=review-result], [data-testid=review-error]', { timeout: 120000 });
if (await page.locator('[data-testid=review-error]').count()) fail('live review error: ' + (await page.textContent('[data-testid=review-error]')));
else {
  log(`live review in ${((Date.now() - t0) / 1000).toFixed(1)} s · ring`, await page.getAttribute('[data-testid=score-ring]', 'aria-label'), '·', await page.textContent('[data-testid=rv-headline]'));
  log('summary:', await page.textContent('[data-testid=rv-summary]'));
  if (/\bAI\b/.test(await page.textContent('body'))) fail('"AI" on the review page');
  await shot(page, 'review-result');
  await page.click('[data-testid=rv-more]'); await page.waitForSelector('[data-testid=rv-advice]');
  const tips = await page.locator('[data-testid=rv-tip]').count(), acts = await page.locator('[data-testid=rv-action]').count(); log('advice:', tips, 'tips,', acts, 'working actions');
  for (const t of await page.locator('[data-testid=rv-tip] .hd b').allTextContents()) log('  tip:', t);
  if (tips < 3 || tips > 5) fail('tip count ' + tips);
  await page.locator('[data-testid=rv-advice]').scrollIntoViewIfNeeded(); await page.evaluate(() => { const a = document.querySelector('[data-testid=rv-advice]'); scrollTo(0, a.getBoundingClientRect().top + scrollY - 120); });
  await shot(page, 'review-advice');
}
// remove admin (revokes the token on the worker)
await page.goto(BASE + '#/settings'); await page.click('[data-testid=admin-remove]'); await page.waitForSelector('[data-testid=admin-open]'); log('admin removed on the screenshot device');

// chat remaining count on a normal (non-admin) device: one real message
const c2 = await mk(); const p2 = c2.page; await p2.goto(BASE + '#/coach'); await p2.waitForSelector('textarea[aria-label="Message the coach"]');
await p2.fill('textarea[aria-label="Message the coach"]', 'How was my week? One line.'); await p2.click('[data-testid=coach-send]');
await p2.waitForSelector('[data-testid=coach-quota]:has-text("4/5")', { timeout: 90000 }); await p2.waitForSelector('[data-testid=coach-reply]', { timeout: 90000 });
await p2.waitForSelector('[data-testid=coach-typing]', { state: 'detached', timeout: 90000 }).catch(() => {}); await p2.waitForSelector('[data-testid=coach-send]', { timeout: 90000 }); await p2.waitForTimeout(1500);
log('chat pill:', await p2.textContent('[data-testid=coach-quota]')); await shot(p2, 'chat');
if (failed) { console.error(failed, 'failure(s)'); process.exitCode = 1; } else console.log('V1.11.0 LIVE OK');
await b.close();
