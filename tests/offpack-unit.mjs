// v1.13.0 offline Australian food pack: shard rule matches the build script, rows map through offToFood like live OFF products
// (AU carbs incl. fibre, servings, liquids, canned-in-liquid), text search ("weet-bix" / "weetbix" / brand words), real pack files sane.
import { buildSync } from 'esbuild'; import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
const dir = mkdtempSync(join(tmpdir(), 'op-'));
buildSync({ entryPoints: [new URL('../src/offpack.ts', import.meta.url).pathname], bundle: true, format: 'esm', outfile: join(dir, 'b.mjs'), logLevel: 'error' });
const P = await import(pathToFileURL(join(dir, 'b.mjs')).href);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
// [rank, code, name, brand, kcal, protein, carbs, fat, fibre, sugar, satfat, sodium_mg, serving_size, serving_g, package_g, quantity, cats]
const WB = [41, '9300652010794', 'Weet-Bix', 'Sanitarium', 353.4, 12.4, 65.9, 1.3, 12.9, 3, 0.3, 270, '33 g (2 biscuits)', 33, 1200, '1.2 kg'];
const MILK = [111, '9300652803495', 'Almond Milk Unsweetened', 'Sanitarium So Good', 103, 3.5, 2, 8.8, 2, 0.8, 0.8, 225, '1 serving (250 ml)', 250, 1000, '1L'];
const TUNA = [500, '9310768114941', 'No Net Tuna in Spring Water', 'Safcol', 120.4, 25.5, 1, 1.6, 0, 1, 0.5, 49, null, null, 185, '185g', 'en:canned-tunas'];
const f = P.rowToFood(WB);
ok(f.id === 'off_9300652010794' && f.name === 'Weet-Bix' && f.brand === 'Sanitarium' && f.source === 'off' && f.unit === 'g', 'row → Food (id, name, brand, source, unit)');
ok(Math.abs(f.per100.kcal - 353.4) < 0.01 && f.per100.protein === 12.4 && Math.abs(f.per100.carbs - 78.8) < 0.01 && f.per100.fibre === 12.9 && f.per100.sodium === 270, 'per 100 g: AU available carbs + fibre stored as total, sodium mg');
ok(f.servings.some((s) => s.kind === 'serving' && s.grams === 33) && f.servings.some((s) => s.kind === 'package' && s.grams === 1200), 'serving 33 g + 1.2 kg package from the label');
const m = P.rowToFood(MILK); ok(m.unit === 'ml' && m.servings.some((s) => s.grams === 250), 'liquids → ml with the 250 ml serving');
const t = P.rowToFood(TUNA); ok(!t.servings.some((s) => s.grams === 185), 'canned in spring water: 185 g gross can not offered (same rule as live lookups)');
ok(P.normCode('0049000028911') === '49000028911' && P.normCode('049000028911') === '49000028911', 'UPC-A / EAN-13 zero padding normalises to one key');
ok(P.shardOf('9300652010794') === 94 % 16 && P.shardOf('0049000028911') === P.shardOf('049000028911'), 'shard = last two digits mod 16 (stable across padding)');
ok(P.normText('Weet-Bix™ Bites – Crème') === 'weet bix bites creme', 'text normalised (case, accents, punctuation)');
const ix = P.buildIndex([WB, MILK, TUNA, [7, '9300650651012', 'Vegemite', 'Vegemite', 174, 25, 11, 0.5, 8, 2, 0.1, 3300], [3, '9300652000001', 'Weet-Bix Bites Honey', 'Sanitarium', 380, 9, 70, 2, 9, 20, 0.4, 100]]);
const names = (q) => P.matchPack(ix, q).map((r) => r[2]);
ok(names('weet-bix').join('|') === 'Weet-Bix|Weet-Bix Bites Honey', 'weet-bix → exact name first, then by popularity: ' + names('weet-bix').join('|'));
ok(names('weetbix').length === 2 && names('WEET BIX').length === 2, '"weetbix" and "WEET BIX" match too');
ok(names('sanitarium milk').join() === 'Almond Milk Unsweetened', 'brand + name words');
ok(names('tuna safcol').length === 1 && names('vegemite')[0] === 'Vegemite' && names('x').length === 0 && names('zzzz').length === 0, 'other queries / too short / no match');
// the real pack files
const pdir = new URL('../public/offpack/', import.meta.url).pathname; const meta = JSON.parse(readFileSync(pdir + 'meta.json', 'utf8'));
const files = readdirSync(pdir).filter((x) => /^au-[0-9a-f]\.json$/.test(x)); let n = 0, gz = 0, raw = 0, badShard = 0, noKcal = 0; const seen = new Set();
for (const x of files) { const body = readFileSync(pdir + x); raw += body.length; gz += gzipSync(body).length; const j = JSON.parse(body); const i = parseInt(x.slice(3, 4), 16);
  for (const r of j.rows) { n++; if (P.shardOf(r[1], meta.shards) !== i) badShard++; if (typeof r[4] !== 'number') noKcal++; seen.add(P.normCode(r[1])); } }
ok(files.length === meta.shards && n === meta.count && seen.size === n, `pack: ${meta.shards} shards, ${n} products, unique barcodes (meta says ${meta.count}, data ${meta.date})`);
ok(badShard === 0 && noKcal === 0, 'every row in the right shard and has kcal/100 g');
ok(gz < 2.5e6 && raw < 6e6, `pack size ${(raw / 1e6).toFixed(2)} MB raw / ${(gz / 1e6).toFixed(2)} MB gzip`);
const all = files.flatMap((x) => JSON.parse(readFileSync(pdir + x, 'utf8')).rows); const wb = all.find((r) => r[1] === '9300652010794');
ok(!!wb && P.matchPack(P.buildIndex(all), 'weet-bix').some((r) => r[1] === '9300652010794'), 'real pack has Weet-Bix 1.2 kg and search finds it');
const t0 = performance.now(); const big = P.buildIndex(all); const t1 = performance.now(); P.matchPack(big, 'weet-bix'); P.matchPack(big, 'greek yoghurt'); const t2 = performance.now();
ok(t2 - t1 < 150, `search over ${all.length} products: index ${(t1 - t0).toFixed(0)} ms, 2 queries ${(t2 - t1).toFixed(1)} ms`);
console.log(bad ? `${bad} FAILED` : 'OFFPACK UNIT PASSED'); process.exit(bad ? 1 : 0);
