// Live admin-code check against the deployed Worker. Reads the real code from /home/box/.lunk-admin-code (outside the repo, never printed).
// 1 wrong attempt + 1 right attempt (2 of the 5/hour allowance for this device id), /status shows unlimited, then the token is revoked.
import fs from 'fs';
const U = process.env.PROXY || 'https://grug-coach-proxy.grug-fitgrug-fitgrug-fit.workers.dev';
const dev = crypto.randomUUID(); const H = { 'Content-Type': 'application/json', Origin: 'https://zingerstackerburgerbox.github.io', 'X-Device-Id': dev };
let bad = 0; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) bad++; };
let r = await fetch(U + '/admin', { method: 'POST', headers: H, body: JSON.stringify({ code: 'NOT-THE-CODE' }) }); let j = await r.json();
ok(r.status === 401 && j.message === 'Code not recognised.', `wrong code → ${r.status} "${j.message}"`);
const code = fs.readFileSync(process.env.HOME + '/.lunk-admin-code', 'utf8');
r = await fetch(U + '/admin', { method: 'POST', headers: H, body: JSON.stringify({ code: ' ' + code.toLowerCase() + ' ' }) }); j = await r.json(); const tok = j.token;
ok(r.status === 200 && /^[0-9a-f]{64}$/.test(tok || ''), `real code (lower-cased, padded) → ${r.status}, token issued`);
r = await fetch(U + '/status', { headers: { ...H, 'X-Admin-Token': tok } }); j = await r.json();
ok(j.admin === true && j.remaining === null && j.estimate.remaining === null && j.review.remaining === null, '/status with admin token: chat, estimate and review unlimited');
r = await fetch(U + '/status', { headers: { ...H, 'X-Device-Id': crypto.randomUUID(), 'X-Admin-Token': tok } }); j = await r.json(); ok(j.admin === false, 'token copied to another device id is ignored');
if (process.env.KEEP_TOKEN_FILE) { fs.writeFileSync(process.env.KEEP_TOKEN_FILE, JSON.stringify({ device: dev, token: tok }), { mode: 0o600 }); console.log('token kept for the next step (file, not printed)'); }
else { r = await fetch(U + '/admin/remove', { method: 'POST', headers: { ...H, 'X-Admin-Token': tok } }); r = await fetch(U + '/status', { headers: { ...H, 'X-Admin-Token': tok } }); j = await r.json(); ok(j.admin === false && j.remaining === 5, 'after remove: normal device (5 chat messages)'); }
if (bad) { console.error('ADMIN LIVE FAILED'); process.exit(1); } console.log('ADMIN LIVE PASSED');
