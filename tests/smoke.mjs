import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const SHOTS = process.env.SHOTS !== '0';
const log = (...a) => console.log('•', ...a);
import { execFileSync } from 'child_process';
import fs from 'fs';
if (!fs.existsSync('tests/barcode.y4m')) execFileSync('node', ['tests/make-barcode-video.mjs']);
// Fake rear camera showing a Nutella EAN-13. Desktop Linux Chromium has no native BarcodeDetector, so the bundled ZXing fallback is exercised.
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=' + process.cwd() + '/tests/barcode.y4m'] });
const ctx = await browser.newContext({ ...devices['Pixel 7'], colorScheme: 'dark', permissions: ['notifications', 'camera'] });
const page = await ctx.newPage(); page.setDefaultTimeout(12000);
const errors = [];
page.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); console.log('PAGEERROR', e.message); });
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
page.on('dialog', async (d) => { log('dialog:', d.type(), d.message().slice(0, 60)); if (d.type() === 'prompt') await d.accept(d.defaultValue() || '100'); else await d.accept(); });
const shot = async (n) => { if (!SHOTS) return; await page.waitForSelector('.toast', { state: 'detached', timeout: 4000 }).catch(() => {}); await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(150); await page.screenshot({ path: `screenshots/${n}.png` }); };
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };

await page.goto(BASE);
await page.click('[data-testid=ob-skip]'); // onboarding is covered by tests/onboarding.mjs
await page.waitForSelector('text=Today\'s nutrition');
const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { scope: r.scope, active: !!r.active }; });
log('service worker', JSON.stringify(sw));
const man = await page.evaluate(async () => { const l = document.querySelector('link[rel=manifest]'); const r = await fetch(l.href); return r.json(); });
log('manifest', man.name, man.display, man.icons.map((i) => i.sizes).join(','));
const cdp = await ctx.newCDPSession(page);
const inst = await cdp.send('Page.getInstallabilityErrors').catch((e) => ({ err: e.message }));
log('installability errors:', JSON.stringify(inst));
const am = await cdp.send('Page.getAppManifest').catch((e) => ({ err: e.message }));
log('manifest errors:', JSON.stringify(am.errors || am.err));

// ---- Supplement + schedule ----
await page.goto(BASE + '#/supp/new');
await page.fill('input[placeholder="e.g. Vitamin D3"]', 'Vitamin D3');
await page.locator('label:has-text("Dose") input').first().fill('25');
await page.locator('label:has-text("Unit") select').selectOption('µg');
await page.locator('label:has-text("Stock left") input').fill('9');
await page.click('text=+ Add schedule');
await page.locator('input[type=time]').nth(0).fill('23:58');
await page.click('details summary');
await page.locator('label:has-text("Vitamin D (µg)") input').fill('25');
await page.locator('header >> text=Save').click();
await page.waitForSelector('text=Vitamin D3');
log('supplement saved');
// second: creatine twice daily
await page.goto(BASE + '#/supp/new');
await page.fill('input[placeholder="e.g. Vitamin D3"]', 'Creatine');
await page.locator('label:has-text("Dose") input').first().fill('5');
await page.locator('label:has-text("Unit") select').selectOption('g');
await page.click('text=+ Add schedule');
await page.click('text=+ Add time');
await page.locator('input[type=time]').nth(0).fill('23:50');
await page.locator('input[type=time]').nth(1).fill('23:55');
await page.locator('header >> text=Save').click();
await page.waitForSelector('text=Creatine');
await page.goto(BASE + '#/calendar');
await page.waitForSelector('.card.list .item');
const slots = await page.locator('.card.list .item').count();
log('slots today on calendar:', slots);
if (slots < 3) fail('expected 3 dose slots today');
await page.locator('.card.list .item:has-text("Vitamin D3")').first().click();
await page.waitForTimeout(400);
const taken = await page.locator('.card.list .pill.ok').count();
log('taken pills:', taken); if (taken !== 1) fail('dose not marked taken');
await page.waitForTimeout(300); await shot('04-dose-calendar');
await page.goto(BASE + '#/supps'); await page.waitForSelector('text=Library');
const stockTxt = await page.locator('text=Stock:').first().textContent(); log('stock after dose:', stockTxt);
if (!/8 left/.test(stockTxt)) fail('stock not decremented');
const libTxt = await page.locator('.card:has-text("Vitamin D3")').first().textContent(); log('library card:', libTxt); if (!/25 µg/.test(libTxt)) fail('dose amount not saved');
await shot('05-supplements');

