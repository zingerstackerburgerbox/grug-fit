// v1.10.0 Smart Estimate (Food tab) with a mocked proxy: first-open notice (once), manual path, review/edit/log, estimated badge,
// edit keeps the badge and creates no saved food, backup carries it, daily cap mirror (used card + server 429), failure not counted, offline.
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark', timezoneId: 'Australia/Sydney' }); const page = await ctx.newPage(); page.setDefaultTimeout(12000);
page.on('pageerror', (e) => fail('pageerror ' + e.message)); page.on('dialog', (d) => d.accept());
const idb = (src) => page.evaluate(async (src) => {
  const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); });
  const tx = (store) => d.transaction(store, 'readonly').objectStore(store); const p = (req) => new Promise((r) => { req.onsuccess = () => r(req.result); });
  const res = await new Function('tx', 'p', `return (async () => { ${src} })()`)(tx, p); d.close(); return res;
}, src);
const RESET = new Date(Date.now() + 3 * 3600e3).toISOString();
let mode = 'ok', remaining = 1, posts = [];
const MEAL = { items: [
  { name: 'Scrambled eggs', qty: '2 large eggs', grams: 110, kcal: 160, protein: 14, carbs: 1, fat: 11, fibre: 0 },
  { name: 'Butter', qty: '2 tsp', grams: 10, kcal: 74, protein: 0, carbs: 0, fat: 8, fibre: 0 },
  { name: 'White toast', qty: '2 slices', grams: 70, kcal: 185, protein: 6, carbs: 34, fat: 2, fibre: 2 }], confidence: 'med', note: 'Assumed 10 g butter and 2 slices of white bread.' };
await ctx.route('https://coach.test/**', async (r) => {
  const u = r.request().url(); const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'X-Est-Remaining' };
  if (u.endsWith('/status')) return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ enabled: true, owner: false, remaining: 30, cap: 30, resetAt: RESET, estimate: { remaining, cap: 1, used: 1 - remaining } }) });
  posts.push(JSON.parse(r.request().postData() || '{}'));
  if (mode === 'fail') return r.fulfill({ status: 502, contentType: 'application/json', headers: cors, body: JSON.stringify({ error: 'bad_estimate', message: "Couldn't read the estimate. Nothing was used up – try again." }) });
  if (mode === 'limit') return r.fulfill({ status: 429, contentType: 'application/json', headers: cors, body: JSON.stringify({ error: 'est_limit', message: 'used', remaining: 0, cap: 1, resetAt: RESET }) });
  remaining = 0; return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ...MEAL, remaining: 0, cap: 1, resetAt: RESET, owner: false }) });
});
await page.goto(BASE); await page.fill('[data-testid=ob-username]', 'grug_tester').then(() => page.click('[data-testid=ob-next]')).then(() => page.click('[data-testid=ob-skip]')); await page.waitForSelector("text=Today's nutrition");
await page.evaluate(() => localStorage.setItem('coachProxyUrl', 'https://coach.test'));
const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });

// 1) entry point on the Food tab + first-open notice
await page.goto(BASE + '#/food'); await page.click('[data-testid=est-open-breakfast]');
await page.waitForSelector('[data-testid=est-notice]'); const nt = await page.textContent('[data-testid=est-notice-text]');
if (!/Automated calorie estimates can be unreliable\. Portion sizes, oils and hidden ingredients are hard to judge\. If you know the exact calories \(from a label or recipe\), please enter them manually instead\./.test(nt)) fail('notice wording');
const allText = await page.textContent('body'); if (/\bAI\b/.test(allText)) fail('estimator copy must not say "AI"');
log('notice shown on first open');
await page.click('[data-testid=est-manual]'); await page.waitForTimeout(300);
if (!page.url().includes(`#/food/add/${today}/breakfast`)) fail('Enter manually → normal add-food: ' + page.url()); else log('Enter manually → add food screen');
await page.goto(BASE + `#/food/estimate/${today}/breakfast`); await page.waitForSelector('[data-testid=est-notice]'); log('notice shown again (not accepted yet)');
await page.click('[data-testid=est-ok]'); await page.waitForSelector('[data-testid=est-notice]', { state: 'detached' });
const sn = await idb(`return (await p(tx('kv').get('settings'))).estNotice`); if (!sn) fail('Got it stored in settings');
await page.reload(); await page.waitForSelector('[data-testid=est-text]'); await page.waitForTimeout(400);
if (await page.locator('[data-testid=est-notice]').count()) fail('notice shown twice'); else log('notice not shown after Got it (remembered on-device)');
const ql = await page.textContent('[data-testid=est-quota]'); if (ql.trim() !== 'Smart Estimate: 1 left today') fail('quota line: ' + ql); else log(ql);

