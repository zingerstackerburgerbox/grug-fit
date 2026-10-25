// v1.7.0 AI Coach with a mocked backend: setup state, consent, streaming + markdown, context payload, actions, errors, own key, history.
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark', timezoneId: 'Australia/Sydney' }); const page = await ctx.newPage(); page.setDefaultTimeout(12000);
page.on('pageerror', (e) => fail('pageerror ' + e.message)); page.on('dialog', (d) => d.accept());
const idb = (src, arg) => page.evaluate(async ([src, arg]) => {
  const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); });
  const tx = (store, mode = 'readonly') => d.transaction(store, mode).objectStore(store);
  const p = (req) => new Promise((r, j) => { req.onsuccess = () => r(req.result); req.onerror = () => j(req.error); });
  const res = await new Function('tx', 'p', 'arg', `return (async () => { ${src} })()`)(tx, p, arg); d.close(); return res;
}, [src, arg]);
const sse = (text) => text.match(/[\s\S]{1,12}/g).map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join('') + 'data: [DONE]\n\n';
let mode = 'ok', reqs = [], reply = 'Hello';
// never touch the real deployed proxy from tests
let realHits = 0; await ctx.route('https://grug-coach-proxy.grug-fitgrug-fitgrug-fit.workers.dev/**', (r) => { realHits++; return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ enabled: true, owner: false, remaining: 30, cap: 30, used: 0, resetAt: '2026-10-24T00:00:00.000Z' }) }); });
await ctx.route('https://coach.test/**', async (r) => {
  const u = r.request().url(); const h = r.request().headers(); const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'X-Coach-Remaining, X-Coach-Cap, X-Coach-Reset' };
  if (u.endsWith('/status')) return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ enabled: true, owner: false, remaining: 5, cap: 5, used: 0, resetAt: '2026-10-24T00:00:00.000Z' }) });
  reqs.push({ h, body: JSON.parse(r.request().postData() || '{}') });
  if (mode === 'abort') return r.abort('failed');
  if (mode === 'limit') return r.fulfill({ status: 429, contentType: 'application/json', headers: { ...cors, 'X-Coach-Remaining': '0' }, body: JSON.stringify({ error: 'device_limit', message: 'Daily limit', remaining: 0, cap: 5, resetAt: '2026-10-24T00:00:00.000Z' }) });
  if (mode === 'iplimit') return r.fulfill({ status: 429, contentType: 'application/json', headers: cors, body: JSON.stringify({ error: 'ip_limit', message: 'net', remaining: 0, cap: 15, resetAt: '2026-10-24T00:00:00.000Z' }) });
  if (mode === 'rl') return r.fulfill({ status: 429, contentType: 'application/json', headers: cors, body: JSON.stringify({ error: 'rate_limited', message: 'slow', retryAfter: 60 }) });
  if (mode === 'disabled') return r.fulfill({ status: 503, contentType: 'application/json', headers: cors, body: JSON.stringify({ error: 'disabled', message: 'off' }) });
  return r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream', 'X-Coach-Remaining': String(5 - reqs.length), 'X-Coach-Cap': '5' }, body: sse(reply) });
});
await page.goto(BASE); await page.fill('[data-testid=ob-username]', 'grug_tester').then(() => page.click('[data-testid=ob-next]')).then(() => page.click('[data-testid=ob-skip]')); await page.waitForSelector("text=Today's nutrition");
// some data for the context
const T = Date.now() - 864e5;
await idb(`await p(tx('workouts','readwrite').put(arg.w)); await p(tx('bodyweight','readwrite').put(arg.bw));`, { w: { id: 'w1', name: 'Push Day', start: T, end: T + 3600e3, exercises: [{ id: 'e1', exerciseId: 'ex001', restSec: 90, sets: [{ id: 's1', type: 'N', kg: 100, reps: 5, done: true }] }] }, bw: { id: 'bw1', date: '2026-10-20', kg: 84.2 } });

