// Real-Chrome installability audit (needs a display: HEADED=1 node tests/install-audit.mjs <url>). Uses a persistent (non-incognito) profile, where Chrome fires beforeinstallprompt.
import { chromium } from 'playwright';
const B = process.argv[2];
const ctx = await chromium.launchPersistentContext('/tmp/pwa-profile-' + Date.now(), { headless: process.env.HEADED ? false : true, args: ['--bypass-app-banner-engagement-checks'] }); const b = ctx; const p = ctx.pages()[0] || await ctx.newPage();
await p.addInitScript(() => { window.__bip = 0; addEventListener('beforeinstallprompt', () => { window.__bip++; }); });
const cdp = await ctx.newCDPSession(p);
await p.goto(B); await p.waitForTimeout(4000);
console.log('sw controller:', await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { scope: r?.scope, active: !!r?.active, controlled: !!navigator.serviceWorker.controller }; }));
console.log('installability:', JSON.stringify(await cdp.send('Page.getInstallabilityErrors')));
const m = await cdp.send('Page.getAppManifest'); console.log('manifest url:', m.url, 'errors:', JSON.stringify(m.errors));
try { console.log('manifest id:', JSON.stringify(await cdp.send('Page.getAppId'))); } catch (e) { console.log('appId n/a'); }
await p.reload(); await p.waitForTimeout(4000);
console.log('beforeinstallprompt fired:', await p.evaluate(() => window.__bip), '| standalone:', await p.evaluate(() => matchMedia('(display-mode: standalone)').matches));
// app wiring: our handler captured it → banner/Settings offer the native install
if (await p.locator('[data-testid=ob-skip]').count()) await p.click('[data-testid=ob-skip]'); console.log('home banner:', (await p.textContent('[data-testid=install-go]')).trim()); await p.goto(B + '#/settings'); await p.waitForSelector('[data-testid=settings-install]'); console.log('settings item:', (await p.textContent('[data-testid=settings-install]')).trim());
await b.close();