// ---- Food: custom food ----
await page.goto(BASE + '#/food/edit/new');
await page.fill('input[placeholder="e.g. Homemade protein oats"]', 'Chicken breast (raw)');
await page.locator('label:has-text("Serving name") input').fill('fillet');
await page.locator('label:has-text("Serving size") input').fill('200');
await page.locator('label:has-text("Energy (kcal)") input').fill('120');
await page.locator('label:has-text("Protein (g)") input').fill('23');
await page.locator('label:has-text("Fat (g)") input').first().fill('2.5');
await page.locator('header >> text=Save').click();
await page.waitForTimeout(300);
const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
await page.goto(BASE + `#/food/add/${today}/lunch`);
await page.click('text=My foods & recipes');
await page.click('.item:has-text("Chicken breast")');
await page.click('text=Add to diary');
await page.waitForTimeout(300);
// ---- Food: Open Food Facts search ----
await page.goto(BASE + `#/food/add/${today}/breakfast`);
await page.fill('input[type=search]', 'weet-bix');
await page.click('button[aria-label=Search]');
try {
  const got = await page.waitForSelector('.list .item', { timeout: 30000 }).then(() => true).catch(() => false);
  if (!got) { log('OFF search failed once (OFF is rate-limiting); retrying'); await page.click('button[aria-label=Search]'); await page.waitForSelector('.list .item', { timeout: 40000 }); }
  const n = await page.locator('.list .item').count(); log('OFF search results:', n);
  await shot('06-food-search');
  await page.locator('.list .item').first().click();
  await page.waitForSelector('text=Add to diary');
  await page.click('text=Add to diary'); await page.waitForTimeout(400);
} catch (e) { fail('OFF search: ' + e.message); await shot('06-food-search'); }
// ---- Barcode scanner (camera, ZXing fallback) -> OFF lookup -> amount screen ----
const idb = (store, id) => page.evaluate(([store, id]) => new Promise((res, rej) => { const r = indexedDB.open('grugfit'); r.onsuccess = () => { const tx = r.result.transaction(store); const q = id ? tx.objectStore(store).get(id) : tx.objectStore(store).getAll(); q.onsuccess = () => res(q.result); q.onerror = rej; }; }), [store, id]);
const preview = async () => { const g = await page.locator('[data-testid=grams]').textContent(); const v = {}; for (const k of ['kcal', 'protein', 'carbs', 'fat']) v[k] = Number(await page.locator(`[data-testid=preview] [data-k=${k}]`).textContent()); v.grams = Number(/= ([\d.]+)/.exec(g)[1]); return v; };
const near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;
const chip = (re) => page.locator('.amount-sheet [role=radio]').filter({ hasText: re });
await page.goto(BASE + `#/food/${today}`); await page.waitForSelector('text=Snacks');
await page.click('a[aria-label="Scan barcode into Snacks"]');
await page.waitForSelector('.scanner');
const engine = await page.waitForFunction(() => document.querySelector('.scanner')?.getAttribute('data-engine') || window.__scanEngine, null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => null);
log('scanner engine:', engine); if (engine !== 'zxing') fail('scanner fallback (zxing) did not initialise');
if (SHOTS) await page.screenshot({ path: 'screenshots/11-barcode-scanner.png' });
let nutella = null;
try {
  await page.waitForSelector('.amount-sheet', { timeout: 30000 });
  const title = await page.locator('.sheet h2').textContent(); log('scanned + looked up:', title);
  nutella = await idb('foods', 'off_3017620422003');
  log('nutella units:', JSON.stringify(nutella.servings), 'kcal/100', nutella.per100.kcal);
  const units = await page.locator('.amount-sheet [role=radio]').allTextContents(); log('unit chips:', units.join(' | '));
  if (units.length < 2) fail('no serving/package unit offered');
  await page.waitForTimeout(200); if (SHOTS) await page.screenshot({ path: 'screenshots/12-amount-servings.png' });
  // log in grams
  await chip(/^grams$/).click();
  await page.fill('.amount-sheet input[aria-label=Amount]', '50');
  let pv = await preview(); log('50 g preview:', JSON.stringify(pv));
  if (!near(pv.grams, 50, 0.01) || !near(pv.kcal, nutella.per100.kcal * 0.5, 1) || !near(pv.fat, nutella.per100.fat * 0.5, 0.11)) fail('gram maths wrong');
  if (SHOTS) await page.screenshot({ path: 'screenshots/13-amount-grams.png' });
  await page.click('.amount-sheet >> text=Add to diary'); await page.waitForTimeout(400);
  // reopen from Recent: remembers last unit (grams, 50)
  await page.goto(BASE + `#/food/add/${today}/snacks`); await page.click('.chip:has-text("Recent")');
  await page.click('.item:has-text("Nutella")'); await page.waitForSelector('.amount-sheet');
  const rememberedChecked = await page.locator('.amount-sheet [role=radio][aria-checked=true]').textContent(); const remQty = await page.inputValue('.amount-sheet input[aria-label=Amount]');
  log('remembered unit/qty:', rememberedChecked, remQty); if (rememberedChecked !== 'grams' || remQty !== '50') fail('last unit/amount not remembered');
  // switch to servings: quantity converts keeping grams
  const sv = nutella.servings[0]; const svRe = new RegExp('^' + sv.label);
  await chip(svRe).click(); await page.waitForTimeout(150);
  const conv = Number(await page.inputValue('.amount-sheet input[aria-label=Amount]')); pv = await preview();
  log(`switched to serving (${sv.grams} g): qty`, conv, 'grams', pv.grams); if (!near(conv, Math.round(50 / sv.grams * 1000) / 1000, 0.01) || !near(pv.grams, 50, 0.2)) fail('unit conversion wrong');
  await page.fill('.amount-sheet input[aria-label=Amount]', '2'); pv = await preview();
  log('2 servings preview:', JSON.stringify(pv));
  if (!near(pv.grams, 2 * sv.grams, 0.01) || !near(pv.kcal, nutella.per100.kcal * sv.grams * 2 / 100, 1) || !near(pv.protein, nutella.per100.protein * sv.grams * 2 / 100, 0.11)) fail('serving maths wrong');
  await page.fill('.amount-sheet input[aria-label=Amount]', '1.5'); pv = await preview(); if (!near(pv.grams, 1.5 * sv.grams, 0.01)) fail('decimal servings');
  await page.click('.amount-sheet >> text=Add to diary'); await page.waitForTimeout(400);
  // edit the logged 50 g entry -> 1 serving
  await page.goto(BASE + `#/food/${today}`); await page.waitForSelector('text=Snacks');
  const rows = page.locator('.card:has-text("Snacks") .item'); log('snack rows:', (await rows.allTextContents()).join(' || '));
  await page.locator('.card:has-text("Snacks") .item:has-text("50 g")').first().click(); await page.waitForSelector('.amount-sheet');
  const editUnit = await page.locator('.amount-sheet [role=radio][aria-checked=true]').textContent(); const editQty = await page.inputValue('.amount-sheet input[aria-label=Amount]');
  log('editing entry shows:', editUnit, editQty); if (editUnit !== 'grams' || editQty !== '50') fail('edit did not load logged unit');
  await chip(svRe).click(); await page.fill('.amount-sheet input[aria-label=Amount]', '1'); await page.click('text=Save changes'); await page.waitForTimeout(400);
  const ents = (await idb('diary')).filter((e) => e.foodId === 'off_3017620422003').sort((a, b) => a.created - b.created);
  log('nutella entries:', ents.map((e) => `${e.qty} × ${e.serving} = ${Math.round(e.grams * 10) / 10} g, ${Math.round(e.n.kcal)} kcal`).join(' ; '));
  if (!(ents.length === 2 && ents[0].serving === sv.label && ents[0].qty === 1 && near(ents[0].grams, sv.grams, 0.01) && near(ents[0].n.kcal, nutella.per100.kcal * sv.grams / 100, 0.5))) fail('edited entry wrong');
  if (!(ents[1].qty === 1.5 && near(ents[1].grams, 1.5 * sv.grams, 0.01))) fail('servings entry wrong');
  const shown = await page.locator('.card:has-text("Snacks") .item').allTextContents(); log('diary shows:', shown.join(' || '));
} catch (e) { fail('scanner/amount flow: ' + e.message); }

