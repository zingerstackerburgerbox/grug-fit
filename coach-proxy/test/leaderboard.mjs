// v1.12.0 leaderboard: validation, merge, ranking (ties, duplicate names), submit/leave/GET through the fetch handler with a KV mock that
// supports list() + metadata, rate limits per device and per hashed network, owner bypass, and no effect on chat/estimate/review counters.
import worker, { cleanLbName, validSubmit, mergeEntry, rankRows, lbPeriods, sydDay, lbStars, LB_PREFIX, LB_OLD_PREFIX } from '../src/index.js';
let failed = 0; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) failed++; };
const kv = new Map(); const meta = new Map();
const KV = { get: async (k) => kv.get(k) ?? null, put: async (k, v, o = {}) => { kv.set(k, v); if (o.metadata) meta.set(k, o.metadata); else meta.delete(k); }, delete: async (k) => { kv.delete(k); meta.delete(k); },
  list: async ({ prefix = '', limit = 1000, cursor } = {}) => { const all = [...kv.keys()].filter((k) => k.startsWith(prefix)).sort(); const s = cursor ? +cursor : 0; const page = all.slice(s, s + limit);
    return { keys: page.map((name) => ({ name, metadata: meta.get(name) })), list_complete: s + limit >= all.length, cursor: s + limit >= all.length ? undefined : String(s + limit) }; } };
