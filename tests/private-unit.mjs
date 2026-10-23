// Unit tests for the private/incognito heuristic (v1.8.2) with mocked quota/env.
import { buildSync } from 'esbuild'; import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { pathToFileURL } from 'node:url';
const out = join(mkdtempSync(join(tmpdir(), 'priv-')), 'privacy.mjs');
buildSync({ entryPoints: [new URL('../src/privacy.ts', import.meta.url).pathname], bundle: true, format: 'esm', outfile: out, logLevel: 'error' });
const { detectPrivate, engineOf } = await import(pathToFileURL(out).href);
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const G = 2 ** 30, M = 2 ** 20;
const UA = {
  chrome156: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36',
  chrome120: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/150.0.0.0 Mobile Safari/537.36',
  firefox: 'Mozilla/5.0 (Android 14; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0',
  safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  crios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1'
};
const env = (ua, o = {}) => ({ ua, standalone: false, secure: true, hasSW: true, hasIDB: true, estimate: async () => ({ quota: 10 * G, usage: 0 }), idbOpen: async () => true, lsWorks: () => true, ...o });
const q = (quota, usage = 0) => async () => ({ quota, usage });
const t = async (name, e, want, reason) => { const r = await detectPrivate(e); ok(r.private === want && (!reason || r.reason === reason), `${name} → private=${r.private} (${r.reason})`); };

ok(engineOf(UA.chrome156).engine === 'chromium' && engineOf(UA.chrome156).major === 156, 'engine chrome 156');
ok(engineOf(UA.crios).engine === 'webkit', 'iOS Chrome is WebKit');
ok(engineOf(UA.firefox).engine === 'firefox', 'engine firefox');
// Chromium ≥147: headroom
await t('Chrome 156 normal (usage+10GiB)', env(UA.chrome156, { estimate: q(10 * G + 300 * M, 300 * M) }), false, 'chrome-ok');
await t('Chrome 148 leaky incognito (usage+9GiB)', env(UA.chrome156, { estimate: q(9 * G + 5 * M, 5 * M) }), true, 'chrome-headroom');
await t('Chrome 156 static incognito (usage+10GiB) – undetectable', env(UA.chrome156, { estimate: q(10 * G) }), false);
await t('Chrome big disk', env(UA.chrome156, { estimate: q(80 * G) }), false);
await t('Samsung (Chromium 150) incognito 9GiB', env(UA.samsung, { estimate: q(9 * G) }), true);
// old Chromium: small quota
await t('Chrome 120 incognito 600MB', env(UA.chrome120, { estimate: q(600e6) }), true, 'chrome-low-quota');
await t('Chrome 120 normal 9GB (small phone)', env(UA.chrome120, { estimate: q(9e9) }), false);
// Firefox
await t('Firefox private (no SW)', env(UA.firefox, { hasSW: false, estimate: q(10 * G) }), true, 'firefox-no-serviceworker');
await t('Firefox normal', env(UA.firefox), false);
await t('Firefox old private (IDB open fails)', env(UA.firefox, { idbOpen: async () => false }), true, 'indexeddb-error');
await t('Firefox insecure http (no SW expected)', env(UA.firefox, { hasSW: false, secure: false }), false);
// Safari
await t('Safari private (OPFS unknown transient reason)', env(UA.safari, { opfs: async () => { throw new DOMException('The operation failed for an unknown transient reason (e.g. out of memory).', 'UnknownError'); } }), true, 'safari-opfs');
await t('Safari normal', env(UA.safari, { opfs: async () => {}, estimate: q(2 * G) }), false);
await t('Safari tiny quota', env(UA.safari, { opfs: async () => {}, estimate: q(50 * M) }), true, 'safari-low-quota');
await t('Safari estimate throws', env(UA.safari, { estimate: async () => { throw new Error('x'); } }), true, 'estimate-error');
await t('Old Safari localStorage throws', env(UA.safari, { lsWorks: () => false }), true, 'localstorage-error');
await t('No IndexedDB at all', env(UA.chrome156, { hasIDB: false }), true, 'indexeddb-missing');
// never in standalone, whatever the signals
await t('Standalone + tiny quota + no SW', env(UA.chrome156, { standalone: true, hasSW: false, hasIDB: false, estimate: q(1 * M) }), false, 'standalone');
await t('No estimate API (unknown)', env(UA.chrome156, { estimate: undefined }), false);
if (bad) { console.error(bad + ' FAILED'); process.exit(1); } console.log('PRIVATE UNIT TESTS PASSED');
