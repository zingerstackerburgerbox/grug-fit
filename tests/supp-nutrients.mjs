// v1.17.0 Doses nutrients + label photo, end to end:
//  picker (search, categories, custom), units + IU conversion, % of the NHMRC daily reference by profile sex, per-dose UL note,
//  save (ingredients + diary nutrients), today's dose totals with the upper-level warning, migration of an old supplement,
//  and Photo of label (one-time notice, file chooser, downscaled JPEG to POST /supp/label, prefill, nothing saved until Save, errors).
//  LIVE_LABEL=1 uses the real coach proxy for the label read (screenshots); otherwise /supp/label is mocked.
import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/'; const SHOTS = process.env.SHOTS; const LIVE = process.env.LIVE_LABEL === '1';
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const READ = JSON.parse(readFileSync(new URL('./fixtures/label-nutricost-multi.read.json', import.meta.url)));
const PHOTO = new URL('./fixtures/label-nutricost-multi.jpg', import.meta.url).pathname;
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, colorScheme: 'dark', timezoneId: 'Australia/Sydney' });
if (!LIVE) await ctx.addInitScript(() => { localStorage.setItem('coachProxyUrl', 'https://coach.test'); });
await ctx.addInitScript(() => localStorage.setItem('offpackAuto', '0'));
const page = await ctx.newPage(); page.setDefaultTimeout(LIVE ? 60000 : 12000); page.on('pageerror', (e) => fail('pageerror ' + e.message));
const posts = []; let labelMode = 'ok';
await ctx.route('https://coach.test/**', async (r) => { const q = r.request(); const u = new URL(q.url()); const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
  if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
  if (u.pathname === '/supp/label') { posts.push(JSON.parse(q.postData() || '{}')); await new Promise((res) => setTimeout(res, 300));
    if (labelMode === 'busy') return r.fulfill({ status: 429, contentType: 'application/json', headers: cors, body: JSON.stringify({ error: 'rate_limited', message: 'Lots of label reads from this network this hour. Try again in a bit.' }) });
    return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ...READ, ms: 9000 }) }); }
  return r.fulfill({ status: 404, contentType: 'application/json', headers: cors, body: '{}' }); });
await page.goto(BASE); await page.fill('[data-testid=ob-username]', 'grug_tester'); await page.click('[data-testid=ob-next]'); await page.click('[data-testid=ob-skip]'); await page.waitForSelector("text=Today's nutrition");
const idb = (fn, arg) => page.evaluate(async ([src, arg]) => { const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); }); const P = (q) => new Promise((r) => { q.onsuccess = () => r(q.result); });
  const tx = (s, m = 'readonly') => d.transaction(s, m).objectStore(s); return await (new Function('d', 'P', 'tx', 'arg', `return (async () => { ${src} })()`))(d, P, tx, arg); }, [fn, arg]);
await idb(`const s = await P(tx('kv').get('settings')); await P(tx('kv', 'readwrite').put({ ...s, profile: { heightCm: 165, sex: 'female', birthYear: 1994, goal: 'maintain' } }));`);
const open = async (id = 'new') => { await page.goto(BASE + '#/'); await page.waitForSelector("text=Today's nutrition"); await page.goto(BASE + '#/supp/' + id); await page.waitForSelector('[data-testid=ingr-editor]'); };
const row = (key) => page.locator(`[data-testid=ingr-row][data-key=${key}]`);
const pick = async (q, key) => { await page.click('[data-testid=add-nutrient]'); await page.fill('[data-testid=nutrient-search]', q); await page.waitForTimeout(350); await page.click(`[data-testid=pick-${key}]`); await row(key).waitFor(); };

