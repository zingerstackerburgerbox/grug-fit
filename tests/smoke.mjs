import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const SHOTS = process.env.SHOTS !== '0';
const log = (...a) => console.log('•', ...a);
const browser = await chromium.launch({ args: ['--enable-features=BarcodeDetector'] });
const ctx = await browser.newContext({ ...devices['Pixel 7'], colorScheme: 'dark', permissions: ['notifications'] });
const page = await ctx.newPage(); page.setDefaultTimeout(12000);
const errors = [];
page.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); console.log('PAGEERROR', e.message); });
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
page.on('dialog', async (d) => { log('dialog:', d.type(), d.message().slice(0, 60)); if (d.type() === 'prompt') await d.accept(d.defaultValue() || '100'); else await d.accept(); });
const shot = async (n) => { if (!SHOTS) return; await page.waitForSelector('.toast', { state: 'detached', timeout: 4000 }).catch(() => {}); await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(150); await page.screenshot({ path: `screenshots/${n}.png` }); };
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };

await page.goto(BASE);
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
  await page.waitForSelector('.list .item', { timeout: 45000 });
  const n = await page.locator('.list .item').count(); log('OFF search results:', n);
  await shot('06-food-search');
  await page.locator('.list .item').first().click();
  await page.waitForSelector('text=Add to diary');
  await page.click('text=Add to diary'); await page.waitForTimeout(400);
} catch (e) { fail('OFF search: ' + e.message); await shot('06-food-search'); }
// barcode lookup (Nutella AU-ish code, well known in OFF)
await page.goto(BASE + `#/food/add/${today}/snacks`);
await page.click('button[aria-label="Scan barcode"]');
await page.waitForSelector('text=Scan barcode');
await page.fill('input[placeholder^="Barcode number"]', '3017620422003');
await page.click('text=Look up');
try { await page.waitForSelector('text=Add to diary', { timeout: 20000 }); log('barcode found:', await page.locator('.sheet h2').textContent()); await page.locator('.sheet select').selectOption({ label: 'g' }).catch(() => {}); await page.fill('.sheet input[inputmode=decimal]', '20'); await page.click('text=Add to diary'); } catch (e) { fail('barcode lookup ' + e.message); }
await page.waitForTimeout(400);
await page.goto(BASE + `#/food/${today}`);
await page.waitForSelector('text=Breakfast');
const kcalRing = await page.locator('.ring').first().textContent(); log('diary kcal ring:', kcalRing);
const entries = await page.locator('.card .list .item').count(); log('diary entries:', entries); if (entries < 2) fail('diary entries missing');
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