// 1. placeholder backend → "being set up"
await page.evaluate(() => localStorage.setItem('coachProxyUrl', 'https://grug-coach-proxy.REPLACE-ME.workers.dev')); await page.reload(); await page.waitForSelector("text=Today's nutrition");
await page.click('nav.tabs a:has-text("Coach")'); await page.waitForSelector('[data-testid=coach-setup]');
log('placeholder:', (await page.textContent('[data-testid=coach-setup]')).replace(/\s+/g, ' ').slice(0, 80)); if (await page.locator('.composer').count()) fail('composer shown without a backend');
await page.screenshot({ path: 'screenshots/38-coach-setup.png' });

// 2. mocked proxy: consent → suggested prompt → streamed markdown reply with actions
await idb(`const t = new Date(); const f = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); const y = new Date(t); y.setDate(t.getDate() - 1);
  await p(tx('kv', 'readwrite').put({ id: 'stepLog', days: { [f(t)]: 9000, [f(y)]: 7000 } }));`);
await page.evaluate(() => localStorage.setItem('coachProxyUrl', 'https://coach.test')); await page.reload(); await page.waitForSelector('[data-testid=coach-consent]');
if (reqs.length) fail('data sent before consent'); log('privacy notice shown before first use');
await page.click('[data-testid=coach-accept]'); await page.waitForSelector('[data-testid=coach-suggest]');
const sugg = await page.locator('[data-testid=coach-suggest]').allTextContents(); log('suggestions:', sugg.join(' | ')); if (sugg.length !== 4) fail('suggested prompts');
reply = `Here's a **4-day PPL** split:\n\n- Push: chest, shoulders, triceps\n- Pull: back, biceps\n\n<img src=x onerror="window.__xss=1">\n\n\`\`\`grug-action\n{"type":"create_routine","name":"Push A","exercises":[{"name":"Bench Press (Barbell)","sets":4,"reps":6,"restSec":150},{"name":"Overhead Press","sets":3,"reps":8},{"name":"Cable Y-Raise Thingy","sets":3,"reps":15}]}\n\`\`\`\n\n\`\`\`grug-action\n{"type":"update_targets","protein":170}\n\`\`\`\nStick with it!`;
await page.locator('[data-testid=coach-suggest]', { hasText: 'PPL' }).click(); await page.waitForSelector('[data-testid=coach-action] >> nth=1');
const rq = reqs[0]; const sys = rq.body.messages[0];
log('request: device', rq.h['x-device-id'], '| stream', rq.body.stream, '| roles', rq.body.messages.map((m) => m.role).join(','), '| system chars', sys.content.length);
if (!/^[0-9a-f-]{36}$/.test(rq.h['x-device-id'] || '')) fail('device id header'); if (rq.body.stream !== true) fail('not streaming');
const data = JSON.parse(sys.content.split('DATA (the user\'s own logs, JSON):\n')[1] || '{}');
log('context keys:', Object.keys(data).join(','), '| workout', JSON.stringify(data.workouts?.recent?.[0]), '| bw', data.bodyWeight?.latestKg);
if (!/not a doctor/.test(sys.content) || !data.targets || data.workouts?.recent?.[0]?.ex?.[0]?.[0] !== 'Bench Press (Barbell)' || data.bodyWeight?.latestKg !== 84.2) fail('context payload');
log('steps in context:', JSON.stringify(data.steps14d)); if (data.steps14d?.days?.length !== 2 || data.steps14d.avgPerLoggedDay !== 8000 || data.steps14d.goal !== 8000) fail('steps in coach context');
if (/grug_tester/.test(JSON.stringify(rq.body)) || /grug_tester/.test(JSON.stringify(rq.h))) fail('username sent to the coach'); else log('username not in the coach request');
if (sys.content.length > 16000) fail('system prompt too big: ' + sys.content.length);
if (!sys.content.startsWith('You are Grug') || !sys.content.includes('inside Lunk') || sys.content.includes('Grug Fit')) fail('coach persona: Grug, the coach inside Lunk');
const html = await page.innerHTML('[data-testid=coach-reply]');
if (!/<strong>4-day PPL<\/strong>/.test(html) || !/<li>Push: chest/.test(html)) fail('markdown not rendered'); if (/grug-action/.test(await page.textContent('[data-testid=coach-reply]'))) fail('raw action block shown');
if (await page.evaluate(() => window.__xss) || /<img/.test(html)) fail('HTML not escaped'); else log('markdown rendered, HTML escaped');
const card = await page.textContent('[data-testid=coach-action][data-type=create_routine]'); log('routine card:', card.replace(/\s+/g, ' '));
if (!/new/.test(card)) fail('unknown exercise not flagged as new');
await page.waitForTimeout(300); log('quota pill:', await page.textContent('[data-testid=coach-quota]')); if (!/^4\/5 messages left today$/.test(await page.textContent('[data-testid=coach-quota]'))) fail('remaining messages');
await page.screenshot({ path: 'screenshots/39-coach-chat.png' });
const before = await idb(`return (await p(tx('kv').get('settings'))).targets.protein;`);
await page.locator('[data-testid=coach-action][data-type=update_targets] [data-testid=action-dismiss]').click();
await page.locator('[data-testid=coach-action][data-type=create_routine] [data-testid=action-save]').click(); await page.waitForTimeout(400);
const routines = await idb(`return await p(tx('routines').getAll());`); const after = await idb(`return (await p(tx('kv').get('settings'))).targets.protein;`);
log('saved routine:', JSON.stringify(routines.map((r) => [r.name, r.exercises.map((e) => e.exerciseId + ' ' + e.sets + 'x' + e.reps)])), '| protein target', before, '→', after);
if (routines.length !== 1 || routines[0].name !== 'Push A' || routines[0].exercises[0].exerciseId !== 'ex001' || routines[0].exercises[0].sets !== 4) fail('routine action');
if (after !== before) fail('dismissed targets changed settings');
reply = 'Bump protein:\n```grug-action\n{"type":"update_targets","kcal":2300,"protein":175}\n```';
await page.fill('textarea[aria-label="Message the coach"]', 'Set my targets'); await page.click('[data-testid=coach-send]');
await page.waitForSelector('[data-testid=coach-action] >> nth=2'); await page.locator('[data-testid=coach-action]').nth(2).locator('[data-testid=action-save]').click(); await page.waitForTimeout(300);
const t2 = await idb(`return (await p(tx('kv').get('settings'))).targets;`); log('targets after Save:', t2.kcal, t2.protein); if (t2.kcal !== 2300 || t2.protein !== 175) fail('targets action');
if (reqs[1].body.messages.filter((m) => m.role !== 'system').length !== 3) fail('history not sent with follow-up');

