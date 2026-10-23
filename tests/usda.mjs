// Second-pass barcode lookup: saved foods → Open Food Facts → USDA FoodData Central (Branded) → not-found card.
// Mocked part (deterministic): nutrient mapping, servings, net carbs, detail fetch, exact-GTIN match, 429/timeout, settings key, caching.
// Live part (USDA_LIVE=0 to skip): real FDC lookups of known US GTINs + one bogus code. The shared DEMO_KEY is rate limited (~30/h).
import { chromium, devices } from 'playwright';
import fs from 'fs';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const LIVE = process.env.USDA_LIVE !== '0';
const log = (...a) => console.log('•', ...a); let failed = 0;
const fail = (m) => { console.error('FAIL:', m); failed++; };
const near = (a, b, t = 0.15) => Math.abs(a - b) <= t;
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' }); const page = await ctx.newPage(); page.setDefaultTimeout(15000);
page.on('pageerror', (e) => fail('pageerror ' + e.message));
const idb = (store, id) => page.evaluate(([store, id]) => new Promise((res) => { const r = indexedDB.open('grugfit'); r.onsuccess = () => { const q = r.result.transaction(store).objectStore(store).get(id); q.onsuccess = () => { res(q.result); r.result.close(); }; }; }), [store, id]);
await page.goto(BASE); await page.click('[data-testid=ob-skip]'); await page.waitForSelector("text=Today's nutrition");
const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
const preview = async () => { const v = {}; for (const k of ['kcal', 'protein', 'carbs', 'fat']) v[k] = Number(await page.locator(`[data-testid=preview] [data-k=${k}]`).textContent()); v.grams = Number(((await page.textContent('[data-testid=grams]')).match(/= ([\d.]+)/) || [])[1]); return v; };
const typeCode = async (code) => { await page.goto(BASE + '#/'); await page.waitForSelector("text=Today's nutrition"); await page.goto(BASE + `#/food/add/${today}/snacks`); await page.fill('input[type=search]', code); await page.click('button[aria-label=Search]'); };
const outcome = () => Promise.race([page.waitForSelector('.amount-sheet', { timeout: 20000 }).then(() => 'found'), page.waitForSelector('[data-testid=notfound]', { timeout: 20000 }).then(() => 'notfound')]).catch(() => 'timeout');

// ---- routes: OFF says "not found" for our test codes; USDA is mocked per scenario ----
let offCalls = 0, usdaCalls = 0, usdaMode = 'fixture', lastUsdaUrl = '';
const OFF_MISS = new Set(['0850001234567', '850001234567', '0850001234574', '850001234574', '0850001234581', '850001234581', '0850001234598', '850001234598', '0850001234604', '850001234604']);
let blockOffFor = new Set(OFF_MISS);
await ctx.route(/world\.openfoodfacts\.org\/api\/v2\/product\//, (r) => { const c = r.request().url().match(/product\/(\d+)/)[1]; if (blockOffFor.has(c)) { offCalls++; return r.fulfill({ status: 404, contentType: 'application/json', body: '{"status":0}' }); } return r.continue(); });
const bar = { fdcId: 99001, description: 'TEST OAT PROTEIN BAR', dataType: 'Branded', gtinUpc: '00850001234567', brandOwner: 'TEST FOODS INC.', brandName: 'TESTCO', servingSize: 40, servingSizeUnit: 'GRM', householdServingFullText: '1 bar', publishedDate: '2026-01-01',
  foodNutrients: [['208', 'KCAL', 400], ['203', 'G', 10], ['204', 'G', 12], ['606', 'G', 3], ['205', 'G', 60], ['291', 'G', 10], ['269', 'G', 20], ['307', 'MG', 300], ['301', 'MG', 120], ['303', 'MG', 3.6], ['401', 'MG', 6], ['320', 'UG', 100], ['328', 'UG', 2], ['418', 'UG', 1.2], ['435', 'UG', 50], ['304', 'MG', 80], ['306', 'MG', 200], ['324', 'IU', 80]].map(([nutrientNumber, unitName, value]) => ({ nutrientNumber, unitName, value })) };
await ctx.route(/api\.nal\.usda\.gov\/fdc\/v1\//, async (r) => {
  const u = r.request().url(); lastUsdaUrl = u;
  if (LIVE && usdaMode === 'live') return r.continue();
  usdaCalls++;
  if (usdaMode === '429') return r.fulfill({ status: 429, body: 'OVER_RATE_LIMIT' });
  if (usdaMode === 'hang') { await new Promise((res) => setTimeout(res, 12000)); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"foods":[]}' }).catch(() => {}); }
  if (usdaMode === 'wrong') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ foods: [{ ...bar, gtinUpc: '00850001234999' }] }) });
  if (usdaMode === 'detail') {
    if (u.includes('/food/99002')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ fdcId: 99002, description: 'Test Granola Drink', foodNutrients: [{ nutrient: { number: '268', unitName: 'kJ' }, amount: 418.4 }, { nutrient: { number: '203', unitName: 'g' }, amount: 3 }, { nutrient: { number: '205', unitName: 'g' }, amount: 12 }, { nutrient: { number: '291', unitName: 'g' }, amount: 2 }] }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ foods: [{ fdcId: 99002, description: 'Test Granola Drink', gtinUpc: '850001234598', servingSize: 250, servingSizeUnit: 'MLT', householdServingFullText: '1 bottle', foodNutrients: [] }] }) });
  }
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ totalHits: 1, foods: [bar] }) });
});

