// js/figure-head.js — heads, faces and hair for js/figures.js (near LOD sculpted, far LOD cheap).
// The head is one smooth loft whose rings are sampled densely across the face: jaw, chin, cheekbones, brow ridge, eye
// sockets, a broad nose with alae, and full lips are pushed out of (or into) the rings; ears are small tilted ellipsoids.
// Faces are painted in the fragment shader from the bind-pose position (almond eyes with whites, irises and lash lines,
// lid creases, brows, nostrils, two-tone lips, beards and stubble), and skin gets a warm wrap-lit subsurface term.
// Hair is three shared pieces whose shape the vertex shader picks per person ("hair kind", in the look texture):
//   a scalp SHELL (crop, fade, twists, TWA, afro, cornrows, braid parts, locs roots, weave, slick-back, doek wrap),
//   a BALL (puff, bun, doek knot) and 20 hanging STRANDS (box braids, locs, a straight weave curtain, cornrow tails).
// Hair texture (coils, plaits, cornrow parting, locs lumps, combed lines, cloth folds) is bump-mapped from the same
// bind-pose coordinates, faded out with pixel size so it never shimmers at a distance.
import * as THREE from 'three';

// Hair kinds (data texel 6.a); people.js / player.js only pick a coarse HAIR style, hairKind() refines it from the seed
export const HK = { CROP: 0, FADE: 1, TWISTS: 2, TWA: 3, AFRO: 4, PUFF: 5, BUN: 6, DOEK: 7, ROWS: 8, BRAIDS: 9, LOCS: 10, WEAVE: 11, CAP: 12, BALD: 13 };
export const BEARD = { NONE: 0, STUBBLE: 1, MOUSTACHE: 2, GOATEE: 3, FULL: 4 };

