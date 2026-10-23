/** Parametric stick-figure renderer for exercise visuals (original art, generated SVG).
 *  Angles: absolute degrees, 0 = pointing down, +90 = facing direction (+x), 180 = up, −90 = behind. */
export type V = [number, number];
/** A limb is given as absolute angles [upper, lower] (`a`) or as an IK target (`to` absolute / `rel` to the root).
 *  The joint (elbow/knee) always bends the anatomical way — see `flexSense`. `bend` is only honoured together with `proj`,
 *  for poses where shoulder rotation makes the elbow *look* reversed in 2-D (e.g. back-squat grip, hands behind the head). */
export type Limb = { a?: [number, number]; to?: V; rel?: V; bend?: 1 | -1; proj?: boolean };
export type Pose = { /** face-down (push-up, plank): flips the flexion sense */ prone?: boolean; hip: V; torso: number; head?: number; tl?: number; nk?: number; lt?: number; armN: Limb; armF?: Limb; legN: Limb; legF?: Limb; foot?: number; footF?: number };
export type Prop =
  | { t: 'bb' | 'db' | 'kb' | 'wheel' | 'dbH' | 'dbV' | 'handle' | 'plate'; at: Anchor; off?: V; r?: number; ang?: number }
  | { t: 'bbF'; at: Anchor; off?: V; w?: number }
  | { t: 'cable'; at: Anchor; from: V; col?: number | false }
  | { t: 'bench'; x: number; y: number; w: number; ang?: number; legs?: boolean }
  | { t: 'pad'; x: number; y: number; w: number; h: number; ang?: number; at?: Anchor; front?: boolean }
  | { t: 'bar'; x: number; y: number; w?: number }
  | { t: 'rod'; from: V; at: Anchor; ext?: number; plate?: boolean }
  | { t: 'band'; from: V; at: Anchor }
  | { t: 'line'; p: V[]; w?: number; front?: boolean }
  | { t: 'box'; x: number; y: number; w: number; h: number };
export type Anchor = 'handN' | 'handF' | 'hands' | 'shoulder' | 'hip' | 'ankleN' | 'ankleF' | 'ankles' | 'knee' | 'chest' | 'elbowN';
export type Muscle = 'chest' | 'back' | 'lats' | 'shoulders' | 'reardelt' | 'traps' | 'biceps' | 'triceps' | 'forearms' | 'quads' | 'hams' | 'glutes' | 'abductors' | 'calves' | 'core' | 'obliques';
export type Def = { view: 'side' | 'front'; mus: Muscle[]; keys: Pose[]; props?: Prop[]; dur?: number; floor?: number | false; hold?: boolean; /** thumbnail phase (default 0 = start pose) */ thumb?: number };

export const L = { torso: 25, neck: 8.5, head: 6, ua: 15, fa: 14, th: 20, sh: 20, foot: 7, shW: 8.5, hipW: 5 };
const rad = (a: number) => (a * Math.PI) / 180;
export const dir = (a: number): V => [Math.sin(rad(a)), Math.cos(rad(a))];
const add = (p: V, q: V, k = 1): V => [p[0] + q[0] * k, p[1] + q[1] * k];
const angOf = (p: V, q: V) => (Math.atan2(q[0] - p[0], q[1] - p[1]) * 180) / Math.PI;
const dist = (p: V, q: V) => Math.hypot(q[0] - p[0], q[1] - p[1]);

const norm = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
/** Joint flexion sense in screen angles: +1 = forearm/shin rotates in the +angle direction when the joint flexes.
 *  Elbows flex "forward" (+), knees "backward" (−) for a figure facing +x; mirrored for the far limb in front view and for prone poses. */
