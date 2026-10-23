// v1.8.5 e2e: Settings › Daily targets – changing calories scales protein/carbs/fat live (before saving), fibre stays,
// editing a macro changes only that macro; "Recalculate targets" keeps the current macro ratio at the suggested calories.
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark', locale: 'en-AU', timezoneId: 'Australia/Sydney' });
const page = await ctx.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', (e) => fail('pageerror ' + e.message));
const idb = (src) => page.evaluate(async (src) => { const d = await new Promise((r) => { const q = indexedDB.open('grugfit'); q.onsuccess = () => r(q.result); });
  const tx = (s, m = 'readonly') => d.transaction(s, m).objectStore(s); const p = (q) => new Promise((r, j) => { q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
  const res = await new Function('tx', 'p', `return (async () => { ${src} })()`)(tx, p); d.close(); return res; }, src);
const vals = () => page.evaluate(() => Object.fromEntries(['kcal', 'protein', 'carbs', 'fat', 'fibre'].map((k) => [k, document.querySelector(`[data-testid=target-${k}]`).value])));
const J = JSON.stringify;
await page.goto(BASE); await page.fill('[data-testid=ob-username]', 'grug_tester').then(() => page.click('[data-testid=ob-next]')).then(() => page.click('[data-testid=ob-skip]')); await page.waitForSelector("text=Today's nutrition");
await idb(`const s = await p(tx('kv').get('settings')); s.targets = { ...s.targets, kcal: 2000, protein: 200, carbs: 150, fat: 60, fibre: 30 }; await p(tx('kv','readwrite').put(s));`);
await page.goto(BASE + '#/settings'); await page.waitForSelector('[data-testid=target-kcal]'); await page.waitForFunction(() => document.querySelector('[data-testid=target-kcal]').value === '2000');
// type 1000 key by key – values update live from the pre-edit base (no compounding rounding)
await page.fill('[data-testid=target-kcal]', ''); await page.locator('[data-testid=target-kcal]').pressSequentially('1000');
let v = await vals(); log('typed 1000 kcal (not saved yet):', J(v)); if (J(v) !== J({ kcal: '1000', protein: '100', carbs: '75', fat: '30', fibre: '30' })) fail('live scaling 2000 → 1000');
const stored = await idb(`return (await p(tx('kv').get('settings'))).targets.protein`); if (stored !== 200) fail('nothing saved before Save');
await page.locator('[data-testid=target-kcal]').scrollIntoViewIfNeeded(); await page.evaluate(() => scrollBy(0, -90)); await page.screenshot({ path: 'screenshots/56-targets-scaled.png' });
await page.click('text=Save targets'); await page.waitForTimeout(300);
const t1 = await idb(`const t = (await p(tx('kv').get('settings'))).targets; return [t.kcal, t.protein, t.carbs, t.fat, t.fibre]`); log('saved:', J(t1)); if (J(t1) !== J([1000, 100, 75, 30, 30])) fail('saved values');
// edit one macro → only it changes
await page.fill('[data-testid=target-protein]', '120'); v = await vals(); log('edit protein → 120:', J(v)); if (J(v) !== J({ kcal: '1000', protein: '120', carbs: '75', fat: '30', fibre: '30' })) fail('macro edit cascaded');
// calories again → scales from the edited values
await page.fill('[data-testid=target-kcal]', '1500'); v = await vals(); log('then 1500 kcal:', J(v)); if (J(v) !== J({ kcal: '1500', protein: '180', carbs: '113', fat: '45', fibre: '30' })) fail('scale after macro edit');
await page.click('text=Save targets'); await page.waitForTimeout(300);
// recalculation from the profile keeps the current ratio (P 180 : C 113 : F 45 at 1500)
await idb(`const s = await p(tx('kv').get('settings')); s.profile = { heightCm: 180, sex: 'male', birthYear: 1990, goal: 'cut' }; await p(tx('kv','readwrite').put(s)); await p(tx('bodyweight','readwrite').put({ id: 'bw1', date: '2026-01-01', kg: 85 }));`);
await page.goto(BASE + '#/welcome?step=result&from=settings'); await page.waitForSelector('[aria-label="Target calories"]'); await page.waitForTimeout(300);
const ob = await page.evaluate(() => ['calories', 'protein', 'carbs', 'fat'].map((k) => Number(document.querySelector(`[aria-label="Target ${k}"]`).value)));
const exp = [180, 113, 45].map((x) => Math.round((x * ob[0]) / 1500)); log('recalculate (cut):', J(ob), 'expected macros', J(exp)); if (J(ob.slice(1)) !== J(exp)) fail('onboarding ratio');
await page.fill('[aria-label="Target calories"]', '3000'); await page.waitForTimeout(100);
const ob2 = await page.evaluate(() => ['protein', 'carbs', 'fat'].map((k) => Number(document.querySelector(`[aria-label="Target ${k}"]`).value))); log('…edit to 3000 kcal there:', J(ob2));
if (J(ob2) !== J(exp.map((x) => Math.round((x * 3000) / ob[0])))) fail('onboarding live scaling');
await b.close(); if (failed) { console.error(failed + ' FAILURES'); process.exit(1); } console.log('TARGETS TESTS PASSED');