// ---- Barcode not found -> create custom food with barcode -> next scan finds it locally ----
const fake = '2913579246800'; // valid EAN-13 checksum, in-store range, not in OFF (checked 23/10/2026)
// (the fake camera always shows the Nutella code, so type this barcode into the search box; manual entry inside the scanner is tested in the no-camera context below)
await page.goto(BASE + `#/food/add/${today}/dinner`); await page.fill('input[type=search]', fake); await page.click('button[aria-label=Search]');
try {
  await page.waitForSelector('[data-testid=notfound]', { timeout: 25000 }); log('not-found offered custom food');
  const lbl = await page.getAttribute('[data-testid=scan-label-notfound]', 'href'); if (!lbl?.includes('#/food/label?barcode=')) fail('not-found card lacks label-scan link: ' + lbl); else log('not-found offers label scan', lbl);
  await page.click('text=Type it in manually');
  await page.waitForSelector('text=New custom food');
  const bcVal = await page.inputValue('label:has-text("Barcode") input'); log('barcode prefilled:', bcVal); if (bcVal !== fake) fail('barcode not prefilled');
  await page.fill('input[placeholder="e.g. Homemade protein oats"]', 'Butcher snags');
  await page.locator('label:has-text("Energy (kcal)") input').fill('250'); await page.locator('label:has-text("Protein (g)") input').fill('14'); await page.locator('label:has-text("Fat (g)") input').first().fill('20');
  await page.locator('header >> text=Save').click();
  await page.waitForSelector('.amount-sheet', { timeout: 8000 }); log('returned to amount screen for new food:', await page.locator('.sheet h2').textContent());
  const u = await page.locator('.amount-sheet [role=radio]').allTextContents(); if (u.length !== 1) fail('no-serving food should be grams only');
  // define a serving on the fly
  await page.click('[aria-label="Define a serving"]'); await page.fill('.amount-sheet input[placeholder="e.g. slice, cup, scoop"]', 'sausage'); await page.fill('.amount-sheet input[aria-label="Serving size"]', '75'); await page.click('text=Save serving');
  await page.waitForTimeout(200); await page.fill('.amount-sheet input[aria-label=Amount]', '2'); const pv2 = await preview(); log('2 sausages:', JSON.stringify(pv2)); if (!near(pv2.grams, 150, 0.01) || !near(pv2.kcal, 375, 1)) fail('defined serving maths');
  await page.click('.amount-sheet >> text=Add to diary'); await page.waitForTimeout(300);
  await page.goto(BASE + `#/food/add/${today}/dinner`); await page.fill('input[type=search]', fake); await page.click('button[aria-label=Search]');
  await page.waitForSelector('.amount-sheet', { timeout: 5000 }); log('rescan found locally:', await page.locator('.sheet h2').textContent());
  await page.keyboard.press('Escape');
} catch (e) { fail('not-found flow: ' + e.message); }

