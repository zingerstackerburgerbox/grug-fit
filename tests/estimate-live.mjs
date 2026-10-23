// Live end-to-end Smart Estimate: deployed app → deployed Worker /estimate → xAI.
// A) a fresh (non-owner) device: notice, real text estimate, review, Log, then the daily cap (used card + server 429 on a retry).
//    Uses 1 of today's per-network allowance (EST_DAILY_CAP x 3).
// B) owner device (token read from ~/.grug-coach-owner-token, never printed): photo-only estimate (vision) – bypasses the cap.
// SHOTDIR=<dir> also saves v1100-*.png screenshots.
import { chromium, devices } from 'playwright';
import fs from 'fs';
const BASE = process.env.BASE || 'https://zingerstackerburgerbox.github.io/grug-fit/'; const SHOT = process.env.SHOTDIR;
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const b = await chromium.launch();
const shot = async (page, n) => { if (SHOT) { await page.waitForTimeout(300); await page.screenshot({ path: `${SHOT}/v1100-${n}.png` }); } };
async function fresh() {
  const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark', timezoneId: 'Australia/Sydney' }); const page = await ctx.newPage(); page.setDefaultTimeout(90000);
  page.on('pageerror', (e) => fail('pageerror ' + e.message)); page.on('dialog', (d) => d.accept());
  await page.goto(BASE); await page.fill('[data-testid=ob-username]', 'erik').then(() => page.click('[data-testid=ob-next]')).then(() => page.click('[data-testid=ob-skip]')); await page.waitForSelector("text=Today's nutrition");
  // dismiss the seasonal notice so it doesn't cover screenshots
  if (await page.locator('text=Happy Halloween').count()) await page.locator('.season-notice button, [data-testid=season-dismiss]').last().click().catch(() => {});
  return { ctx, page };
}
const waitReview = async (page) => { await page.waitForSelector('[data-testid=est-review], [data-testid=est-error]', { timeout: 120000 }); if (await page.locator('[data-testid=est-error]').count()) { fail('estimate error: ' + (await page.textContent('[data-testid=est-error]'))); return false; } return true; };

// ---- A: normal user, text ----
{ const { ctx, page } = await fresh();
  await page.click('nav.tabs a:has-text("Food")'); await page.waitForSelector('[data-testid=est-open-lunch]'); await page.click('[data-testid=est-open-lunch]');
  await page.waitForSelector('[data-testid=est-notice]'); await shot(page, 'disclaimer'); await page.click('[data-testid=est-ok]');
  await page.waitForSelector('[data-testid=est-quota]'); const q = (await page.textContent('[data-testid=est-quota]')).trim(); log(q); if (q !== 'Smart Estimate: 1 left today') fail('quota line live');
  await page.fill('[data-testid=est-text]', 'Chicken salad wrap: wholemeal wrap, grilled chicken breast, lettuce, tomato, a little mayo. Plus a regular flat white with full-cream milk.');
  await page.fill('[data-testid=est-portion]', 'about 120 g chicken'); await shot(page, 'input');
  const t0 = Date.now(); await page.click('[data-testid=est-go]');
  if (await waitReview(page)) {
    const names = await page.locator('[data-testid=est-name]').evaluateAll((els) => els.map((e) => e.value)); const tot = +(await page.textContent('[data-testid=est-total] [data-k=kcal]'));
    log(`real estimate in ${((Date.now() - t0) / 1000).toFixed(1)} s:`, names.join(', '), '| total', tot, 'kcal |', await page.textContent('[data-testid=est-conf]'), '|', await page.textContent('[data-testid=est-note]').catch(() => ''));
    if (!names.length || tot < 300 || tot > 1200) fail('implausible estimate ' + tot);
    await page.evaluate(() => scrollTo(0, 0)); await shot(page, 'review');
    await page.click('[data-testid=est-log]'); await page.waitForSelector('[data-testid=est-badge]'); log('logged; badges:', await page.locator('[data-testid=est-badge]').count());
    await page.locator('.card', { hasText: 'Lunch' }).first().scrollIntoViewIfNeeded(); await page.waitForSelector('.toast', { state: 'detached', timeout: 5000 }).catch(() => {}); await shot(page, 'diary');
    // cap: mirror shows the used card; a retry with the mirror cleared is refused by the server
    await page.click('[data-testid=est-open-dinner]'); await page.waitForSelector('[data-testid=est-used]'); log('used card:', (await page.textContent('[data-testid=est-used]')).trim());
    await shot(page, 'used');
    await page.evaluate(() => localStorage.removeItem('estQuota')); await page.reload(); await page.waitForSelector('[data-testid=est-used], [data-testid=est-text]');
    if (await page.locator('[data-testid=est-used]').count()) log('server /status already reports 0 left'); else {
      await page.fill('[data-testid=est-text]', 'a banana'); await page.click('[data-testid=est-go]'); await page.waitForSelector('[data-testid=est-error]');
      if ((await page.getAttribute('[data-testid=est-error]', 'data-kind')) !== 'limit') fail('second estimate not blocked by the server'); }
    // a cleared-storage "new device" on the same network can still get one (network allowance x3) – not exercised here to save the allowance
  }
  await ctx.close(); }

// ---- B: owner, photo only (vision) ----
{ const { ctx, page } = await fresh();
  const tok = fs.readFileSync(process.env.HOME + '/.grug-coach-owner-token', 'utf8').trim();
  await page.evaluate(async (tok) => { const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); });
    const st = d.transaction('kv', 'readwrite').objectStore('kv'); const s = await new Promise((r) => { const g = st.get('settings'); g.onsuccess = () => r(g.result); });
    await new Promise((r) => { const p = st.put({ ...s, coachOwnerToken: tok, estNotice: Date.now() }); p.onsuccess = r; }); d.close(); }, tok);
  await page.goto(BASE + '#/food/estimate/' + new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }) + '/breakfast'); await page.reload();
  await page.waitForSelector('[data-testid=est-text]'); await page.waitForTimeout(1500);
  log('owner:', (await page.textContent('[data-testid=est-quota]').catch(() => '?')).trim());
  await page.setInputFiles('[data-testid=est-file]', 'tests/fixtures/meal-eggs.jpg'); await page.waitForSelector('[data-testid=est-photo]');
  const t0 = Date.now(); await page.click('[data-testid=est-go]');
  if (await waitReview(page)) {
    const names = await page.locator('[data-testid=est-name]').evaluateAll((els) => els.map((e) => e.value));
    log(`photo-only estimate in ${((Date.now() - t0) / 1000).toFixed(1)} s:`, names.join(', '), '| total', await page.textContent('[data-testid=est-total] [data-k=kcal]'), 'kcal');
    if (!names.some((n) => /egg/i.test(n))) fail('vision: eggs not recognised');
    if (await page.locator('[data-testid=est-photo]').count()) fail('photo should be dropped after the request');
  }
  await ctx.close(); }
await b.close(); if (failed) { console.error('ESTIMATE LIVE FAILED'); process.exit(1); } console.log('ESTIMATE LIVE PASSED');
