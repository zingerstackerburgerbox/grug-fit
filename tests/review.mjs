// v1.11.0 Grug's Review + Home stars + admin code (mocked proxy): stars "building" state, star rows + breakdown sheet,
// card → loading (steps, Cancel) → result (ring, local tiles, tags), advice actions really change data (food, routine set,
// step goal), unusable actions dropped, Save + Share fallback, used-this-week card, server 429 limit, admin unlimited,
// Settings admin box (wrong code, rate limit, success, header sent, Remove), no "AI" in copy.
import { chromium, devices } from 'playwright';
import { seedWeek } from './seed-week.mjs';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark', timezoneId: 'Australia/Sydney', acceptDownloads: true });
await ctx.addInitScript(() => { try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }); } catch {} });
const page = await ctx.newPage(); page.setDefaultTimeout(12000);
page.on('pageerror', (e) => fail('pageerror ' + e.message)); page.on('dialog', (d) => d.accept());
const idb = (src) => page.evaluate(async (src) => {
  const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); });
  const tx = (store) => d.transaction(store, 'readonly').objectStore(store); const p = (req) => new Promise((r) => { req.onsuccess = () => r(req.result); });
  const res = await new Function('tx', 'p', `return (async () => { ${src} })()`)(tx, p); d.close(); return res;
}, src);
const TEST_CODE = 'MOCK-ONLY-CODE'; const TOKEN = 'ab'.repeat(32);
let st = { remaining: 1, owner: false }, reviewMode = 'ok', delay = 0, posts = [], adminHdr = [], adminMode = 'ok', removed = 0;
const NEXT = (() => { const d = new Date(); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd + 7); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const WEEK = (() => { const d = new Date(); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const REVIEW = { scores: { overall: 7.5, training: 8, nutrition: 6.5, consistency: 8 }, headline: 'Strong week', quote: 'Strong week. Protein a bit low, muscle hungry.',
  summary: 'Grug see strong week. You lift heavy rock 4 times, bench go up. Food mostly good, but protein a bit low — muscle hungry. Weekend legs lazy. Walk more.',
  went_well: ['4 of 4 planned workouts', 'Bench 80 → 82.5 kg × 5', 'Creatine 7/7 days'], slipped: ['Protein hit 3/7 days', 'Squat stuck at 100 kg × 5', 'Steps under 5k Sat & Sun'],
  tips: [
    { icon: '🥩', title: 'Close the protein gap', data: 'Avg 152 g vs 180 g · short 4 of 7 days', body: 'Muscle hungry. Add one protein snack. Grug pick:', action: { type: 'add_food', label: 'Add to tomorrow’s snacks', day: 'tomorrow', meal: 'snacks', foods: [{ name: 'Greek yoghurt', grams: 200, kcal: 146, protein: 20, carbs: 8, fat: 4 }, { name: 'Tuna can', grams: 95, kcal: 110, protein: 24, carbs: 0, fat: 1 }, { name: 'Protein shake', grams: 300, kcal: 160, protein: 30, carbs: 4, fat: 2 }] } },
    { icon: '🦵', title: 'Unstick the squat', data: 'Squat 100 kg × 5 for 3 weeks', body: 'Rock not move. Add one back-off set at 90 kg × 8 to Legs A.', action: { type: 'add_routine_set', label: 'Add set to “Legs A”', routine: 'Legs A', exercise: 'Squat (Barbell)', sets: 1, reps: 8, kg: 90 } },
    { icon: '🚶', title: 'Walk on weekends', data: 'Sat 4.1k · Sun 4.4k vs goal 8k', body: 'Weekend legs lazy. Make goal you hit.', action: { type: 'set_step_goal', label: 'Set step goal to 7,000', steps: 7000 } },
    { icon: '🏋️', title: 'Keep the push day', data: 'Bench 80 → 82.5 kg', body: 'Good hunt. Keep same plan.', action: { type: 'add_routine_set', label: 'Add set to “Arms Z”', routine: 'Arms Z', exercise: 'Squat (Barbell)', sets: 1, reps: 8, kg: 90 } },
    { icon: '📅', title: 'Plan weekend', data: '0 workouts Sat/Sun', body: 'Grug no can set reminders here.', action: null }] };
const J = (r, status, body, extra = {}) => r.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', ...extra }, body: JSON.stringify(body) });
await ctx.route('https://coach.test/**', async (r) => {
  const u = new URL(r.request().url()); const h = r.request().headers(); if (h['x-admin-token']) adminHdr.push(u.pathname);
  if (u.pathname === '/status') return J(r, 200, { enabled: true, owner: st.owner, admin: st.owner, remaining: st.owner ? null : 5, cap: 5, resetAt: new Date(Date.now() + 3600e3).toISOString(), estimate: { remaining: 3, cap: 3 }, review: { remaining: st.owner ? null : st.remaining, cap: 1, week: WEEK, nextMonday: NEXT } });
  if (u.pathname === '/admin') { const code = JSON.parse(r.request().postData() || '{}').code;
    if (adminMode === 'limit') return J(r, 429, { error: 'too_many_attempts', message: 'Too many attempts. Try again in an hour.' });
    if (code !== TEST_CODE) return J(r, 401, { error: 'bad_code', message: 'Code not recognised.' }); st.owner = true; return J(r, 200, { token: TOKEN, admin: true }); }
  if (u.pathname === '/admin/remove') { removed++; st.owner = false; return J(r, 200, { removed: true }); }
  if (u.pathname === '/review') {
    posts.push(JSON.parse(r.request().postData() || '{}')); if (delay) await new Promise((res) => setTimeout(res, delay));
    if (!st.owner && st.remaining <= 0 || reviewMode === 'limit') return J(r, 429, { error: 'review_limit', message: 'used', remaining: 0, cap: 1, nextMonday: NEXT, week: WEEK });
    if (!st.owner) st.remaining--; return J(r, 200, { review: REVIEW, remaining: st.owner ? null : st.remaining, cap: 1, owner: st.owner, week: WEEK, nextMonday: NEXT, resetAt: new Date().toISOString() });
  }
  return J(r, 404, { error: 'not_found' });
});
await page.goto(BASE); await page.fill('[data-testid=ob-username]', 'grug_tester').then(() => page.click('[data-testid=ob-next]')).then(() => page.click('[data-testid=ob-skip]')); await page.waitForSelector("text=Today's nutrition");
await page.evaluate(() => localStorage.setItem('coachProxyUrl', 'https://coach.test')); await page.reload();

// 1) brand-new user: stars say they're building, card offers the review
await page.waitForSelector('[data-testid=review-card]'); await page.waitForSelector('[data-testid=stars-building]', { timeout: 5000 }).catch(() => {});
if (!(await page.locator('[data-testid=stars-building]').count())) fail('stars building state for new user'); else log('new user:', (await page.textContent('[data-testid=stars-building]')).trim());
const order = await page.evaluate(() => { const c = [...document.querySelectorAll('.page > *')]; const n = c.findIndex((e) => /Today's nutrition/.test(e.textContent)); return c[n + 1]?.getAttribute('data-testid'); });
if (order !== 'review-card') fail('review card must sit right after the nutrition card: ' + order); else log('review card sits below the nutrition card');

// 2) seeded week → star rows + sheet
await seedWeek(page); await page.reload(); await page.waitForSelector('[data-testid=stars-training]');
const tS = await page.getAttribute('[data-testid=stars-training]', 'data-stars'), nS = await page.getAttribute('[data-testid=stars-nutrition]', 'data-stars');
log('stars: training', tS, '· nutrition', nS, '·', (await page.textContent('[data-testid=stars-nutrition]')).replace(/\s+/g, ' '));
if (!(+tS >= 1 && +tS <= 5 && +nS >= 1 && +nS <= 5)) fail('star values');
await page.click('[data-testid=stars-training]'); await page.waitForSelector('[data-testid=stars-sheet]');
const sheet = await page.textContent('[data-testid=stars-sheet]'); for (const w of ['Consistency', 'Progressive overload', 'Volume balance', 'Daily movement', 'Calories on target', 'Protein', 'Logging', 'Supplements']) if (!sheet.includes(w)) fail('sheet part ' + w);
log('breakdown sheet lists all parts'); await page.click('[data-testid=stars-sheet] >> text=Close');
const note = (await page.textContent('[data-testid=review-note]')).trim(); if (!/^1 free review a week · resets Mon \d+ \w{3}$/.test(note)) fail('card note ' + note); else log(note);

// 3) loading + cancel (nothing saved)
delay = 1500; await page.click('[data-testid=review-get]'); await page.waitForSelector('[data-testid=review-loading]'); await page.waitForSelector('[data-testid=rv-step-0]:has-text("found")');
const ld = await page.textContent('[data-testid=review-loading]'); if (!/workouts? found/.test(ld) || !/days? of food logged/.test(ld) || !/Grug thinking hard/.test(ld)) fail('loading steps ' + ld);
log('loading:', (await page.textContent('[data-testid=rv-step-0]')).trim(), '|', (await page.textContent('[data-testid=rv-step-1]')).trim());
await page.click('[data-testid=review-cancel]'); await page.waitForSelector('[data-testid=review-card]'); await page.waitForTimeout(1800);
if ((await idb(`return ((await p(tx('kv').get('grugReviews')))?.list || []).length`)) !== 0) fail('cancelled review saved'); else log('Cancel → back Home, nothing saved');
st.remaining = 1;

// 4) result
delay = 400; await page.click('[data-testid=review-get]'); await page.waitForSelector('[data-testid=review-result]');
const body = posts.at(-1).data; if (!body || !body.stars || !Array.isArray(body.workouts)) fail('payload shape'); if (JSON.stringify(body).includes('grug_tester') || JSON.stringify(body).includes('"Erik"')) fail('username must not be sent');
log('payload', JSON.stringify(body).length, 'chars · keys', Object.keys(body).join(','));
const tiles = await page.textContent('[data-testid=rv-tiles]'); log('tiles:', tiles.replace(/\s+/g, ' '));
if (!/^4workouts/.test(tiles.replace(/\s+/g, ''))) fail('workouts tile computed locally (4 this week): ' + tiles);
if (!/of 2,400/.test(tiles) || !/of 180 g/.test(tiles) || !/of 8k/.test(tiles)) fail('tile targets');
if ((await page.textContent('[data-testid=rv-headline]')) !== 'Strong week') fail('headline'); if ((await page.locator('.tag.ok').count()) !== 3 || (await page.locator('.tag.warn').count()) !== 3) fail('tags');
if (!/^#\/review\/[\w-]+$/.test(new URL(page.url()).hash) || page.url().endsWith('/new')) fail('url replaced with review id ' + page.url());
if (/\bAI\b/.test(await page.textContent('body'))) fail('no "AI" in review copy');
if (!/Estimates and advice can be off\. Not medical advice\./.test(await page.textContent('.disc'))) fail('disclaimer');
log('result: ring', await page.getAttribute('[data-testid=score-ring]', 'aria-label'), '· headline + tags + disclaimer');

// 5) advice + actions
await page.click('[data-testid=rv-more]'); await page.waitForSelector('[data-testid=rv-advice]');
const nTips = await page.locator('[data-testid=rv-tip]').count(), nAct = await page.locator('[data-testid=rv-action]').count();
if (nTips !== 5 || nAct !== 3) fail(`tips ${nTips} actions ${nAct} (routine that doesn't exist must lose its button)`); else log('advice: 5 tips, 3 working actions (missing routine + no-action tip have no button)');
await page.locator('[data-testid=rv-food]').nth(1).click(); await page.locator('[data-testid=rv-action][data-type=add_food]').click(); await page.waitForSelector('[data-testid=rv-done]');
const tomorrow = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
const fe = await idb(`return (await p(tx('diary').getAll())).filter((e) => e.date === '${tomorrow}')`);
if (fe.length !== 1 || fe[0].name !== 'Tuna can' || fe[0].meal !== 'snacks' || fe[0].n.protein !== 24 || !fe[0].est) fail('add_food entry ' + JSON.stringify(fe)); else log('add_food →', fe[0].name, 'in tomorrow’s snacks (est. badge)');
await page.locator('[data-testid=rv-action][data-type=add_routine_set]').click(); await page.waitForFunction(() => document.querySelectorAll('[data-testid=rv-done]').length === 2);
const legs = await idb(`return (await p(tx('routines').getAll())).find((r) => r.name === 'Legs A')`); const last = legs.exercises.at(-1);
if (legs.exercises.length !== 5 || last.sets !== 1 || last.reps !== 8 || last.kg !== 90) fail('routine set ' + JSON.stringify(last)); else log('add_routine_set → Legs A gets 1 × 8 @ 90 kg');
await page.locator('[data-testid=rv-action][data-type=set_step_goal]').click(); await page.waitForFunction(() => document.querySelectorAll('[data-testid=rv-done]').length === 3);
if ((await idb(`return (await p(tx('kv').get('settings'))).stepGoal`)) !== 7000) fail('step goal'); else log('set_step_goal → 7,000');
await page.click('[data-testid=rv-save]'); await page.waitForSelector('[data-testid=rv-save]:has-text("Saved")');
const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null); await page.click('[data-testid=rv-share]'); const d0 = await dl;
if (!d0 || !/\.png$/.test(d0.suggestedFilename())) fail('share fallback download'); else log('share (no Web Share) → downloads', d0.suggestedFilename());
await page.reload(); await page.waitForSelector('[data-testid=review-result]'); await page.click('[data-testid=rv-more]');
if ((await page.locator('[data-testid=rv-done]').count()) !== 3) fail('done lines survive reload'); else log('done actions remembered after reload');

// 6) used-this-week card + saved list
await page.goto(BASE + '#/'); await page.waitForSelector('[data-testid=review-open]');
const used = await page.textContent('[data-testid=review-card]');
if (!/Strong week\. Protein a bit low/.test(used) || !/Next review Mon \d+ \w{3}/.test(used) || !/Want more\? Lunk Premium \(coming soon\)/.test(used)) fail('used card ' + used); else log('used card: quote · Open review · next Monday · Premium');
if (await page.locator('[data-testid=review-get]').count()) fail('Get button still shown after the week’s review');
await page.click('[data-testid=review-saved-link]'); await page.waitForSelector('[data-testid=saved-review]'); log('saved reviews list:', await page.locator('[data-testid=saved-review]').count());

// 7) server says limit (e.g. other install on this device id): error card, nothing saved
await idb(`return 1`); await page.evaluate(async () => { const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); }); await new Promise((r) => { const q = d.transaction('kv', 'readwrite').objectStore('kv').delete('grugReviews'); q.onsuccess = r; }); d.close(); localStorage.removeItem('reviewQuota'); });
st.remaining = 1; reviewMode = 'limit'; await page.goto(BASE + '#/review/new'); await page.reload(); await page.waitForSelector('[data-testid=review-error]');
const ek = await page.getAttribute('[data-testid=review-error]', 'data-kind'); const et = await page.textContent('[data-testid=review-error]');
if (ek !== 'limit' || !/Next review Mon/.test(et)) fail('limit error ' + ek + et); else log('429 → limit card:', et.trim().slice(0, 70));
await page.goto(BASE + '#/'); await page.waitForSelector('[data-testid=review-note]'); st.remaining = 0;
if (!/This week's free review is used/.test(await page.textContent('[data-testid=review-note]'))) fail('used (no local review) note');
reviewMode = 'ok';

// 8) admin code in Settings
await page.goto(BASE + '#/settings'); await page.click('[data-testid=admin-open]');
await page.fill('[data-testid=admin-code]', 'WRONG-ONE'); await page.click('[data-testid=admin-unlock]'); await page.waitForSelector('[data-testid=admin-msg]');
if ((await page.textContent('[data-testid=admin-msg]')).trim() !== 'Code not recognised') fail('wrong code msg'); else log('wrong code → "Code not recognised"');
adminMode = 'limit'; await page.click('[data-testid=admin-unlock]'); await page.waitForSelector('[data-testid=admin-msg]:has-text("Too many")'); log('rate limited →', (await page.textContent('[data-testid=admin-msg]')).trim());
adminMode = 'ok'; await page.fill('[data-testid=admin-code]', TEST_CODE); await page.click('[data-testid=admin-unlock]'); await page.waitForSelector('[data-testid=admin-on]');
if ((await page.textContent('[data-testid=admin-on]')).trim() !== 'Admin: unlimited access ✓') fail('admin on text');
if (await page.getAttribute('[data-testid=admin-box]', 'data-x') || /MOCK-ONLY-CODE/.test(await page.content())) fail('code visible after unlock');
const stored = await page.evaluate(async () => { const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); }); const s = await new Promise((r) => { const q = d.transaction('kv').objectStore('kv').getAll(); q.onsuccess = () => r(q.result); }); d.close(); return JSON.stringify(s) + JSON.stringify(localStorage); });
if (stored.includes(TEST_CODE)) fail('admin code stored on device'); if (!stored.includes(TOKEN)) fail('token not stored'); log('unlocked: token stored, code not stored anywhere on device');
// admin = unlimited: card offers new reviews every time
await page.goto(BASE + '#/'); await page.waitForSelector('[data-testid=review-note]'); await page.waitForTimeout(500);
if (!/Admin: unlimited reviews/.test(await page.textContent('[data-testid=review-card]'))) fail('admin card note');
for (let i = 0; i < 2; i++) { await page.goto(BASE + '#/review/new'); await page.reload(); await page.waitForSelector('[data-testid=review-result]'); }
await page.goto(BASE + '#/'); await page.waitForSelector('[data-testid=review-new]');
if (!adminHdr.includes('/review') || !adminHdr.includes('/status')) fail('X-Admin-Token sent'); else log('admin: 2 more reviews in the same week, X-Admin-Token sent, "Get a new review" offered');
await page.goto(BASE + '#/settings'); await page.click('[data-testid=admin-remove]'); await page.waitForSelector('[data-testid=admin-open]');
if (removed !== 1 || (await idb(`return (await p(tx('kv').get('settings'))).adminToken`))) fail('remove'); else log('Remove → /admin/remove called, token cleared');

if (failed) { console.error(failed, 'failure(s)'); process.exitCode = 1; } else console.log('review e2e OK');
await b.close();