export const flexSense = (arm: boolean, mirrored: boolean, prone?: boolean, proj?: boolean) => (arm ? 1 : -1) * (mirrored ? -1 : 1) * (prone ? -1 : 1) * (proj ? -1 : 1);
export const FLEX_MAX = 172, FLEX_MIN = -5; // a few degrees of natural hyperextension allowed
/** Two-bone IK. Picks the solution whose joint bends anatomically and clamps angle-specified joints to [FLEX_MIN, FLEX_MAX]. */
function solve(root: V, s: Limb, l1: number, l2: number, sense: number): { j: V; e: V; a1: number; a2: number } {
  if (s.a) {
    const a1 = s.a[0]; const fl = Math.min(FLEX_MAX, Math.max(FLEX_MIN, norm(sense * (s.a[1] - a1)))); const a2 = a1 + sense * fl;
    const j = add(root, dir(a1), l1); return { j, e: add(j, dir(a2), l2), a1, a2 };
  }
  const T: V = s.to ? s.to : add(root, s.rel || [0, l1 + l2]);
  let d = dist(root, T); const base = angOf(root, T); d = Math.min(Math.max(d, Math.abs(l1 - l2) + 0.01), (l1 + l2) * 0.9999);
  const A = (Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)))) * 180) / Math.PI;
  const e = add(root, dir(base), d);
  // the anatomical solution: the joint sits on the side that makes the lower bone rotate by +sense (flexion ≥ 0)
  const b = -sense as 1 | -1; const a1 = base + b * A; const j = add(root, dir(a1), l1);
  return { j, e, a1, a2: angOf(j, e) };
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpV = (a: V, b: V, t: number): V => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
/** shortest angular path from a to b */
const lerpA = (a: number, b: number, t: number) => a + norm(b - a) * t;
function lerpLimb(a: Limb | undefined, b: Limb | undefined, t: number): Limb | undefined {
  if (!a || !b) return a || b;
  const o: Limb = { bend: t < 0.5 ? a.bend : b.bend, proj: t < 0.5 ? a.proj : b.proj };
  // angles: shortest path for the upper bone, and interpolate the joint's *relative* angle so it stays within its range
  if (a.a && b.a) { const u = lerpA(a.a[0], b.a[0], t); const ra = norm(a.a[1] - a.a[0]), rb = norm(b.a[1] - b.a[0]); o.a = [u, u + lerp(ra, rb, t)]; }
  else if (a.to && b.to) o.to = lerpV(a.to, b.to, t);
  else if (a.rel && b.rel) o.rel = lerpV(a.rel, b.rel, t);
  else return t < 0.5 ? a : b; // mixed kinds are converted to angles in poseAt before we get here
  return o;
}
export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return { prone: t < 0.5 ? a.prone : b.prone, hip: lerpV(a.hip, b.hip, t), torso: lerpA(a.torso, b.torso, t), head: lerp(a.head || 0, b.head || 0, t), tl: lerp(a.tl ?? 1, b.tl ?? 1, t), nk: lerp(a.nk ?? 1, b.nk ?? 1, t), lt: lerp(a.lt ?? 1, b.lt ?? 1, t), armN: lerpLimb(a.armN, b.armN, t)!, armF: lerpLimb(a.armF, b.armF, t), legN: lerpLimb(a.legN, b.legN, t)!, legF: lerpLimb(a.legF, b.legF, t),
    foot: a.foot != null || b.foot != null ? lerpA(a.foot ?? b.foot!, b.foot ?? a.foot!, t) : undefined, footF: a.footF != null || b.footF != null ? lerpA(a.footF ?? b.footF!, b.footF ?? a.footF!, t) : undefined };
}
type LK = 'armN' | 'armF' | 'legN' | 'legF';
const kindOf = (l?: Limb) => (!l ? '' : l.a ? 'a' : l.to ? 'to' : 'rel');
/** when two keyframes describe a limb differently (angles vs IK target), resolve both to angles so the blend is continuous */
function harmonise(d: Def, a: Pose, b: Pose): [Pose, Pose] {
  const ks: LK[] = ['armN', 'armF', 'legN', 'legF']; let A = a, B = b;
  for (const key of ks) {
    if (!A[key] || !B[key] || kindOf(A[key]) === kindOf(B[key])) continue;
    const ang = (P: Pose): Limb => { const k = skeleton(d, P); const i = key.endsWith('N') ? 0 : 1; return key.startsWith('arm') ? { a: [k.ua[i], k.fa[i]], proj: P[key]!.proj } : { a: [k.th[i], k.sh[i]], proj: P[key]!.proj }; };
    A = { ...A, [key]: ang(A) }; B = { ...B, [key]: ang(B) };
  }
  return [A, B];
}
const hcache = new WeakMap<Def, [Pose, Pose][]>();
/** pose at phase p∈[0,1): there and back through the keyframes with ease-in-out */
export function poseAt(d: Def, p: number): Pose {
  const k = d.keys; if (k.length === 1) return k[0];
  const u = p < 0.5 ? p * 2 : 2 - p * 2; const e = (1 - Math.cos(Math.PI * u)) / 2; // 0→1→0
  const seg = e * (k.length - 1); const i = Math.min(k.length - 2, Math.floor(seg));
  let H = hcache.get(d); if (!H) { H = k.slice(0, -1).map((x, j) => harmonise(d, x, k[j + 1])); hcache.set(d, H); }
  return lerpPose(H[i][0], H[i][1], seg - i);
}