// 2) failure → message + manual, nothing consumed
mode = 'fail'; await page.fill('[data-testid=est-text]', '2 eggs scrambled with butter, 2 slices toast'); await page.click('[data-testid=est-go]');
await page.waitForSelector('[data-testid=est-error]'); const fk = await page.getAttribute('[data-testid=est-error]', 'data-kind');
if (fk !== 'failed' || !(await page.locator('[data-testid=est-err-manual]').count())) fail('failure card'); if (!(await page.locator('[data-testid=est-quota]').count())) fail('failure must not use up the estimate');
log('failed estimate:', fk, '· still', (await page.textContent('[data-testid=est-quota]')).trim());

// 3) review / edit / remove / meal + date / Log
mode = 'ok'; await page.fill('[data-testid=est-portion]', 'normal plate'); await page.click('[data-testid=est-go]'); await page.waitForSelector('[data-testid=est-review]');
if (posts.at(-1).text !== '2 eggs scrambled with butter, 2 slices toast' || posts.at(-1).portion !== 'normal plate' || posts.at(-1).image) fail('request body ' + JSON.stringify(posts.at(-1)));
if (!(await page.isVisible('[data-testid=est-reminder]'))) fail('persistent reminder on review');
log('review:', await page.locator('[data-testid=est-item]').count(), 'items ·', await page.textContent('[data-testid=est-conf]'), '·', await page.textContent('[data-testid=est-note]'));
const tot0 = await page.textContent('[data-testid=est-total] [data-k=kcal]'); if (tot0 !== '419') fail('total ' + tot0);
await page.locator('[data-testid=est-kcal]').nth(0).fill('180'); await page.locator('[data-testid=est-protein]').nth(0).fill('15');
await page.locator('[data-testid=est-remove]').nth(1).click(); // remove butter
const tot1 = await page.textContent('[data-testid=est-total] [data-k=kcal]'); if (tot1 !== '365') fail('edited total ' + tot1); else log('edited kcal + removed butter → total', tot1);
await page.selectOption('[data-testid=est-meal]', 'lunch');
const nothing = await idb(`return (await p(tx('diary').getAll())).length`); if (nothing) fail('nothing may be logged before Log');
await page.click('[data-testid=est-log]'); await page.waitForTimeout(500);
if (!page.url().includes('#/food/' + today)) fail('back to diary ' + page.url());
const ents = await idb(`return (await p(tx('diary').getAll()))`); const foods = await idb(`return (await p(tx('foods').getAll())).filter((f) => f.id.startsWith('est:')).length`);
log('logged:', ents.map((e) => `${e.meal}:${e.name} ${e.n.kcal}kcal P${e.n.protein} est=${e.est?.conf}`).join(' | '));
if (ents.length !== 2 || !ents.every((e) => e.meal === 'lunch' && e.date === today && e.est?.conf === 'med' && /Assumed/.test(e.est.note)) || ents.find((e) => e.name === 'Scrambled eggs')?.n.kcal !== 180) fail('logged entries');
if (foods) fail('estimated items must not create saved foods');
const badges = await page.locator('[data-testid=est-badge]').count(); if (badges !== 2) fail('est badge count ' + badges); else log('diary shows', badges, '"≈ est." badges');
await page.screenshot({ path: 'screenshots/90-estimate-diary.png' });
// totals include the estimate
const ring = await page.locator('.card').filter({ hasText: 'Lunch' }).first().textContent(); if (!/365/.test(ring)) fail('lunch total includes estimate: ' + ring.slice(0, 80));
// edit an estimated entry like a normal one: badge stays, still no saved food
await page.locator('button.item', { hasText: 'White toast' }).click(); await page.waitForSelector('.amount-sheet');
if (await page.locator('.amount-sheet >> text=Edit food').count()) fail('no "Edit food" for an estimated item');
const qi = page.locator('.amount-sheet input[inputmode=decimal]').first(); await qi.fill('35'); await page.click('text=Save changes'); await page.waitForTimeout(400);
const toast2 = await idb(`return (await p(tx('diary').getAll())).find((e) => e.name === 'White toast')`); const foods2 = await idb(`return (await p(tx('foods').getAll())).length`);
log('edited toast:', toast2.grams, 'g', Math.round(toast2.n.kcal), 'kcal est=', toast2.est?.conf, '· saved foods', foods2);
if (!toast2.est || Math.abs(toast2.n.kcal - 92.5) > 0.6 || foods2) fail('edit keeps est flag, scales, no saved food');
// backup carries the flag
await page.goto(BASE + '#/settings'); const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=Export all data')]);
const bj = JSON.parse(await (await import('fs')).promises.readFile(await dl.path(), 'utf8')); if ((bj.data.diary || []).filter((e) => e.est).length !== 2) fail('backup has est entries'); else log('backup keeps the est flag');