// 1) picker, units, conversion, % daily (female profile)
await open(); await page.fill('[data-testid=supp-name]', 'Zinc + D3');
await page.click('[data-testid=add-nutrient]'); await page.waitForSelector('[data-testid=nutrient-picker]');
const cats = await page.locator('[data-testid^=cat-]').evaluateAll((l) => l.map((e) => e.dataset.testid.slice(4) + ':' + e.querySelectorAll('.item').length));
log('picker categories:', cats.join(' ')); if (cats.length !== 4 || !cats[0].startsWith('Vitamins') || +cats[0].split(':')[1] < 14 || +cats[1].split(':')[1] < 16) fail('picker categories');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/v1170-nutrient-picker.png` });
await page.fill('[data-testid=nutrient-search]', 'thiamine'); const th = await page.locator('[data-testid^=pick-]:not([data-testid=pick-custom])').allTextContents(); log('search "thiamine":', th.join(', ')); if (th.length !== 1 || !/B1/.test(th[0])) fail('alias search');
await page.keyboard.press('Escape'); await page.waitForSelector('[data-testid=nutrient-picker]', { state: 'detached' }); await page.waitForTimeout(200);
await pick('zinc', 'zinc'); await row('zinc').locator('input').fill('15');
await pick('d3', 'vitD'); await row('vitD').locator('select').selectOption('IU'); await row('vitD').locator('input').fill('1000');
const zp = (await row('zinc').locator('[data-testid=ingr-pct]').textContent()).trim(); const dp = (await row('vitD').locator('[data-testid=ingr-pct]').textContent()).trim(); const conv = (await row('vitD').locator('[data-testid=ingr-conv]').textContent()).trim();
log('zinc 15 mg →', zp, '| vitamin D 1000 IU →', conv, dp); if (zp !== '188% daily' || conv !== '= 25 µg' || dp !== '500% daily') fail('% daily / IU conversion');
await page.click('[data-testid=add-nutrient]'); if (!(await page.locator('[data-testid=pick-zinc]').isDisabled())) fail('already-added entries disabled');
await page.fill('[data-testid=nutrient-search]', 'turmeric'); await page.click('[data-testid=pick-custom]'); await page.fill('[data-testid=custom-unit]', 'mg'); await page.click('[data-testid=custom-add]');
await page.locator('[data-testid=ingr-row][data-key=custom]').locator('input').fill('500');
const cu = await page.locator('[data-testid=ingr-row][data-key=custom]').textContent(); log('custom entry:', cu.replace(/\s+/g, ' ').trim().slice(0, 60)); if (!/turmeric/i.test(cu) || !/no AU reference/.test(cu)) fail('custom entry');
await pick('vitamin a', 'vitA'); await row('vitA').locator('select').selectOption('IU'); await row('vitA').locator('input').fill('20000');
const ulOne = await row('vitA').locator('[data-testid=ingr-ul]').textContent().catch(() => ''); log('vitamin A 20000 IU (6000 µg) in one dose:', ulOne.trim()); if (!/upper level \(3000 µg/.test(ulOne)) fail('per-dose UL note');
await row('vitA').locator('button[aria-label^=Remove]').click();
await page.locator('.ingr-row').first().scrollIntoViewIfNeeded(); if (SHOTS) await page.screenshot({ path: `${SHOTS}/v1170-supp-rdi.png` });
await page.locator('button:has-text("Save")').first().click(); await page.waitForURL(/#\/supps/);
let l = await idb(`return await P(tx('supplements').getAll());`); const zd = l.find((x) => x.name === 'Zinc + D3');
log('saved ingr:', JSON.stringify(zd.ingr), '| diary nutrients:', JSON.stringify(zd.nutrients));
if (zd.ingr.length !== 3 || zd.nutrients.vitD !== 25 || zd.nutrients.zinc !== undefined) fail('saved ingredients / diary nutrients');
// 2) dose totals + UL warning
await open(); await page.fill('[data-testid=supp-name]', 'Mag Glycinate'); await pick('magnesium', 'magnesium'); await row('magnesium').locator('input').fill('250');
await page.locator('button:has-text("Save")').first().click(); await page.waitForURL(/#\/supps/);
const logDose = async (name, n) => { await page.locator('.card', { hasText: name }).locator('button:has-text("Log")').click(); await page.locator('.sheet input[inputmode=decimal]').fill(String(n)); await page.click('text=Log extra dose'); await page.waitForTimeout(400); };
await logDose('Mag Glycinate', 1); let w = await page.locator('[data-testid=ul-warning]').count(); log('after 250 mg magnesium: warnings', w); if (w) fail('no warning under the UL');
await logDose('Mag Glycinate', 1); await logDose('Zinc + D3', 1);
const tot = (await page.textContent('[data-testid=dose-totals]')).replace(/\s+/g, ' '); const warn = await page.locator('[data-testid=ul-warning]').allTextContents();
log('today\'s totals:', tot.slice(0, 160)); log('warning:', warn.join(' | ')); if (warn.length !== 1 || !/Magnesium: 500 mg today from doses, above the upper level of 350 mg/.test(warn[0]) || !/Zinc 15 mg \(188%\)/.test(tot)) fail('dose totals / UL warning');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/v1170-doses-ul.png` });
// 3) migration of an old supplement (only `nutrients`)
await idb(`await P(tx('supplements', 'readwrite').put({ id: 'spOLD', name: 'Old D + Mg', kind: 'supplement', doseAmount: 1, unit: 'capsule', form: 'Capsule', unitsPerDose: 1, lowStock: 7, stock: null, color: '#22c55e', nutrients: { vitD: 25, magnesium: 300 } }));`);
await open('spOLD'); const keys = await page.locator('[data-testid=ingr-row]').evaluateAll((l) => l.map((e) => e.dataset.key + '=' + e.querySelector('input').value + ' ' + e.querySelector('select').value));
log('old supplement opens as:', keys.join(', ')); if (keys.join() !== 'vitD=25 µg,magnesium=300 mg') fail('migration');
await page.locator('button:has-text("Save")').first().click(); await page.waitForURL((u) => !String(u).includes('spOLD'));
const old = await idb(`return await P(tx('supplements').get('spOLD'));`); if (old.ingr?.length !== 2 || old.nutrients.vitD !== 25 || old.nutrients.magnesium !== 300) fail('migrated on save, diary values unchanged'); else log('re-saved: ingr', old.ingr.length, '+ nutrients kept', JSON.stringify(old.nutrients));
// 4) label photo
await open(); const before = (await idb(`return await P(tx('supplements').getAll());`)).length;
await page.click('[data-testid=label-photo]'); await page.waitForSelector('[data-testid=label-disclaimer]'); const disc = await page.textContent('[data-testid=label-disclaimer]');
if (!/Automated reads can be wrong/.test(disc) || /\bAI\b/.test(disc)) fail('disclaimer copy');
const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-testid=label-ok]')]); const t0 = Date.now(); await fc.setFiles(PHOTO);
await page.waitForSelector('[data-testid=label-ingredients]', { timeout: LIVE ? 90000 : 15000 }); const took = Date.now() - t0;
const f = await page.evaluate(() => ({ name: document.querySelector('[data-testid=supp-name]').value, brand: document.querySelector('[data-testid=supp-brand]').value, dose: document.querySelector('.page .grid3 input').value, unit: document.querySelector('.page .grid3 select').value, rows: document.querySelectorAll('[data-testid=ingr-row]').length }));
log(`label read (${LIVE ? 'live' : 'mocked'}) in ${took} ms:`, JSON.stringify(f));
if (!/Multivitamin for Men/i.test(f.name) || f.dose !== '2' || f.unit !== 'capsule' || f.rows < 20) fail('label prefill');
if (!LIVE) { const img = posts[0]?.image || ''; const dims = await page.evaluate(async (src) => { const i = new Image(); i.src = src; await i.decode(); return [i.naturalWidth, i.naturalHeight]; }, img);
  log('sent image:', img.slice(0, 23), Math.round(img.length / 1024) + ' kB', dims.join('×')); if (!img.startsWith('data:image/jpeg;base64,') || Math.max(...dims) > 1600) fail('downscaled JPEG'); }