export const C = { body: '#cbd5e1', far: '#6b7686', mus: '#fb923c', eq: '#94a3b8', plate: '#3b4656', pad: '#334155', floor: '#2b303b', cable: '#7dd3fc', outline: '#171a21' };
type Sk = { H: V; S: V; head: V; hand: [V, V]; elbow: [V, V]; knee: [V, V]; ankle: [V, V]; toe: [V, V]; SL: V; SR: V; HL: V; HR: V; front: boolean; torso: number; ua: [number, number]; fa: [number, number]; th: [number, number]; sh: [number, number] };

export function skeleton(d: Def, P: Pose): Sk {
  const front = d.view === 'front';
  const H = P.hip; const S = add(H, dir(P.torso), L.torso * (P.tl ?? 1)); const head = add(S, dir(P.torso + (P.head || 0)), L.neck * (P.nk ?? 1));
  const perp = dir(P.torso + 90); // sideways for front view
  const SR = front ? add(S, perp, -L.shW) : S, SL = front ? add(S, perp, L.shW) : S; // R = +x side (near), L = mirrored
  const HR = front ? add(H, perp, -L.hipW) : H, HL = front ? add(H, perp, L.hipW) : H;
  const mir = (l: Limb | undefined, cx: number): Limb | undefined => !l ? l : { proj: l.proj, bend: l.bend != null ? (-l.bend as 1 | -1) : undefined, a: l.a ? [-l.a[0], -l.a[1]] : undefined, to: l.to ? [2 * cx - l.to[0], l.to[1]] : undefined, rel: l.rel ? [-l.rel[0], l.rel[1]] : undefined };
  const armF = front ? (P.armF || mir(P.armN, S[0])) : (P.armF || P.armN);
  const legF = front ? (P.legF || mir(P.legN, H[0])) : (P.legF || P.legN);
  const fs = (l: Limb | undefined, arm: boolean, far: boolean) => flexSense(arm, front && far, P.prone, l?.proj);
  const aN = solve(front ? SR : S, P.armN, L.ua, L.fa, fs(P.armN, true, false)), aF = solve(front ? SL : S, armF!, L.ua, L.fa, fs(armF, true, true));
  const th = L.th * (P.lt ?? 1); const lN = solve(front ? HR : H, P.legN, th, L.sh, fs(P.legN, false, false)), lF = solve(front ? HL : H, legF!, th, L.sh, fs(legF, false, true));
  const footA = (shin: number, f?: number) => f ?? (front ? shin : Math.abs(shin) < 60 ? 90 : shin + 90);
  const tN = front ? add(lN.e, [2.5, 0], 1) : add(lN.e, dir(footA(lN.a2, P.foot)), L.foot), tF = front ? add(lF.e, [-2.5, 0], 1) : add(lF.e, dir(footA(lF.a2, P.footF ?? P.foot)), L.foot);
  return { H, S, head, hand: [aN.e, aF.e], elbow: [aN.j, aF.j], knee: [lN.j, lF.j], ankle: [lN.e, lF.e], toe: [tN, tF], SL, SR, HL, HR, front, torso: P.torso, ua: [aN.a1, aF.a1], fa: [aN.a2, aF.a2], th: [lN.a1, lF.a1], sh: [lN.a2, lF.a2] };
}
const f = (n: number) => Math.round(n * 10) / 10;
const ln = (p: V, q: V, c: string, w: number, extra = '') => `<line x1="${f(p[0])}" y1="${f(p[1])}" x2="${f(q[0])}" y2="${f(q[1])}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"${extra}/>`;
const circ = (p: V, r: number, c: string, extra = '') => `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${r}" fill="${c}"${extra}/>`;
const poly = (pts: V[], c: string, extra = '') => `<polygon points="${pts.map((p) => f(p[0]) + ',' + f(p[1])).join(' ')}" fill="${c}"${extra}/>`;
const seg = (p: V, q: V, t0: number, t1: number): [V, V] => [lerpV(p, q, t0), lerpV(p, q, t1)];

