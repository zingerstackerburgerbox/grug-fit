// v1.8.4: Hevy date parsing against real-world formats (Hevy app, spreadsheet re-saves, other locales) + a realistic Hevy export.
import { buildSync } from 'esbuild'; import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { pathToFileURL } from 'node:url';
process.env.TZ = process.env.TZ || 'Australia/Sydney';
const dir = mkdtempSync(join(tmpdir(), 'hd-')); const src = new URL('../src/', import.meta.url).pathname; const entry = join(dir, 'e.ts');
writeFileSync(entry, `export * from '${src}importer'; export { reconcile } from '${src}reconcile'; export { SEED_EXERCISES } from '${src}seed';`);
buildSync({ entryPoints: [entry], bundle: true, format: 'esm', outfile: join(dir, 'b.mjs'), logLevel: 'error' });
const { parseHevyDate, dateOrderOf, plausibleDate, buildPlan, reconcile, SEED_EXERCISES } = await import(pathToFileURL(join(dir, 'b.mjs')).href);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const L = (y, mo, d, h = 7, mi = 15, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();
const CASES = [
  ['21 May 2025, 20:44', L(2025, 5, 21, 20, 44)], ['5 Jan 2026, 07:09', L(2026, 1, 5, 7, 9)], ['05 Jan 2026, 07:09', L(2026, 1, 5, 7, 9)],
  ['23 Oct 2026, 19:15:30', L(2026, 10, 23, 19, 15, 30)], ['Oct 23, 2026, 7:15 AM', L(2026, 10, 23)], ['Oct 23, 2026, 7:15 PM', L(2026, 10, 23, 19)], ['Oct 23, 2026 12:05 AM', L(2026, 10, 23, 0, 5)],
  ['23 Oct 26, 07:15', L(2026, 10, 23)], ['2026-10-23 07:15:00', L(2026, 10, 23)], ['2026-10-23 07:15', L(2026, 10, 23)], ['2026-10-23T07:15:00', L(2026, 10, 23)],
  ['2026-10-22T20:15:00Z', Date.UTC(2026, 9, 22, 20, 15)], ['2026-10-23T07:15:00+11:00', Date.UTC(2026, 9, 22, 20, 15)], ['2026-10-23T07:15:00.000+1100', Date.UTC(2026, 9, 22, 20, 15)],
  ['23/10/2026 07:15', L(2026, 10, 23)], ['23.10.2026, 07:15', L(2026, 10, 23)], ['10/23/2026 7:15 PM', L(2026, 10, 23, 19)], ['23 Sept 2026, 07:15', L(2026, 9, 23)],
  ['23 okt. 2026, 07:15', L(2026, 10, 23)], ['23. Oktober 2026, 07:15', L(2026, 10, 23)], ['23 de oct. de 2026, 07:15', L(2026, 10, 23)], ['23 ottobre 2026, 07:15', L(2026, 10, 23)],
  ['23 déc. 2025, 07:15', L(2025, 12, 23)], ['Fri, 23 Oct 2026, 07:15', L(2026, 10, 23)], ['mar, 23 mar 2026, 07:15', L(2026, 3, 23)], ['23 Oct 2026 at 7:15 p.m.', L(2026, 10, 23, 19)],
  ['2026年10月23日 7:15', L(2026, 10, 23)], ['23 Oct, 07:15', null], ['31 Feb 2026, 07:15', null], ['garbage', null], ['', null], ['13:00', null], ['25/13/2026 07:15', null]
];
for (const [s, want] of CASES) { const got = parseHevyDate(s); ok(got === want, `${JSON.stringify(s)} → ${got == null ? 'null' : new Date(got).toString().slice(0, 24)}`); }
ok(parseHevyDate('05/10/2026 07:15', 'dmy') === L(2026, 10, 5) && parseHevyDate('05/10/2026 07:15', 'mdy') === L(2026, 5, 10), 'ambiguous numeric date follows the file/locale order');
ok(dateOrderOf(['05/10/2026 07:15', '23/10/2026 07:15']) === 'dmy' && dateOrderOf(['05/10/2026', '10/23/2026']) === 'mdy' && dateOrderOf(['05/10/2026'], 'mdy') === 'mdy', 'dateOrderOf: decided by any part > 12, else locale');
ok(!plausibleDate(0) && !plausibleDate(NaN) && !plausibleDate(L(1970, 1, 1)) && !plausibleDate(L(2001, 10, 23)) === false && !plausibleDate(Date.now() + 30 * 864e5) && plausibleDate(L(2026, 10, 23)), 'plausible: rejects NaN/epoch/far future');

// realistic export → identical results from re-saved (spreadsheet, day-first numeric) and German-month copies
const real = readFileSync(new URL('./fixtures/hevy_real_style.csv', import.meta.url), 'utf8');
const EX = { exercises: SEED_EXERCISES, workouts: [], diaryIds: new Set(), diaryCronDates: new Set(), bodyweight: [], defaultRest: 90 };
const p = buildPlan([{ name: 'workouts.csv', text: real }], EX);
const W = p.workouts; const starts = W.map((w) => w.start);
ok(p.files[0].kind === 'hevy' && W.length === 63 && p.sets === 1004 && !p.warnings.length, `real-style export: ${W.length} workouts, ${p.sets} sets, ${p.files[0].from} → ${p.files[0].to}`);
ok(W.every((w) => plausibleDate(w.start) && w.end > w.start && w.end - w.start < 3 * 3600e3 && w.exercises.length && w.srcStart), 'every workout: plausible start, end after start, exercises, raw start kept');
ok(p.files[0].from === '2026-01-05' && p.files[0].to === '2026-07-03', 'date range as in the file');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const resaved = real.replace(/"(\d{1,2}) (\w{3}) (\d{4}), (\d{2}):(\d{2})"/g, (_, d, m, y, h, mi) => `"${d.padStart(2, '0')}/${String(MON.indexOf(m) + 1).padStart(2, '0')}/${y} ${+h}:${mi}"`);
const DE = { Jan: 'Jan.', Feb: 'Feb.', Mar: 'März', Apr: 'Apr.', May: 'Mai', Jun: 'Juni', Jul: 'Juli' };
const german = real.replace(/"(\d{1,2}) (\w{3}) (\d{4}), /g, (_, d, m, y) => `"${d}. ${DE[m]} ${y}, `);
for (const [name, text] of [['spreadsheet re-saved (dd/mm/yyyy)', resaved], ['German month names', german]]) {
  const q = buildPlan([{ name: 'x.csv', text }], EX); const s2 = q.workouts.map((w) => w.start);
  ok(q.workouts.length === 63 && s2.every((t, i) => t === starts[i]), `${name}: same 63 dates (sample "${text.split('\n')[1].split('","')[1]}")`);
}

// a stored import with a broken date (NaN/0) must never get a falsy end – every list filters on `end`, so it would vanish
const broken = W.slice(0, 3).map((w, i) => ({ ...w, start: i ? Number.NaN : 0, end: Number.NaN }));
const c = reconcile({ workouts: broken, exercises: SEED_EXERCISES, routines: [], diary: [], foods: [] });
ok(c.workouts.length === 3 && c.workouts.every((w) => w.end > 0), 'broken imported dates still get a finite end (stay visible in lists)');
if (bad) { console.error(bad + ' FAILED'); process.exit(1); } console.log('HEVY DATES UNIT TESTS PASSED');