const h01 = (seed, k) => {
  const x = Math.sin((seed * 1000 + k) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};
const pickW = (u, table) => {
  let a = 0;
  for (const [v, w] of table) if (u < (a += w)) return v;
  return table[table.length - 1][0];
};
// coarse style (0 crop, 1 afro, 2 doek, 3 braids, 4 cap, 5 shaved) + sex/age + seed -> [hair kind, beard, lipstick]
export function hairKind(L) {
  const s = L.seed ?? 0, fem = (L.fem || 0) > 0.5, child = (L.child || 0) > 0.5, st = L.hairStyle || 0;
  const u = h01(s, 1);
  let k;
  if (st === 1) k = fem ? (u < 0.5 ? HK.AFRO : HK.PUFF) : HK.AFRO;
  else if (st === 2) k = HK.DOEK;
  else if (st === 3) k = fem || child ? pickW(u, [[HK.ROWS, 0.32], [HK.BRAIDS, 0.43], [HK.LOCS, 0.25]]) : HK.LOCS;
  else if (st === 4) k = HK.CAP;
  else if (st === 5) k = HK.BALD;
  else if (fem) k = child ? pickW(u, [[HK.PUFF, 0.35], [HK.ROWS, 0.35], [HK.TWA, 0.3]]) : pickW(u, [[HK.WEAVE, 0.3], [HK.BUN, 0.2], [HK.PUFF, 0.15], [HK.TWA, 0.2], [HK.CROP, 0.15]]);
  else k = child ? pickW(u, [[HK.CROP, 0.7], [HK.FADE, 0.3]]) : pickW(u, [[HK.CROP, 0.46], [HK.FADE, 0.3], [HK.TWISTS, 0.12], [HK.LOCS, 0.12]]);
  if (L.load && (k === HK.AFRO || k === HK.PUFF || k === HK.BUN || k === HK.DOEK)) k = HK.ROWS; // a basin sits on the crown
  const beard = fem || child ? 0 : pickW(h01(s, 2), [[0, 0.42], [1, 0.26], [2, 0.08], [3, 0.11], [4, 0.13]]);
  const lips = fem && !child && h01(s, 3) < 0.3 ? 1 + Math.floor(h01(s, 4) * 3) : 0;
  return [L.hairKind ?? k, L.beard ?? beard, lips];
}

// --- head surface ------------------------------------------------------------------------------------------------------
// [y, rx, rzFront, rzBack, centreZ, squareness exponent]
const HEADT = [
  [1.537, 0.03, 0.046, 0.022, 0.02, 2],
  [1.548, 0.05, 0.072, 0.038, 0.013, 2.1],
  [1.558, 0.058, 0.08, 0.046, 0.009, 2.2],
  [1.567, 0.062, 0.084, 0.053, 0.005, 2.2],
  [1.575, 0.065, 0.086, 0.06, 0.003, 2.18],
  [1.581, 0.066, 0.087, 0.064, 0.002, 2.15],
  [1.588, 0.068, 0.088, 0.069, 0.001, 2.12],
  [1.596, 0.071, 0.089, 0.074, -0.001, 2.06],
  [1.604, 0.073, 0.09, 0.079, -0.002, 2.05],
  [1.614, 0.076, 0.091, 0.084, -0.003, 2],
  [1.626, 0.08, 0.092, 0.089, -0.004, 2],
  [1.638, 0.082, 0.092, 0.093, -0.005, 2],
  [1.646, 0.083, 0.092, 0.096, -0.006, 2],
  [1.654, 0.084, 0.092, 0.098, -0.007, 2],
  [1.662, 0.085, 0.093, 0.1, -0.008, 2],
  [1.671, 0.086, 0.093, 0.102, -0.009, 2],
  [1.685, 0.087, 0.09, 0.103, -0.011, 2],
  [1.702, 0.085, 0.086, 0.101, -0.013, 2],
  [1.72, 0.08, 0.079, 0.095, -0.015, 2],
  [1.737, 0.071, 0.068, 0.085, -0.017, 2],
  [1.75, 0.058, 0.054, 0.07, -0.018, 2],
  [1.759, 0.04, 0.037, 0.049, -0.019, 2],
  [1.764, 0.016, 0.015, 0.02, -0.019, 2],
];
const CROWN = 1.763;
function headRow(y, fem) {
  const T = HEADT;
  let r;
  if (y <= T[0][0]) r = T[0].slice();
  else if (y >= T[T.length - 1][0]) r = T[T.length - 1].slice();
  else
    for (let i = 0; i < T.length - 1; i++)
      if (y >= T[i][0] && y <= T[i + 1][0]) {
        const t = (y - T[i][0]) / (T[i + 1][0] - T[i][0]);
        r = T[i].map((v, k) => v + (T[i + 1][k] - v) * t);
        break;
      }
  if (fem) {
    const jaw = THREE.MathUtils.smoothstep(y, 1.55, 1.63);
    r[1] *= 0.935 + 0.03 * jaw;
    r[2] *= 0.975;
    r[3] *= 0.965;
    r[5] = 2 + (r[5] - 2) * 0.3;
  }
  return r;
}
const g = (y, y0, w) => Math.exp(-(((y - y0) / w) ** 2));
const lin = (tab, x) => {
  if (x <= tab[0][0]) return tab[0][1];
  for (let i = 0; i < tab.length - 1; i++) if (x <= tab[i + 1][0]) return tab[i][1] + ((tab[i + 1][1] - tab[i][1]) * (x - tab[i][0])) / (tab[i + 1][0] - tab[i][0]);
  return tab[tab.length - 1][1];
};
const NOSE_P = [[1.588, 0], [1.596, 0.009], [1.603, 0.0175], [1.612, 0.015], [1.625, 0.0095], [1.64, 0.0055], [1.652, 0.003], [1.664, 0]];
const NOSE_W = [[1.59, 0.011], [1.603, 0.0135], [1.62, 0.0095], [1.65, 0.0085], [1.664, 0.012]];
// radial push (m) at height y, arc distance s across the face from the midline
function faceBump(y, s, fem) {
  const as = Math.abs(s);
  let b = lin(NOSE_P, y) * Math.exp(-((s / lin(NOSE_W, y)) ** 2));
  b += 0.0062 * g(y, 1.602, 0.007) * Math.exp(-(((as - 0.0165) / 0.006) ** 2)); // alae
  b += (0.0048 + 0.0022 * fem) * g(y, 1.586, 0.0045) * Math.exp(-((s / 0.021) ** 4)); // upper lip
  b += (0.0058 + 0.0024 * fem) * g(y, 1.574, 0.0045) * Math.exp(-((s / 0.019) ** 4)); // lower lip
  b -= 0.0018 * g(y, 1.5805, 0.0022) * Math.exp(-((s / 0.022) ** 4)); // mouth line
  b -= 0.0028 * g(y, 1.58, 0.008) * Math.exp(-(((as - 0.027) / 0.007) ** 2)); // mouth corners
  b += (0.0062 - 0.0022 * fem) * g(y, 1.552, 0.01) * Math.exp(-((s / 0.024) ** 2)); // chin
  b += 0.0052 * g(y, 1.631, 0.013) * Math.exp(-(((as - 0.046) / 0.02) ** 2)); // cheekbones
  b += (0.0052 - 0.0018 * fem) * g(y, 1.668, 0.0075) * Math.exp(-((s / 0.05) ** 2)); // brow ridge
  b -= 0.0036 * g(y, 1.651, 0.0062) * Math.exp(-(((as - 0.0315) / 0.012) ** 2)); // eye sockets
  b -= 0.002 * g(y, 1.61, 0.012) * Math.exp(-(((as - 0.032) / 0.01) ** 2)); // nasolabial hollow
  return b;
}
export function headPoint(y, off, fem = 0, detail = true) {
  const [, rx, rzF, rzB, cz, ex] = headRow(y, fem);
  const a = Math.PI / 2 + off, c = Math.cos(a), s = Math.sin(a), e = 2 / ex;
  let x = Math.sign(c) * Math.abs(c) ** e * rx, z = Math.sign(s) * Math.abs(s) ** e * (s >= 0 ? rzF : rzB);
  if (detail && Math.abs(off) < 1.6) {
    const b = faceBump(y, off * (rx + rzF) * 0.5, fem);
    const r = Math.hypot(x, z) || 1;
    x += (x / r) * b;
    z += (z / r) * b;
  }
  return [x, y, z + cz];
}

// hairline height by angle from the face's front (|off| radians)
const HAIRLINE = [[0, 1.713], [0.5, 1.707], [0.85, 1.697], [1.2, 1.679], [1.45, 1.671], [1.7, 1.664], [1.95, 1.64], [2.3, 1.615], [Math.PI, 1.598]];
const CAPLINE = [[0, 1.694], [0.8, 1.69], [1.4, 1.682], [1.9, 1.668], [Math.PI, 1.66]];
const C0 = [0, 1.655, -0.012];
function scalpPoint(line, f, off, fem, lift) {
  const y = CROWN + (lin(line, Math.abs(off)) - CROWN) * f;
  const p = headPoint(y, off, fem, false);
  const d = [p[0] - C0[0], p[1] - C0[1], p[2] - C0[2]];
  const l = Math.hypot(...d) || 1;
  return [p[0] + (d[0] / l) * lift, p[1] + (d[1] / l) * lift, p[2] + (d[2] / l) * lift];
}
const EAR = { y: 1.632, off: Math.PI / 2 + 0.14 };

// strand roots: [shell f, angle from front]; row 0 along the hairline, row 1 higher on the back of the head
const ROOTS = [
  ...[1.2, 1.5, 1.8, 2.1, 2.45, 2.8].flatMap((o) => [[1, o, 0], [1, -o, 0]]),
  [1, Math.PI, 0],
  ...[1.62, 2.05, 2.55].flatMap((o) => [[0.6, o, 1], [0.6, -o, 1]]),
  [0.6, Math.PI, 1],
];
const STRAND_T = [0, 0.18, 0.42, 0.7, 1];
// canonical (box braid) strand point, mirrored exactly by strandPos() in the shader
function strandPoint(root, t, ang, row, L = 0.32, wT = 0.0055, wR = 0.0055) {
  const ox = root[0], oz = root[2] + 0.012, rr = Math.hypot(ox, oz) || 1;
  const o = [ox / rr, 0, oz / rr], tg = [-o[2], 0, o[0]];
  const ss = THREE.MathUtils.smoothstep;
  const rad = rr + (Math.max(rr + 0.006, 0.117 + 0.007 * row) - rr) * ss(t, 0, 0.22) + 0.03 * t;
  const back = 0.07 * Math.abs(o[0]) * ss(t, 0.25, 0.75);
  const taper = 1 - 0.45 * t * t;
  const c = [o[0] * rad, root[1] - L * t, -0.012 + o[2] * rad - back];
  const ca = Math.cos(ang) * wT * taper, sa = Math.sin(ang) * wR * taper;
  return [c[0] + tg[0] * ca + o[0] * sa, c[1], c[2] + tg[2] * ca + o[2] * sa];
}

// Build the head, ears and hair pieces into MeshKit k. V(part, skin, fem, aux) gives the base vertex attributes.
export function headParts(k, detail, V, PART, B) {
  const HB = [B.H, B.C, 0];
  const X = (base, hx = [0, 0, 0, 0], root = [0, 0, 0]) => ({ ...base, aHx: hx, aRoot: root });
  // Head
  {
    const ys = detail ? HEADT.map((r) => r[0]) : [1.537, 1.558, 1.588, 1.626, 1.662, 1.702, 1.737, 1.764];
    const side = [0.07, 0.14, 0.21, 0.29, 0.38, 0.48, 0.6, 0.76, 0.98, 1.25, 1.55, 1.95, 2.5];
    const offs = detail ? [...side.map((v) => -v).reverse(), 0, ...side, Math.PI] : Array.from({ length: 10 }, (_, j) => -Math.PI + (j * Math.PI * 2) / 10);
    const P = ys.map((y) => offs.map((o) => headPoint(y, o, 0, detail)));
    const Fm = ys.map((y, i) => offs.map((o, j) => headPoint(y, o, 1, detail).map((v, c) => v - P[i][j][c])));
    k.loft(P, null, { closed: true, capStart: true, capEnd: true, vattrs: (i, j) => X(V(PART.HEAD, HB, j < 0 ? [0, 0, 0] : Fm[i][j], 0)) });
  }
  // Ears
  if (detail)
    for (const sd of [1, -1]) {
      const off = sd > 0 ? -EAR.off : EAR.off; // +x is off < 0 (a = pi/2 + off, x = cos a)
      const pm = headPoint(EAR.y, off, 0, false), pf = headPoint(EAR.y, off, 1, false);
      const M = new THREE.Matrix4().compose(
        new THREE.Vector3(pm[0] + sd * 0.004, EAR.y, pm[2] - 0.004),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.18, sd * 0.28, sd * 0.06, 'YXZ')),
        new THREE.Vector3(0.008, 0.028, 0.017)
      );
      k.geo(new THREE.SphereGeometry(1, 7, 5), X(V(PART.HEAD, HB, [pf[0] - pm[0], 0, pf[2] - pm[2]], 1)), M);
    }
  // Scalp shell
  {
    const F = detail ? [0.03, 0.12, 0.24, 0.37, 0.5, 0.62, 0.73, 0.83, 0.91, 0.97, 1] : [0.05, 0.35, 0.7, 1];
    const n = detail ? 22 : 10;
    const offs = Array.from({ length: n }, (_, j) => -Math.PI + (j * Math.PI * 2) / n);
    const P = F.map((f) => offs.map((o) => scalpPoint(HAIRLINE, f, o, 0, 0.0028)));
    const Fm = F.map((f, i) => offs.map((o, j) => scalpPoint(HAIRLINE, f, o, 1, 0.0028).map((v, c) => v - P[i][j][c])));
    k.loft(P, null, { closed: true, capStart: true, vattrs: (i, j) => X(V(PART.HAIR, HB, j < 0 ? [0, 0, 0] : Fm[i][j]), [F[i], j < 0 ? 0 : offs[j], 0, 0]) });
  }
  k.proxyIdx = k.idx.length; // everything up to here is safe to draw unposed (see figures.js)
  // Cap crown and brim
  {
    const F = detail ? [0.04, 0.25, 0.5, 0.75, 1] : [0.1, 0.6, 1];
    const n = detail ? 14 : 8;
    const offs = Array.from({ length: n }, (_, j) => -Math.PI + (j * Math.PI * 2) / n);
    const P = F.map((f) => offs.map((o) => scalpPoint(CAPLINE, f, o, 0, 0.0085)));
    const Fm = F.map((f, i) => offs.map((o, j) => scalpPoint(CAPLINE, f, o, 1, 0.0085).map((v, c) => v - P[i][j][c])));
    k.loft(P, null, { closed: true, capStart: true, vattrs: (i, j) => X(V(PART.CAP, HB, j < 0 ? [0, 0, 0] : Fm[i][j], 0)) });
    const brim = [];
    const bn = detail ? 12 : 6;
    for (const dy of [0, 0.008]) {
      const row = [];
      for (let j = 0; j < bn; j++) {
        const a = (j / bn) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        const z = s >= 0 ? s * 0.168 : s * 0.02;
        row.push([c * 0.097, 1.699 + dy - Math.max(0, z - 0.06) * 0.3, z]);
      }
      brim.push(row);
    }
    k.loft(brim, null, { closed: true, capStart: true, capEnd: true, vattrs: () => X(V(PART.CAP, HB, [0, 0, 0], 1)) });
  }
  // Ball: afro puff, bun or doek knot (placed and sized in the shader)
  {
    const s = new THREE.SphereGeometry(1, detail ? 10 : 6, detail ? 7 : 4);
    const P = s.attributes.position;
    const base = k.pos.length / 3;
    k.geo(s, X(V(PART.DOEK, HB)), new THREE.Matrix4().makeScale(0.04, 0.04, 0.04).setPosition(0, 1.79, -0.045));
    for (let i = 0; i < P.count; i++) {
      const o = (base + i) * 3;
      k.extra.aRoot[o] = P.getX(i);
      k.extra.aRoot[o + 1] = P.getY(i);
      k.extra.aRoot[o + 2] = P.getZ(i);
    }
  }
  // Strands
  {
    const roots = detail ? ROOTS : ROOTS.filter((r, i) => r[2] === 0 && i % 3 === 0).concat([[1, Math.PI, 0]]);
    const T = detail ? STRAND_T : [0, 0.4, 1];
    const sides = detail ? 5 : 3;
    roots.forEach(([f, off, row], si) => {
      const root = scalpPoint(HAIRLINE, f, off, 0, 0.004), rootF = scalpPoint(HAIRLINE, f, off, 1, 0.004);
      const P = T.map((t) => Array.from({ length: sides }, (_, j) => strandPoint(root, t, (j / sides) * Math.PI * 2, row)));
      const idx = ROOTS.findIndex((r) => r[1] === off && r[0] === f);
      k.loft(P, null, {
        closed: true,
        vattrs: (i, j) => {
          const t = T[i];
          const skin = t < 0.3 ? [B.H, B.C, 0] : t < 0.6 ? [B.H, B.C, 0.5] : [B.C, B.H, 0.15];
          return X(V(PART.BRAIDS, skin, [rootF[0] - root[0], rootF[1] - root[1], rootF[2] - root[2]]), [t, (Math.max(0, j) / sides) * Math.PI * 2, idx / ROOTS.length, row], root);
        },
      });
    });
  }
}

