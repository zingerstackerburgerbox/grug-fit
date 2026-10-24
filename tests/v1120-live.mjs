// v1.12.0 live check on the deployed site + Worker: leaderboard API validation/ranking/leave with 3 fake test devices, seeded demo rows for
// the screenshots (390x844, dark), a real browser device (seeded "Erik" week, noon clock) that sees the opt-in, joins, views Weekly + Daily,
// and the Settings toggle. EVERYTHING it adds is removed again at the end (all test/demo devices + the browser device leave) and verified gone.
// The owner token is read from /home/box/.grug-coach-owner-token only to lift the submit rate limit for the seeding; it is never printed.
import fs from 'fs';
import { chromium } from 'playwright';
import { seedWeek } from './seed-week.mjs';
const BASE = process.env.BASE || 'https://zingerstackerburgerbox.github.io/grug-fit/';
const U = process.env.PROXY || 'https://grug-coach-proxy.grug-fitgrug-fitgrug-fit.workers.dev';
const OUT = process.env.OUT || '/cursor/stores/store-ba4c5ff4-98dd-4ddd-94fb-5537ced61e1d/screenshots';
const ORIGIN = 'https://zingerstackerburgerbox.github.io';
const OWNER = (() => { try { return fs.readFileSync('/home/box/.grug-coach-owner-token', 'utf8').trim(); } catch { return ''; } })();
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const H = (device, owner) => ({ 'Content-Type': 'application/json', Origin: ORIGIN, 'X-Device-Id': device, ...(owner && OWNER ? { 'X-Owner-Token': OWNER } : {}) });
const api = async (path, device, { body, owner } = {}) => { const r = await fetch(U + path, { method: body ? 'POST' : 'GET', headers: H(device, owner), body: body && JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch {} return { s: r.status, j }; };
const uuid = () => crypto.randomUUID();
const mine = []; // every device id this script puts on the board (cleaned up at the end)
const submit = (device, username, d, w, P, owner = true) => { mine.push(device); return api('/leaderboard/submit', device, { owner, body: { deviceId: device, username, daily: { score: d, date: P.day }, weekly: { score: w, weekKey: P.week } } }); };
const viewer = uuid();
// KV list() is eventually consistent: new rows can take up to ~60 s to be listed for other devices
const waitFor = async (dev, pred, what) => { for (let i = 0; i < 15; i++) { const r = await api('/leaderboard?period=weekly', dev); if (pred(r.j)) return r; await new Promise((x) => setTimeout(x, 6000)); } fail('timed out waiting for ' + what); return api('/leaderboard?period=weekly', dev); };
let browser; const cleanup = async () => {
  for (const d of new Set(mine)) await api('/leaderboard/leave', d, { body: {} });
  let left = []; for (let i = 0; i < 12; i++) { // KV list() is eventually consistent (~60 s): wait until no fixture/demo name is listed any more
    const [w, dd] = await Promise.all([api('/leaderboard?period=weekly', viewer), api('/leaderboard?period=daily', viewer)]);
    left = [...(w.j?.top || []), ...(dd.j?.top || [])].filter((r) => /^(lbtest_|Big_Ugg|Thog|Mammoth_Mia|Rocky_R|Oog|Pebbles)/.test(r.name)); if (!left.length) break; await new Promise((r) => setTimeout(r, 10000)); }
  for (const d of new Set(mine)) { const r = await api('/leaderboard?period=weekly', d); if (r.j?.joined) fail('entry still there for a test device'); }
  if (left.length) fail('fixture rows still listed: ' + left.map((r) => r.name).join(', ')); else log(`cleanup: ${new Set(mine).size} test/demo devices left the board; none listed any more`);
};
try {
  // ---------- API ----------
  const before = await api('/leaderboard?period=weekly', viewer); if (before.s !== 200) throw new Error('GET /leaderboard ' + before.s + ' ' + JSON.stringify(before.j));
  const P = { week: before.j.key, day: (await api('/leaderboard?period=daily', viewer)).j.key }; log(`live board before: ${before.j.total} on weekly ${P.week}, daily ${P.day}`);
  const T = [uuid(), uuid(), uuid()];
  for (const [b, m] of [[{ deviceId: T[0], username: 'lbtest_a', daily: { score: 101, date: P.day } }, 'score 101'], [{ deviceId: T[0], username: 'lbtest_a', daily: { score: 50, date: '2020-01-01' } }, 'old date'],
    [{ deviceId: T[0], username: 'x'.repeat(21), daily: { score: 5, date: P.day } }, '21-char name'], [{ deviceId: T[0], username: 'lbtest_a', daily: { score: 5, date: P.day }, weightKg: 80 }, 'extra field']]) {
    const r = await api('/leaderboard/submit', T[0], { body: b }); if (r.s !== 400) fail(`live: ${m} → ${r.s}`); }
  log('live validation: 101 / old date / 21-char name / extra field → 400');
  await submit(T[0], 'lbtest_a', 11, 12, P, false); await submit(T[1], 'lbtest_b', 13, 14, P, false); await submit(T[2], 'lbtest_b', 9, 10, P, false);
  let r = await waitFor(T[1], (j) => j.top.filter((x) => /^lbtest_/.test(x.name)).length === 3, '3 test rows'); const tests = r.j.top.filter((x) => /^lbtest_/.test(x.name));
  log('live weekly (test rows):', tests.map((x) => `${x.rank}. ${x.name} ${x.score}${x.me ? ' (me)' : ''}`).join(' | '));
  if (tests.length !== 3 || tests[0].score !== 14 || !tests[0].me || !/^lbtest_b #[0-9a-f]{4}$/.test(tests[0].name) || tests[1].name !== 'lbtest_a' || r.j.me?.score !== 14) fail('live ranking / me / duplicate tag');
  if (JSON.stringify(r.j).includes(T[0]) || JSON.stringify(r.j).includes(T[1])) fail('device ids leaked');
  r = await api('/leaderboard/leave', T[2], { body: {} }); r = await api('/leaderboard?period=weekly', T[2]); if (r.j.joined || r.j.me) fail('live leave'); else log('live leave → entry gone for that device');
  // test fixtures off the board before the screenshots (the screenshots only show demo rows)
  for (const d of T) await api('/leaderboard/leave', d, { body: {} });
  await waitFor(viewer, (j) => !j.top.some((x) => /^lbtest_/.test(x.name)), 'test rows gone'); log('test fixtures removed');
  // ---------- demo rows for the screenshots ----------
  const demo = [['Big_Ugg', 94, 91], ['Thog', 88, 84], ['Mammoth_Mia', 71, 79], ['Rocky_R', 64, 70], ['Oog', 52, 58], ['Pebbles', 38, 45]];
  for (const [n, d, w] of demo) await submit(uuid(), n, d, w, P);
  await waitFor(viewer, (j) => demo.every(([n]) => j.top.some((x) => x.name === n)), 'demo rows listed'); log('seeded', demo.length, 'demo rows (listed)');
  // ---------- browser ----------
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: 'dark', timezoneId: 'Australia/Sydney',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36' });
  const now = new Date(); await ctx.clock.install({ time: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0) });
  const page = await ctx.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', (e) => fail('pageerror ' + e.message)); page.on('dialog', (d) => d.accept());
  const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/v1120-${name}.png` }); log('screenshot', `${OUT}/v1120-${name}.png`); };
  await page.goto(BASE); await page.fill('[data-testid=ob-username]', 'Erik'); await page.click('[data-testid=ob-next]'); await page.click('[data-testid=ob-skip]'); await page.waitForSelector("text=Today's nutrition");
  await seedWeek(page); await page.reload(); await page.waitForSelector('[data-testid=stars-training]'); const nn = page.locator('text=Not now'); if (await nn.count()) await nn.first().click();
  mine.push(await page.evaluate(() => localStorage.getItem('coachDevice')));
  await page.goto(BASE + '#/settings'); const ver = (await page.textContent('[data-testid=app-version]')).trim(); if (ver !== '1.12.0') fail('live version ' + ver); else log('live About: v' + ver);
  await page.goto(BASE + '#/'); await page.waitForSelector('[data-testid=review-leaderboard]');
  await page.evaluate(() => { const c = document.querySelector('[data-testid=review-card]'); scrollTo(0, c.getBoundingClientRect().top + scrollY - 70); }); await shot('review-card');
  await page.click('[data-testid=review-leaderboard]'); await page.waitForSelector('[data-testid=lb-optin]');
  for (let i = 0; i < 12 && !(await page.locator('[data-testid=lb-row]:has-text("Big_Ugg")').count() && !(await page.locator('[data-testid=lb-row]:has-text("lbtest_")').count())); i++) { // edge caches/list() catch up
    await page.waitForTimeout(6000); await page.reload(); await page.waitForSelector('[data-testid=lb-optin]'); await page.waitForSelector('[data-testid=lb-list-weekly], [data-testid=lb-empty]'); }
  await page.waitForSelector('[data-testid=lb-row]:has-text("Big_Ugg")'); await shot('optin');
  await page.click('[data-testid=lb-join]'); await page.waitForSelector('[data-testid=lb-row][data-me]');
  const rows = await page.locator('[data-testid=lb-row]').allInnerTexts(); log('live weekly:', rows.map((x) => x.replace(/\s+/g, ' ')).join(' | '));
  await page.waitForSelector('.toast', { state: 'detached', timeout: 8000 }).catch(() => {}); await shot('weekly');
  await page.click('[data-testid=lb-tab-daily]'); await page.waitForSelector('[data-testid=lb-list-daily]'); await page.waitForSelector('[data-testid=lb-row][data-me]');
  log('live daily:', (await page.locator('[data-testid=lb-row]').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ')).join(' | ')); await shot('daily');
  if (/\bAI\b/.test(await page.textContent('body'))) fail('"AI" on the leaderboard');
  await page.goto(BASE + '#/settings'); await page.waitForSelector('[data-testid=lb-setting]');
  await page.evaluate(() => { const c = document.querySelector('[data-testid=lb-setting]'); scrollTo(0, c.getBoundingClientRect().top + scrollY - 160); }); if (!(await page.isChecked('[data-testid=set-lb-join]'))) fail('toggle not on'); await shot('settings');
  await page.uncheck('[data-testid=set-lb-join]'); await page.waitForSelector('.toast:has-text("Removed from the leaderboard")'); log('live Settings toggle off → removed');
  r = await api('/leaderboard?period=weekly', mine.at(-1)); if (r.j.joined) fail('browser device still joined after toggle off');
} catch (e) { fail(String(e?.stack || e)); }
finally { await cleanup().catch((e) => fail('cleanup ' + e)); await browser?.close(); }
if (failed) { console.error(failed, 'failure(s)'); process.exitCode = 1; } else console.log('V1.12.0 LIVE OK');
