// v1.13.1 live screenshots (390x844, dark): Settings with the single "API key" row, and the opened API key screen (empty fields, no key).
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'https://zingerstackerburgerbox.github.io/grug-fit/';
const OUT = process.env.OUT || '/cursor/stores/store-ba4c5ff4-98dd-4ddd-94fb-5537ced61e1d/screenshots';
let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; }; const log = (...a) => console.log('•', ...a);
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark', timezoneId: 'Australia/Sydney' });
const page = await ctx.newPage(); page.setDefaultTimeout(30000);
await page.goto(BASE); await page.fill('[data-testid=ob-username]', 'grug_live'); await page.click('[data-testid=ob-next]'); await page.click('[data-testid=ob-skip]'); await page.waitForSelector("text=Today's nutrition");
await page.goto(BASE + '#/settings'); await page.waitForSelector('[data-testid=api-key-row]');
await page.waitForTimeout(1500); const x = page.locator('.toast button, [role=status] button').last(); if (await x.count()) await x.click().catch(() => {}); // season notice out of the shot
const v = (await page.textContent('[data-testid=app-version]')).trim(); log('live version', v); if (v !== '1.13.1') fail('version ' + v);
for (const t of ['coach-key', 'coach-owner', 'usda-key']) if (await page.locator(`[data-testid=${t}]`).count()) fail(t + ' on main Settings');
log('row:', (await page.textContent('[data-testid=api-key-row]')).replace(/\s+/g, ' ').trim());
await page.evaluate(() => { const h = [...document.querySelectorAll('h2')].find((x) => x.textContent === 'Food lookup'); window.scrollBy(0, h.getBoundingClientRect().top - 70); });
await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/v1131-settings-row.png` });
await page.click('[data-testid=api-key-row]'); await page.waitForSelector('[data-testid=coach-key]');
if (await page.inputValue('[data-testid=coach-key]') || await page.inputValue('[data-testid=coach-owner]') || await page.inputValue('[data-testid=usda-key]')) fail('a key is filled in');
await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/v1131-api-key-menu.png` }); log('url', page.url());
await b.close(); if (failed) process.exit(1); console.log('V1131 LIVE PASSED');