// ---- Legacy (v1) data migration ----
await page.evaluate(([today]) => new Promise((res) => { const r = indexedDB.open('grugfit'); r.onsuccess = () => { const tx = r.result.transaction(['foods', 'diary', 'kv'], 'readwrite');
  tx.objectStore('foods').put({ id: 'off_legacy1', name: 'Legacy Bix', source: 'off', per100: { kcal: 350, protein: 12, carbs: 70, fibre: 10, fat: 1.4 }, servings: [{ label: 'serving (33 g (2 biscuits))', grams: 33 }, { label: '100 g', grams: 100 }, { label: 'g', grams: 1 }] });
  tx.objectStore('diary').put({ id: 'legacyA', date: today, meal: 'breakfast', foodId: 'off_legacy1', name: 'Legacy Bix', grams: 66, qty: 2, serving: 'serving (33 g (2 biscuits))', n: { kcal: 231, protein: 7.9, carbs: 46.2, fibre: 6.6, fat: 0.9 }, created: 1 });
  tx.objectStore('diary').put({ id: 'legacyB', date: today, meal: 'breakfast', foodId: 'off_legacy1', name: 'Legacy Bix', grams: 150, qty: 1.5, serving: '100 g', n: { kcal: 525, protein: 18, carbs: 105, fibre: 15, fat: 2.1 }, created: 2 });
  tx.objectStore('kv').delete('schema'); tx.oncomplete = res; }; }), [today]);