// --- GLSL --------------------------------------------------------------------------------------------------------------
const glslTable = (name, tab) => {
  let s = `float ${name}(float x) {\n  x = abs(x);\n`;
  for (let i = 0; i < tab.length - 1; i++) s += `  if (x <= ${tab[i + 1][0].toFixed(4)}) return mix(${tab[i][1].toFixed(4)}, ${tab[i + 1][1].toFixed(4)}, (x - ${tab[i][0].toFixed(4)}) / ${(tab[i + 1][0] - tab[i][0]).toFixed(4)});\n`;
  return s + `  return ${tab[tab.length - 1][1].toFixed(4)};\n}\n`;
};

// shared by the vertex and fragment stages
export const HEAD_COMMON = /* glsl */ `
float hh(float s, float k) { return fract(sin(s * 1731.31 + k * 91.713) * 43758.5453); }
bool isK(float K, float k) { return abs(K - k) < 0.1; }
${glslTable('hairlineY', HAIRLINE)}
// beard / stubble coverage at bind-pose point b; type: 1 stubble, 2 moustache, 3 goatee, 4 full
float beardMask(vec3 b, float type) {
  if (type < 0.5) return 0.0;
  float ax = abs(b.x);
  float a = abs(atan(b.x, b.z + 0.008));
  float front = 1.0 - smoothstep(1.65, 1.95, a);
  float top = mix(1.594, 1.627, smoothstep(0.32, 1.25, a)) + 0.045 * smoothstep(1.28, 1.5, a);
  float jaw = (1.0 - smoothstep(top - 0.006, top + 0.003, b.y)) * front * smoothstep(1.528, 1.548, b.y);
  float lu = ax / 0.0245, lk = max(0.0, 1.0 - lu * lu);
  float upTop = 1.5805 + 0.0082 * pow(lk, 0.42), loBot = 1.5805 - 0.0102 * pow(lk, 0.6);
  float lips = smoothstep(1.08, 0.95, lu) * smoothstep(loBot - 0.0015, loBot + 0.0005, b.y) * smoothstep(upTop + 0.0012, upTop - 0.0003, b.y);
  float fr = step(0.04, b.z);
  float mous = smoothstep(0.031, 0.024, ax) * smoothstep(upTop - 0.0003, upTop + 0.0012, b.y) * smoothstep(1.5975 - 0.004 * smoothstep(0.012, 0.03, ax), 1.5935 - 0.004 * smoothstep(0.012, 0.03, ax), b.y) * fr;
  mous = max(mous, smoothstep(0.033, 0.026, ax) * smoothstep(0.022, 0.025, ax) * smoothstep(1.57, 1.575, b.y) * smoothstep(1.594, 1.588, b.y) * fr);
  float goat = smoothstep(1.0, 0.75, length(vec2(b.x / 0.021, (b.y - 1.556) / 0.017))) * fr;
  goat = max(goat, smoothstep(0.012, 0.007, ax) * smoothstep(1.555, 1.56, b.y) * smoothstep(loBot - 0.0005, loBot - 0.003, b.y) * fr);
  float m = type < 2.5 && type > 1.5 ? mous : type > 2.5 && type < 3.5 ? max(goat, mous) : max(jaw, mous);
  return m * (1.0 - lips);
}
`;

