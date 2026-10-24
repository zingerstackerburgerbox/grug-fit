// v1.12.0 Leaderboard, training-only since v1.12.1 (mocked network, but the REAL coach-proxy Worker code runs in-process behind https://coach.test with an in-memory KV):
// Review card + result-screen button, first-open opt-in ("Just look" sends nothing), empty state, other lunks ranked with medals,
// joining (payload = username + kind + two integers only; daily score = Home Training stars score), own row highlighted, Daily tab,
// debounced quiet re-submit after logging steps, Settings toggle (leave deletes the server entry), offline error. Fixed noon clock.
import { chromium, devices } from 'playwright';
import { seedWeek } from './seed-week.mjs';
import worker from '../coach-proxy/src/index.js';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const kv = new Map(), meta = new Map();
const KV = { get: async (k) => kv.get(k) ?? null, put: async (k, v, o = {}) => { kv.set(k, v); if (o.metadata) meta.set(k, o.metadata); else meta.delete(k); }, delete: async (k) => { kv.delete(k); meta.delete(k); },
  list: async ({ prefix = '' } = {}) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: meta.get(name) })), list_complete: true }) };
const ENV = { COACH_KV: KV, IP_SALT: 'test-salt', ALLOWED_ORIGINS: 'http://127.0.0.1:4173,http://localhost:4173' };
const ORIGIN = new URL(BASE).origin; const posts = []; const paths = [];
const call = async (path, { method = 'GET', device, body } = {}) => { const res = await worker.fetch(new Request('https://coach.test' + path, { method, headers: { Origin: ORIGIN, 'X-Device-Id': device, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }), ENV, {}); return res.json(); };
const now = new Date(); const NOON = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0).getTime();
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark', timezoneId: 'Australia/Sydney' }); await ctx.clock.install({ time: NOON }); // noon start, flowing clock (fast-forwarded for the debounce check)
const page = await ctx.newPage(); page.setDefaultTimeout(12000);
page.on('pageerror', (e) => fail('pageerror ' + e.message)); page.on('dialog', (d) => d.accept());
await ctx.route('https://coach.test/**', async (r) => {
  const q = r.request(); const u = new URL(q.url()); paths.push(u.pathname);
  if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
  if (u.pathname === '/status') return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ enabled: true, remaining: 5, cap: 5, review: { remaining: 1, cap: 1 } }) });
  if (u.pathname === '/leaderboard/submit') posts.push(JSON.parse(q.postData() || '{}'));
  const res = await worker.fetch(new Request(q.url(), { method: q.method(), headers: { ...q.headers(), origin: ORIGIN }, body: ['GET', 'HEAD'].includes(q.method()) ? undefined : q.postData() }), ENV, {});
  return r.fulfill({ status: res.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: await res.text() });
});
await page.goto(BASE); await page.fill('[data-testid=ob-username]', 'grug_tester'); await page.click('[data-testid=ob-next]'); await page.click('[data-testid=ob-skip]'); await page.waitForSelector("text=Today's nutrition");
await page.evaluate(() => localStorage.setItem('coachProxyUrl', 'https://coach.test')); await seedWeek(page); await page.reload(); await page.waitForSelector('[data-testid=stars-training]');
const nn = page.locator('text=Not now'); if (await nn.count()) await nn.first().click();

// Home: button on the Review card; the Training stars score is the leaderboard score (v1.12.1: training only)
await page.waitForSelector('[data-testid=review-leaderboard]'); log('Review card button:', (await page.textContent('[data-testid=review-leaderboard]')).trim());
await page.click('[data-testid=stars-training]'); await page.waitForSelector('[data-testid=stars-sheet]');
const tsc = +(await page.textContent('[data-testid=stars-sheet-training] .row.between .mut')).match(/(\d+)\/100/)[1], nsc = +(await page.textContent('[data-testid=stars-sheet-nutrition] .row.between .mut')).match(/(\d+)\/100/)[1];
const expDaily = tsc; log(`Home stars: training ${tsc}/100, nutrition ${nsc}/100 → leaderboard score ${expDaily} (training only)`); await page.keyboard.press('Escape');
await page.waitForTimeout(3000); if (posts.length) fail('something was submitted before opting in');