await page.goto(BASE + `#/food/${today}`); await page.reload(); await page.waitForSelector('text=Breakfast');
const lf = await idb('foods', 'off_legacy1'); const la = await idb('diary', 'legacyA'); const lb = await idb('diary', 'legacyB');
log('migrated food servings:', JSON.stringify(lf.servings), '| A:', la.qty, la.serving, la.grams, la.n.kcal, '| B:', lb.qty, lb.serving, lb.grams, lb.n.kcal);
if (!(lf.servings.length === 1 && lf.servings[0].label === 'serving' && la.serving === 'serving' && la.qty === 2 && lb.serving === 'g' && lb.qty === 150 && lb.n.kcal === 525)) fail('migration');
const bt = await page.locator('.card:has-text("Breakfast") .item:has-text("Legacy")').allTextContents(); log('legacy entries display:', bt.join(' || '));
await page.locator('.card:has-text("Breakfast") .item:has-text("Legacy")').first().click(); await page.waitForSelector('.amount-sheet');
const lu = await page.locator('.amount-sheet [role=radio][aria-checked=true]').textContent(); const lq = await page.inputValue('.amount-sheet input[aria-label=Amount]'); log('legacy edit opens as:', lu, lq);
if (!/serving/.test(lu) || lq !== '2') fail('legacy entry edit unit');
await page.keyboard.press('Escape');
for (const id of ['legacyA', 'legacyB']) await page.evaluate((id) => new Promise((res) => { const r = indexedDB.open('grugfit'); r.onsuccess = () => { const tx = r.result.transaction('diary', 'readwrite'); tx.objectStore('diary').delete(id); tx.oncomplete = res; }; }), id);