export const HEAD_VERT = /* glsl */ `
attribute vec4 aHx;
attribute vec3 aRoot;
varying vec4 vHx;
void tiltX(inout vec3 d, float a) { float c = cos(a), s = sin(a); d = vec3(d.x, d.y * c - d.z * s, d.y * s + d.z * c); }
// Shape the hair pieces for hair kind K. Returns true when the vertex should be hidden.
bool hairVert(float part, float K, float fem, float seed, inout vec3 p, inout vec3 n) {
  if (part == 7.0) { // scalp shell
    if (isK(K, 12.0) || isK(K, 13.0)) return true;
    float f = aHx.x, off = aHx.y;
    float edge = 1.0 - smoothstep(0.8, 1.0, f);
    float th = 0.0022 * edge;
    if (isK(K, 1.0)) th = 0.001 + 0.0085 * smoothstep(1.695, 1.74, p.y) * edge;
    else if (isK(K, 2.0)) th = 0.002 + 0.012 * smoothstep(1.685, 1.735, p.y) * edge;
    else if (isK(K, 3.0)) th = 0.0015 + 0.009 * edge;
    else if (isK(K, 8.0) || isK(K, 9.0)) th = 0.0012 + 0.0014 * edge;
    else if (isK(K, 10.0)) th = 0.002 + 0.006 * edge;
    else if (isK(K, 11.0)) th = 0.003 + 0.006 * edge;
    else if (isK(K, 5.0) || isK(K, 6.0)) th = 0.0015;
    p += n * th;
    if (isK(K, 4.0) || isK(K, 7.0)) {
      bool afro = isK(K, 4.0);
      vec3 ca = afro ? vec3(0.0, 1.703, -0.022) : vec3(0.0, 1.717, -0.034);
      vec3 R = afro ? vec3(0.138, 0.128, 0.142) * (0.86 + 0.26 * hh(seed, 4.0)) : vec3(0.104, 0.097, 0.128) * (0.96 + 0.1 * hh(seed, 5.0));
      float tilt = afro ? 0.0 : -0.42 - 0.2 * hh(seed, 6.0);
      vec3 d = p - ca;
      tiltX(d, tilt);
      float s = 1.0 / length(d / R);
      float w = afro ? pow(1.0 - smoothstep(0.55, 1.0, f), 0.6) : 1.0 - 0.85 * smoothstep(0.9, 1.0, f);
      if (s > 1.0) {
        vec3 dn = d * s / (R * R);
        tiltX(dn, -tilt);
        p = mix(p, ca + (p - ca) * s, w);
        n = normalize(mix(n, normalize(dn), w));
      }
      if (!afro) p += n * (0.0045 * sin(off * 5.0 + f * 7.0 + seed * 20.0) + 0.0035) * w * smoothstep(0.05, 0.4, f);
    }
    vHx = aHx;
    return false;
  }
  if (part == 8.0) { // ball
    vec3 c, R;
    if (isK(K, 5.0)) { c = vec3(0.0, 1.792, -0.078); R = vec3(0.074, 0.066, 0.072) * (0.88 + 0.24 * hh(seed, 7.0)); }
    else if (isK(K, 6.0)) { c = vec3(0.0, 1.792, -0.05); R = vec3(0.043, 0.036, 0.043) * (0.9 + 0.2 * hh(seed, 8.0)); }
    else if (isK(K, 7.0)) {
      bool back = hh(seed, 9.0) < 0.4;
      c = back ? vec3(0.0, 1.765, -0.142) : vec3(0.0, 1.83, 0.012);
      R = back ? vec3(0.046, 0.04, 0.03) : vec3(0.052, 0.03, 0.04);
      float az = atan(aRoot.x, aRoot.z);
      R *= 1.0 + 0.16 * sin(az * 3.0 + aRoot.y * 4.0 + seed * 9.0);
    } else return true;
    p = c + aRoot * R;
    n = normalize(aRoot / R);
    vHx = vec4(aRoot, 0.0);
    return false;
  }
  if (part == 9.0) { // hanging strands
    float t = aHx.x, ang = aHx.y, idx = aHx.z, row = aHx.w;
    float L = 0.32, wT = 0.0055, wR = 0.0055, taperK = 0.45;
    float jit = hh(idx * 17.0 + 1.0, seed);
    vec3 root = aRoot + aFem * fem;
    if (isK(K, 9.0)) L = (0.28 + 0.1 * hh(seed, 1.0)) * (0.9 + 0.2 * jit);
    else if (isK(K, 10.0)) {
      if (jit > 0.82) return true;
      L = (fem > 0.5 ? 0.2 + 0.13 * hh(seed, 2.0) : 0.085 + 0.07 * hh(seed, 2.0)) * (0.85 + 0.3 * jit);
      wT = wR = 0.0082;
      taperK = 0.25;
    } else if (isK(K, 11.0)) {
      L = (0.19 + 0.1 * hh(seed, 3.0)) * (0.95 + 0.1 * jit);
      wT = row > 0.5 ? 0.042 : 0.036;
      wR = 0.0055;
      taperK = 0.2;
    } else if (isK(K, 8.0)) {
      if (root.z > -0.07 || hh(seed, 10.0) < 0.35) return true;
      L = 0.11 + 0.04 * jit;
      wT = wR = 0.0048;
    } else return true;
    if (isK(K, 10.0)) { wR *= 1.0 + 0.14 * sin(t * L / 0.011 * 6.283 + idx * 31.0); wT = wR; }
    vec2 oo = vec2(root.x, root.z + 0.012);
    float rr = max(length(oo), 1e-4);
    vec3 o = vec3(oo.x / rr, 0.0, oo.y / rr), tg = vec3(-o.z, 0.0, o.x);
    float rad = rr + (max(rr + 0.006, 0.117 + 0.007 * row) - rr) * smoothstep(0.0, 0.22, t) + 0.03 * t;
    float back = 0.07 * abs(o.x) * smoothstep(0.25, 0.75, t);
    float taper = 1.0 - taperK * t * t;
    vec3 c = vec3(o.x * rad, root.y - L * t, -0.012 + o.z * rad - back);
    float ca = cos(ang), sa = sin(ang);
    if (isK(K, 11.0)) { // weave: curved ribbons that overlap into one sheet, tips thinning to points
      float wt = wT * (1.0 - 0.7 * smoothstep(0.6, 1.0, t)) * (0.4 + 0.6 * smoothstep(0.0, 0.3, t));
      p = c + tg * ca * wt + o * (sa * wR - ca * ca * wt * wt / (2.0 * rad));
      n = normalize(o * sign(sa + 1e-3) + tg * ca * 0.35);
    } else {
      p = c + tg * ca * wT * taper + o * sa * wR * taper;
      n = normalize(tg * ca / wT + o * sa / wR);
    }
    vHx = vec4(t * L, ang, idx, row);
    return false;
  }
  if (part == 10.0) return !isK(K, 12.0);
  return false;
}
`;