// 3. errors
mode = 'limit'; await page.fill('textarea[aria-label="Message the coach"]', 'more?'); await page.click('[data-testid=coach-send]'); await page.waitForSelector('[data-testid=coach-error]');
let et = await page.textContent('[data-testid=coach-error]'); log('limit:', et); if (!/You've used today's 5 coach messages./.test(et) || await page.locator('[data-testid=coach-retry]').count()) fail('limit message');
mode = 'iplimit'; await page.fill('textarea[aria-label="Message the coach"]', 'net cap?'); await page.click('[data-testid=coach-send]'); await page.waitForTimeout(400); et = await page.textContent('[data-testid=coach-error]'); log('ip limit:', et); if (!/Daily coach limit reached for this network/.test(et)) fail('ip_limit message');
mode = 'rl'; await page.fill('textarea[aria-label="Message the coach"]', 'fast?'); await page.click('[data-testid=coach-send]'); await page.waitForTimeout(400); et = await page.textContent('[data-testid=coach-error]'); log('rate limited:', et); if (!/wait a minute/.test(et)) fail('rate_limited message');
mode = 'disabled'; await page.fill('textarea[aria-label="Message the coach"]', 'hello?'); await page.click('[data-testid=coach-send]'); await page.waitForTimeout(400); et = await page.textContent('[data-testid=coach-error]'); log('disabled:', et); if (!/switched off/.test(et)) fail('disabled message');
mode = 'abort'; await page.fill('textarea[aria-label="Message the coach"]', 'net?'); await page.click('[data-testid=coach-send]'); await page.waitForTimeout(400); et = await page.textContent('[data-testid=coach-error]'); log('network:', et);
if (!/Couldn't reach/.test(et)) fail('network message'); mode = 'ok'; reply = 'Back online reply.'; await page.click('[data-testid=coach-retry]'); await page.waitForSelector('text=Back online reply.'); log('retry → reply');
await ctx.setOffline(true); await page.fill('textarea[aria-label="Message the coach"]', 'offline?'); await page.click('[data-testid=coach-send]'); await page.waitForTimeout(300); et = await page.textContent('[data-testid=coach-error]'); log('offline:', et); if (!/offline/.test(et)) fail('offline message'); await ctx.setOffline(false);

// 4. history persists; Clear chat
await page.reload(); await page.waitForSelector('[data-testid=coach-reply]'); const n = await page.locator('[data-testid=coach-reply]').count(); log('replies after reload:', n); if (n < 3) fail('history not persisted');
const act = await page.locator('[data-testid=coach-action][data-type=create_routine] .pill').first().textContent(); if (act !== 'Saved') fail('action state not persisted');
await page.click('[data-testid=coach-clear]'); await page.waitForSelector('[data-testid=coach-suggest]'); log('Clear chat → empty');

// 5. own xAI key: direct to api.x.ai (works even while the proxy is a placeholder)
await page.evaluate(() => localStorage.removeItem('coachProxyUrl'));
await page.goto(BASE + '#/coach'); await page.reload(); await page.waitForSelector('.composer'); if (await page.locator('[data-testid=coach-setup]').count()) fail('built-in proxy URL should be live (no setup screen)'); log('default build: proxy mode, composer shown; real proxy calls intercepted:', realHits);
let xr = null; await ctx.route('https://api.x.ai/v1/chat/completions', (r) => { xr = { h: r.request().headers(), body: JSON.parse(r.request().postData()) }; return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'text/event-stream' }, body: sse('Direct reply from xAI.') }); });
await page.goto(BASE + '#/settings'); await page.waitForSelector('[data-testid=coach-settings]'); { const m = await page.textContent('[data-testid=coach-mode]'); log('settings status (built-in proxy):', m); if (!/coach service/.test(m)) fail('settings should show the coach service mode'); }
// v1.13.1: key UI is off the main Settings screen; one "API key" row opens it
for (const t of ['coach-key', 'coach-owner', 'usda-key']) if (await page.locator(`[data-testid=${t}]`).count()) fail(t + ' still on the main Settings screen');
{ const st = (await page.textContent('[data-testid=api-key-status]')).trim(); log('API key row:', st); if (st !== 'Not set') fail('row status ' + st); }
await page.click('[data-testid=api-key-row]'); await page.waitForSelector('[data-testid=api-keys-page]'); if (!(await page.url()).includes('#/settings/keys')) fail('keys route');
await page.fill('[data-testid=coach-key]', 'xai-test-key'); await page.click('[data-testid=coach-key-save]'); await page.waitForTimeout(300);
await page.click('button[aria-label=Back]'); await page.waitForSelector('[data-testid=coach-settings]');
{ const st = (await page.textContent('[data-testid=api-key-status]')).trim(), m = await page.textContent('[data-testid=coach-mode]'); log('after saving: row', st, '| status', m); if (st !== 'Using your own key' || !/own xAI key/.test(m)) fail('row/status after save'); }
await page.goto(BASE + '#/coach'); await page.locator('[data-testid=coach-suggest]').first().click(); await page.waitForSelector('text=Direct reply from xAI.');
log('own key: auth', xr?.h.authorization, '| model', xr?.body.model, '| max_tokens', xr?.body.max_tokens); if (xr?.h.authorization !== 'Bearer xai-test-key' || !xr.body.model) fail('own-key request');
await page.goto(BASE + '#/settings/keys'); await page.waitForSelector('[data-testid=coach-key]'); if ((await page.inputValue('[data-testid=coach-key]')) !== 'xai-test-key' || (await page.getAttribute('[data-testid=coach-key]', 'type')) !== 'password') fail('saved key not shown masked on reopen');
await page.click('text=Remove key'); await page.waitForTimeout(300); await page.goto(BASE + '#/settings'); await page.waitForSelector('[data-testid=api-key-status]');
{ const st = (await page.textContent('[data-testid=api-key-status]')).trim(); log('after Remove key: row', st); if (st !== 'Not set') fail('remove key'); }
await b.close();
if (failed) { console.error(`${failed} failure(s)`); process.exit(1); } console.log('COACH TEST PASSED');
