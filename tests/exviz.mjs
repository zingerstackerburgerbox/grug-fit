// Exercise visuals: thumbnails in picker/active workout/history, animated demo, reduced motion, custom exercise icon picker.
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' }); const page = await ctx.newPage(); page.setDefaultTimeout(10000);
page.on('pageerror', (e) => fail('pageerror ' + e.message));
await page.goto(BASE); await page.click('[data-testid=ob-skip]'); await page.waitForSelector("text=Today's nutrition");
await page.goto(BASE + '#/workouts'); await page.click('text=+ Start empty workout'); await page.click('text=+ Add exercise');
await page.waitForSelector('.sheet .list .exthumb svg');
const n = await page.locator('.sheet .list .exthumb svg').count(); log('picker thumbnails:', n); if (n < 80) fail('expected a thumbnail for every exercise');
await page.fill('.sheet input[type=search]', 'press'); await page.waitForTimeout(200);
await page.screenshot({ path: 'screenshots/22-picker-thumbnails.png' });
await page.fill('.sheet input[type=search]', ''); await page.waitForTimeout(100);
const sizes = await page.$$eval('.sheet .list .exthumb', (l) => l.map((x) => x.innerHTML.length)); const avg = Math.round(sizes.reduce((a, x) => a + x, 0) / sizes.length);
log('avg thumbnail SVG size (bytes):', avg); if (avg > 6000) fail('thumbnails too heavy');
await page.click('.sheet .item:has-text("Bench Press (Barbell)")'); await page.click('.sheet button:has-text("Add 1 exercise")');
await page.waitForSelector('button.exthumb.tap'); await page.click('button.exthumb.tap');
await page.waitForSelector('[data-testid=exdemo] .exanim svg');
const ph1 = await page.getAttribute('[data-testid=exdemo] .exanim', 'data-phase'); await page.waitForTimeout(700); const ph2 = await page.getAttribute('[data-testid=exdemo] .exanim', 'data-phase');
log('demo animation phase', ph1, '→', ph2); if (ph1 === ph2) fail('demo not animating');
await page.waitForTimeout(300); await page.screenshot({ path: 'screenshots/23-exercise-demo.png' });
await page.keyboard.press('Escape'); await page.goto(BASE + '#/exercise/ex052');
await page.waitForSelector('.exanim svg'); const d1 = await page.innerHTML('.exanim'); await page.waitForTimeout(500); const d2 = await page.innerHTML('.exanim');
log('exercise detail animates:', d1 !== d2); if (d1 === d2) fail('detail not animating');
// offscreen pause
await page.evaluate(() => { const el = document.querySelector('.exanim'); el.style.marginTop = '4000px'; }); await page.waitForTimeout(400);
const o1 = await page.getAttribute('.exanim', 'data-phase'); await page.waitForTimeout(500); const o2 = await page.getAttribute('.exanim', 'data-phase');
log('paused when offscreen:', o1 === o2); if (o1 !== o2) fail('animation keeps running offscreen');
// custom exercise icon picker
await page.goto(BASE + '#/exercises'); await page.click('text=+ Custom'); await page.fill('input[placeholder="e.g. Landmine Press"]', 'Landmine Row');
await page.locator('label:has-text("Muscle group") select').selectOption('Back'); await page.locator('label:has-text("Equipment") select').selectOption('Barbell');
await page.click('[aria-label="Picture: Back"]'); await page.click('text=Save exercise'); await page.waitForTimeout(300);
const saved = await page.evaluate(async () => { const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); }); return new Promise((r) => { const g = d.transaction('exercises').objectStore('exercises').getAll(); g.onsuccess = () => r(g.result.find((e) => e.name === 'Landmine Row')); }); });
log('custom exercise icon:', saved?.icon); if (saved?.icon !== 'g:Back') fail('custom icon not saved');
// reduced motion
const c2 = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark', reducedMotion: 'reduce' }); const p2 = await c2.newPage();
await p2.goto(BASE); await p2.click('[data-testid=ob-skip]'); await p2.waitForSelector("text=Today's nutrition"); await p2.goto(BASE + '#/exercise/ex001');
await p2.waitForSelector('.exanim'); const rm = await p2.locator('.exanim.rm svg').count(); log('reduced motion shows static start/end frames:', rm); if (rm !== 2) fail('reduced motion not respected');
await b.close();
if (failed) { console.log(`EXVIZ TEST FAILED (${failed})`); process.exit(1); } else console.log('EXVIZ TEST PASSED');
