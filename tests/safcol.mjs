// Regression: Safcol No Net Tuna in Spring Water 185 g, EAN-13 9310768114941 (Erik's bug report, v1.5.1).
// Lookup (mocked OFF variants + live OFF) and decoding (synthetic curved/angled/soft EAN-13 through the app's ZXing passes;
// plus Erik's own photo if SAFCOL_PHOTO points at it — the photo is NOT committed).
import { chromium, devices } from 'playwright';
import { buildSync } from 'esbuild';
import fs from 'fs';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/'; const LIVE = process.env.OFF_LIVE !== '0';
const CODE = '9310768114941';
const log = (...a) => console.log('•', ...a); let failed = 0; const fail = (m) => { console.error('FAIL:', m); failed++; };
const near = (a, b, t = 0.6) => Math.abs(a - b) <= t;
// OFF v2 response for this product (values from Open Food Facts, ODbL)
const PRODUCT = { code: CODE, product_name: 'No Net Tuna in Spring Water', product_name_en: 'No Net Tuna in Spring Water', brands: 'Safcol', countries_tags: ['en:australia'], nutrition_data_per: '100g', product_quantity: 185, product_quantity_unit: 'g', quantity: '185g',
  nutriments: { 'energy-kcal_100g': 120.4, 'energy-kj_100g': 485, energy_100g: 485, proteins_100g: 25.5, fat_100g: 1.6, 'saturated-fat_100g': 0.5, carbohydrates_100g: 1, sugars_100g: 1, fiber_100g: 0, sodium_100g: 0.0492, salt_100g: 0.123 } };
const b = await chromium.launch();