// 4) cap mirror: used card with reset time + Enter manually
await page.goto(BASE + `#/food/estimate/${today}/dinner`); await page.waitForSelector('[data-testid=est-used]');
const ut = await page.textContent('[data-testid=est-used]'); log('used:', ut.trim());
if (!/^You've used today's Smart Estimate\. It resets at .+\. You can still enter food manually\./.test(ut.trim())) fail('used copy');
await page.click('[data-testid=est-used-manual]'); await page.waitForTimeout(300); if (!page.url().includes(`#/food/add/${today}/dinner`)) fail('used → manual');
// server says limit even though the mirror says 1 left (e.g. another browser / incognito on the same device)
remaining = 1; mode = 'limit'; await page.evaluate(() => localStorage.removeItem('estQuota'));
await page.goto(BASE + `#/food/estimate/${today}/dinner`); await page.waitForSelector('[data-testid=est-quota]');
await page.fill('[data-testid=est-text]', 'chicken wrap'); await page.click('[data-testid=est-go]'); await page.waitForSelector('[data-testid=est-error]');
const lk = await page.getAttribute('[data-testid=est-error]', 'data-kind'); const lt = await page.textContent('[data-testid=est-error]');
if (lk !== 'limit' || !/You've used today's Smart Estimate/.test(lt)) fail('server 429 → limit message'); else log('server cap →', lt.trim().slice(0, 90));
// 5) offline
mode = 'ok'; await page.evaluate(() => localStorage.removeItem('estQuota')); await page.reload(); await page.waitForSelector('[data-testid=est-text]');
await ctx.setOffline(true); await page.fill('[data-testid=est-text]', 'banana'); const n0 = posts.length; await page.click('[data-testid=est-go]'); await page.waitForSelector('[data-testid=est-error]');
const ok2 = await page.getAttribute('[data-testid=est-error]', 'data-kind'); await page.screenshot({ path: 'screenshots/91-estimate-offline.png' });
if (ok2 !== 'offline' || posts.length !== n0 || !(await page.locator('[data-testid=est-err-manual]').count())) fail('offline message + manual'); else log('offline →', (await page.textContent('[data-testid=est-error]')).trim());
await ctx.setOffline(false);
await b.close(); if (failed) { console.error(failed + ' failed'); process.exit(1); } console.log('ESTIMATE TESTS PASSED');