const EARX = headPoint(EAR.y, -EAR.off, 0, false);
export const HEAD_FRAG = /* glsl */ `
varying vec4 vHx;
float hn3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hn3(i), hn3(i + vec3(1, 0, 0)), f.x), mix(hn3(i + vec3(0, 1, 0)), hn3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hn3(i + vec3(0, 0, 1)), hn3(i + vec3(1, 0, 1)), f.x), mix(hn3(i + vec3(0, 1, 1)), hn3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// fade a texture of feature size s (m) out as pixels grow past it
float aaK(float s) { return 1.0 - smoothstep(s * 0.3, s * 1.1, length(fwidth(vBind))); }

vec3 headColor(vec3 skin, vec3 hairC, float K, float fem, float beard, float lips, float seed) {
  vec3 b = vBind;
  vec3 c = skin;
  gSkin = 1.0;
  gRough = 0.56;
  float ax = abs(b.x);
  if (vAux > 0.5) { // ear: darker bowl, lit rim; a gold stud for some women
    float d = length(vec2((b.y - ${EAR.y.toFixed(3)}) / 0.019, (b.z - ${(EARX[2] - 0.004).toFixed(4)}) / 0.011));
    float inner = smoothstep(0.85, 0.4, d) * smoothstep(${(Math.abs(EARX[0]) + 0.004).toFixed(4)}, ${(Math.abs(EARX[0]) + 0.009).toFixed(4)}, ax);
    c *= 1.0 - 0.38 * inner;
    if (fem > 0.5 && hh(seed, 21.0) < 0.6) {
      float stud = smoothstep(0.0034, 0.0022, length(vec2(b.y - ${(EAR.y - 0.024).toFixed(3)}, b.z - ${(EARX[2] - 0.002).toFixed(4)})));
      c = mix(c, vec3(0.95, 0.72, 0.3), stud);
      gRough = mix(gRough, 0.25, stud);
      gSkin *= 1.0 - stud;
    }
    return c;
  }
  // slight warmth on the cheeks, nose and lips; sheen on the forehead
  float faceF = smoothstep(0.03, 0.07, b.z);
  c *= mix(vec3(1.0), vec3(1.05, 0.97, 0.95), exp(-pow((b.y - 1.625) / 0.02, 2.0)) * faceF);
  gRough -= 0.1 * smoothstep(1.665, 1.69, b.y) * faceF + 0.08 * exp(-pow((b.y - 1.605) / 0.012, 2.0)) * smoothstep(0.02, 0.0, ax) * faceF;
  // scalp: hair painted below the shell (crop, fade, under caps / wraps), stubble shadow when shaved
  float off = atan(b.x, b.z + 0.012);
  float hl = hairlineY(off);
  float edgeN = (vnoise(b * 900.0) - 0.5) * 0.004;
  float m = smoothstep(hl - 0.003, hl + 0.001, b.y + edgeN);
  if (isK(K, 13.0)) {
    float mb = smoothstep(hl - 0.02, hl + 0.02, b.y);
    c *= 1.0 - 0.06 * mb;
    gRough = mix(gRough, 0.4, mb);
  } else {
    float dens = 0.94;
    if (isK(K, 1.0)) dens = mix(0.4, 0.94, smoothstep(1.68, 1.725, b.y));
    float n = vnoise(b * 1800.0);
    c = mix(c, hairC * (0.75 + 0.45 * n), m * dens);
    gRough = mix(gRough, 0.85, m);
    gSkin *= 1.0 - m;
    gBump += m * 0.0003 * n * aaK(0.0012);
  }
  // beard and stubble
  float bm = beardMask(b, beard);
  if (bm > 0.0) {
    float n1 = vnoise(b * 2600.0), n2 = vnoise(b * 900.0);
    if (beard < 1.5) c = mix(c, hairC * 0.6 + skin * 0.15, bm * (0.22 + 0.32 * n1) * (0.7 + 0.3 * n2));
    else {
      float cov = bm * smoothstep(0.15, 0.55, n1 * 0.6 + bm * 0.7);
      c = mix(c, hairC * (0.55 + 0.6 * n1) + skin * 0.06, cov * 0.96);
      bm = cov;
      gBump += bm * 0.0008 * n1 * aaK(0.0012);
      gRough = mix(gRough, 0.85, bm);
      gSkin *= 1.0 - bm;
    }
  }
  if (b.z < 0.0) return c;
  // painted occlusion: nose sides and underside, nasolabial folds, under the lower lip, eye sockets
  float ao = 1.0;
  ao *= 1.0 - 0.22 * smoothstep(0.004, 0.0, abs(b.y - 1.5955)) * smoothstep(0.02, 0.008, ax);
  ao *= 1.0 - 0.14 * smoothstep(0.006, 0.0, abs(ax - mix(0.017, 0.012, smoothstep(1.605, 1.645, b.y)))) * smoothstep(1.598, 1.606, b.y) * smoothstep(1.65, 1.632, b.y);
  float nl = abs(ax - mix(0.029, 0.02, smoothstep(1.574, 1.604, b.y)));
  ao *= 1.0 - 0.14 * smoothstep(0.004, 0.0, nl) * smoothstep(1.572, 1.58, b.y) * smoothstep(1.607, 1.598, b.y);
  ao *= 1.0 - 0.18 * smoothstep(0.004, 0.0, abs(b.y - 1.5685)) * smoothstep(0.02, 0.008, ax);
  ao *= 1.0 - 0.12 * exp(-pow((ax - 0.0315) / 0.014, 2.0) - pow((b.y - 1.653) / 0.008, 2.0));
  c *= ao;
  // eyes: almond openings with whites, iris and pupil, a lash line, lid crease and a soft under-eye shadow
  float ex = ax - 0.0315;
  float u = ex / 0.0134;
  float dy = b.y - (1.651 + ex * 0.07);
  float w1 = max(0.0, 1.0 - u * u);
  float top = (0.005 + 0.0004 * fem) * pow(w1, 0.7), bot = -0.0036 * pow(w1, 0.9);
  float aw = 0.00035;
  float e = smoothstep(-aw, aw, dy - bot) * smoothstep(-aw, aw, top - dy) * step(abs(u), 1.0);
  float gz = 0.0012 * (hh(seed, 22.0) - 0.5);
  float ir = length(vec2(ex * sign(b.x) - gz, dy + 0.0002));
  vec3 eyeC = vec3(0.64, 0.58, 0.52) * mix(0.5, 1.0, smoothstep(0.0, 0.005, top - dy)) * mix(0.8, 1.0, smoothstep(1.0, 0.6, abs(u)));
  vec3 irisC = mix(vec3(0.075, 0.035, 0.018), vec3(0.2, 0.1, 0.045), smoothstep(0.0016, 0.0046, ir));
  irisC = mix(irisC, vec3(0.012), smoothstep(0.0021, 0.0017, ir));
  irisC = mix(irisC, vec3(0.04, 0.02, 0.012), smoothstep(0.0046, 0.0053, ir));
  eyeC = mix(eyeC, irisC, smoothstep(0.0054, 0.0049, ir));
  eyeC = mix(skin * vec3(0.55, 0.5, 0.48), eyeC, aaK(0.0035)); // no glowing dots at a distance
  c = mix(c, eyeC, e);
  gRough = mix(gRough, 0.1, e);
  gSkin *= 1.0 - e;
  float lashW = 0.0011 + 0.0005 * fem;
  float lash = smoothstep(lashW, lashW * 0.3, abs(dy - top - lashW * 0.45)) * smoothstep(1.12, 0.95, abs(u) - 0.06 * fem * step(0.0, u));
  lash = max(lash, smoothstep(0.0006, 0.0, abs(dy - bot)) * step(abs(u), 1.0) * 0.45);
  c = mix(c, vec3(0.025, 0.018, 0.015), lash * 0.92);
  float lid = exp(-pow((dy - top - 0.0036) / 0.0015, 2.0)) * smoothstep(1.25, 0.5, abs(u));
  float under = exp(-pow((dy - bot + 0.0032) / 0.0022, 2.0)) * smoothstep(1.3, 0.4, abs(u));
  c *= (1.0 - 0.28 * lid) * (1.0 - 0.12 * under);
  // brows
  float bu = (ax - 0.0335) / 0.0185;
  float by = 1.6628 + 0.0027 * (1.0 - bu * bu) - 0.0008 * bu;
  float bth = mix(0.0024, 0.0011, smoothstep(-1.0, 1.0, bu)) * (fem > 0.5 ? 0.78 : 1.15);
  float strokes = 0.75 + 0.25 * sin((b.x * sign(b.x) * 2.0 + b.y) * 2600.0);
  float brow = smoothstep(bth, bth * 0.35, abs(b.y - by)) * smoothstep(1.05, 0.8, abs(bu)) * strokes;
  c = mix(c, hairC * 0.55 + vec3(0.01), brow * 0.9);
  gBump += brow * 0.00025 * aaK(0.002);
  gSkin *= 1.0 - brow * 0.7;
  // nostrils
  float nost = smoothstep(1.0, 0.45, length(vec2((ax - 0.0088) / 0.0036, (b.y - 1.5985) / 0.0019))) * step(0.07, b.z);
  c = mix(c, c * 0.18, nost);
  // lips: darker upper lip, fuller lower lip, a crisp mouth line; lipstick for some women
  float ym = 1.5805;
  float lw = 0.0222 + 0.002 * fem;
  float lu = ax / lw;
  float lk = max(0.0, 1.0 - lu * lu);
  float upTop = ym + (0.0074 + 0.0018 * fem) * pow(lk, 0.42) - 0.0013 * smoothstep(0.007, 0.0, ax);
  float loBot = ym - (0.0092 + 0.0022 * fem) * pow(lk, 0.6);
  float la = 0.0004;
  float lipUp = smoothstep(-la, la, upTop - b.y) * step(ym, b.y) * step(lu, 1.0);
  float lipLo = smoothstep(-la, la, b.y - loBot) * step(b.y, ym) * step(lu, 1.0);
  vec3 upC = skin * vec3(0.62, 0.44, 0.42), loC = skin * vec3(0.84, 0.57, 0.55) + vec3(0.012, 0.0, 0.0);
  if (lips > 0.5) {
    vec3 ls = lips < 1.5 ? vec3(0.34, 0.06, 0.08) : lips < 2.5 ? vec3(0.24, 0.07, 0.1) : vec3(0.42, 0.16, 0.12);
    upC = mix(upC, ls * 0.85, 0.75);
    loC = mix(loC, ls, 0.75);
  }
  float lipM = max(lipUp, lipLo);
  c = mix(c, mix(upC, loC, lipLo), lipM);
  c = mix(c, skin * 0.25, smoothstep(0.0009, 0.0002, abs(b.y - ym)) * smoothstep(1.05, 0.85, lu));
  gRough = mix(gRough, lips > 0.5 ? 0.28 : 0.4, lipM);
  return c;
}

// scalp shell
vec3 shellColor(vec3 skin, vec3 hairC, vec3 acc, float K, float seed, float pat) {
  vec3 b = vBind;
  float f = vHx.x, off = vHx.y;
  gRough = 0.85;
  gSkin = 0.0;
  vec3 c = hairC;
  if (isK(K, 7.0)) { // doek: printed cloth with pleats and creases
    float pleat = sin(off * 5.0 + f * 7.0 + seed * 20.0) * smoothstep(0.05, 0.4, f);
    gBump += 0.0045 * pleat + 0.0007 * sin(off * 23.0 + f * 15.0 + pleat * 2.0) * aaK(0.004);
    float pt = step(0.55, fract((b.y * 1.3 + b.x * (pat - 0.5)) * 38.0));
    float dots = step(0.7, vnoise(b * 160.0 + seed * 9.0));
    c = mix(acc, acc * 0.45 + vec3(0.35), (pat < 0.5 ? pt : dots) * 0.55);
    c *= 0.88 + 0.12 * pleat;
    gRough = 0.8;
    return c;
  }
  if (isK(K, 4.0) || isK(K, 3.0)) { // coily: afro, short natural
    float k = aaK(0.003);
    float h = vnoise(b * 520.0) * 0.6 + vnoise(b * 1400.0) * 0.4;
    c = hairC * (0.6 + 0.65 * h * k + 0.3 * (1.0 - k));
    gBump += h * (isK(K, 4.0) ? 0.003 : 0.0018) * k;
    gRough = 0.93;
    return c;
  }
  if (isK(K, 2.0) || isK(K, 10.0)) { // twists / locs roots: lumpy nubs with dark gaps
    float h = smoothstep(0.42, 0.78, vnoise(b * (isK(K, 2.0) ? 300.0 : 180.0)));
    float k = aaK(0.005);
    c = hairC * mix(0.8, 0.35 + 0.75 * h, k);
    gBump += h * 0.0028 * k;
    gRough = 0.9;
    return c;
  }
  if (isK(K, 8.0)) { // cornrows straight back, scalp showing in the partings, plaited ridges
    float fr = fract(b.x / 0.0158 + 0.5);
    float ridge = sqrt(max(0.0, 1.0 - pow(2.0 * fr - 1.0, 2.0)));
    float along = atan(b.z + 0.012, b.y - 1.62) * 0.1;
    float pl = fract(along / 0.0052 + abs(fr - 0.5) * 1.2);
    float plait = smoothstep(0.0, 0.25, pl) * smoothstep(1.0, 0.7, pl);
    float k = aaK(0.004);
    float part = smoothstep(0.16, 0.05, min(fr, 1.0 - fr)) * k;
    c = mix(hairC * (0.5 + 0.7 * mix(0.6, plait * ridge, k)), skin * 0.6, part * 0.8);
    gBump += (ridge * 0.0016 + plait * 0.0005) * k;
    gRough = 0.75;
    return c;
  }
  if (isK(K, 9.0)) { // box braid parts
    float gu = fract(off * 2.6 + 0.5 * floor(f * 7.0)), gv = fract(f * 7.0);
    float k = aaK(0.006);
    float part = smoothstep(0.05, 0.015, min(min(gu, 1.0 - gu), min(gv, 1.0 - gv))) * k;
    float pl = fract(gv * 3.0 + abs(gu - 0.5));
    c = mix(hairC * (0.55 + 0.5 * pl), skin * 0.55, part * 0.7);
    gBump += (1.0 - part) * 0.0012 * k;
    gRough = 0.7;
    return c;
  }
  if (isK(K, 11.0)) { // straight weave: combed lines from a side parting, glossy
    float h = vnoise(vec3(off * 70.0, f * 3.0, seed * 9.0));
    float part = smoothstep(0.022, 0.0, abs(off - 0.42)) * step(f, 0.72);
    c = mix(hairC * (0.72 + 0.5 * h), skin * 0.85, part);
    gBump += 0.0005 * h * aaK(0.002);
    gRough = 0.34;
    return c;
  }
  if (isK(K, 5.0) || isK(K, 6.0)) { // gelled back towards the puff / bun
    float h = vnoise(vec3(b.x * 1100.0, b.y * 50.0, b.z * 50.0));
    c = hairC * (0.7 + 0.45 * h);
    gBump += 0.00035 * h * aaK(0.0015);
    gRough = 0.42;
    return c;
  }
  // crop / fade: fine stipple; the fade thins to skin over the ears
  float n = vnoise(b * 2200.0);
  c = hairC * (0.72 + 0.5 * n);
  if (isK(K, 1.0)) c = mix(mix(skin, hairC, 0.45), c, smoothstep(1.685, 1.722, b.y));
  gBump += 0.0004 * n * aaK(0.0012);
  return c;
}

vec3 ballColor(vec3 hairC, vec3 acc, float K, float seed, float pat) {
  vec3 u = vHx.xyz;
  if (isK(K, 7.0)) { // doek knot: gathered folds
    float fo = sin(atan(u.x, u.y) * 5.0 + u.z * 6.0 + seed * 7.0);
    gBump += 0.003 * fo;
    gRough = 0.8;
    gSkin = 0.0;
    float pt = step(0.55, fract((vBind.y * 1.3 + vBind.x * (pat - 0.5)) * 38.0));
    return mix(acc, acc * 0.45 + vec3(0.35), pt * 0.55) * (0.85 + 0.15 * fo);
  }
  if (isK(K, 6.0)) { // bun: wound
    float h = 0.5 + 0.5 * sin(atan(u.x, u.z) * 3.0 + u.y * 18.0 + vnoise(vBind * 600.0) * 2.0);
    gBump += 0.0012 * h * aaK(0.004);
    gRough = 0.5;
    return hairC * (0.6 + 0.5 * h);
  }
  float k = aaK(0.003);
  float h = vnoise(vBind * 520.0) * 0.6 + vnoise(vBind * 1400.0) * 0.4;
  gBump += h * 0.003 * k;
  gRough = 0.93;
  return hairC * (0.6 + 0.65 * h * k + 0.3 * (1.0 - k));
}

vec3 strandColor(vec3 hairC, float K, float seed) {
  float s = vHx.x, ang = vHx.y, idx = vHx.z;
  if (isK(K, 10.0)) { // locs
    float h = vnoise(vec3(s * 170.0, ang * 1.5, idx * 40.0)) * 0.6 + vnoise(vBind * 900.0) * 0.4;
    float k = aaK(0.004);
    gBump += 0.0022 * h * k;
    gRough = 0.9;
    return hairC * (0.55 + 0.7 * h * k + 0.3 * (1.0 - k));
  }
  if (isK(K, 11.0)) { // weave
    float h = vnoise(vec3(cos(ang) * 60.0 + idx * 13.0, s * 4.0, sin(ang) * 3.0)) * 0.7 + vnoise(vec3(cos(ang) * 230.0, s * 9.0, idx)) * 0.3;
    gBump += 0.0005 * h * aaK(0.002);
    gRough = 0.36;
    return hairC * (0.8 + 0.35 * h) * (1.0 - 0.3 * smoothstep(0.6, 1.0, abs(sin(ang))));
  }
  // braids (and cornrow tails): three-strand plait chevrons
  float v = cos(ang);
  float ch = fract(s / 0.0062 + abs(v) * 0.5 + idx * 3.7);
  float pl = smoothstep(0.0, 0.3, ch) * smoothstep(1.0, 0.62, ch);
  float k = aaK(0.004);
  gBump += 0.0011 * pl * k;
  gRough = 0.6;
  vec3 c = hairC;
  if (hh(seed, 30.0) < 0.25) c = mix(c, vec3(0.32, 0.06, 0.06), smoothstep(0.08, 0.3, s)); // burgundy ombre extensions
  return c * mix(0.8, 0.5 + 0.7 * pl, k);
}
`;