// first open: opt-in prompt over an empty Weekly board; "Just look" sends nothing
await page.click('[data-testid=review-leaderboard]'); await page.waitForSelector('[data-testid=lb-optin]'); log('first open → opt-in prompt:', (await page.textContent('#lb-h')).trim());
if ((await page.getAttribute('[data-testid=lb-tab-weekly]', 'aria-selected')) !== 'true') fail('Weekly is not the default tab');
if (!/#\/leaderboard$/.test(page.url())) fail('url ' + page.url());
const tabOn = await page.locator('nav.tabs a.on').textContent(); if (!/Home/.test(tabOn)) fail('Home tab not highlighted: ' + tabOn);
const title = (await page.textContent('header.top h1')).trim(); if (title !== 'Training leaderboard') fail('title ' + title); else log('title:', title);
if (/nutrition/i.test(await page.textContent('[data-testid=leaderboard]')) || /nutrition/i.test(await page.textContent('[data-testid=lb-optin]'))) fail('leaderboard copy mentions nutrition');
await page.click('[data-testid=lb-look]'); await page.waitForSelector('[data-testid=lb-empty]'); await page.waitForSelector('[data-testid=lb-looking]');
log('"Just look" → empty state:', (await page.textContent('[data-testid=lb-empty] b')).trim());
if (posts.length) fail('"Just look" submitted something');
await page.reload(); await page.waitForSelector('[data-testid=lb-empty]'); await page.waitForTimeout(500); if (await page.locator('[data-testid=lb-optin]').count()) fail('opt-in asked twice'); else log('opt-in asked only once');

// two other lunks (fake devices) on the board
const D1 = 'aaaaaaaa-1111-4111-8111-000000000001', D2 = 'aaaaaaaa-1111-4111-8111-000000000002';
const per = await call('/leaderboard?period=weekly', { device: D1 }); const day = (await call('/leaderboard?period=daily', { device: D1 })).key;
await call('/leaderboard/submit', { method: 'POST', device: D1, body: { deviceId: D1, username: 'Big_Ugg', kind: 'training', daily: { score: 97, date: day }, weekly: { score: 96, weekKey: per.key } } });
await call('/leaderboard/submit', { method: 'POST', device: D2, body: { deviceId: D2, username: 'Erik', kind: 'training', daily: { score: 3, date: day }, weekly: { score: 2, weekKey: per.key } } });
await page.click('[data-testid=lb-refresh]'); await page.waitForSelector('[data-testid=lb-list-weekly]');
let rows = await page.locator('[data-testid=lb-row]').allInnerTexts(); log('viewer (not joined) sees:', rows.map((x) => x.replace(/\s+/g, ' ')).join(' | '));
if (rows.length !== 2 || !rows[0].includes('🥇') || !rows[1].includes('🥈') || await page.locator('[data-testid=lb-row][data-me]').count()) fail('viewer rows');

// join → submit → own row highlighted; duplicate name gets a tag
await page.click('[data-testid=lb-join-inline]'); await page.waitForSelector('[data-testid=lb-row][data-me]');
const p0 = posts[0]; log('submitted payload:', JSON.stringify({ ...p0, deviceId: p0?.deviceId ? '<uuid>' : null }));
if (!p0 || JSON.stringify(Object.keys(p0).sort()) !== '["daily","deviceId","kind","username","weekly"]' || p0.kind !== 'training' || JSON.stringify(Object.keys(p0.daily).sort()) !== '["date","score"]' || JSON.stringify(Object.keys(p0.weekly).sort()) !== '["score","weekKey"]') fail('payload shape');
if (p0.username !== 'Erik' || p0.daily.score !== expDaily || !Number.isInteger(p0.weekly.score) || p0.weekly.weekKey !== per.key || p0.daily.date !== day) fail(`payload values daily ${p0?.daily?.score} (want ${expDaily})`);
if (/kg|kcal|weight|food|photo|protein/i.test(JSON.stringify(p0))) fail('payload leaks health data');
rows = await page.locator('[data-testid=lb-row]').allInnerTexts(); log('weekly after joining:', rows.map((x) => x.replace(/\s+/g, ' ')).join(' | '));
const meTxt = await page.textContent('[data-testid=lb-row][data-me]'); if (rows.length !== 3 || !/Erik #[0-9a-f]{4}.*\(you\)/.test(meTxt) || !/Erik #[0-9a-f]{4}/.test(rows[2])) fail('own row / duplicate tag: ' + meTxt);
if (await page.locator('[data-testid=lb-looking]').count()) fail('"just looking" card still shown after joining');
const meScore = +(await page.textContent('[data-testid=lb-row][data-me] [data-testid=lb-score]')); if (meScore !== p0.weekly.score) fail('own weekly score shown ' + meScore);
const bg = await page.$eval('[data-testid=lb-row][data-me]', (e) => getComputedStyle(e).backgroundColor); if (/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) fail('own row not highlighted');
// Daily tab
await page.click('[data-testid=lb-tab-daily]'); await page.waitForSelector('[data-testid=lb-list-daily]');
const drows = await page.locator('[data-testid=lb-row]').allInnerTexts(); log('daily:', drows.map((x) => x.replace(/\s+/g, ' ')).join(' | '), '·', (await page.textContent('[data-testid=lb-period]')).trim());
if (+(await page.textContent('[data-testid=lb-row][data-me] [data-testid=lb-score]')) !== expDaily || !/^Today · \w{3} \d+ \w{3}$/.test((await page.textContent('[data-testid=lb-period]')).trim())) fail('daily tab');
if (paths.some((p) => /^\/(chat|estimate|review)$/.test(p))) fail('leaderboard used chat/estimate/review');
if ([...kv.keys()].some((k) => /^(d|i|g|est|rv)[a-z]*:/.test(k))) fail('chat/estimate/review counters touched');

// quiet, debounced re-submit after logging steps: nothing within 5 min, then one submit
const n0 = posts.length; await page.evaluate(() => { window.__ll = 0; addEventListener('lunk-logged', () => window.__ll++); }); await page.goto(BASE + '#/steps'); await page.waitForSelector('[data-testid=steps-input]'); await page.waitForTimeout(300); await page.fill('[data-testid=steps-input]', '300'); await page.click('[data-testid=steps-save]');
let ll = 0; for (let i = 0; i < 25 && !ll; i++) { await page.waitForTimeout(200); ll = await page.evaluate(() => window.__ll); } if (!ll) fail('logging steps did not raise lunk-logged');
// make the training score really change (drop this week's workouts straight in IndexedDB) so the pending debounced submit has news to send
await page.evaluate(async () => { const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); }); const tx = d.transaction('workouts', 'readwrite'); const st = tx.objectStore('workouts');
  const all = await new Promise((r) => { const q = st.getAll(); q.onsuccess = () => r(q.result); }); const cut = Date.now() - 4 * 864e5;
  for (const w of all) if (w.start >= cut) st.delete(w.id); await new Promise((r) => (tx.oncomplete = r)); d.close(); });
