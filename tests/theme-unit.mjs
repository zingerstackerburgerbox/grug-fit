// v1.9.1 theme maths: readable text on accent buttons and accent-coloured text in every mode, for presets and odd custom colours.
import { buildSync } from 'esbuild'; import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { pathToFileURL } from 'node:url';
const dir = mkdtempSync(join(tmpdir(), 'th-'));
buildSync({ entryPoints: [new URL('../src/theme.ts', import.meta.url).pathname], bundle: true, format: 'esm', outfile: join(dir, 'b.mjs'), logLevel: 'error' });
const T = await import(pathToFileURL(join(dir, 'b.mjs')).href);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
ok(T.normHex('#ABC') === '#aabbcc' && T.normHex('22c55e') === '#22c55e' && T.normHex('red') === null, 'hex normalising');
ok(Math.abs(T.contrast('#000000', '#ffffff') - 21) < 0.01 && Math.abs(T.contrast('#777777', '#777777') - 1) < 1e-9, 'WCAG contrast');
const BG = { dark: ['#0f1115', '#171a21'], light: ['#f4f5f7', '#ffffff'], amoled: ['#000000', '#0c0d10'] }; // Halloween always uses its own pumpkin accent – checked separately below
const odd = ['#ffffff', '#000000', '#1a1a40', '#ffff00', '#808080', '#00ff88', '#7f1d1d', '#fef3c7'];
for (const c of [...T.PRESETS.map(([, c]) => c), ...odd]) {
  const ink = T.inkOn(c); const ic = T.contrast(c, ink);
  const tx = Object.fromEntries(Object.keys(BG).map((m) => [m, Math.min(...BG[m].map((b) => T.contrast(T.accentText(c, m), b)))]));
  ok(ic >= 4.5 && Object.values(tx).every((x) => x >= 4.5), `${c}: button text ${ink} ${ic.toFixed(1)}:1 · accent text dark ${tx.dark.toFixed(1)} / light ${tx.light.toFixed(1)} / amoled ${tx.amoled.toFixed(1)}`);
}
ok(T.accentText('#22c55e', 'dark') === '#22c55e', 'green on dark is already readable → unchanged');
ok(T.resolveMode('system', true) === 'light' && T.resolveMode('system', false) === 'dark' && T.resolveMode('amoled', true) === 'amoled', 'System follows the OS');
ok(JSON.stringify(T.themeOf({ mode: 'neon', accent: 'xyz' })) === JSON.stringify(T.DEFAULT_THEME) && T.themeOf(undefined).accent === '#22c55e', 'invalid stored theme → default');

// v1.9.3 Halloween overlay season (local dates, inclusive)
const L = (y, m, d, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi);
for (const [d, on, label] of [[L(2026, 10, 24), true, '24 Oct'], [L(2026, 11, 2), true, '2 Nov'], [L(2026, 11, 3, 23, 59), true, '3 Nov 23:59'], [L(2026, 11, 4, 0, 0), false, '4 Nov 00:00'], [L(2026, 10, 14, 23, 59), false, '14 Oct 23:59'], [L(2027, 10, 31), true, '31 Oct 2027 (yearly)'], [L(2026, 12, 25), false, '25 Dec']])
  ok(!!T.activeSeason(d) === on, `season ${on ? 'on' : 'off'} ${label}`);
const IN = L(2026, 10, 31), OUT = L(2026, 11, 4, 0, 0);
ok(T.overlaySeason(null, IN)?.id === 'halloween' && T.overlaySeason({}, IN)?.id === 'halloween', 'overlay on by default for everyone in season (any theme)');
ok(T.overlaySeason({ 'halloween-2026': 'off' }, IN) === null, 'turned off → stays off this season');
ok(T.overlaySeason({ 'halloween-2026': 'off' }, L(2027, 10, 20))?.id === 'halloween', 'next year it is on again (choice is per season + year)');
ok(T.overlaySeason(null, OUT) === null && T.overlaySeason({ 'halloween-2026': 'on' }, OUT) === null, '4 Nov 00:00: off for everyone (toggle hidden)');
ok(T.seasonEndLabel(T.SEASONS[0]) === '3 Nov' && T.seasonKey(T.SEASONS[0], IN) === 'halloween-2026', 'end label "3 Nov", key halloween-2026');
// worst case: page text over the darkest point of the vignette (two gradient layers at 90 % opacity, i.e. the screen corners)
const mixA = (hex, rgb, a) => { const c = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)); return '#' + c.map((v, i) => Math.round(v + (rgb[i] - v) * a).toString(16).padStart(2, '0')).join(''); };
for (const m of ['dark', 'amoled', 'light']) { const v = T.VIGNETTE[m]; const a = (1 - (1 - v.a) ** 2) * 0.9; const bg = mixA(T.BG[m].page, v.rgb, a); const tx = T.PAGE_TEXT[m];
  const c1 = T.contrast(tx.fg, bg), c2 = T.contrast(tx.mut, bg), c0 = T.contrast(tx.mut, T.BG[m].page);
  ok(c1 >= 4.5 && c2 >= 4.5 && c0 >= 4.5, `${m} + Halloween overlay: text ${c1.toFixed(1)}:1, muted ${c2.toFixed(1)}:1 at the darkest edge (muted ${c0.toFixed(1)}:1 in the centre)`); }
if (bad) { console.error(bad + ' FAILED'); process.exit(1); } console.log('THEME UNIT TESTS PASSED');
