import { chromium, devices } from 'playwright';
const U = process.argv[2];
const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['Pixel 7'] }); const p = await ctx.newPage();
await p.goto(U); await p.waitForTimeout(2000);
console.log('title:', await p.title()); console.log((await p.evaluate(() => document.body.innerText)).slice(0, 300));
const pw = p.locator('input[type=password]');
if (await pw.count()) { await pw.fill('My-Drop-Site'); await p.keyboard.press('Enter'); await p.waitForTimeout(4000); console.log('after pw title:', await p.title(), p.url()); }
await p.waitForSelector("text=Today's nutrition", { timeout: 15000 }).then(() => console.log('APP LOADED')).catch(() => console.log('app not loaded'));
console.log('sw:', await p.evaluate(async () => { try { const r = await Promise.race([navigator.serviceWorker.ready, new Promise((_, j) => setTimeout(() => j('timeout'), 8000))]); return r.active ? 'active ' + r.scope : 'no active'; } catch (e) { return 'ERR ' + e; } }));
const cdp = await ctx.newCDPSession(p); console.log('installability:', JSON.stringify(await cdp.send('Page.getInstallabilityErrors')));
await b.close();
