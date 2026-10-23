// v1.9.1 theme maths: readable text on accent buttons and accent-coloured text in every mode, for presets and odd custom colours.
import { buildSync } from 'esbuild'; import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { pathToFileURL } from 'node:url';
const dir = mkdtempSync(join(tmpdir(), 'th-'));
buildSync({ entryPoints: [new URL('../src/theme.ts', import.meta.url).pathname], bundle: true, format: 'esm', outfile: join(dir, 'b.mjs'), logLevel: 'error' });
const T = await import(pathToFileURL(join(dir, 'b.mjs')).href);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
ok(T.normHex('#ABC') === '#aabbcc' && T.normHex('22c55e') === '#22c55e' && T.normHex('red') === null, 'hex normalising');
ok(Math.abs(T.contrast('#000000', '#ffffff') - 21) < 0.01 && Math.abs(T.contrast('#777777', '#777777') - 1) < 1e-9, 'WCAG contrast');
const BG = { dark: ['#0f1115', '#171a21'], light: ['#f4f5f7', '#ffffff'], amoled: ['#000000', '#0c0d10'] };
const odd = ['#ffffff', '#000000', '#1a1a40', '#ffff00', '#808080', '#00ff88', '#7f1d1d', '#fef3c7'];
for (const c of [...T.PRESETS.map(([, c]) => c), ...odd]) {
  const ink = T.inkOn(c); const ic = T.contrast(c, ink);
  const tx = Object.fromEntries(Object.keys(BG).map((m) => [m, Math.min(...BG[m].map((b) => T.contrast(T.accentText(c, m), b)))]));
  ok(ic >= 4.5 && Object.values(tx).every((x) => x >= 4.5), `${c}: button text ${ink} ${ic.toFixed(1)}:1 · accent text dark ${tx.dark.toFixed(1)} / light ${tx.light.toFixed(1)} / amoled ${tx.amoled.toFixed(1)}`);
}
ok(T.accentText('#22c55e', 'dark') === '#22c55e', 'green on dark is already readable → unchanged');
ok(T.resolveMode('system', true) === 'light' && T.resolveMode('system', false) === 'dark' && T.resolveMode('amoled', true) === 'amoled', 'System follows the OS');
ok(JSON.stringify(T.themeOf({ mode: 'neon', accent: 'xyz' })) === JSON.stringify(T.DEFAULT_THEME) && T.themeOf(undefined).accent === '#22c55e', 'invalid stored theme → default');
if (bad) { console.error(bad + ' FAILED'); process.exit(1); } console.log('THEME UNIT TESTS PASSED');