// A) OFF miss → USDA hit (typed 12-digit UPC-A; FDC stores GTIN-14) → amount screen with USDA badge, serving, mapped nutrients
await typeCode('850001234567');
if (await outcome() !== 'found') fail('USDA fallback did not open the amount screen'); else {
  const title = await page.locator('.sheet h2').textContent(); log('USDA hit:', title, '|', (await page.locator('.amount-sheet .mut.sm').first().textContent()).trim());
  if (title !== 'Test Oat Protein Bar') fail('name not title-cased: ' + title);
  if (!(await page.locator('[data-testid=src-usda]').count())) fail('no "Source: USDA" badge');
  if (!/api_key=DEMO_KEY/.test(lastUsdaUrl) || !/dataType=Branded/.test(lastUsdaUrl) || !decodeURIComponent(lastUsdaUrl).includes('00850001234567')) fail('bad USDA query ' + lastUsdaUrl); else log('query used DEMO_KEY, Branded, OR of GTIN variants');
  const units = await page.locator('.amount-sheet [role=radio]').allTextContents(); log('unit chips:', units.join(' | '));
  await page.locator('.amount-sheet [role=radio]').filter({ hasText: /serving/ }).first().click(); await page.fill('.amount-sheet input[aria-label=Amount]', '1');
  const pv = await preview(); log('1 serving preview:', JSON.stringify(pv));
  if (!near(pv.grams, 40, 0.01) || !near(pv.kcal, 160, 1) || !near(pv.protein, 4) || !near(pv.fat, 4.8) || !near(pv.carbs, 20)) fail('serving maths / net carbs wrong (want 40 g, 160 kcal, P4, F4.8, net C 20 = (60−10)×0.4)');
  await page.click('.amount-sheet >> text=Add to diary'); await page.waitForTimeout(400);
  const f = await idb('foods', 'fdc_850001234567'); log('cached food:', JSON.stringify(f.per100));
  const want = { kcal: 400, protein: 10, fat: 12, satfat: 3, carbs: 60, fibre: 10, sugar: 20, sodium: 300, calcium: 120, iron: 3.6, vitC: 6, vitA: 100, vitD: 2, b12: 1.2, folate: 50, magnesium: 80, potassium: 200 };
  for (const [k, v] of Object.entries(want)) if (!near(f.per100[k], v, 1e-6)) fail(`nutrient ${k}: got ${f.per100[k]}, want ${v}`);
  if (f.source !== 'usda' || f.barcode !== '850001234567' || f.servings[0].grams !== 40) fail('cached food shape wrong');
  // B) second scan: served from the remembered food, no network
  const o0 = offCalls, u0 = usdaCalls; await typeCode('850001234567');
  if (await outcome() !== 'found' || offCalls !== o0 || usdaCalls !== u0) fail('remembered USDA food not used on rescan'); else log('rescan: instant from saved foods (no OFF/USDA calls)');
  await page.keyboard.press('Escape');
}
// C) search hit without nutrients → fetch /food/{fdcId}; kJ-only energy; ml product
usdaMode = 'detail'; await typeCode('850001234598');
if (await outcome() !== 'found') fail('detail-fetch path failed'); else { const f = await idb('foods', 'fdc_850001234598'); log('detail fetch:', f.name, f.unit, JSON.stringify(f.per100), f.servings.map((s) => s.grams + ' ' + s.note).join()); if (!near(f.per100.kcal, 100, 0.01) || f.unit !== 'ml' || f.servings[0].grams !== 250) fail('detail mapping wrong'); }
// D) a hit whose gtinUpc doesn't match exactly is ignored
usdaMode = 'wrong'; await typeCode('850001234574');
if (await outcome() !== 'notfound') fail('non-matching GTIN was accepted'); else log('non-matching gtinUpc ignored → not-found card');
// E) 429 → not-found card with "USDA busy" note
usdaMode = '429'; await typeCode('850001234581');
if (await outcome() !== 'notfound') fail('429 did not fall through'); else { const n = await page.textContent('[data-testid=usda-note]'); log('429 note:', n); if (!/USDA busy, try again/.test(n)) fail('missing busy note'); if (!(await page.locator('[data-testid=scan-label-notfound]').count())) fail('no label-scan option'); }
// F) timeout → falls through quickly
usdaMode = 'hang'; const t0 = Date.now(); await typeCode('850001234604');
const oc = await outcome(); const dt = Date.now() - t0; log('timeout fall-through in', dt, 'ms');
if (oc !== 'notfound' || dt > 10000) fail('USDA timeout not handled fast'); else if (!/timed out/.test(await page.textContent('[data-testid=usda-note]'))) fail('timeout note missing');
// G) personal key from Settings is used
await page.goto(BASE + '#/settings'); await page.fill('[data-testid=usda-key]', 'MY-TEST-KEY'); await page.locator('[data-testid=usda-key]').blur(); await page.waitForTimeout(300);
if (!(await page.locator('a[href="https://fdc.nal.usda.gov/api-key-signup"]').count())) fail('no signup link in Settings');
usdaMode = '429'; await typeCode('850001234581'); await outcome();
if (!/api_key=MY-TEST-KEY/.test(lastUsdaUrl)) fail('settings key not used: ' + lastUsdaUrl); else log('Settings key used for USDA');
await page.screenshot({ path: 'screenshots/28-usda-busy-notfound.png' });
await page.goto(BASE + '#/settings'); await page.waitForFunction(() => document.querySelector('[data-testid=usda-key]')?.value === 'MY-TEST-KEY'); // field shows the saved key
await page.fill('[data-testid=usda-key]', ''); await page.locator('[data-testid=usda-key]').blur(); await page.waitForTimeout(300);
if ((await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('grugfit'); r.onsuccess = () => { const q = r.result.transaction('kv').objectStore('kv').get('settings'); q.onsuccess = () => res(q.result.usdaKey ?? null); }; }))) !== null) fail('clearing the key did not fall back to DEMO_KEY'); else log('key cleared → DEMO_KEY');