// ---- Camera permission denied is handled ----
{
  const c2 = await browser.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' });
  const p2 = await c2.newPage();
  await p2.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')); });
  await p2.goto(BASE); await p2.click('[data-testid=ob-skip]'); await p2.waitForSelector("text=Today's nutrition"); await p2.goto(BASE + `#/food/add/${today}/lunch`); await p2.waitForSelector('[data-scan-open]'); await p2.click('[data-scan-open]');
  const st = await p2.waitForSelector('.scanner[data-status=denied]', { timeout: 8000 }).then(() => 'denied').catch(() => 'no');
  const manualVisible = await p2.locator('.scanner input[aria-label="Barcode number"]').isVisible();
  log('permission denied state:', st, '| manual entry visible:', manualVisible); if (st !== 'denied' || !manualVisible) fail('permission denial handling');
  if (SHOTS) await p2.screenshot({ path: 'screenshots/14-scanner-permission-denied.png' });
  // manual entry inside the scanner -> OFF lookup -> amount screen
  await p2.fill('.scanner input[aria-label="Barcode number"]', '3017620422003'); await p2.click('.scanner >> text=Look up');
  const okManual = await p2.waitForSelector('.amount-sheet', { timeout: 20000 }).then(() => true).catch(() => false); log('manual barcode entry in scanner -> amount screen:', okManual); if (!okManual) fail('manual entry in scanner');
  await c2.close();
}
await page.goto(BASE + `#/food/${today}`);
await page.waitForSelector('text=Breakfast');
const kcalRing = await page.locator('.ring').first().textContent(); log('diary kcal ring:', kcalRing);
const entries = await page.locator('.card .list .item').count(); log('diary entries:', entries); if (entries < 4) fail('diary entries missing');
const vitD = await page.locator('text=Vitamin D').first().locator('xpath=..').textContent(); log('vit D row:', vitD);
await shot('02-food-diary');
// copy previous day check (copy today's lunch into tomorrow)
const tomorrow = await page.evaluate(() => { const d = new Date(Date.now() + 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
await page.goto(BASE + `#/food/${tomorrow}`); await page.waitForSelector('text=Lunch');
await page.click('button[aria-label="Lunch menu"]'); await page.click('text=Copy lunch from previous day'); await page.waitForTimeout(500);
const copied = await page.locator('.card .list .item').count(); log('copied entries to tomorrow:', copied); if (copied !== 1) fail('copy meal');
await page.click('button[aria-label="Lunch menu"]'); await page.click('text=Clear meal'); await page.waitForTimeout(300);
await page.goto(BASE + '#/food/trends'); await page.waitForSelector('text=Daily'); await shot('07-trends');

// ---- Workouts: routine + 2 workouts (second should produce PR) ----
await page.goto(BASE + '#/routine/new');
await page.fill('input[placeholder="e.g. Push Day"]', 'Push Day');
await page.click('text=+ Add exercises');
await page.fill('.sheet input[type=search]', 'bench press barbell');
await page.locator('.sheet .item:has-text("Bench Press (Barbell)")').first().click();
await page.fill('.sheet input[type=search]', 'lateral raise dumbbell');
await page.locator('.sheet .item:has-text("Lateral Raise (Dumbbell)")').first().click();
await page.click('.sheet >> text=/Add 2 exercises/');
await page.locator('header >> text=Save').click();
await page.waitForSelector('text=Push Day');
async function doWorkout(kg, reps) {
  await page.goto(BASE + '#/workouts'); await page.waitForSelector('text=Routines');
  await page.click('text=Start routine');
  await page.waitForSelector('text=Bench Press (Barbell)');
  const card = page.locator('.card:has-text("Bench Press (Barbell)")');
  const rows = card.locator('tbody tr');
  for (let i = 0; i < 3; i++) { await rows.nth(i).locator('input[aria-label=Weight]').fill(String(kg)); await rows.nth(i).locator('input[aria-label=Weight]').blur(); await rows.nth(i).locator('input[aria-label=Reps]').fill(String(reps)); await rows.nth(i).locator('button[aria-label="Complete set"]').click(); }
  const lr = page.locator('.card:has-text("Lateral Raise")').locator('tbody tr').first();
  await lr.locator('input[aria-label=Weight]').fill('10'); await lr.locator('input[aria-label=Weight]').blur(); await lr.locator('input[aria-label=Reps]').fill('12'); await lr.locator('button[aria-label="Complete set"]').click();
}
await doWorkout(60, 8);
const restVisible = await page.locator('.rest').isVisible(); log('rest timer visible:', restVisible); if (!restVisible) fail('rest timer');
await page.click('header >> text=Finish'); await page.click('.sheet button:has-text("Finish")'); await page.waitForSelector('text=Workout complete');
await page.click('text=Done');
await doWorkout(65, 8);
const prevTxt = await page.locator('.card:has-text("Bench Press (Barbell)") td.prev').first().textContent(); log('previous column:', prevTxt); if (!/60/.test(prevTxt)) fail('previous performance not shown');
const prevAll = await page.locator('.card:has-text("Bench Press (Barbell)") td.prev').allTextContents(); log('prev all:', prevAll.join(' | ')); if (prevAll.some((t) => t.includes('—'))) fail('a previous set lost its weight');
// set type: make first set warm-up
await page.locator('.card:has-text("Bench Press (Barbell)") button.stype').first().click(); await page.click('.sheet >> text=Warm-up');
await page.waitForTimeout(200); await shot('03-active-workout');
await page.click('header >> text=Finish'); await page.click('.sheet button:has-text("Finish")'); await page.waitForSelector('text=Workout complete');
const prs = await page.locator('text=Personal records').count(); log('PR card shown:', prs); if (!prs) fail('PR not detected');
await shot('08-workout-summary');
await page.goto(BASE + '#/exercise/ex001'); await page.waitForSelector('text=History'); await shot('09-exercise-chart');
// body weight
await page.goto(BASE + '#/body'); await page.locator('label:has-text("Weight") input').fill('82.4'); await page.click('text=Log weight'); await page.waitForTimeout(300);
const bw = await page.locator('.list .item').count(); if (bw !== 1) fail('body weight');
// home
await page.goto(BASE); await page.waitForSelector('text=Last workout'); await page.waitForTimeout(300); await shot('01-home');
// settings + export
await page.goto(BASE + '#/settings'); await page.waitForSelector('text=Daily targets'); await shot('10-settings');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.click('text=Export all data')]);
if (dl) { const p = await dl.path(); const j = JSON.parse(await (await import('fs')).promises.readFile(p, 'utf8')); log('export stores:', Object.entries(j.data).map(([k, v]) => k + ':' + v.length).join(' ')); } else fail('no export download');
// offline reload
await ctx.setOffline(true); await page.reload(); const offOk = await page.waitForSelector('text=Daily targets', { timeout: 8000 }).then(() => true).catch(() => false); log('works offline after reload:', offOk); if (!offOk) fail('offline'); await ctx.setOffline(false);
log('errors:', errors.length ? errors : 'none');
await browser.close();
