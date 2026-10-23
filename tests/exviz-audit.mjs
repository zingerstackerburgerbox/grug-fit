// Audits every exercise visual: samples the loop densely and flags joints bending the wrong way or jumping (IK flips).
import { buildSync } from 'esbuild';
const src = buildSync({ stdin: { contents: "export * from './src/exviz/rig'; export { DEFS } from './src/exviz/defs';", resolveDir: '.', loader: 'ts' }, bundle: true, format: 'esm', write: false, platform: 'node' }).outputFiles[0].text;
const M = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
const norm = (a) => ((a % 360) + 540) % 360 - 180;
const N = 80, out = []; let bad = 0;
const only = process.argv[2];
for (const [name, d] of Object.entries(M.DEFS)) {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) continue;
  const front = d.view === 'front'; const issues = new Set(); let prev = null;
  for (let i = 0; i <= N; i++) {
    const p = (i / N) * 0.5; // 0..0.5 covers start→end (loop is there-and-back)
    const k = M.skeleton(d, M.poseAt(d, p));
    const P = M.poseAt(d, p); const fl = (l, arm, far) => M.flexSense(arm, front && far, P.prone, l?.proj);
    const armF = P.armF || P.armN, legF = P.legF || P.legN;
    const joints = [['elbowN', k.S, k.elbow[0], k.hand[0], fl(P.armN, 1, 0), front ? k.SR : k.S], ['elbowF', k.S, k.elbow[1], k.hand[1], fl(armF, 1, 1), front ? k.SL : k.S], ['kneeN', k.H, k.knee[0], k.ankle[0], fl(P.legN, 0, 0), front ? k.HR : k.H], ['kneeF', k.H, k.knee[1], k.ankle[1], fl(legF, 0, 1), front ? k.HL : k.H]];
    const cur = {};
    for (const [j, , J, E, sg, R] of joints) {
      const a1 = Math.atan2(J[0] - R[0], J[1] - R[1]) * 180 / Math.PI, a2 = Math.atan2(E[0] - J[0], E[1] - J[1]) * 180 / Math.PI;
      const flex = norm(sg * (a2 - a1)); cur[j] = J;
      if (flex < M.FLEX_MIN - 1 || flex > M.FLEX_MAX + 1) issues.add(`${j} hyperextends ${flex.toFixed(0)}° @${p.toFixed(2)}`);
      if (prev) { const dj = Math.hypot(J[0] - prev[j][0], J[1] - prev[j][1]); if (dj > 6) issues.add(`${j} jumps ${dj.toFixed(1)} @${p.toFixed(2)}`); }
    }
    prev = cur;
  }
  // authored angle keyframes outside the joint's range would be silently clamped by the rig — flag them so they get fixed at the source
  d.keys.forEach((P, i) => { for (const [kk, arm, far] of [['armN', 1, 0], ['armF', 1, 1], ['legN', 0, 0], ['legF', 0, 1]]) { const l = P[kk] || (front ? null : P[kk.slice(0, 3) + 'N']); if (!l?.a) continue; const f = norm(M.flexSense(!!arm, front && !!far, P.prone, l.proj) * (l.a[1] - l.a[0])); if (f < M.FLEX_MIN - 0.5 || f > M.FLEX_MAX + 0.5) issues.add(`key ${i} ${kk} authored flex ${f.toFixed(0)}° (clamped)`); } });
  if (issues.size) { bad++; out.push(name + ': ' + [...issues].slice(0, 4).join('; ') + (issues.size > 4 ? ` (+${issues.size - 4})` : '')); }
}
console.log(out.join('\n')); console.log(`audit: ${bad} exercise(s) with issues of ${Object.keys(M.DEFS).length}`);
process.exitCode = bad ? 1 : 0;