const ORIGIN = 'https://zingerstackerburgerbox.github.io';
const env = (o = {}) => ({ COACH_KV: KV, IP_SALT: 'pepper', OWNER_TOKEN: 'owner-secret', ...o }); // no XAI_API_KEY: the leaderboard must not need it
const dev = (n) => `eeeeeeee-0000-4000-8000-${String(n).padStart(12, '0')}`;
const req = (path, { method = 'POST', device = dev(1), body, ip = '203.0.113.5', owner } = {}) => new Request('https://proxy.test' + path, { method, headers: { Origin: ORIGIN, 'X-Device-Id': device, 'CF-Connecting-IP': ip, 'Content-Type': 'application/json', ...(owner ? { 'X-Owner-Token': owner } : {}) }, body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
const call = async (r, e = env()) => { const res = await worker.fetch(r, e, {}); const t = await res.text(); let j = null; try { j = JSON.parse(t); } catch {} return { res, j }; };
const P = lbPeriods(); const sub = (device, username, d, w, o = {}) => ({ deviceId: device, username, kind: 'training', ...(d != null ? { daily: { score: d, date: P.day } } : {}), ...(w != null ? { weekly: { score: w, weekKey: P.week } } : {}), ...o });

// ---------- pure helpers ----------
ok(cleanLbName('  Erik  ') === 'Erik' && cleanLbName('a\u0000b\u200Bc\u202Ed') === 'abcd' && cleanLbName('big   lunk') === 'big lunk', 'username: trimmed, control/zero-width/bidi chars stripped, spaces collapsed');
ok(cleanLbName('') === null && cleanLbName('   ') === null && cleanLbName('\u0000\u0001') === null && cleanLbName(42) === null && cleanLbName(null) === null, 'username: empty / only control chars / non-string rejected');
ok(cleanLbName('x'.repeat(20)) === 'x'.repeat(20) && cleanLbName('x'.repeat(21)) === null && cleanLbName('🦴'.repeat(20)) === '🦴'.repeat(20), 'username: 1–20 characters (counted as code points)');
const NOW = Date.parse('2026-10-24T01:00:00Z'); const PP = lbPeriods(NOW);
ok(PP.day === '2026-10-24' && PP.prevDay === '2026-10-23' && PP.week === '2026-10-19' && PP.prevWeek === '2026-10-12', 'periods: Sydney day + Monday week, and the previous ones');
ok(sydDay(Date.parse('2026-10-24T13:30:00Z')) === '2026-10-25', 'Sydney day rolls over at local midnight (00:30 AEDT is the next day)');
const V = (b) => validSubmit(b, dev(1), NOW); const good = { deviceId: dev(1), username: 'Erik', kind: 'training', daily: { score: 72, date: '2026-10-24' }, weekly: { score: 68, weekKey: '2026-10-19' } };
ok(!V(good).error && V(good).daily.score === 72 && V(good).weekly.week === '2026-10-19', 'valid submit accepted');
ok(!V({ ...good, daily: { score: 50, date: '2026-10-23' }, weekly: { score: 50, weekKey: '2026-10-12' } }).error, 'previous day / previous week accepted (midnight edge)');
for (const [b, m] of [[{ ...good, daily: { score: 101, date: '2026-10-24' } }, 'score 101'], [{ ...good, daily: { score: -1, date: '2026-10-24' } }, 'score -1'], [{ ...good, daily: { score: 70.5, date: '2026-10-24' } }, 'score 70.5'],
  [{ ...good, daily: { score: '70', date: '2026-10-24' } }, 'score as string'], [{ ...good, weekly: { score: 1e9, weekKey: '2026-10-19' } }, 'huge weekly'], [{ ...good, daily: { score: 70, date: '2026-10-22' } }, 'date 2 days ago'],
  [{ ...good, daily: { score: 70, date: '2026-10-25' } }, 'future date'], [{ ...good, weekly: { score: 70, weekKey: '2026-10-20' } }, 'week key not a Monday of this/last week'], [{ ...good, weekly: { score: 70, weekKey: '2026-10-05' } }, 'week 2 weeks ago'],
  [{ ...good, username: '' }, 'empty name'], [{ ...good, username: 'x'.repeat(21) }, '21-char name'], [{ ...good, deviceId: dev(2) }, 'deviceId ≠ header'], [{ ...good, weightKg: 80 }, 'extra field (weight)'],
  [{ ...good, daily: { score: 70, date: '2026-10-24', kcal: 2000 } }, 'extra field inside daily'], [{ username: 'Erik' }, 'no scores'], [{ ...good, kind: 'combined' }, 'kind other than training'], [[], 'array body'], [null, 'null body']])
  ok(!!V(b).error, 'rejected: ' + m);
// merge: newer periods replace, older never overwrite newer
let e = mergeEntry(null, V(good), 1); ok(e.u === 'Erik' && e.d[0] === '2026-10-24' && e.d[1] === 72 && e.w[1] === 68, 'merge: new entry');
e = mergeEntry(e, V({ ...good, daily: { score: 10, date: '2026-10-23' }, weekly: undefined }), 2); ok(e.d[0] === '2026-10-24' && e.d[1] === 72 && e.w[1] === 68, 'merge: yesterday\'s late submit does not overwrite today');
// ranking
const tag = (id) => id.slice(-4);
const rk = rankRows([{ id: 'a001', u: 'Zed', score: 80 }, { id: 'a002', u: 'amy', score: 95 }, { id: 'a003', u: 'Bob', score: 80 }, { id: 'a004', u: 'Cat', score: 40 }], tag);
ok(rk.map((r) => `${r.rank}:${r.name}:${r.stars}`).join(',') === '1:amy:5,2:Bob:4,2:Zed:4,4:Cat:2', 'ranking: score desc, ties share a rank (1,2,2,4) ordered by name, stars from score: ' + rk.map((r) => `${r.rank}:${r.name}`).join(','));
const dup = rankRows([{ id: 'b001', u: 'Grug', score: 50 }, { id: 'b002', u: 'grug', score: 60 }, { id: 'b003', u: 'Solo', score: 70 }], tag);
ok(dup.find((r) => r.id === 'b001').name === 'Grug #b001' && dup.find((r) => r.id === 'b002').name === 'grug #b002' && dup.find((r) => r.id === 'b003').name === 'Solo', 'duplicate names (case-insensitive) get a short tag, unique names do not');
ok([0, 39, 40, 59, 60, 74, 75, 89, 90, 100].map(lbStars).join('') === '1122334455', 'stars: same thresholds as the Home stars');

// ---------- through the Worker ----------
ok(LB_PREFIX === 'lb2:e:' && LB_OLD_PREFIX === 'lb:e:', 'v1.12.1: new KV prefix for training-only entries');
let r = await call(req('/leaderboard?period=weekly', { method: 'GET' })); ok(r.res.status === 200 && r.j.total === 0 && r.j.top.length === 0 && r.j.me === null && r.j.joined === false, 'empty board: 200, no rows (no XAI key needed)');
r = await call(req('/leaderboard?period=monthly', { method: 'GET' })); ok(r.res.status === 400, 'unknown period → 400');
r = await call(req('/leaderboard/submit', { body: sub(dev(1), 'Erik', 72, 68) })); ok(r.res.status === 200 && r.j.ok && r.j.entry.username === 'Erik' && r.j.entry.weekly.score === 68, 'submit: 200');
ok(r.j.stored === true && r.j.kind === 'training', 'submit with kind training → stored'); const stored = kv.get(LB_PREFIX + dev(1)); ok(stored && JSON.stringify(Object.keys(JSON.parse(stored)).sort()) === '["d","t","u","w"]' && !/kcal|weight|food|photo/i.test(stored), 'stored entry only holds username + scores (+ time): ' + stored);
r = await call(req('/leaderboard/submit', { body: sub(dev(1), 'Erik', 101, 68) })); ok(r.res.status === 400 && r.j.error === 'bad_request', 'submit: out-of-range score → 400');
r = await call(req('/leaderboard/submit', { body: '{bad' })); ok(r.res.status === 400, 'submit: bad JSON → 400');
r = await call(req('/leaderboard/submit', { body: sub(dev(1), 'x', 1, 1, { pad: 'y'.repeat(3000) }) })); ok(r.res.status === 413, 'submit: oversized body → 413');
await call(req('/leaderboard/submit', { device: dev(2), ip: '203.0.113.6', body: sub(dev(2), 'Lunk', 90, 55) }));
await call(req('/leaderboard/submit', { device: dev(3), ip: '203.0.113.7', body: sub(dev(3), 'Erik', 40, 81) }));
await call(req('/leaderboard/submit', { device: dev(4), ip: '203.0.113.8', body: sub(dev(4), 'OnlyDaily', 60, null) }));
r = await call(req('/leaderboard?period=weekly', { method: 'GET' }));
ok(r.res.status === 200 && r.j.key === P.week && r.j.total === 3 && r.j.top.map((x) => x.score).join(',') === '81,68,55', 'weekly: ranked 81, 68, 55 (daily-only device not on the weekly board)');
ok(r.j.top[1].me === true && r.j.me.rank === 2 && r.j.top.filter((x) => x.me).length === 1 && r.j.joined === true, 'weekly: caller flagged as me + own rank');
ok(/^Erik #[0-9a-f]{4}$/.test(r.j.top[0].name) && /^Erik #[0-9a-f]{4}$/.test(r.j.top[1].name) && r.j.top[0].name !== r.j.top[1].name && r.j.top[2].name === 'Lunk', 'two "Erik"s get different short tags: ' + r.j.top.map((x) => x.name).join(' | '));
ok(!JSON.stringify(r.j).includes('eeeeeeee'), 'device IDs are never returned');
ok(r.j.top.every((x) => JSON.stringify(Object.keys(x).filter((k) => k !== 'me').sort()) === '["name","rank","score","stars"]'), 'rows: rank, name, stars, score only');
r = await call(req('/leaderboard?period=daily', { method: 'GET', device: dev(9) })); ok(r.j.key === P.day && r.j.top.map((x) => x.score).join(',') === '90,72,60,40' && r.j.me === null && r.j.joined === false, 'daily board; a viewer who is not on it can still view (me null)');
// v1.12.1: v1.12.0 combined-score entries (old prefix) are ignored, and an old app's submit (no kind) is acknowledged but never stored
{ const m = { u: 'OldCombined', d: [P.day, 99], w: [P.week, 99], t: 1 }; kv.set(LB_OLD_PREFIX + dev(6), JSON.stringify(m)); meta.set(LB_OLD_PREFIX + dev(6), m); }
r = await call(req('/leaderboard/submit', { device: dev(7), ip: '203.0.113.9', body: { deviceId: dev(7), username: 'OldApp', daily: { score: 99, date: P.day }, weekly: { score: 99, weekKey: P.week } } }));
ok(r.res.status === 200 && r.j.stored === false && r.j.reason === 'outdated_app' && !kv.has(LB_PREFIX + dev(7)) && !kv.has(LB_OLD_PREFIX + dev(7)), 'old app submit (no kind) → 200 stored:false, nothing written');
await call(req('/leaderboard/submit', { device: dev(2), ip: '203.0.113.6', body: sub(dev(2), 'Lunk', 92, 55) })); // reset the list cache
r = await call(req('/leaderboard?period=daily', { method: 'GET', device: dev(9) })); ok(r.j.kind === 'training' && !r.j.top.some((x) => /^Old/.test(x.name)), 'old combined entries and old-app submits never appear on the board');
r = await call(req('/leaderboard/leave', { device: dev(6) })); ok(!kv.has(LB_OLD_PREFIX + dev(6)), 'leave also removes a leftover v1.12.0 entry');
// stale entries (old periods) are not shown
kv.set(LB_PREFIX + dev(5), 'x'); meta.set(LB_PREFIX + dev(5), { u: 'Old', d: ['2020-01-01', 99], w: ['2019-12-30', 99], t: 1 });
await call(req('/leaderboard/submit', { device: dev(2), ip: '203.0.113.6', body: sub(dev(2), 'Lunk', 91, 55) })); // a write resets the list cache
r = await call(req('/leaderboard?period=weekly', { method: 'GET', device: dev(9) })); ok(r.j.total === 3 && r.j.kind === 'training' && !r.j.top.some((x) => x.name === 'Old'), 'entries from an old week/day are not shown');
// top 50 + own rank beyond it
for (let i = 10; i < 70; i++) { const d = dev(i); const m = { u: `fx${i}`, d: [P.day, 90], w: [P.week, 95], t: 1 }; kv.set(LB_PREFIX + d, JSON.stringify(m)); meta.set(LB_PREFIX + d, m); }
r = await call(req('/leaderboard?period=weekly', { method: 'GET', device: dev(4), ip: '198.51.100.1' }), env({ LB_TOP: '50' })); // dev(4) has no weekly score
await call(req('/leaderboard/submit', { device: dev(4), ip: '203.0.113.8', body: sub(dev(4), 'OnlyDaily', 60, 3) }));
r = await call(req('/leaderboard?period=weekly', { method: 'GET', device: dev(4) }));
ok(r.j.top.length === 50 && r.j.total === 64 && r.j.me && r.j.me.rank === 64 && r.j.me.score === 3 && !r.j.top.some((x) => x.me), 'top 50 returned + own rank (64) outside the top 50');
// leave deletes
r = await call(req('/leaderboard/leave', { device: dev(3), ip: '203.0.113.7' })); ok(r.res.status === 200 && !kv.has(LB_PREFIX + dev(3)), 'leave deletes the entry');
r = await call(req('/leaderboard?period=weekly', { method: 'GET', device: dev(3) })); ok(r.j.me === null && r.j.joined === false && !r.j.top.some((x) => x.score === 81), 'after leave: not on the board, joined false');
ok(![...kv.keys()].some((k) => /^(d|i|g|est|esti|estg|rv|rvi|rvg):/.test(k)), 'leaderboard never touches chat / estimate / review counters');
ok(![...kv.keys()].some((k) => k.includes('203.0.113')), 'raw IPs never stored');
// rate limits
kv.clear(); meta.clear(); let codes = [];
for (let k = 0; k < 22; k++) codes.push((await call(req('/leaderboard/submit', { device: dev(1), ip: '192.0.2.1', body: sub(dev(1), 'Erik', k, k) }))).res.status);
ok(codes.slice(0, 20).every((c) => c === 200) && codes[20] === 429, 'device: 20 submits/hour, 21st → 429');
r = await call(req('/leaderboard/submit', { device: dev(1), ip: '192.0.2.1', body: sub(dev(1), 'Erik', 1, 1) })); ok(r.j.error === 'lb_rate_limited', '429 lb_rate_limited');
r = await call(req('/leaderboard/submit', { device: dev(1), ip: '192.0.2.1', owner: 'owner-secret', body: sub(dev(1), 'Erik', 1, 1) })); ok(r.res.status === 200, 'owner token bypasses the submit limit');
r = await call(req('/leaderboard?period=weekly', { method: 'GET', device: dev(1), ip: '192.0.2.1' })); ok(r.res.status === 200, 'viewing still works while submits are limited');
kv.clear(); meta.clear(); codes = [];
for (let k = 0; k < 4; k++) codes.push((await call(req('/leaderboard/submit', { device: dev(100 + k), ip: '192.0.2.50', body: sub(dev(100 + k), 'N' + k, 5, 5) }), env({ LB_NETWORK_SUBMITS_PER_HOUR: '3' }))).res.status);
ok(codes.join(',') === '200,200,200,429', 'network: per-hashed-IP limit across device IDs (3 → 4th refused)');
r = await call(req('/leaderboard/submit', { device: dev(200), ip: '192.0.2.50', body: sub(dev(200), 'N', 5, 5) }), env({ LB_NETWORK_SUBMITS_PER_HOUR: '3' })); ok(r.j.error === 'lb_ip_rate_limited', '429 lb_ip_rate_limited');
r = await call(req('/leaderboard', { method: 'GET' }), env({ KILL_SWITCH: '1' })); ok(r.res.status === 503, 'kill switch also covers the leaderboard');
r = await call(new Request('https://proxy.test/leaderboard', { headers: { Origin: 'https://evil.example', 'X-Device-Id': dev(1) } })); ok(r.res.status === 403, 'foreign origin refused');
if (failed) { console.error(failed + ' failed'); process.exit(1); } console.log('LEADERBOARD UNIT TESTS PASSED');
