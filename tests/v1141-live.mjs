// v1.14.1 live screenshots (390x844, dark, Halloween season as it is live): a seeded demo week in a throwaway browser profile
// (device-local IndexedDB only, nothing is sent anywhere; the profile is discarded at the end), Edit workout with + Add set buttons,
// a set row mid-swipe showing Delete, and the exercise ⋮ menu.
import { chromium } from 'playwright';
import { seedWeek } from './seed-week.mjs';
const BASE = process.env.BASE || 'https://zingerstackerburgerbox.github.io/grug-fit/';
const OUT = process.env.OUT || '/cursor/stores/store-ba4c5ff4-98dd-4ddd-94fb-5537ced61e1d/screenshots';
let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; }; const log = (...a) => console.log('•', ...a);
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark', timezoneId: 'Australia/Sydney' });
const page = await ctx.newPage(); page.setDefaultTimeout(30000);
await page.goto(BASE); await page.evaluate(() => localStorage.setItem('offpackAuto', '0'));
await page.fill('[data-testid=ob-username]', 'grug_demo'); await page.click('[data-testid=ob-next]'); await page.click('[data-testid=ob-skip]'); await page.waitForSelector("text=Today's nutrition");
await seedWeek(page); await page.reload(); await page.waitForSelector("text=Today's nutrition");
const x = page.locator('.season-notice button').last(); if (await x.count()) await x.click().catch(() => {});
const w = await page.evaluate(async () => { const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); }); const l = await new Promise((r) => { const q = d.transaction('workouts').objectStore('workouts').getAll(); q.onsuccess = () => r(q.result); }); d.close(); l.sort((a, b) => b.start - a.start); return l.find((w) => /Push/.test(w.name)) || l[0]; });
await page.goto(BASE + '#/settings'); const v = (await page.textContent('[data-testid=app-version]')).trim(); log('live version', v); if (v !== '1.14.1') fail('version ' + v);
await page.goto(BASE + `#/history/${w.id}?edit=1`); await page.waitForSelector('[data-testid=ex-card]');
const cards = page.locator('[data-testid=ex-card]'); log('editing', w.name, await cards.count(), 'exercises,', await page.locator('[data-testid=add-set]').count(), 'Add set buttons');
await page.evaluate(() => { const c = document.querySelectorAll('[data-testid=ex-card]')[1]; window.scrollBy(0, c.getBoundingClientRect().top - 120); }); await page.waitForTimeout(400);
await page.screenshot({ path: `/tmp/v1141-edit-add-set.png` });
// mid-swipe: finger down on set 2 of the second exercise, dragged ~110 px left, screenshot, then let go back closed
const row = cards.nth(1).locator('.set-row').nth(1); const bb = await row.boundingBox(); const sx = bb.x + bb.width * 0.08, sy = bb.y + bb.height / 2;
await page.mouse.move(sx, sy); await page.mouse.down(); for (let k = 1; k <= 10; k++) await page.mouse.move(sx + 11 * k, sy); await page.waitForTimeout(150);
const tf = await row.evaluate((e) => e.style.transform); log('mid-swipe transform:', tf); if (!/translateX\([1-9]\d*/.test(tf)) fail('row not swiping');
await page.screenshot({ path: `${OUT}/v1141-swipe-delete.png` });
for (let k = 9; k >= 0; k--) await page.mouse.move(sx + 11 * k, sy); await page.mouse.up(); await page.waitForTimeout(300);
await cards.nth(1).locator('[data-testid=ex-menu]').click(); await page.waitForSelector('[data-testid=ex-menu-sheet]'); await page.waitForTimeout(300);
await page.screenshot({ path: `/tmp/v1141-exercise-menu.png` }); await page.keyboard.press('Escape');
await page.click('text=Cancel editing'); await page.waitForSelector('[data-testid=edit-workout]');
await ctx.close(); await b.close(); log('demo profile discarded (seeded data lived only in this throwaway browser context)');
if (failed) process.exit(1); console.log('V1141 LIVE PASSED');