const zinc = await row('zinc').locator('input').inputValue(); const b12 = await row('b12').locator('[data-testid=ingr-pct]').textContent(); log('zinc', zinc, 'mg | B12 60 µg', b12.trim());
if ((await idb(`return await P(tx('supplements').getAll());`)).length !== before) fail('nothing saved before Save');
await page.locator('[data-testid=label-result]').scrollIntoViewIfNeeded(); if (SHOTS) await page.screenshot({ path: `${SHOTS}/v1170-label-read.png` });
if (/\bAI\b/.test(await page.textContent('body'))) fail('"AI" in copy');
if (!LIVE) { labelMode = 'busy'; const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-testid=label-photo]')]); await fc2.setFiles(PHOTO);
  const e = await page.textContent('[data-testid=label-error]'); log('rate-limited read:', e); if (!/Try again/.test(e) || (await page.locator('[data-testid=label-disclaimer]').count())) fail('error path / notice only once'); }
await page.locator('button:has-text("Save")').first().click(); await page.waitForURL(/#\/supps/);
l = await idb(`return await P(tx('supplements').getAll());`); const mv = l.find((x) => /Multivitamin/i.test(x.name)); log('saved after review:', mv?.name, mv?.ingr?.length, 'ingredients, servings', mv?.servings); if (!mv || mv.ingr.length < 20) fail('save after review');
await b.close();
if (failed) { console.error(failed, 'FAILURES'); process.exit(1); } console.log('SUPP NUTRIENTS TESTS PASSED');