// ---- live FoodData Central ----
if (LIVE) {
  usdaMode = 'live';
  const cases = [
    { code: '016000224735', why: 'Gushers (not in OFF)', name: /gushers/i, kcal: 360 },
    { code: '016000196131', why: 'Fruit by the Foot (OFF has it but no nutrition)', name: /fruit by the foot/i },
    { code: '04963406', why: 'Coca-Cola 12 oz can as UPC-E (OFF blocked) → UPC-A 049000006346', name: /coca-cola/i, blockOff: true, unit: 'ml' },
    { code: '999990000014', why: 'bogus code', none: true }
  ];
  for (const c of cases) {
    blockOffFor = new Set(c.blockOff ? [c.code] : []); await typeCode(c.code); const o = await outcome();
    if (c.none) { if (o !== 'notfound') fail('bogus code found?'); else { const note = await page.locator('[data-testid=usda-note]').textContent().catch(() => ''); log(`live ${c.code} (${c.why}): not-found card`, note ? '— ' + note : ''); } continue; }
    if (o === 'notfound') { const note = await page.locator('[data-testid=usda-note]').textContent().catch(() => ''); if (/busy/.test(note)) log(`WARN live ${c.code}: USDA rate-limited (${note}) — not counted as a failure`); else fail(`live ${c.code} (${c.why}) not found`); continue; }
    const title = await page.locator('.sheet h2').textContent(); const f = await idb('foods', 'fdc_' + c.code);
    log(`live ${c.code} (${c.why}):`, title, '| fdcId', f?.fdcId, '| kcal/100', f?.per100.kcal, f?.unit, '| serving', f?.servings.map((s) => s.grams + ' ' + (s.note || '')).join());
    if (!c.name.test(title) || f?.source !== 'usda') fail('live hit wrong: ' + title);
    if (c.kcal && !near(f.per100.kcal, c.kcal, 1)) fail('live kcal mismatch'); if (c.unit && f.unit !== c.unit) fail('live unit');
    if (c.code === '016000224735') await page.screenshot({ path: 'screenshots/29-usda-result.png' });
    await page.keyboard.press('Escape');
  }
} else log('live USDA checks skipped (USDA_LIVE=0)');
await b.close();
if (failed) { console.error(failed, 'failure(s)'); process.exit(1); } console.log('USDA TEST PASSED');
