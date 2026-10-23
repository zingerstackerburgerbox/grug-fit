// Fitness fact of the day: list sanity, deterministic by local date, no repeats until the list cycles, Home card UI + settings.
import { chromium, devices } from 'playwright';
import { buildSync } from 'esbuild';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const b = await chromium.launch();
// ---- unit ----
{
  const js = buildSync({ entryPoints: ['src/facts.ts'], bundle: true, format: 'iife', globalName: 'F', write: false }).outputFiles[0].text;
  const p = await b.newPage(); await p.setContent(`<script>${js}</script>`);
  const r = await p.evaluate(() => {
    const L = F.FACTS; const cats = {}; for (const f of L) cats[f.c] = (cats[f.c] || 0) + 1;
    const bad = L.filter((f) => !f.t || !f.s || f.t.length > 200 || f.s.length > 90 || !/[.!?]$/.test(f.t)).map((f) => f.t.slice(0, 40));
    const dup = L.length - new Set(L.map((f) => f.t)).size;
    const same = F.factFor(new Date(2026, 9, 23, 0, 1)).idx === F.factFor(new Date(2026, 9, 23, 23, 59)).idx;
    const changes = F.factFor(new Date(2026, 9, 23, 23, 59)).idx !== F.factFor(new Date(2026, 9, 24, 0, 0)).idx;
    const seen = new Set(); let firstRepeat = -1; for (let i = 0; i < L.length * 2; i++) { const k = F.factFor(new Date(2026, 0, 1 + i)).idx; if (seen.has(k) && firstRepeat < 0) firstRepeat = i; seen.add(k); }
    const peek = F.factFor(new Date(2026, 9, 23), 1).idx === F.factFor(new Date(2026, 9, 24)).idx;
    return { n: L.length, cats, bad, dup, same, changes, firstRepeat, covered: seen.size, peek };
  });
  log('facts:', r.n, JSON.stringify(r.cats), '| first repeat on day', r.firstRepeat, '| covered', r.covered);
  if (r.n < 150) fail('fewer than 150 facts'); if (Object.keys(r.cats).length !== 7) fail('missing categories');
  if (r.bad.length) fail('malformed facts: ' + r.bad.join(' / ')); if (r.dup) fail(r.dup + ' duplicate facts');
  if (!r.same) fail('fact changes during the day'); if (!r.changes) fail('fact does not change at midnight');
  if (r.firstRepeat !== r.n || r.covered !== r.n) fail('repeats before the list cycles'); if (!r.peek) fail('"Another" is not the next in sequence');
  await p.close();
}
// ---- UI ----
const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' }); const page = await ctx.newPage(); page.setDefaultTimeout(15000);
page.on('pageerror', (e) => fail('pageerror ' + e.message));
await page.goto(BASE); await page.fill('[data-testid=ob-username]', 'grug_tester').then(() => page.click('[data-testid=ob-next]')).then(() => page.click('[data-testid=ob-skip]')); await page.waitForSelector('[data-testid=fact-card]');
const t1 = await page.textContent('[data-testid=fact-text]'); const s1 = await page.textContent('[data-testid=fact-src]'); log('today:', t1, '|', s1);
await page.screenshot({ path: 'screenshots/35-home-fact.png' });
await page.click('[data-testid=fact-next]'); const t2 = await page.textContent('[data-testid=fact-text]'); log('another:', t2); if (t2 === t1) fail('Another did not change the fact');
await page.click('[data-testid=fact-today]'); if ((await page.textContent('[data-testid=fact-text]')) !== t1) fail("Today's did not return");
await page.reload(); await page.waitForSelector('[data-testid=fact-card]'); if ((await page.textContent('[data-testid=fact-text]')) !== t1) fail('fact not stable across reloads');
await page.click('[data-testid=fact-toggle]'); await page.waitForTimeout(300); await page.reload(); await page.waitForSelector('[data-testid=fact-card]');
if (await page.locator('[data-testid=fact-text]').count()) fail('collapse not remembered'); else log('collapsed state remembered');
await page.click('[data-testid=fact-toggle]'); await page.waitForSelector('[data-testid=fact-text]');
await page.click('[data-testid=fact-hide]'); await page.waitForTimeout(300); await page.reload(); await page.waitForSelector("text=Today's nutrition"); await page.waitForTimeout(400);
if (await page.locator('[data-testid=fact-card]').count()) fail('hide not remembered'); else log('hidden state remembered');
await page.goto(BASE + '#/settings'); await page.check('[data-testid=fact-setting]'); await page.waitForTimeout(300);
await page.goto(BASE + '#/'); await page.waitForSelector('[data-testid=fact-card]').then(() => log('re-enabled from Settings')).catch(() => fail('Settings toggle did not re-enable'));
await b.close();
if (failed) { console.error(`${failed} failure(s)`); process.exit(1); } console.log('FACTS TEST PASSED');