// ---------- lookup ----------
const ctx = await b.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' }); await ctx.addInitScript(() => { localStorage.setItem('foodPack', '0'); localStorage.setItem('coachProxyUrl', 'https://REPLACE-ME.test'); }); // v1.13.0: exercise the direct Open Food Facts path these mocks target
const page = await ctx.newPage(); page.setDefaultTimeout(20000);
page.on('pageerror', (e) => fail('pageerror ' + e.message));
let mode = 'ok', calls = [];
await ctx.route(/openfoodfacts\.org\/api\/v\d\/product\/9310768114941/, async (r) => {
  const u = r.request().url(); calls.push(u.match(/api\/(v\d)/)[1]);
  if (mode === 'live') return r.continue();
  if (mode === '503') return r.fulfill({ status: 503, body: 'busy' });
  if (mode === 'hang-then-v0') { if (u.includes('/v2/')) { await new Promise((res) => setTimeout(res, 11000)); return r.fulfill({ status: 200, body: '{}' }).catch(() => {}); } }
  if (mode === 'html') return r.fulfill({ status: 200, contentType: 'text/html', body: '<html>maintenance</html>' });
  let p = PRODUCT;
  if (mode === 'kj') { const n = { ...PRODUCT.nutriments }; delete n['energy-kcal_100g']; delete n['energy-kj_100g']; p = { ...PRODUCT, nutriments: n }; }
  return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: CODE, product: p, status: mode === 'v3' ? 'success' : 1 }) });
});
const idbPut = (store, v) => page.evaluate(([store, v]) => new Promise((res) => { const r = indexedDB.open('grugfit'); r.onsuccess = () => { const tx = r.result.transaction(store, 'readwrite'); tx.objectStore(store).put(v); tx.oncomplete = () => { r.result.close(); res(); }; }; }), [store, v]);
const idbDel = (store, id) => page.evaluate(([store, id]) => new Promise((res) => { const r = indexedDB.open('grugfit'); r.onsuccess = () => { const tx = r.result.transaction(store, 'readwrite'); tx.objectStore(store).delete(id); tx.oncomplete = () => { r.result.close(); res(); }; }; }), [store, id]);
await page.goto(BASE); await page.fill('[data-testid=ob-username]', 'grug_tester').then(() => page.click('[data-testid=ob-next]')).then(() => page.click('[data-testid=ob-skip]')); await page.waitForSelector("text=Today's nutrition");
const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
const typeCode = async () => { await idbDel('foods', 'off_' + CODE); await page.goto(BASE + '#/'); await page.waitForSelector("text=Today's nutrition"); await page.goto(BASE + `#/food/add/${today}/lunch`); await page.fill('input[type=search]', CODE); await page.click('button[aria-label=Search]'); };
const outcome = (ms = 30000) => Promise.race([page.waitForSelector('.amount-sheet', { timeout: ms }).then(() => 'found'), page.waitForSelector('[data-testid=notfound]', { timeout: ms }).then(() => 'notfound')]).catch(() => 'timeout');
const preview = async () => { const v = {}; for (const k of ['kcal', 'protein', 'carbs', 'fat']) v[k] = Number(await page.locator(`[data-testid=preview] [data-k=${k}]`).textContent()); v.grams = Number(((await page.textContent('[data-testid=grams]')).match(/= ([\d.]+)/) || [])[1]); v.micros = await page.textContent('[data-testid=grams]'); return v; };
const checkTuna = async (label) => {
  const title = await page.locator('.sheet h2').textContent(); const sub = await page.locator('.amount-sheet .mut.sm').first().textContent();
  if (title !== 'No Net Tuna in Spring Water' || !/Safcol/.test(sub)) fail(`${label}: wrong product ${title} / ${sub}`);
  // v1.5.2: label serving 65 g (default) + ~130 g drained tuna per can; the 185 g gross can (incl. water) is never offered
  const units = await page.locator('.amount-sheet [role=radio]').allTextContents(); log(`${label} units:`, units.join(' | '));
  if (units.some((u) => /185/.test(u))) fail(`${label}: 185 g can (incl. water) offered as a serving (${units.join(' | ')})`);
  if (!units.some((u) => /^1 serving \(65 g\)/.test(u)) || !units.some((u) => /^1 can, drained \(130 g\)/.test(u))) fail(`${label}: servings wrong (${units.join(' | ')})`);
  const def = await page.locator('.amount-sheet [role=radio][aria-checked=true]').textContent(); const dq = await page.inputValue('.amount-sheet input[aria-label=Amount]');
  const sv = await preview(); log(`${label} default ${def} × ${dq}:`, JSON.stringify({ ...sv, micros: undefined }));
  if (!/^1 serving/.test(def) || dq !== '1' || !near(sv.grams, 65, 0.01) || !near(sv.kcal, 78, 1) || !near(sv.protein, 16.6, 0.05)) fail(`${label}: default serving wrong`);
  await page.locator('.amount-sheet [role=radio]').filter({ hasText: /^grams$/ }).click(); await page.fill('.amount-sheet input[aria-label=Amount]', '100');
  const g = await preview(); log(`${label} 100 g:`, JSON.stringify(g));
  if (!near(g.kcal, 120, 1) || !near(g.protein, 25.5, 0.05) || !near(g.fat, 1.6, 0.05) || !near(g.carbs, 1, 0.05) || !/Sodium 49\.2 mg/.test(g.micros)) fail(`${label}: per-100 g macros wrong`);
  await page.locator('.amount-sheet [role=radio]').filter({ hasText: /can, drained/ }).click(); await page.fill('.amount-sheet input[aria-label=Amount]', '1');
  const p = await preview(); log(`${label} 1 can drained:`, JSON.stringify({ ...p, micros: undefined }));
  if (!near(p.grams, 130, 0.01) || !near(p.kcal, 157, 1) || !near(p.protein, 33.2, 0.1)) fail(`${label}: drained can maths wrong`);
  await page.locator('.amount-sheet [role=radio]').filter({ hasText: /^1 serving/ }).click(); await page.fill('.amount-sheet input[aria-label=Amount]', '1');
};
await typeCode(); if (await outcome() !== 'found') fail('mocked OFF: not found'); else { log('OFF request:', calls.join(',')); await checkTuna('mock'); }
mode = 'v3'; calls = []; await typeCode(); if (await outcome() !== 'found') fail('status "success" not accepted'); else log('status "success" accepted');
mode = 'kj'; await typeCode(); if (await outcome() !== 'found') fail('kJ-only not found'); else { await page.locator('.amount-sheet [role=radio]').filter({ hasText: /^grams$/ }).click(); await page.fill('.amount-sheet input[aria-label=Amount]', '100'); const k = (await preview()).kcal; log('kJ-only → kcal/100 g', k); if (!near(k, 116, 1)) fail('kJ conversion'); }
mode = 'hang-then-v0'; calls = []; const t0 = Date.now(); await typeCode(); const ho = await outcome(40000); log('v2 timeout → v0 retry:', ho, Date.now() - t0, 'ms', calls.join(',')); if (ho !== 'found' || !calls.includes('v0')) fail('timeout retry failed');
// 503 twice → not-found card with reason + Retry; then OFF recovers and Retry finds it
mode = '503'; await typeCode(); if (await outcome() !== 'notfound') fail('503 not surfaced'); else {
  const d = await page.textContent('[data-testid=lookup-diag]'); const head = await page.textContent('[data-testid=notfound] .sm'); log('503 card:', head.slice(0, 90), '| diag:', d);
  if (!/OFF: server busy \(HTTP 503\)/.test(d) || !/USDA/.test(d)) fail('diag missing reason');
  await page.screenshot({ path: 'screenshots/30-lookup-retry.png' });
  mode = 'ok'; await page.click('[data-testid=retry-lookup]'); if (await outcome() !== 'found') fail('Retry lookup did not recover'); else log('Retry lookup → found');
}
mode = 'html'; await typeCode(); if (await outcome() !== 'notfound') fail('garbled body'); else { const d = await page.textContent('[data-testid=lookup-diag]'); log('garbled body diag:', d); if (!/unreadable response/.test(d)) fail('parse reason missing'); }
// a saved food with this barcode but no nutrition (abandoned manual entry) must not hide the OFF result
mode = 'ok'; await idbPut('foods', { id: 'cfempty', name: 'tuna?', source: 'custom', barcode: CODE, per100: { kcal: 0, protein: 0, carbs: 0, fibre: 0, fat: 0 }, servings: [] });
await typeCode(); if (await outcome() !== 'found' || (await page.locator('.sheet h2').textContent()) !== 'No Net Tuna in Spring Water') fail('empty local food shadowed OFF'); else log('empty saved food with same barcode → OFF result shown');
await idbDel('foods', 'cfempty');
// ---- user-edited servings: persist per barcode, survive OFF re-fetch and removal of the saved food ----
const idbGet = (store, id) => page.evaluate(([store, id]) => new Promise((res) => { const r = indexedDB.open('grugfit'); r.onsuccess = () => { const q = r.result.transaction(store).objectStore(store).get(id); q.onsuccess = () => { r.result.close(); res(q.result); }; }; }), [store, id]);
await typeCode(); await outcome(); await page.waitForTimeout(200);
await page.screenshot({ path: 'screenshots/32-tuna-servings.png' });
await page.click('[data-testid=edit-servings]'); await page.waitForSelector('[data-testid=servings-editor]');
await page.screenshot({ path: 'screenshots/33-edit-servings.png' });
await page.click('text=＋ Add serving'); await page.locator('.amount-sheet input[aria-label="Serving name"]').last().fill('sandwich');
await page.locator('.amount-sheet input[aria-label="Serving grams"]').last().fill('40'); await page.check('.amount-sheet input[aria-label="Default: sandwich"]');
await page.locator('.amount-sheet input[aria-label="Serving grams"]').first().fill('70'); // serving 65 → 70
await page.click('[aria-label="Delete can, drained"]'); await page.click('[data-testid=save-servings]'); await page.waitForTimeout(300);
let u = await page.locator('.amount-sheet [role=radio]').allTextContents(); let on = await page.locator('.amount-sheet [role=radio][aria-checked=true]').textContent();
log('after edit:', u.join(' | '), '| default:', on); if (u.join('|') !== 'grams|1 serving (70 g)|1 sandwich (40 g)' || !/sandwich/.test(on)) fail('servings edit not applied');
const kvo = await idbGet('kv', 'servings:' + CODE); log('stored override:', JSON.stringify(kvo)); if (!kvo || kvo.def !== 'sandwich') fail('override not stored by barcode');
await page.keyboard.press('Escape');
// re-fetch from OFF (typeCode deletes the saved food first) — user's servings must win
await typeCode(); await outcome(); u = await page.locator('.amount-sheet [role=radio]').allTextContents(); on = await page.locator('.amount-sheet [role=radio][aria-checked=true]').textContent();
log('rescan after edit:', u.join(' | '), '| default:', on); if (u.join('|') !== 'grams|1 serving (70 g)|1 sandwich (40 g)' || !/sandwich/.test(on)) fail('user servings lost on OFF re-fetch');
await page.keyboard.press('Escape'); await idbDel('kv', 'servings:' + CODE);
// ---- logged 185 g cans: one-time note, nothing changed without consent ----
const ent = (id, d) => ({ id, date: d, meal: 'lunch', foodId: 'off_' + CODE, name: 'No Net Tuna in Spring Water (Safcol)', grams: 185, qty: 1, serving: 'package', n: { kcal: 222.7, protein: 47.2, carbs: 1.9, fibre: 0, fat: 3 }, created: 5 });
const yest = await page.evaluate(() => { const d = new Date(Date.now() - 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
await idbPut('diary', ent('tunaA', yest)); await idbPut('diary', { ...ent('tunaB', today), qty: 2, grams: 370, n: { kcal: 445.4, protein: 94.4, carbs: 3.7, fibre: 0, fat: 5.9 } });
await page.goto(BASE + `#/food/${today}`); await page.waitForSelector('[data-testid=fix-note]', { timeout: 8000 }).catch(() => fail('fix note not shown'));
log('fix note:', (await page.textContent('[data-testid=fix-note]')).replace(/\s+/g, ' '));
const untouched = await idbGet('diary', 'tunaA'); if (untouched.grams !== 185) fail('history changed before consent');
await page.screenshot({ path: 'screenshots/34-fix-note.png' });
await page.click('[data-testid=fix-apply]'); await page.waitForTimeout(400);
const fa = await idbGet('diary', 'tunaA'), fb = await idbGet('diary', 'tunaB'); log('corrected:', fa.grams, fa.serving, Math.round(fa.n.kcal), '|', fb.qty, '×', fb.grams, Math.round(fb.n.kcal), fb.n.protein.toFixed(1));
if (!(fa.grams === 130 && near(fa.n.kcal, 156.5, 1) && fb.grams === 260 && near(fb.n.protein, 66.3, 0.2) && fa.serving === 'can, drained')) fail('correction maths');
await page.reload(); await page.waitForSelector('text=Snacks'); await page.waitForTimeout(500); if (await page.locator('[data-testid=fix-note]').count()) fail('note shown again after fixing');
// "Keep as logged" leaves history alone and never asks again
await idbDel('kv', 'fix:' + CODE); await idbPut('diary', ent('tunaC', today)); await page.reload(); await page.waitForSelector('[data-testid=fix-note]');
await page.click('[data-testid=fix-keep]'); await page.waitForTimeout(300); const fc = await idbGet('diary', 'tunaC'); if (fc.grams !== 185 || fc.n.kcal !== 222.7) fail('keep changed history');
await page.reload(); await page.waitForSelector('text=Snacks'); await page.waitForTimeout(500); if (await page.locator('[data-testid=fix-note]').count()) fail('note shown again after keep'); else log('keep as logged → unchanged, not asked again');
for (const id of ['tunaA', 'tunaB', 'tunaC']) await idbDel('diary', id);
if (LIVE) { mode = 'live'; calls = []; await typeCode(); const o = await outcome(); if (o !== 'found') fail('LIVE OFF: ' + o + ' ' + (await page.locator('[data-testid=lookup-diag]').textContent().catch(() => ''))); else { await checkTuna('live'); await page.screenshot({ path: 'screenshots/31-safcol-tuna.png' }); } }
await ctx.close();

// ---------- OFF → servings rules (unit) ----------
{
  const oj = buildSync({ entryPoints: ['src/off.ts'], bundle: true, format: 'iife', globalName: 'OFFM', write: false }).outputFiles[0].text;
  const up = await b.newPage(); await up.setContent(`<script>${oj}</script>`);
  const S = (p) => up.evaluate((p) => OFFM.offToFood(p).servings.map((s) => `${s.label}=${s.grams}${s.note ? ' [' + s.note + ']' : ''}`).join(', '), p);
  const nm = { 'energy-kcal_100g': 100, proteins_100g: 10 };
  const cases = [
    ['Safcol raw OFF (no serving, canned in spring water)', { ...PRODUCT, categories_tags: ['en:canned-fishes', 'en:canned-tunas'], code: '1' }, ''],
    ['quantity "185 g (130 g drained)"', { product_name: 'Tuna Chunks in Brine', nutriments: nm, quantity: '185 g (130 g drained)', product_quantity: 185, product_quantity_unit: 'g', categories_tags: ['en:canned-tunas'] }, 'can, drained=130 [185 g incl. liquid]'],
    ['"drained weight 240g" + serving 120 g', { product_name: 'Chickpeas in Brine', nutriments: nm, quantity: '400g, drained weight 240g', product_quantity: 400, serving_quantity: 120, serving_size: '120 g' }, 'serving=120, can, drained=240 [400 g incl. liquid]'],
    ['"poids égoutté : 140 g"', { product_name: 'Thon au naturel', nutriments: nm, quantity: '200 g - poids égoutté : 140 g', product_quantity: 200, categories_tags: ['en:canned-tunas'] }, 'can, drained=140 [200 g incl. liquid]'],
    ['drained_weight field', { product_name: 'Peaches in Syrup', nutriments: nm, quantity: '410 g', product_quantity: 410, drained_weight: '245 g', categories_tags: ['en:fruits-in-syrup'] }, 'can, drained=245 [410 g incl. liquid]'],
    ['beans in brine, no drained info → no can offered', { product_name: 'Red Kidney Beans in Brine', nutriments: nm, quantity: '420 g', product_quantity: 420, serving_quantity: 105, serving_size: '105 g' }, 'serving=105'],
    ['not packed in liquid → whole package kept', { product_name: 'Hazelnut spread', nutriments: nm, quantity: '400 g', product_quantity: 400, serving_quantity: 15, serving_size: '15 g' }, 'serving=15, package=400'],
    ['serving_size text only', { product_name: 'Oats', nutriments: nm, serving_size: '40 g (1/2 cup)', quantity: '750 g', product_quantity: 750 }, 'serving=40 [1/2 cup], package=750'],
    ['no serving data → none invented', { product_name: 'Rice', nutriments: nm }, '']
  ];
  for (const [n, p, want] of cases) { const got = await S(p); log(`servings · ${n}: ${got || '(grams only)'}`); if (got !== want) fail(`servings ${n}: got "${got}" want "${want}"`); }
  await up.close();
}
// ---------- decoding (ZXing fallback, same code path as the app) ----------
const js = buildSync({ entryPoints: ['src/barcode.ts'], bundle: true, format: 'iife', globalName: 'BC', write: false }).outputFiles[0].text;
const dp = await b.newPage(); await dp.setContent(`<script>${js}</script>`);
const synth = await dp.evaluate(async (code) => {
  // EAN-13 encoder (L/G/R tables, parity from the first digit)
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const G = L.map((p) => [...p].map((c) => (c === '1' ? '0' : '1')).reverse().join('')); const R = L.map((p) => [...p].map((c) => (c === '1' ? '0' : '1')).join(''));
  const PAR = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  const d = code.split('').map(Number); let bits = '101'; for (let i = 1; i <= 6; i++) bits += (PAR[d[0]][i - 1] === 'L' ? L : G)[d[i]]; bits += '01010'; for (let i = 7; i <= 12; i++) bits += R[d[i]]; bits += '101';
  const mk = ({ W, H, mod, curve, angle, blur, noise }) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.fillStyle = '#d9dde2'; x.fillRect(0, 0, W, H);
    x.save(); x.translate(W / 2, H / 2); x.rotate((angle * Math.PI) / 180); if (blur) x.filter = `blur(${blur}px)`;
    const bw = bits.length * mod, bh = H * 0.28; x.fillStyle = '#fff'; x.fillRect(-bw / 2 - 12 * mod, -bh / 2 - 4 * mod, bw + 24 * mod, bh + 8 * mod);
    // can curvature: label wraps a cylinder, bars compress towards the edges
    const px = (u) => (curve ? (Math.sin((u - 0.5) * curve) / Math.sin(0.5 * curve)) * 0.5 : u - 0.5) * bw;
    x.fillStyle = '#111'; for (let i = 0; i < bits.length; i++) if (bits[i] === '1') { const a = px(i / bits.length), e = px((i + 1) / bits.length); x.fillRect(a, -bh / 2, e - a + 0.15, bh); }
    x.restore();
    if (noise) { const im = x.getImageData(0, 0, W, H); for (let i = 0; i < im.data.length; i += 4) { const n = (Math.random() - 0.5) * noise; im.data[i] += n; im.data[i + 1] += n; im.data[i + 2] += n; } x.putImageData(im, 0, 0); }
    return c;
  };
  const z = await BC.zxingForTest();
  const cases = { 'flat, 720×1280 portrait frame': { W: 720, H: 1280, mod: 3, curve: 0, angle: 0, blur: 0 }, 'curved can (1.6 rad)': { W: 720, H: 1280, mod: 3, curve: 1.6, angle: 0, blur: 0 },
    'curved + 6° tilt': { W: 720, H: 1280, mod: 3, curve: 1.4, angle: 6, blur: 0 }, 'small (1.6 px modules)': { W: 720, H: 1280, mod: 1.6, curve: 1.2, angle: 3, blur: 0 },
    'soft focus (blur 1.2)': { W: 720, H: 1280, mod: 3, curve: 1.2, angle: 3, blur: 1.2, noise: 14 }, 'held sideways (90°)': { W: 720, H: 1280, mod: 3, curve: 1.2, angle: 90, blur: 0 } };
  const out = {};
  for (const [k, cfg] of Object.entries(cases)) { const c = mk(cfg); const hits = BC.PLANS.map((_, i) => z.decodePlan(c, i)); out[k] = { any: hits.find((h) => h) || null, plans: hits.map((h) => (h ? 'Y' : '-')).join('') }; }
  return out;
}, CODE);
for (const [k, v] of Object.entries(synth)) { log(`decode ${k}: ${v.any || 'NO READ'} (passes ${v.plans})`); if (v.any !== CODE) fail('decode failed: ' + k); }
if (process.env.SAFCOL_PHOTO && fs.existsSync(process.env.SAFCOL_PHOTO)) {
  const img = 'data:image/jpeg;base64,' + fs.readFileSync(process.env.SAFCOL_PHOTO).toString('base64');
  const res = await dp.evaluate(async (src) => { const im = new Image(); im.src = src; await im.decode(); const z = await BC.zxingForTest(); const o = {};
    for (const w of [im.naturalWidth, 1080, 720, 480, 360]) for (const rot of [0, 90]) { const c = document.createElement('canvas'); const h = Math.round(im.naturalHeight * w / im.naturalWidth); c.width = rot ? h : w; c.height = rot ? w : h; const x = c.getContext('2d'); if (rot) { x.translate(h, 0); x.rotate(Math.PI / 2); } x.drawImage(im, 0, 0, w, h); o[`${w}px${rot ? ' rotated' : ''}`] = BC.PLANS.map((_, i) => (z.decodePlan(c, i) ? 'Y' : '-')).join(''); }
    return o; }, img);
  for (const [k, v] of Object.entries(res)) { log(`photo ${k}: passes ${v}`); if (!v.includes('Y')) fail('photo not decoded at ' + k); }
}
await b.close();
if (failed) { console.error(failed, 'failure(s)'); process.exit(1); } console.log('SAFCOL REGRESSION TEST PASSED');
