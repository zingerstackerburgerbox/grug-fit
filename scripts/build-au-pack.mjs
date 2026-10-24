// Builds the bundled offline Australian food pack (public/offpack/) from the Open Food Facts bulk CSV export.
// Data: Open Food Facts, https://world.openfoodfacts.org — Open Database License (ODbL) 1.0, contents DbCL.
// Usage: curl -LO https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz
//        node scripts/build-au-pack.mjs en.openfoodfacts.org.products.csv.gz [maxProducts=25000] [exportDate=YYYY-MM-DD]
import { createReadStream, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'fs';
import { createGunzip, gzipSync } from 'zlib';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [src, maxArg, dateArg] = process.argv.slice(2);
if (!src) { console.error('usage: node scripts/build-au-pack.mjs <products.csv.gz> [max] [YYYY-MM-DD]'); process.exit(1); }
const MAX = +(maxArg || 25000);
const DATE = dateArg || new Date(statSync(src).mtimeMs).toISOString().slice(0, 10);
export const SHARDS = 16;
// keep only the category tags the app uses to recognise canned / jarred / packed-in-liquid foods
const CAT_KEEP = /canned|-in-|syrup|pickles|olives|brine/;
const n = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

const rl = createInterface({ input: createReadStream(src).pipe(createGunzip()), crlfDelay: Infinity });
let head = null; let I = {}; let total = 0; let au = 0; const out = [];
const need = ['code', 'product_name', 'brands', 'quantity', 'countries_tags', 'categories_tags', 'serving_size', 'serving_quantity', 'product_quantity',
  'unique_scans_n', 'completeness', 'energy-kcal_100g', 'energy-kj_100g', 'energy_100g', 'fat_100g', 'saturated-fat_100g', 'carbohydrates_100g', 'sugars_100g', 'fiber_100g', 'proteins_100g', 'sodium_100g'];
for await (const line of rl) {
  if (!head) { head = line.split('\t'); for (const k of need) { I[k] = head.indexOf(k); if (I[k] < 0) throw new Error('missing column ' + k); } continue; }
  total++;
  if (!line.includes('en:australia')) continue;
  const c = line.split('\t'); const g = (k) => c[I[k]] ?? '';
  if (!g('countries_tags').split(',').includes('en:australia')) continue;
  const code = g('code').trim(); if (!/^\d{8,14}$/.test(code)) continue;
  const name = g('product_name').replace(/\s+/g, ' ').trim(); if (!name || name.length > 90) continue;
  let kcal = n(g('energy-kcal_100g')); if (kcal == null && n(g('energy-kj_100g')) != null) kcal = n(g('energy-kj_100g')) / 4.184;
  if (kcal == null && n(g('energy_100g')) != null) kcal = n(g('energy_100g')) / 4.184;
  if (kcal == null || kcal < 0 || kcal > 950) continue;
  const p = n(g('proteins_100g')), cb = n(g('carbohydrates_100g')), f = n(g('fat_100g'));
  const bad = [p, cb, f, n(g('sugars_100g')), n(g('fiber_100g')), n(g('saturated-fat_100g'))].some((v) => v != null && (v < 0 || v > 100));
  if (bad || (p ?? 0) + (cb ?? 0) + (f ?? 0) > 105) continue;
  if (kcal === 0 && !p && !cb && !f && !/water|diet|zero|tea|coffee|sugar free|no sugar|max/i.test(name)) continue; // empty nutrition panel
  au++;
  const filled = [p, cb, f, n(g('sugars_100g')), n(g('fiber_100g')), n(g('saturated-fat_100g')), n(g('sodium_100g'))].filter((v) => v != null).length;
  const cats = g('categories_tags').split(',').filter((t) => CAT_KEEP.test(t)).join(',');
  const qty = g('quantity').replace(/\s+/g, ' ').trim().slice(0, 40); const sv = g('serving_size').replace(/\s+/g, ' ').trim().slice(0, 40);
  const sodium = n(g('sodium_100g'));
  out.push({ score: (n(g('unique_scans_n')) || 0) * 10 + (n(g('completeness')) || 0) * 3 + filled * 0.2 + (g('brands') ? 0.3 : 0) + (sv ? 0.3 : 0),
    row: [code, name, g('brands').split(',')[0].trim().slice(0, 40), r1(kcal), r1(p), r1(cb), r1(f), r1(n(g('fiber_100g'))), r1(n(g('sugars_100g'))), r1(n(g('saturated-fat_100g'))),
      sodium == null ? null : Math.round(sodium * 1000), sv, r1(n(g('serving_quantity'))), r1(n(g('product_quantity'))), qty, cats] });
}
// best per barcode, then most scanned / most complete first
const best = new Map();
for (const o of out) { const k = o.row[0].replace(/^0+/, ''); const prev = best.get(k); if (!prev || o.score > prev.score) best.set(k, o); }
const ranked = [...best.values()].sort((a, b) => b.score - a.score).slice(0, MAX);
const COLS = ['code', 'name', 'brand', 'kcal', 'protein', 'carbs', 'fat', 'fibre', 'sugar', 'satfat', 'sodium_mg', 'serving_size', 'serving_g', 'package_g', 'quantity', 'cats'];
const dir = join(ROOT, 'public', 'offpack'); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
const shards = Array.from({ length: SHARDS }, () => []);
ranked.forEach((o, rank) => { const r = o.row; while (r.length && (r[r.length - 1] == null || r[r.length - 1] === '')) r.pop(); for (let i = 0; i < r.length; i++) if (r[i] === '') r[i] = null; shards[+r[0].slice(-2) % SHARDS].push([...r, rank]); });
let bytes = 0; let gz = 0; const sizes = [];
shards.forEach((rows, i) => {
  rows.forEach((r) => { r.unshift(r.pop()); }); // rank first: lower = more popular
  const body = JSON.stringify({ cols: ['rank', ...COLS], rows });
  writeFileSync(join(dir, `au-${i.toString(16)}.json`), body); bytes += body.length; const z = gzipSync(body, { level: 9 }).length; gz += z; sizes.push(z);
});
const meta = { version: DATE, date: DATE, count: ranked.length, shards: SHARDS, bytes, gzipBytes: gz, source: 'Open Food Facts bulk export (en.openfoodfacts.org.products.csv.gz)', licence: 'ODbL 1.0', country: 'en:australia' };
writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta));
console.log(JSON.stringify({ scanned: total, australianWithKcal: au, uniqueBarcodes: best.size, ...meta, shardGzip: sizes }));
