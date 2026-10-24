// Live check of the Smart Estimate daily cap on the deployed Worker (no owner token): one fresh device id gets EST_DAILY_CAP (3)
// successful estimates, the next is refused with 429 est_limit. Costs 3 real estimates and 3 of today's 9 per-network allowance.
const U = process.env.PROXY || 'https://grug-coach-proxy.grug-fitgrug-fitgrug-fit.workers.dev';
const H = { 'Content-Type': 'application/json', Origin: 'https://zingerstackerburgerbox.github.io', 'X-Device-Id': crypto.randomUUID() };
const meals = ['a bowl of rolled oats with milk and a banana', 'ham and cheese sandwich on white bread', 'an apple', 'a flat white'];
let bad = 0; const st = async () => (await (await fetch(U + '/status', { headers: H })).json()).estimate;
console.log('status before:', JSON.stringify(await st()));
for (const [i, text] of meals.entries()) {
  const r = await fetch(U + '/estimate', { method: 'POST', headers: H, body: JSON.stringify({ text }) }); const j = await r.json();
  console.log(`#${i + 1}`, r.status, j.error || `${j.items.length} items, ${Math.round(j.items.reduce((a, x) => a + x.kcal, 0))} kcal`, '| remaining', r.headers.get('x-est-remaining'));
  if (i < 3 && r.status !== 200) bad++; if (i === 3 && !(r.status === 429 && j.error === 'est_limit')) bad++;
  if (i === 3) console.log('message:', j.message);
}
console.log('status after:', JSON.stringify(await st()));
if (bad) { console.error('EST CAP LIVE FAILED'); process.exit(1); } console.log('EST CAP LIVE PASSED');
