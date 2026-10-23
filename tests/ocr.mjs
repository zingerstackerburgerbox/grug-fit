// End-to-end OCR accuracy test: synthetic AU/NZ + US labels (clean, photo-like, low-res) → label scanner → review screen.
import { chromium, devices } from 'playwright';
import fs from 'fs'; import { execFileSync } from 'child_process';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const DIR = 'tests/labels/';
if (!fs.existsSync(DIR + 'truth.json')) execFileSync('node', ['tests/make-labels.mjs'], { stdio: 'inherit' });
const truth = JSON.parse(fs.readFileSync(DIR + 'truth.json', 'utf8'));
const only = process.argv[2];
const browser = await chromium.launch(); const ctx = await browser.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' });
const page = await ctx.newPage(); page.setDefaultTimeout(20000);
page.on('pageerror', (e) => console.log('PAGEERROR', e.message)); page.on('dialog', (d) => d.accept());
const today = new Date(); const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
await page.goto(BASE); await page.fill('[data-testid=ob-username]', 'grug_tester').then(() => page.click('[data-testid=ob-next]')).then(() => page.click('[data-testid=ob-skip]')); await page.waitForSelector('text=Today\'s nutrition');
const close = (a, b) => a != null && Math.abs(a - b) <= (b >= 100 ? 1 : 0.051); // exact to the label's precision (±1 for derived kcal/mg)
let total = 0, ok = 0; const rows = []; let fails = 0;
for (const [name, t] of Object.entries(truth)) {
  if (only && !name.includes(only)) continue;
  const file = DIR + name + (fs.existsSync(DIR + name + '.png') ? '.png' : '.jpg');
  await page.goto(BASE + `#/food/label?barcode=9300000000${String(total).padStart(3, '0')}&ret=${ymd}/snack`);
  await page.setInputFiles('[data-testid=label-file]', file);
  await page.click('[data-testid=read-label]');
  await page.waitForSelector('[data-testid=label-review]', { timeout: 120000 });
  const r = await page.evaluate(() => { const o = window.__ocr; return { per100: o.parsed.per100, style: o.parsed.style, ss: o.parsed.servingSize, spp: o.parsed.servingsPerPack, flagged: o.parsed.flagged, warnings: o.parsed.warnings, pass: o.pass, ms: o.ms, text: o.lines.map((l) => Math.round(l.conf) + '% ' + l.text).join('\n') }; });
  const fieldRes = {}; let nOk = 0, n = 0;
  for (const [k, v] of Object.entries(t.per100)) { n++; const good = close(r.per100[k], v); if (good) nOk++; fieldRes[k] = good ? '✓' : `✗ got ${r.per100[k] ?? '—'} want ${v}${r.flagged.includes(k) ? ' (flagged)' : ''}`; }
  for (const [k, got, want] of [['servingSize', r.ss, t.servingSize], ['servingsPerPack', r.spp, t.servingsPerPack]]) { n++; const good = got === want; if (good) nOk++; fieldRes[k] = good ? '✓' : `✗ got ${got ?? '—'} want ${want}`; }
  n++; if (r.style === t.style) nOk++; else fieldRes.style = `✗ ${r.style}`;
  total += n; ok += nOk;
  const wrongUnflagged = Object.entries(fieldRes).filter(([k, v]) => v.startsWith('✗') && !v.includes('flagged')).map(([k]) => k);
  rows.push({ name, acc: `${nOk}/${n}`, pass: r.pass, s: (r.ms / 1000).toFixed(1), wrong: Object.entries(fieldRes).filter(([, v]) => v !== '✓').map(([k, v]) => `${k}: ${v}`).join('; '), warnings: r.warnings.length });
  console.log(`\n=== ${name}: ${nOk}/${n} fields (${r.pass} pass, ${(r.ms / 1000).toFixed(1)} s)`, Object.entries(fieldRes).filter(([, v]) => v !== '✓').map(([k, v]) => `${k}: ${v}`).join(' | ') || 'all correct');
  if (r.warnings.length) console.log('  warnings:', r.warnings.join(' / '));
  if (process.env.VERBOSE || nOk < n) console.log(r.text.split('\n').map((l) => '    ' + l).join('\n'));
  if (!name.includes('-') && nOk < n) fails++; // clean renders must be read perfectly
  if (name === 'au-muesli') { // full flow: review → save → amount sheet → log → barcode is linked
    await page.screenshot({ path: 'screenshots/16-label-review.png', fullPage: false });
    await page.click('[data-testid=label-save]');
    await page.waitForSelector('.amount-sheet'); await page.waitForTimeout(300);
    await page.screenshot({ path: 'screenshots/17-label-amount.png' });
    const linked = await page.evaluate(async () => { const req = indexedDB.open('grugfit'); const d = await new Promise((r) => (req.onsuccess = () => r(req.result))); return new Promise((res) => { const g = d.transaction('foods').objectStore('foods').index('barcode').get('9300000000000'); g.onsuccess = () => res(g.result && { name: g.result.name, per100: g.result.per100, servings: g.result.servings }); }); });
    console.log('  saved food:', JSON.stringify(linked));
    if (!linked || linked.per100.carbs !== 71.1) { console.log('FAIL: saved food wrong (AU carbs should be 62 + 9.1 fibre = 71.1 total)'); fails++; }
    await page.click('button:has-text("Add to diary")'); await page.waitForTimeout(500);
  }
}
if (!only) {
  await page.goto(BASE + `#/food/label?ret=${ymd}/snack`); await page.setInputFiles('[data-testid=label-file]', DIR + 'au-yoghurt-photo.jpg'); await page.waitForSelector('[data-testid=cropbox]');
  await page.screenshot({ path: 'screenshots/18-label-crop.png' });
}
console.log(`\nOVERALL field accuracy: ${ok}/${total} = ${(100 * ok / total).toFixed(1)}%`);
console.table(rows);
await browser.close();
if (fails) { console.log('FAIL: clean label(s) not parsed perfectly / flow failure'); process.exit(1); } else console.log('OCR TEST PASSED');