function anchorPt(k: Sk, a: Anchor): V {
  switch (a) {
    case 'handN': return k.hand[0]; case 'handF': return k.hand[1]; case 'hands': return lerpV(k.hand[0], k.hand[1], 0.5);
    case 'shoulder': return k.S; case 'hip': return k.H; case 'ankleN': return k.ankle[0]; case 'ankleF': return k.ankle[1]; case 'ankles': return lerpV(k.ankle[0], k.ankle[1], 0.5);
    case 'knee': return k.knee[0]; case 'chest': return lerpV(k.H, k.S, 0.8); case 'elbowN': return k.elbow[0];
  }
}
function rot(pts: V[], c: V, ang = 0): V[] { if (!ang) return pts; const r = rad(ang), co = Math.cos(r), si = Math.sin(r); return pts.map(([x, y]) => [c[0] + (x - c[0]) * co - (y - c[1]) * si, c[1] + (x - c[0]) * si + (y - c[1]) * co]); }
function propSvg(p: Prop, k: Sk, layer: 'back' | 'front'): string {
  const isFrontLayer = ['bb', 'db', 'kb', 'wheel', 'dbH', 'dbV', 'handle', 'plate', 'bbF', 'cable', 'rod', 'band'].includes(p.t) || ((p.t === 'pad' || p.t === 'line') && !!(p as any).front);
  if ((layer === 'front') !== isFrontLayer) return '';
  switch (p.t) {
    case 'bench': { const a = p.ang || 0; const pts = rot([[p.x, p.y], [p.x + p.w, p.y], [p.x + p.w, p.y + 4], [p.x, p.y + 4]], [p.x, p.y], a);
      const legs = p.legs === false ? '' : ln(rot([[p.x + 4, p.y + 4]], [p.x, p.y], a)[0], [rot([[p.x + 4, p.y + 4]], [p.x, p.y], a)[0][0], 94], C.pad, 2.5) + ln(rot([[p.x + p.w - 4, p.y + 4]], [p.x, p.y], a)[0], [rot([[p.x + p.w - 4, p.y + 4]], [p.x, p.y], a)[0][0], 94], C.pad, 2.5);
      return legs + poly(pts, C.pad, ` stroke="${C.pad}" stroke-width="2" stroke-linejoin="round"`); }
    case 'pad': { const o = p.at ? add(anchorPt(k, p.at), [p.x, p.y]) : [p.x, p.y] as V; const pts = rot([[o[0], o[1]], [o[0] + p.w, o[1]], [o[0] + p.w, o[1] + p.h], [o[0], o[1] + p.h]], o, p.ang || 0);
      return poly(pts, C.pad, ` stroke="${C.pad}" stroke-width="2.5" stroke-linejoin="round"`); }
    case 'line': return `<polyline points="${p.p.map((q) => f(q[0]) + ',' + f(q[1])).join(' ')}" fill="none" stroke="${C.pad}" stroke-width="${p.w || 2.5}" stroke-linecap="round" stroke-linejoin="round"/>`;
    case 'box': return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="1.5" fill="${C.pad}"/>`;
    case 'bar': return p.w ? ln([p.x - p.w / 2, p.y], [p.x + p.w / 2, p.y], C.eq, 2.2) : circ([p.x, p.y], 1.8, C.eq);
    case 'rod': { const h = anchorPt(k, p.at); const a = angOf(p.from, h); const e = add(h, dir(a), p.ext ?? 4);
      return ln(p.from, e, C.eq, 2.2) + (p.plate === false ? '' : circ(add(h, dir(a), (p.ext ?? 4) + 1), 6.5, C.plate, ` stroke="${C.eq}" stroke-width="1.4"`)); }
    case 'band': { const h = anchorPt(k, p.at); return ln(p.from, h, '#4ade80', 1.6, ' stroke-dasharray="3 1.5"'); }
    case 'cable': { const h = anchorPt(k, p.at); const col = p.col === false ? '' : ln([p.col ?? p.from[0], 6], [p.col ?? p.from[0], 94], C.pad, 4);
      return col + ln(p.from, h, C.cable, 1.2, ' stroke-dasharray="0"') + circ(p.from, 2.2, C.eq); }
  }
  const at = add(anchorPt(k, (p as any).at), (p as any).off || [0, 0]);
  switch (p.t) {
    case 'bb': return circ(at, p.r || 9, C.plate, ` stroke="${C.eq}" stroke-width="1.6"`) + circ(at, 1.6, C.eq);
    case 'plate': return circ(at, p.r || 6, C.plate, ` stroke="${C.eq}" stroke-width="1.4"`) + circ(at, 1.2, C.eq);
    case 'db': return circ(at, p.r || 3.6, C.plate, ` stroke="${C.eq}" stroke-width="1.2"`);
    case 'dbH': case 'dbV': { const a = p.ang ?? (p.t === 'dbV' ? 90 : 0); const r = rad(a); const dx = Math.cos(r) * 4.5, dy = Math.sin(r) * 4.5;
      return ln([at[0] - dx, at[1] - dy], [at[0] + dx, at[1] + dy], C.eq, 1.6) + ln([at[0] - dx * 1.1, at[1] - dy * 1.1], [at[0] - dx * 0.65, at[1] - dy * 0.65], C.plate, 5, ` stroke="${C.eq}"`).replace('stroke-linecap="round"', 'stroke-linecap="round"') + ln([at[0] + dx * 0.65, at[1] + dy * 0.65], [at[0] + dx * 1.1, at[1] + dy * 1.1], C.eq, 5); }
    case 'kb': return `<path d="M${f(at[0] - 2.6)} ${f(at[1] + 1)} Q${f(at[0])} ${f(at[1] - 4)} ${f(at[0] + 2.6)} ${f(at[1] + 1)}" fill="none" stroke="${C.eq}" stroke-width="1.6"/>` + circ([at[0], at[1] + 5], 4.4, C.plate, ` stroke="${C.eq}" stroke-width="1.2"`);
    case 'wheel': return circ(at, p.r || 5, C.plate, ` stroke="${C.eq}" stroke-width="1.6"`) + circ(at, 1.2, C.eq);
    case 'handle': { const a = rad(p.ang ?? 0); return ln([at[0] - Math.cos(a) * 3, at[1] - Math.sin(a) * 3], [at[0] + Math.cos(a) * 3, at[1] + Math.sin(a) * 3], C.eq, 2); }
    case 'bbF': { const w = p.w || 34; return ln([at[0] - w, at[1]], [at[0] + w, at[1]], C.eq, 1.8) + [-1, 1].map((s) => `<rect x="${f(at[0] + s * (w - 5) - 2)}" y="${f(at[1] - 7)}" width="4" height="14" rx="1.2" fill="${C.plate}" stroke="${C.eq}" stroke-width="1"/>`).join(''); }
  }
  return '';
}

function muscleSvg(d: Def, k: Sk, near: boolean): string {
  const out: string[] = []; const M = new Set(d.mus); const c = C.mus;
  const tFront: V = [-Math.cos(rad(k.torso)), Math.sin(rad(k.torso))]; // chest side normal for side view
  const off = (p: [V, V], n: V, s: number): [V, V] => [add(p[0], n, s), add(p[1], n, s)];
  const limbN = (a: number): V => [Math.cos(rad(a)), -Math.sin(rad(a))]; // "front" of a limb hanging from its root
  if (!k.front) {
    if (!near) return '';
    const tor = (t0: number, t1: number, s: number, w = 4.5) => { const sg = off(seg(k.H, k.S, t0, t1), tFront, s); out.push(ln(sg[0], sg[1], c, w)); };
    if (M.has('chest')) tor(0.62, 0.9, 3);
    if (M.has('core')) tor(0.12, 0.55, 3);
    if (M.has('obliques')) tor(0.15, 0.5, 0.5, 5);
    if (M.has('back') || M.has('lats')) tor(0.3, 0.9, -3);
    if (M.has('traps')) { const sg = off(seg(k.H, k.S, 0.85, 1.1), tFront, -2.5); out.push(ln(sg[0], sg[1], c, 4.5)); }
    if (M.has('shoulders') || M.has('reardelt')) out.push(circ(add(k.S, dir(k.ua[0]), 2.5), 3.6, c));
    const arm = (t0: number, t1: number, s: number, fore = false) => { const p = fore ? seg(k.elbow[0], k.hand[0], t0, t1) : seg(k.S, k.elbow[0], t0, t1); const n = limbN(fore ? 0 : k.ua[0]); const sg = fore ? p : off(p, n, s); out.push(ln(sg[0], sg[1], c, fore ? 4 : 3.4)); };
    if (M.has('biceps')) arm(0.25, 0.85, 1.6); if (M.has('triceps')) arm(0.2, 0.85, -1.6); if (M.has('forearms')) arm(0.1, 0.8, 0, true);
    const leg = (t0: number, t1: number, s: number, shin = false) => { const p = shin ? seg(k.knee[0], k.ankle[0], t0, t1) : seg(k.H, k.knee[0], t0, t1); const n = limbN(shin ? k.sh[0] : k.th[0]); const sg = off(p, n, s); out.push(ln(sg[0], sg[1], c, shin ? 3.4 : 4.4)); };
    if (M.has('quads')) leg(0.15, 0.85, 1.8); if (M.has('hams')) leg(0.15, 0.85, -1.8); if (M.has('calves')) leg(0.12, 0.6, -1.4, true);
    if (M.has('glutes')) out.push(circ(add(k.H, tFront, -3), 4.4, c));
    if (M.has('abductors')) leg(0, 0.4, 0);
  } else {
    const both = (fn: (side: 0 | 1) => void) => { fn(0); fn(1); };
    if (M.has('chest')) both((s) => { const sp = s ? k.SL : k.SR; out.push(ln(lerpV(sp, k.S, 0.25), add(lerpV(sp, k.S, 0.8), dir(k.torso), -5), c, 4)); });
    if (M.has('core')) out.push(ln(lerpV(k.H, k.S, 0.12), lerpV(k.H, k.S, 0.55), c, 5));
    if (M.has('obliques')) both((s) => out.push(ln(lerpV(s ? k.HL : k.HR, k.S, 0.1), lerpV(s ? k.HL : k.HR, k.S, 0.45), c, 3.5)));
    if (M.has('lats') || M.has('back')) both((s) => out.push(ln(lerpV(s ? k.HL : k.HR, s ? k.SL : k.SR, 0.3), lerpV(s ? k.HL : k.HR, s ? k.SL : k.SR, 0.85), c, 3.6)));
    if (M.has('traps')) both((s) => out.push(ln(lerpV(k.S, k.head, 0.3), lerpV(k.S, s ? k.SL : k.SR, 0.75), c, 3.6)));
    if (M.has('shoulders') || M.has('reardelt')) both((s) => out.push(circ(add(s ? k.SL : k.SR, dir(k.ua[s]), 2.2), 3.4, c)));
    if (M.has('biceps') || M.has('triceps')) both((s) => { const p = seg(s ? k.SL : k.SR, k.elbow[s], 0.25, 0.85); out.push(ln(p[0], p[1], c, 3.4)); });
    if (M.has('forearms')) both((s) => { const p = seg(k.elbow[s], k.hand[s], 0.1, 0.8); out.push(ln(p[0], p[1], c, 3.4)); });
    if (M.has('quads') || M.has('hams')) both((s) => { const p = seg(s ? k.HL : k.HR, k.knee[s], 0.15, 0.85); out.push(ln(p[0], p[1], c, 4.4)); });
    if (M.has('calves')) both((s) => { const p = seg(k.knee[s], k.ankle[s], 0.12, 0.6); out.push(ln(p[0], p[1], c, 3.6)); });
    if (M.has('glutes') || M.has('abductors')) both((s) => out.push(circ(add(s ? k.HL : k.HR, [s ? -2.2 : 2.2, 0]), 3.6, c)));
  }
  return out.join('');
}

/** Render one frame as SVG markup. */
/** square viewBox tightly around figure + props (used for small thumbnails) */
function fitBox(d: Def, k: Sk): string {
  const pts: V[] = [k.head, k.S, k.H, ...k.hand, ...k.elbow, ...k.knee, ...k.ankle, ...k.toe, k.SL, k.SR];
  for (const q of d.props || []) {
    if ('at' in q && q.at && typeof q.at === 'string') { const c = add(anchorPt(k, q.at), ((q as any).off || [0, 0]) as V); const r = q.t === 'bb' ? (q as any).r || 9 : q.t === 'bbF' ? (q as any).w || 34 : 6; pts.push([c[0] - r, c[1] - r], [c[0] + r, c[1] + r]); }
    if (q.t === 'bench') pts.push([q.x, q.y], [q.x + q.w, q.y], [q.x, 94]);
    if (q.t === 'pad' && !q.at) pts.push([q.x, q.y], [q.x + q.w, q.y + q.h]);
    if (q.t === 'box') pts.push([q.x, q.y], [q.x + q.w, q.y + q.h]);
    if (q.t === 'bar') pts.push([q.x - (q.w || 0) / 2, q.y], [q.x + (q.w || 0) / 2, q.y]);
  }
  if (d.floor !== false) pts.push([pts[0][0], (d.floor ?? 94) + 2.5]);
  let x0 = Math.min(...pts.map((q) => q[0])) - 7, x1 = Math.max(...pts.map((q) => q[0])) + 7, y0 = Math.min(...pts.map((q) => q[1])) - 8, y1 = Math.max(...pts.map((q) => q[1])) + 5;
  const side = Math.max(x1 - x0, y1 - y0, 70); const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return `${f(cx - side / 2)} ${f(cy - side / 2)} ${f(side)} ${f(side)}`;
}
export function renderSvg(d: Def, p = 0, opts: { size?: number; cls?: string; title?: string; fit?: boolean } = {}): string {
  const P = poseAt(d, p); const k = skeleton(d, P);
  const body = (near: boolean) => {
    const i = near ? 0 : 1; const col = near ? C.body : C.far; const o: string[] = [];
    const sp = k.front ? (i === 0 ? k.SR : k.SL) : k.S; const hp = k.front ? (i === 0 ? k.HR : k.HL) : k.H;
    o.push(ln(hp, k.knee[i], col, 7.5), ln(k.knee[i], k.ankle[i], col, 6), ln(k.ankle[i], k.toe[i], col, 4.5));
    o.push(ln(sp, k.elbow[i], col, 5.8), ln(k.elbow[i], k.hand[i], col, 4.8), circ(k.hand[i], 2.6, col));
    return o.join('');
  };
  const O = C.outline; // thin dark outline keeps overlapping limbs readable
  const legs = (i: number) => { const col = !k.front && i ? C.far : C.body; const hp = k.front ? (i === 0 ? k.HR : k.HL) : k.H; return ln(hp, k.knee[i], O, 10) + ln(k.knee[i], k.ankle[i], O, 8.5) + ln(hp, k.knee[i], col, 7.5) + ln(k.knee[i], k.ankle[i], col, 6) + ln(k.ankle[i], k.toe[i], col, 4.5); };
  const arms = (i: number) => { const col = !k.front && i ? C.far : C.body; const sp = k.front ? (i === 0 ? k.SR : k.SL) : k.S; return ln(sp, k.elbow[i], O, 8.2) + ln(k.elbow[i], k.hand[i], O, 7.2) + ln(sp, k.elbow[i], col, 5.8) + ln(k.elbow[i], k.hand[i], col, 4.8) + circ(k.hand[i], 2.6, col); };
  const torso = k.front
    ? poly([k.SR, k.SL, k.HL, k.HR], C.body, ` stroke="${C.body}" stroke-width="5" stroke-linejoin="round"`)
    : ln(k.H, k.S, C.body, 11);
  const headSvg = ln(k.S, add(k.S, dir(k.torso + 0), 4), C.body, 5) + circ(k.head, L.head, C.body);
  const props = d.props || [];
  const floor = d.floor === false ? '' : ln([-20, (d.floor ?? 94) + 1.5], [120, (d.floor ?? 94) + 1.5], C.floor, 2);
  const parts = [floor, props.map((q) => propSvg(q, k, 'back')).join('')];
  if (k.front) parts.push(legs(0), legs(1), torso, muscleSvg(d, k, true), arms(0), arms(1), headSvg);
  else parts.push(legs(1), arms(1), torso, headSvg, muscleSvg(d, k, true), legs(0));
  if (!k.front) { const late = (q: Prop) => q.t === 'cable' || q.t === 'dbH' || q.t === 'dbV'; parts.push(props.filter((q) => !late(q)).map((q) => propSvg(q, k, 'front')).join('')); parts.push(arms(0), props.filter(late).map((q) => propSvg(q, k, 'front')).join('')); }
  else parts.push(props.map((q) => propSvg(q, k, 'front')).join(''));
  if (!k.front) { const m = muscleSvg({ ...d, mus: d.mus.filter((x) => ['biceps', 'triceps', 'forearms', 'shoulders', 'reardelt', 'quads', 'hams', 'calves'].includes(x)) }, k, true); parts.push(m); }
  void body;
  const s = opts.size;
  return `<svg viewBox="${opts.fit ? fitBox(d, k) : '-6 -14 112 112'}" ${s ? `width="${s}" height="${s}"` : ''} class="${opts.cls || 'exviz'}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${(opts.title || 'exercise').replace(/"/g, '')}">${parts.join('')}</svg>`;
}