await page.waitForTimeout(3500); if (posts.length !== n0) fail('re-submit not debounced'); else log('steps logged → no submit inside the 5-minute window');
await page.clock.fastForward('05:10'); await page.waitForTimeout(2500);
if (posts.length !== n0 + 1) fail('no debounced re-submit after 5 min: ' + (posts.length - n0)); else log(`after 5 min → 1 quiet re-submit (daily ${posts.at(-1).daily.score}, weekly ${posts.at(-1).weekly.score})`);

// result screen button
await page.evaluate(async () => { const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); });
  const t = new Date(); const ymd = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; const tx = d.transaction('kv', 'readwrite');
  tx.objectStore('kv').put({ id: 'grugReviews', list: [{ id: 'r1', created: Date.now(), week: '2000-01-03', nextMonday: '2000-01-10', from: ymd, to: ymd, tiles: { workouts: 1, planned: 3, kcalAvg: 2000, kcalTarget: 2000, proteinAvg: 100, proteinTarget: 150, stepsAvg: null, stepGoal: 8000, foodDays: 1, entries: 1, stepDays: 0, doseDue: 0, doseTaken: 0 },
    result: { scores: { overall: 7, training: 7, nutrition: 7, consistency: 7 }, headline: 'Good week', quote: 'q', summary: 'Grug see.', went_well: [], slipped: [], tips: [{ icon: '💡', title: 't', data: '', body: 'b', action: null }] } }] });
  await new Promise((r) => (tx.oncomplete = r)); d.close(); });
await page.goto(BASE + '#/review/r1'); await page.waitForSelector('[data-testid=rv-leaderboard]'); await page.click('[data-testid=rv-leaderboard]'); await page.waitForSelector('[data-testid=leaderboard]'); log('result screen → View leaderboard works');

// Settings toggle: leave deletes the entry; join again re-adds
await page.goto(BASE + '#/settings'); await page.waitForSelector('[data-testid=set-lb-join]');
if (!(await page.isChecked('[data-testid=set-lb-join]'))) fail('toggle should be on');
const myKey = [...kv.keys()].find((k) => k.startsWith('lb2:e:') && !k.includes('aaaaaaaa')); if (!myKey) fail('own entry missing on the server');
await page.uncheck('[data-testid=set-lb-join]'); await page.waitForSelector('.toast:has-text("Removed from the leaderboard")'); if (kv.has(myKey)) fail('leave did not delete the server entry'); else log('Settings → off: entry deleted on the server');
await page.goto(BASE + '#/leaderboard'); await page.waitForSelector('[data-testid=lb-list-weekly]'); if (await page.locator('[data-testid=lb-row][data-me]').count() || !(await page.locator('[data-testid=lb-looking]').count())) fail('still on the board after leaving');
await page.goto(BASE + '#/settings'); await page.check('[data-testid=set-lb-join]'); await page.waitForSelector('.toast:has-text("on the training leaderboard")'); if (!kv.has(myKey)) fail('re-join did not submit'); else log('Settings → on: back on the board');

// offline
await page.goto(BASE + '#/leaderboard'); await page.waitForSelector('[data-testid=lb-list-weekly]'); await ctx.setOffline(true); await page.click('[data-testid=lb-refresh]');
await page.waitForSelector('[data-testid=lb-error]'); log('offline:', (await page.textContent('[data-testid=lb-error] .sm')).trim()); await ctx.setOffline(false);
await page.click('[data-testid=lb-retry]'); await page.waitForSelector('[data-testid=lb-list-weekly]'); log('retry online → board back');
if (/\bAI\b/.test(await page.textContent('body'))) fail('"AI" in leaderboard copy');
await page.goto(BASE + '#/settings'); const ver = (await page.textContent('[data-testid=app-version]')).trim(); if (ver !== '1.12.1') fail('version ' + ver); else log('About: v' + ver, '·', (await page.textContent('[data-testid=whats-new]')).trim());
await b.close();
if (failed) { console.error(failed, 'failure(s)'); process.exit(1); } console.log('LEADERBOARD E2E PASSED');
