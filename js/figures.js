// js/figures.js — every person in the city, as two instanced meshes (near and far detail) animated on the GPU.
// Bodies are smooth lofts (torso, limbs with elbows and knees, hands, shoes; the sculpted head, painted face and hair
// styles live in js/figure-head.js) skinned to a
// tiny 13-bone rig: each vertex carries two bones and a weight. The vertex shader poses the rig per instance from a gait
// phase: two-bone IK plants each foot on a stance path that slides back at walking speed, the pelvis bobs, sways and
// rolls over the stance leg, the chest counter-rotates and the arms swing against the legs. Standing figures shift
// their weight, look about, fold their arms, phone, put hands on hips; sellers sit on crates; touts wave; conductors hang.
// Per-person looks (colours, outfit, hair style, loads, bags) live in a float texture indexed by person id, so the CPU
// only streams a matrix and two vec4s per visible person per frame, sorted into the near / far mesh by distance.
import * as THREE from 'three';
import { aoHooks } from './ao-hooks.js';
import { MeshKit } from './meshkit.js';
import { NIGHT_GLSL, nightUniforms } from './nightglow.js';
import { headParts, hairKind, HEAD_COMMON, HEAD_VERT, HEAD_FRAG } from './figure-head.js';

// Parts (match the shader)
export const PART = { TORSO: 1, LEG: 2, SHOE: 3, ARM: 4, HAND: 5, HEAD: 6, HAIR: 7, DOEK: 8, BRAIDS: 9, CAP: 10, SKIRT: 11, BASIN: 12, CONTENT: 13, BUNDLE: 14, SBAG: 15, HBAG: 16, PACK: 17 };
// Bones: 0 pelvis, 1 chest, 2 head, 3/4 thigh L/R, 5/6 shin, 7/8 foot, 9/10 upper arm, 11/12 forearm. Left = +x.
const B = { P: 0, C: 1, H: 2, TL: 3, TR: 4, SL: 5, SR: 6, FL: 7, FR: 8, UL: 9, UR: 10, AL: 11, AR: 12 };
// Hair styles, outfits, bags
export const HAIR = { CROP: 0, AFRO: 1, DOEK: 2, BRAIDS: 3, CAP: 4, SHAVED: 5 };
export const OUTFIT = { PLAIN: 0, SUIT: 1, VEST: 2, OVERALLS: 3, PATTERN: 4, SCHOOL: 5, JERSEY: 6 }; // JERSEY: football kit, trim = bag colour
export const BAG = { NONE: 0, SHOULDER: 1, HAND: 2, PACK: 3 };
export const IDLE = { HANG: 0, CROSSED: 1, PHONE: 2, HIPS: 3, HANGON: 5 };

const HIP_Y = 0.93, HIP_X = 0.092, KNEE_Y = 0.5, ANKLE_Y = 0.085;
const SH = [0.185, 1.415, -0.015], ARM_AB = 0.09, UPPER = 0.29;
const TEX_W = 9; // texels per person

// --- geometry ----------------------------------------------------------------------------------------------------------
function ring(y, rx, rzF, rzB, cz, n, cx = 0, bump = null, ex = 2) {
  const out = [];
  const e = 2 / ex;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    let x = Math.sign(c) * Math.abs(c) ** e * rx, z = Math.sign(s) * Math.abs(s) ** e * (s >= 0 ? rzF : rzB);
    const b = bump ? bump(a) : 0;
    if (b) {
      const r = Math.hypot(x, z) || 1;
      x += (x / r) * b;
      z += (z / r) * b;
    }
    out.push([cx + x, y, cz + z]);
  }
  return out;
}
const lobe = (a, a0, w) => {
  let d = a - a0;
  d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
  return Math.exp(-(d * d) / (w * w));
};
// keep the first and last rows and every other one between (far LOD)
const thin = (rows, detail) => (detail ? rows : rows.filter((r, i) => i === 0 || i === rows.length - 1 || i % 2 === 1 || r.keep));

// Torso: [y, rx, rzF, rzB, cz, female rx, rzF, rzB]
const TORSO = [
  [0.8, 0.12, 0.08, 0.085, 0.0, 0.135, 0.085, 0.095],
  [0.85, 0.158, 0.098, 0.108, -0.005, 0.18, 0.1, 0.125],
  [0.92, 0.172, 0.104, 0.118, -0.008, 0.198, 0.108, 0.135],
  [0.99, 0.168, 0.102, 0.11, -0.006, 0.178, 0.098, 0.115],
  [1.06, 0.157, 0.1, 0.1, 0.0, 0.142, 0.09, 0.09],
  [1.14, 0.162, 0.108, 0.098, 0.006, 0.14, 0.098, 0.088],
  [1.22, 0.172, 0.118, 0.1, 0.01, 0.15, 0.142, 0.09],
  [1.3, 0.18, 0.12, 0.1, 0.006, 0.158, 0.138, 0.092],
  [1.37, 0.188, 0.11, 0.095, -0.002, 0.165, 0.1, 0.088],
  [1.42, 0.18, 0.095, 0.088, -0.01, 0.158, 0.085, 0.08],
  [1.46, 0.14, 0.08, 0.078, -0.014, 0.122, 0.072, 0.07],
  [1.49, 0.08, 0.06, 0.062, -0.016, 0.07, 0.054, 0.056],
  [1.53, 0.057, 0.053, 0.057, -0.014, 0.05, 0.047, 0.051],
  [1.575, 0.054, 0.05, 0.054, -0.01, 0.048, 0.045, 0.049],
];
const torsoSkin = (y) => (y <= 1.0 ? [B.P, B.C, 0] : y < 1.1 ? [B.P, B.C, 0.4] : y < 1.18 ? [B.P, B.C, 0.85] : y < 1.52 ? [B.C, B.H, 0] : y < 1.56 ? [B.C, B.H, 0.3] : [B.C, B.H, 0.8]);
// Leg: [y, rx, rzF, rzB, cz, female extra radius]
const LEG = [
  [0.98, 0.08, 0.085, 0.085, 0, 0.012],
  [0.9, 0.082, 0.086, 0.09, 0, 0.012],
  [0.8, 0.075, 0.08, 0.084, 0, 0.01],
  [0.68, 0.064, 0.068, 0.07, 0, 0.006],
  [0.57, 0.054, 0.057, 0.058, 0, 0.003],
  [0.5, 0.051, 0.056, 0.054, 0.004, 0],
  [0.43, 0.05, 0.05, 0.06, -0.004, 0],
  [0.34, 0.049, 0.048, 0.064, -0.008, 0],
  [0.24, 0.041, 0.042, 0.05, -0.006, 0],
  [0.15, 0.034, 0.036, 0.04, -0.004, 0],
  [0.09, 0.032, 0.036, 0.036, 0, 0],
];
const legSkin = (y, L) => {
  const T = B.TL + L, S = B.SL + L, F = B.FL + L;
  if (y >= 0.56) return [T, S, 0];
  if (y >= 0.53) return [T, S, 0.2];
  if (y >= 0.47) return [T, S, 0.5];
  if (y >= 0.4) return [T, S, 0.85];
  if (y > 0.1) return [S, F, 0];
  return [S, F, 0.4];
};
// Shoe sections along z: [z, half width, y bottom, y top]
const SHOE = [
  [-0.075, 0.028, 0.0, 0.05],
  [-0.064, 0.04, 0.0, 0.085],
  [-0.03, 0.045, 0.0, 0.105],
  [0.02, 0.047, 0.0, 0.098],
  [0.07, 0.049, 0.0, 0.07],
  [0.12, 0.046, 0.0, 0.055],
  [0.163, 0.036, 0.003, 0.046],
  [0.183, 0.018, 0.008, 0.032],
];
// Arm rows along the limb: [t, rx (across), rz (front-back), female delta]
const ARM = [
  [-0.02, 0.05, 0.052, -0.006],
  [0.03, 0.055, 0.057, -0.007],
  [0.1, 0.048, 0.05, -0.006],
  [0.19, 0.042, 0.044, -0.005],
  [0.26, 0.037, 0.039, -0.004],
  [0.3, 0.036, 0.037, -0.004],
  [0.35, 0.037, 0.039, -0.004],
  [0.43, 0.033, 0.035, -0.004],
  [0.5, 0.027, 0.031, -0.003],
  [0.545, 0.024, 0.028, -0.003],
];
const armSkin = (t, L) => {
  const U = B.UL + L, A = B.AL + L;
  if (t <= 0.22) return [U, A, 0];
  if (t <= 0.27) return [U, A, 0.25];
  if (t <= 0.31) return [U, A, 0.5];
  if (t <= 0.36) return [U, A, 0.85];
  return [A, U, 0];
};
const HAND = [
  [0.53, 0.02, 0.026],
  [0.58, 0.023, 0.04],
  [0.64, 0.021, 0.041],
  [0.69, 0.016, 0.032],
  [0.72, 0.008, 0.015],
];
// Skirt / wrapper: [y, rx, rzF, rzB, cz, female extra]
const SKIRT = [
  [1.045, 0.152, 0.102, 0.104, 0, 0.006],
  [0.96, 0.18, 0.112, 0.126, -0.004, 0.022],
  [0.86, 0.194, 0.126, 0.137, -0.004, 0.02],
  [0.7, 0.2, 0.14, 0.142, 0, 0.014],
  [0.52, 0.205, 0.15, 0.148, 0, 0.01],
  [0.34, 0.21, 0.158, 0.152, 0, 0.008],
  [0.2, 0.214, 0.163, 0.157, 0, 0.008],
];

function limbFrame(side) {
  const d = [side * Math.sin(ARM_AB), -Math.cos(ARM_AB), 0];
  const u = [Math.cos(ARM_AB), side * Math.sin(ARM_AB), 0]; // across (outward-ish), perpendicular to d
  return { d, u, w: [0, 0, 1] };
}
function limbRing(c, F, rx, rz, n, side) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, ca = Math.cos(a) * rx * side, sa = Math.sin(a) * rz;
    out.push([c[0] + F.u[0] * ca + F.w[0] * sa, c[1] + F.u[1] * ca + F.w[1] * sa, c[2] + F.u[2] * ca + F.w[2] * sa]);
  }
  return out;
}

function figureGeometry(k, detail) {
  const N = detail ? 1 : 0;
  const V = (part, skin, fem = [0, 0, 0], aux = 0) => ({ aSkin: [skin[0], skin[1], skin[2], part], aFem: fem, aAux: aux });
  // Torso
  {
    const n = N ? 16 : 8;
    const rows = thin(TORSO, N);
    const P = [], Fm = [];
    for (const [y, rx, f, b, cz, frx, ff, fb] of rows) {
      const m = ring(y, rx, f, b, cz, n), w = ring(y, frx, ff, fb, cz, n);
      P.push(m);
      Fm.push(m.map((p, j) => [w[j][0] - p[0], w[j][1] - p[1], w[j][2] - p[2]]));
    }
    k.loft(P, null, { closed: true, capStart: true, capEnd: true, vattrs: (i, j) => V(PART.TORSO, torsoSkin(rows[i][0]), j < 0 ? [0, 0, 0] : Fm[i][j], rows[i][0]) });
  }
  for (const side of [1, -1]) {
    const L = side > 0 ? 0 : 1;
    // Leg
    {
      const n = N ? 10 : 6;
      const rows = thin(LEG, N);
      const P = [], Fm = [];
      for (const [y, rx, f, b, cz, fe] of rows) {
        const cx = side * (HIP_X - (0.98 - y) * 0.009);
        P.push(ring(y, rx, f, b, cz, n, cx));
        Fm.push(ring(y, rx + fe, f + fe, b + fe, cz, n, cx + side * fe * 0.4).map((p, j) => [p[0] - P[P.length - 1][j][0], 0, p[2] - P[P.length - 1][j][2]]));
      }
      k.loft(P, null, { closed: true, capEnd: true, vattrs: (i, j) => V(PART.LEG, legSkin(rows[i][0], L), j < 0 ? [0, 0, 0] : Fm[i][j], rows[i][0]) });
    }
    // Shoe (loft along z)
    {
      const n = N ? 10 : 6;
      const rows = N ? SHOE : SHOE.filter((r, i) => i % 2 === 0 || i === SHOE.length - 1);
      const cx = side * (HIP_X - 0.89 * 0.009);
      const P = rows.map(([z, hw, yb, yt]) => {
        const out = [];
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
          const e = 0.6;
          out.push([cx + Math.sign(c) * Math.abs(c) ** e * hw, (yb + yt) / 2 + Math.sign(s) * Math.abs(s) ** (s < 0 ? 0.35 : e) * (yt - yb) / 2, z]);
        }
        return out;
      });
      k.loft(P, null, { closed: true, capStart: true, capEnd: true, vattrs: () => V(PART.SHOE, [B.FL + L, B.SL + L, 0]) });
    }
    // Arm + hand
    {
      const F = limbFrame(side);
      const n = N ? 10 : 6;
      const rows = thin(ARM, N);
      const P = [], Fm = [];
      for (const [t, rx, rz, fd] of rows) {
        const c = [SH[0] * side + F.d[0] * t, SH[1] + F.d[1] * t, SH[2]];
        P.push(limbRing(c, F, rx, rz, n, side));
        const q = limbRing(c, F, rx + fd, rz + fd, n, side);
        Fm.push(q.map((p, j) => [p[0] - P[P.length - 1][j][0] - side * 0.018, p[1] - P[P.length - 1][j][1], p[2] - P[P.length - 1][j][2]]));
      }
      k.loft(P, null, { closed: true, capEnd: !N, vattrs: (i, j) => V(PART.ARM, armSkin(rows[i][0], L), j < 0 ? [-side * 0.018, 0, 0] : Fm[i][j], rows[i][0]) });
      if (N) {
        const H = HAND.map(([t, rx, rz]) => limbRing([SH[0] * side + F.d[0] * t, SH[1] + F.d[1] * t, SH[2] + 0.004], F, rx, rz, 8, side));
        k.loft(H, null, { closed: true, capStart: true, capEnd: true, vattrs: () => V(PART.HAND, [B.AL + L, B.UL + L, 0], [-side * 0.018, 0, 0], 0.6) });
      }
    }
  }
  // Head, ears, hair shell, cap, puff / bun / knot, hanging strands (js/figure-head.js)
  headParts(k, detail, V, PART, B);
  // Skirt / dress / wrapper: sides follow their thigh, the middle splits the difference
  {
    const n = N ? 16 : 8;
    const rows = thin(SKIRT, N);
    const P = [], Fm = [];
    for (const [y, rx, f, b, cz, fe] of rows) {
      P.push(ring(y, rx, f, b, cz, n));
      Fm.push(ring(y, rx + fe, f + fe * 0.5, b + fe, cz, n).map((p, j) => [p[0] - P[P.length - 1][j][0], 0, p[2] - P[P.length - 1][j][2]]));
    }
    k.loft(P, null, {
      closed: true,
      capStart: true,
      vattrs: (i, j) => {
        const y = rows[i][0];
        if (y > 0.9 || j < 0) return V(PART.SKIRT, [B.P, B.C, 0], j < 0 ? [0, 0, 0] : Fm[i][j], y);
        const x = P[i][j][0] / rows[i][1];
        const wR = THREE.MathUtils.smoothstep(-x, -0.55, 0.55);
        return V(PART.SKIRT, [B.TL, B.TR, wR], Fm[i][j], y);
      },
    });
  }
  // Head loads: a basin of produce, or a cloth bundle
  {
    const M = new THREE.Matrix4();
    const s = N ? 12 : 7;
    k.geo(new THREE.CylinderGeometry(0.27, 0.17, 0.13, s, 1), V(PART.BASIN, [B.H, B.C, 0]), M.makeTranslation(0, 1.835, -0.01));
    k.geo(new THREE.SphereGeometry(1, s, 3, 0, Math.PI * 2, 0, Math.PI / 2), V(PART.CONTENT, [B.H, B.C, 0]), M.makeScale(0.245, 0.11, 0.245).setPosition(0, 1.89, -0.01));
    k.geo(new THREE.SphereGeometry(1, N ? 10 : 6, N ? 6 : 4), V(PART.BUNDLE, [B.H, B.C, 0]), M.makeScale(0.25, 0.12, 0.2).setPosition(0, 1.86, -0.01));
    // shoulder bag at the right hip with a strap across the chest
    k.geo(new THREE.BoxGeometry(0.07, 0.22, 0.25), V(PART.SBAG, [B.P, B.C, 0]), M.makeTranslation(-0.235, 0.98, 0.02));
    k.geo(new THREE.BoxGeometry(0.03, 0.62, 0.012), V(PART.SBAG, [B.C, B.P, 0]), new THREE.Matrix4().makeRotationZ(-0.72).setPosition(0.0, 1.24, 0.118));
    k.geo(new THREE.BoxGeometry(0.03, 0.62, 0.012), V(PART.SBAG, [B.C, B.P, 0]), new THREE.Matrix4().makeRotationZ(-0.72).setPosition(0.0, 1.24, -0.106));
    // carrier bag hanging from the left hand
    k.geo(new THREE.BoxGeometry(0.06, 0.28, 0.24), V(PART.HBAG, [B.AL, B.UL, 0]), M.makeTranslation(SH[0] + Math.sin(ARM_AB) * 0.74 + 0.005, SH[1] - Math.cos(ARM_AB) * 0.74 - 0.08, 0.0));
    // school backpack
    k.geo(new THREE.BoxGeometry(0.27, 0.33, 0.13), V(PART.PACK, [B.C, B.P, 0]), M.makeTranslation(0, 1.2, -0.165));
  }
}

function buildGeometry() {
  const attrs = { aSkin: 4, aFem: 3, aAux: 1, aHx: 4, aRoot: 3 };
  const kn = new MeshKit(attrs);
  figureGeometry(kn, true);
  const nearIdx = kn.idx.length, proxyIdx = kn.proxyIdx;
  figureGeometry(kn, false); // the far body doubles as the near mesh's shadow stand-in
  const near = kn.build();
  near.userData.ranges = { near: nearIdx, shadow: kn.idx.length - nearIdx, proxy: proxyIdx };
  const kf = new MeshKit(attrs);
  figureGeometry(kf, false);
  const far = kf.build();
  near.userData.verts = kn.vertexCount;
  far.userData.verts = kf.vertexCount;
  return { near, far };
}

// --- shaders -----------------------------------------------------------------------------------------------------------
const HEADER = /* glsl */ `
attribute vec4 aSkin;
attribute vec3 aFem;
attribute float aAux;
attribute vec4 iAnim; // phase, freq (rad/s), stride (half stance span, body units), gesture
attribute vec4 iPose; // id, sit, idle style, lean
attribute vec4 iExt;  // run (0..1), airborne (0..1), -, -  (zero for the crowd)
uniform float uTime;
uniform sampler2D uData;
flat varying float vId;
flat varying float vPart;
varying vec3 vBind;
varying float vAux;
${HEAD_COMMON}
${HEAD_VERT}
vec4 fData(int k) { return texelFetch(uData, ivec2(k, int(iPose.x + 0.5)), 0); }
void rFwd(inout vec3 p, inout vec3 n, vec3 o, float a) { // swing toward +z about x
  float c = cos(a), s = sin(a);
  vec3 q = p - o;
  p = o + vec3(q.x, q.y * c + q.z * s, -q.y * s + q.z * c);
  n = vec3(n.x, n.y * c + n.z * s, -n.y * s + n.z * c);
}
void rSide(inout vec3 p, inout vec3 n, vec3 o, float a) { // about z: down swings to +x for a > 0
  float c = cos(a), s = sin(a);
  vec3 q = p - o;
  p = o + vec3(q.x * c - q.y * s, q.x * s + q.y * c, q.z);
  n = vec3(n.x * c - n.y * s, n.x * s + n.y * c, n.z);
}
void rYaw(inout vec3 p, inout vec3 n, vec3 o, float a) { // about y: +z swings to +x for a > 0
  float c = cos(a), s = sin(a);
  vec3 q = p - o;
  p = o + vec3(q.x * c + q.z * s, q.y, -q.x * s + q.z * c);
  n = vec3(n.x * c + n.z * s, n.y, -n.x * s + n.z * c);
}

vec3 gLegL, gLegR; // thigh forward, knee flex, foot pitch (relative)
vec4 gArmL, gArmR; // flex, abduction, inward twist, elbow
vec3 gPel; // shift x, hip height, -
float gRoll, gYaw, gChestYaw, gLean, gHeadYaw, gHeadNod, gBodyLean;
vec3 gHeadScale;

// foot path for one leg at gait phase p: (forward offset, lift, pitch)
vec3 footPath(float p, float A, float lift) {
  if (p < 0.6) {
    float t = p / 0.6;
    float heel = smoothstep(0.62, 1.0, t);
    return vec3(A * (1.0 - 2.0 * t), heel * 0.045 * lift, (-heel * 0.5 + (1.0 - smoothstep(0.0, 0.18, t)) * 0.22) * lift);
  }
  float t = (p - 0.6) / 0.4;
  float s = t * t * (3.0 - 2.0 * t);
  return vec3(A * (2.0 * s - 1.0), lift * (0.045 * (1.0 - t) + 0.075 * sin(3.14159 * t)), mix(-0.5, 0.22, smoothstep(0.1, 0.9, t)) * lift);
}
// running foot path: short stance (flight phase between footfalls), heel kicked up behind, toe pointed
const float RUN_ST = 0.28; // keep in step with js/player.js
vec3 footRun(float p, float A, float lift) {
  if (p < RUN_ST) {
    float t = p / RUN_ST;
    float heel = smoothstep(0.45, 1.0, t);
    return vec3(A * (1.0 - 2.0 * t), heel * 0.075 * lift, (-heel * 0.75 + (1.0 - smoothstep(0.0, 0.3, t)) * 0.12) * lift);
  }
  float t = (p - RUN_ST) / (1.0 - RUN_ST);
  float s = smoothstep(0.12, 0.95, t);
  float y = 0.075 * (1.0 - t) + 0.34 * sin(3.14159 * pow(t, 0.7));
  return vec3(A * (2.0 * s - 1.0), lift * y, mix(-0.75, 0.12, smoothstep(0.25, 0.95, t)) * lift);
}
vec3 legIK(vec3 f, float hipY) {
  const float L1 = ${(HIP_Y - KNEE_Y).toFixed(3)}, L2 = ${(KNEE_Y - ANKLE_Y).toFixed(3)};
  float ty = ${ANKLE_Y} + f.y;
  vec2 v = vec2(f.x, hipY - ty);
  float d = clamp(length(v), 0.3, L1 + L2 - 0.0005);
  float al = atan(v.x, v.y);
  float be = acos(clamp((L1 * L1 + d * d - L2 * L2) / (2.0 * L1 * d), -1.0, 1.0));
  float kn = 3.14159265 - acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2.0 * L1 * L2), -1.0, 1.0));
  float th = al + be;
  return vec3(th, kn, f.z - (th - kn));
}

void figRig(float fem, float load, float child) {
  float A = iAnim.z, g = iAnim.w, sit = iPose.y, style = iPose.z;
  float lift = clamp(A / 0.25, 0.0, 1.0);
  float idle = 1.0 - lift;
  float seed = fract(iAnim.x * 0.159);
  float arg = uTime * iAnim.y + iAnim.x;
  float cyc = fract(arg / 6.2831853);
  float cs = cos(arg), sn = sin(arg - 0.31);
  vec3 fL = footPath(cyc, A, lift), fR = footPath(fract(cyc + 0.5), A, lift);
  float run = iExt.x, air = iExt.y;
  if (run > 0.001) {
    fL = mix(fL, footRun(cyc, A, lift), run);
    fR = mix(fR, footRun(fract(cyc + 0.5), A, lift), run);
  }
  // standing: one knee relaxed, weight on the other leg, shifting every so often
  float shift = sign(sin(uTime * 0.11 + seed * 40.0)) * idle;
  vec3 relax = vec3(0.05, 0.02, -0.22);
  fL += relax * max(0.0, shift);
  fR += relax * max(0.0, -shift);
  const float R = ${((HIP_Y - ANKLE_Y) * 0.985).toFixed(4)};
  float hL = ${ANKLE_Y} + fL.y + sqrt(max(0.0, R * R - fL.x * fL.x));
  float hR = ${ANKLE_Y} + fR.y + sqrt(max(0.0, R * R - fR.x * fR.x));
  float hip = min(${HIP_Y}, min(hL, hR) + 0.004);
  if (run > 0.001) { // sink into each stance, float in the flight phase
    float cL = cyc < RUN_ST ? sin(3.14159 * cyc / RUN_ST) : 0.0;
    float cR = fract(cyc + 0.5) < RUN_ST ? sin(3.14159 * fract(cyc + 0.5) / RUN_ST) : 0.0;
    hip = mix(hip, min(min(hL, hR) + 0.045, 0.9) - 0.04 * max(cL, cR) * lift, run);
  }
  // sitting on a crate
  hip = mix(hip, 0.47, sit);
  gLegL = mix(legIK(fL, hip), vec3(1.42, 1.5, 0.05), sit);
  gLegR = mix(legIK(fR, hip), vec3(1.38, 1.42, 0.0), sit);
  float swayK = mix(0.035, 0.065, fem);
  gRoll = swayK * lift * sn - 0.03 * shift;
  gPel = vec3(0.018 * lift * sn + 0.02 * shift * (1.0 - sit), hip, 0.0);
  gYaw = -0.085 * lift * cs;
  gChestYaw = 0.13 * lift * cs;
  gLean = 0.05 * lift + 0.12 * sit;
  float look = (1.0 - step(0.5, load)) * idle;
  gHeadYaw = look * 0.45 * sin(uTime * 0.21 + seed * 31.0) * smoothstep(0.2, 0.7, sin(uTime * 0.13 + seed * 17.0) * 0.5 + 0.5);
  gHeadNod = -0.03 * lift + 0.08 * sit;
  gHeadScale = vec3(mix(1.0, 1.16, child));
  gBodyLean = iPose.w;
  // arms: swing against the legs, then idle styles, then gestures
  float sw = 0.42 * lift;
  float breathe = 0.03 * sin(uTime * 1.3 + seed * 9.0) * idle;
  gArmL = vec4(-sw * cs + breathe, 0.04 + 0.04 * fem, 0.0, 0.18 + 0.3 * max(0.0, -sw * cs) + 0.08 * lift);
  gArmR = vec4(sw * cs + breathe, 0.04 + 0.04 * fem, 0.0, 0.18 + 0.3 * max(0.0, sw * cs) + 0.08 * lift);
  vec4 sitArm = vec4(0.62, 0.12, 0.25, 1.0);
  gArmL = mix(gArmL, sitArm, sit);
  gArmR = mix(gArmR, sitArm, sit);
  float w = idle * (1.0 - sit);
  if (style > 0.5 && style < 1.5) { // arms folded
    gArmL = mix(gArmL, vec4(0.42, 0.16, 1.2, 1.95), w);
    gArmR = mix(gArmR, vec4(0.48, 0.16, 1.25, 1.85), w);
  } else if (style > 1.5 && style < 2.5) { // on the phone
    gArmR = mix(gArmR, vec4(0.3, 0.42, 1.0, 2.55), w);
  } else if (style > 2.5 && style < 3.5) { // hands on hips
    gArmL = mix(gArmL, vec4(-0.1, 0.62, 1.35, 1.75), w);
    gArmR = mix(gArmR, vec4(-0.1, 0.62, 1.35, 1.75), w);
  } else if (style > 4.5) { // conductor hanging out of the door: right hand on the roof gutter
    gArmR = vec4(2.75, -0.05, 0.0, 0.35);
  }
  if (load > 0.5 && load < 2.5) gArmR = vec4(2.85, -0.12, 0.25, 0.55); // steadying the basin
  else if (load > 2.5) gArmR = mix(gArmR, vec4(2.7, 0.0, 0.3, 0.7), 0.6);
  if (g > 0.01) {
    float wv = sin(uTime * 6.5 + iAnim.x * 3.0);
    if (style > 4.5) gArmL = mix(gArmL, vec4(1.3 + 0.35 * wv, 0.9, 0.0, 0.25), g); // waving passengers in
    else gArmR = mix(gArmR, vec4(2.35 + 0.22 * wv, 0.32 + 0.22 * wv, 0.0, 0.45), g);
  }
  // running: lean in, bent elbows pumping, more twist through the trunk
  float rk = run * lift;
  if (rk > 0.001) {
    float c2 = cos(arg - 0.35);
    gArmL = mix(gArmL, vec4(-0.55 * c2 - 0.15, 0.14, 0.22, 1.38), rk);
    gArmR = mix(gArmR, vec4(0.55 * c2 - 0.15, 0.14, 0.22, 1.38), rk);
    gLean += 0.17 * rk;
    gHeadNod -= 0.12 * rk;
    gYaw *= 1.0 + 0.5 * rk;
    gChestYaw *= 1.0 + 0.6 * rk;
  }
  // airborne (jumping): lead knee tucked, trailing leg folded back, arms thrown up and out
  if (air > 0.001) {
    gLegL = mix(gLegL, vec3(1.05, 1.6, 0.35), air);
    gLegR = mix(gLegR, vec3(-0.2, 1.05, -0.45), air);
    gPel.y = mix(gPel.y, 0.84, air);
    gPel.x *= 1.0 - air;
    gRoll *= 1.0 - air;
    gArmL = mix(gArmL, vec4(1.1, 0.45, 0.0, 0.85), air);
    gArmR = mix(gArmR, vec4(-0.5, 0.55, 0.0, 0.6), air);
    gLean = mix(gLean, 0.12, air);
    gHeadNod = mix(gHeadNod, -0.12, air);
  }
}

vec3 figBone(float bone, vec3 p, inout vec3 n) {
  if (bone > 2.5 && bone < 8.5) {
    bool left = mod(bone + 0.5, 2.0) > 1.0; // 3, 5, 7
    float side = left ? 1.0 : -1.0;
    vec3 Lg = left ? gLegL : gLegR;
    float hx = side * ${HIP_X};
    if (bone > 6.5) rFwd(p, n, vec3(hx, ${ANKLE_Y}, 0.0), Lg.z);
    if (bone > 4.5) rFwd(p, n, vec3(hx, ${KNEE_Y}, 0.0), -Lg.y);
    rFwd(p, n, vec3(hx, ${HIP_Y}, 0.0), Lg.x);
  } else if (bone > 0.5) {
    if (bone > 8.5) {
      bool left = mod(bone + 0.5, 2.0) > 1.0; // 9, 11
      float side = left ? 1.0 : -1.0;
      vec4 Am = left ? gArmL : gArmR;
      vec3 sp = vec3(side * ${SH[0]}, ${SH[1]}, ${SH[2]});
      if (bone > 10.5) rFwd(p, n, sp + vec3(side * ${(Math.sin(ARM_AB) * UPPER).toFixed(4)}, ${(-Math.cos(ARM_AB) * UPPER).toFixed(4)}, 0.0), Am.w);
      rYaw(p, n, sp, -side * Am.z);
      rSide(p, n, sp, side * Am.y);
      rFwd(p, n, sp, Am.x);
    } else if (bone > 1.5) {
      vec3 hp = vec3(0.0, 1.53, -0.015);
      p = hp + (p - hp) * gHeadScale;
      rFwd(p, n, hp, gHeadNod);
      rYaw(p, n, hp, gHeadYaw);
    }
    vec3 wp = vec3(0.0, 1.02, -0.01);
    rYaw(p, n, wp, gChestYaw);
    rFwd(p, n, wp, gLean);
  }
  vec3 pp = vec3(0.0, ${HIP_Y}, 0.0);
  rYaw(p, n, pp, gYaw);
  rSide(p, n, pp, gRoll);
  p += vec3(gPel.x, gPel.y - ${HIP_Y}, 0.0);
  rSide(p, n, vec3(0.0), -gBodyLean);
  return p;
}

// Pose one vertex; returns the posed position (hidden parts collapse to the origin)
vec3 figPose(inout vec3 n) {
  vec4 f0 = fData(0), f1 = fData(1); // fem, load, hair, bag | skirt length, child, outfit, wrap
  float part = aSkin.w;
  vec3 p = position + aFem * f0.x;
  float hide = 0.0;
  float load = f0.y, bag = f0.w;
  if (part > 6.5 && part < 10.5) hide = 0.0;
  else if (part == 11.0) {
    hide = step(f1.x, 0.01);
    p.y = 1.045 - (1.045 - p.y) * (1.045 - f1.x) / 0.845;
  }
  else if (part == 12.0 || part == 13.0) hide = (load > 0.5 && load < 2.5) ? 0.0 : 1.0;
  else if (part == 14.0) hide = step(load, 2.5);
  else if (part == 15.0) hide = abs(bag - 1.0) < 0.1 ? 0.0 : 1.0;
  else if (part == 16.0) hide = abs(bag - 2.0) < 0.1 ? 0.0 : 1.0;
  else if (part == 17.0) hide = abs(bag - 3.0) < 0.1 ? 0.0 : 1.0;
  vId = iPose.x;
  vPart = part;
  vBind = p;
  vAux = aAux;
  vHx = vec4(0.0);
  float seed = fData(4).a;
  if (part > 5.5 && part < 10.5) {
    vec4 f6 = fData(6), f7 = fData(7);
    if (hairVert(part, f6.a, f0.x, seed, p, n)) hide = 1.0;
    else if (part == 6.0 && aAux < 0.5) { // per-person jaw and nose width, beard volume
      p.x *= 1.0 + (hh(seed, 11.0) - 0.5) * 0.12 * smoothstep(1.625, 1.55, p.y);
      float nm = smoothstep(0.035, 0.01, abs(p.x)) * smoothstep(0.06, 0.085, p.z) * smoothstep(1.585, 1.597, p.y) * smoothstep(1.64, 1.615, p.y);
      p.x *= 1.0 + (hh(seed, 12.0) - 0.3) * 0.3 * nm;
      if (f7.a > 3.5) p += n * 0.0035 * beardMask(vBind, f7.a);
    }
    if (part != 6.0) vBind = p;
  }
  if (hide > 0.5) return vec3(0.0);
  figRig(f0.x, load, f1.y);
  gHeadScale *= vec3(1.0 + 0.05 * (hh(seed, 13.0) - 0.5), 1.0 + 0.05 * (hh(seed, 14.0) - 0.5), 1.0 + 0.04 * (hh(seed, 15.0) - 0.5));
  vec3 na = n, nb = n;
  vec3 pa = figBone(aSkin.x, p, na);
  vec3 pb = aSkin.z > 0.001 ? figBone(aSkin.y, p, nb) : pa;
  n = normalize(mix(na, nb, aSkin.z));
  return mix(pa, pb, aSkin.z);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uData;
flat varying float vId;
flat varying float vPart;
varying vec3 vBind;
varying float vAux;
vec4 pd(int k) { return texelFetch(uData, ivec2(k, int(vId + 0.5)), 0); }
float gSkin = 0.0, gRough = 0.82, gBump = 0.0; // subsurface weight, roughness and bump height for this fragment
${HEAD_COMMON}
${HEAD_FRAG}
// bump from a height field via screen derivatives (three's perturbNormalArb)
vec3 figPerturb(vec3 pos, vec3 nrm, vec2 dH, float fd) {
  vec3 sx = dFdx(pos), sy = dFdy(pos);
  vec3 r1 = cross(sy, nrm), r2 = cross(nrm, sx);
  float det = dot(sx, r1) * fd;
  vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
  return normalize(abs(det) * nrm - grad);
}
float hsh(float x) { return fract(sin(x * 91.3458) * 47453.5453); }
vec3 figColor() {
  float part = vPart;
  vec3 b = vBind;
  vec4 f1 = pd(1);
  float outfit = f1.z;
  vec3 skin = pd(4).rgb;
  if (part == 1.0) { // torso: neck, shirt, trousers
    if (b.y > 1.478 - (outfit == 1.0 ? 0.01 : 0.0)) { gSkin = 1.0; gRough = 0.6; return skin; }
    if (b.y < 1.0 && f1.x < 0.01) {
      vec3 bc = pd(3).rgb;
      if (b.y > 0.975 && outfit != 3.0) bc *= 0.35; // belt
      return bc;
    }
    vec4 top = pd(2);
    vec3 c = top.rgb;
    if (outfit == 1.0) { // suit: shirt and tie in the V of the jacket
      float v = (b.y - 1.17) * 0.42;
      if (b.z > 0.04 && abs(b.x) < v) c = abs(b.x) < 0.014 && b.y < 1.45 ? pd(5).rgb : vec3(0.9, 0.9, 0.88);
    } else if (outfit == 2.0) { // hi-vis vest over the shirt
      if (b.y > 1.0 && b.y < 1.44 && !(b.z > 0.06 && abs(b.x) < 0.035 && b.y > 1.3)) {
        c = pd(5).rgb;
        if (abs(b.y - 1.13) < 0.018 || abs(b.y - 1.27) < 0.018) c = vec3(0.75, 0.77, 0.78);
      }
    } else if (outfit == 3.0) { // overalls: reflective band
      if (abs(b.y - 1.2) < 0.016) c = vec3(0.8, 0.8, 0.75);
    } else if (outfit == 4.0) { // patterned shirt
      float s = pd(4).a;
      float pat = s < 0.5 ? step(0.5, fract(b.x * 30.0 + b.z * 30.0)) : step(0.5, fract(b.y * 28.0)) * step(0.5, fract(b.x * 28.0 + 0.25));
      c = mix(c, pd(5).rgb, pat * 0.75);
    } else if (outfit == 5.0) { // school: jersey V
      if (b.z > 0.05 && abs(b.x) < (b.y - 1.26) * 0.5) c = vec3(0.92, 0.92, 0.9);
    } else if (outfit == 6.0) { // football kit: trim-coloured V collar, shoulder flashes, side panels, hem; a number on the back
      vec3 tr = pd(8).rgb;
      float vw = (b.y - 1.32) * 0.62;
      if (b.z > 0.03 && abs(b.x) < vw) c = abs(b.x) > vw - 0.022 ? tr : skin;
      if (b.y > 1.455) c = tr;
      float ang = atan(b.x, b.z);
      if (abs(abs(ang) - 1.5708) < 0.11 && b.y < 1.36) c = tr;
      if (b.y > 1.395 && b.y < 1.43 && abs(abs(ang) - 1.5708) < 0.45) c = tr;
      if (b.y < 1.04) c = tr;
      if (b.z < -0.05) { // "10" on the back
        vec2 q = vec2(b.x, b.y - 1.235);
        float one = step(abs(q.x - 0.045), 0.011) * step(abs(q.y), 0.075);
        vec2 o = vec2((q.x + 0.035) / 0.032, q.y / 0.075);
        float r = length(o);
        float zero = step(abs(r - 0.82), 0.25);
        if (one + zero > 0.5) c = tr;
      }
    }
    return c;
  }
  if (part == 4.0) { // arm: sleeve then skin
    vec4 top = pd(2);
    if (outfit == 6.0 && vAux < top.a && vAux > top.a - 0.03) return pd(8).rgb; // kit sleeve cuff
    if (vAux < top.a) return top.rgb;
    gSkin = 1.0;
    gRough = 0.6;
    return skin;
  }
  if (part == 2.0) { // leg
    if (f1.x > 0.01) { gSkin = 1.0; gRough = 0.6; return skin; }
    vec4 bot = pd(3);
    vec3 c = vAux > bot.a ? bot.rgb : skin;
    if (vAux <= bot.a) gSkin = 1.0;
    if (outfit == 3.0 && abs(vAux - 0.32) < 0.016) c = vec3(0.8, 0.8, 0.75);
    return c;
  }
  if (part == 3.0) return pd(7).rgb;
  if (part == 5.0) { gSkin = 1.0; gRough = 0.58; return skin * 1.08; }
  if (part > 5.5 && part < 9.5) { // head and face, hair shell, puff / bun / knot, strands (js/figure-head.js)
    vec4 h6 = pd(6), f0 = pd(0), a5 = pd(5);
    float K = h6.a, seed = pd(4).a;
    if (part == 6.0) return headColor(skin, h6.rgb, K, f0.x, pd(7).a, a5.a, seed);
    if (part == 7.0) return shellColor(skin, h6.rgb, a5.rgb, K, seed, seed);
    if (part == 8.0) return ballColor(h6.rgb, a5.rgb, K, seed, seed);
    return strandColor(h6.rgb, K, seed);
  }
  if (part == 10.0) { // cap: panel seams, a button on top
    float az = atan(b.x, b.z + 0.012);
    float seam = smoothstep(0.012, 0.0, abs(fract(az / 1.0472 + 0.5) - 0.5)) * step(vAux, 0.5) * step(1.7, b.y);
    float btn = smoothstep(0.008, 0.005, length(b.xz - vec2(0.0, -0.016))) * step(1.765, b.y);
    gRough = 0.75;
    return pd(5).rgb * (1.0 - 0.3 * seam) * (1.0 - 0.25 * btn);
  }
  if (part == 11.0) { // skirt, dress or zambia wrapper
    vec3 c = pd(3).rgb;
    if (f1.w > 0.5) {
      vec3 a = pd(5).rgb;
      float s = pd(4).a;
      float ang = atan(b.x, b.z);
      float m = s < 0.33 ? step(0.5, fract(b.y * 9.0)) : s < 0.66 ? step(0.6, fract(ang * 2.2 + b.y * 6.0)) : step(0.5, fract(b.y * 7.0)) * step(0.5, fract(ang * 2.5));
      c = mix(c, a, m);
      if (abs(fract(b.y * 4.5) - 0.5) < 0.04) c = mix(c, vec3(0.95, 0.9, 0.7), 0.6);
    }
    return c;
  }
  if (part == 12.0 || part == 14.0) return pd(5).rgb;
  if (part == 13.0) return pd(0).y < 1.5 ? vec3(0.62, 0.06, 0.03) : vec3(0.75, 0.6, 0.08);
  return pd(8).rgb;
}
`;

// Warm wrap lighting on skin: light reaching past the terminator, reddened as if scattered under the skin
const SKIN_LIGHT = (() => {
  const src = THREE.ShaderChunk.lights_physical_pars_fragment;
  const a = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );';
  if (!src.includes(a)) return src;
  return src.replace(
    a,
    `float nlW = dot( geometryNormal, directLight.direction );
	vec3 sssW = gSkin * max( 0.0, ( nlW + 0.55 ) / 1.55 - dotNL ) * vec3( 0.8, 0.32, 0.2 ) * directLight.color;
	reflectedLight.directDiffuse += ( irradiance + sssW ) * BRDF_Lambert( material.diffuseColor );`
  );
})();

// --- instances ---------------------------------------------------------------------------------------------------------
export function createFigures(scene, capacity, opts = {}) {
  const NEAR = opts.near ?? 45, FAR = opts.far ?? 480;
  const { near: geoN, far: geoF } = buildGeometry();
  const data = new Float32Array(TEX_W * 4 * Math.max(1, capacity));
  const tex = new THREE.DataTexture(data, TEX_W, Math.max(1, capacity), THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  const uTime = { value: 0 }, uData = { value: tex };

  const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.uniforms.uData = uData;
    Object.assign(sh.uniforms, nightUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${HEADER}`)
      .replace('#include <beginnormal_vertex>', `vec3 objectNormal = normal;\nvec3 posePos = figPose(objectNormal);`)
      .replace('#include <begin_vertex>', `vec3 transformed = posePos;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG}\n${NIGHT_GLSL}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= figColor();')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n{ vec2 dH = vec2(dFdx(gBump), dFdy(gBump)); if (dot(dH, dH) > 0.0) normal = figPerturb(-vViewPosition, normal, dH, faceDirection); }')
      .replace('#include <lights_physical_pars_fragment>', SKIN_LIGHT)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += nightGlow(vNgWorld) * diffuseColor.rgb;');
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vNgWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvNgWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
  };
  mat.customProgramCacheKey = () => 'harare-figure-v3';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.uniforms.uData = uData;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${HEADER}`)
      .replace('#include <begin_vertex>', `vec3 fN = vec3(0.0, 1.0, 0.0);\nvec3 transformed = figPose(fN);`);
  };
  depth.customProgramCacheKey = () => 'harare-figure-depth-v3';
  // posed normals for the AO pass (see ao-hooks.js)
  const aoMat = new THREE.MeshNormalMaterial({ blending: THREE.NoBlending });
  aoMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.uniforms.uData = uData;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${HEADER}`)
      .replace('#include <beginnormal_vertex>', `vec3 objectNormal = normal;\nvec3 posePos = figPose(objectNormal);`)
      .replace('#include <begin_vertex>', `vec3 transformed = posePos;`);
  };
  aoMat.customProgramCacheKey = () => 'harare-figure-ao-v1';

  const meshes = [geoN, geoF].map((geo) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, capacity));
    const anim = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * 4), 4);
    const pose = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * 4), 4);
    const ext = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * 4), 4);
    anim.setUsage(THREE.DynamicDrawUsage);
    pose.setUsage(THREE.DynamicDrawUsage);
    ext.setUsage(THREE.DynamicDrawUsage);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iAnim', anim);
    geo.setAttribute('iPose', pose);
    geo.setAttribute('iExt', ext);
    m.customDepthMaterial = depth;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    scene.add(m);
    return { m, anim, pose, M: m.instanceMatrix.array, A: anim.array, P: pose.array, E: ext.array, ups: [[m.instanceMatrix, 16], [anim, 4], [pose, 4], [ext, 4]] };
  });
  let cam = null;
  const { near: nearIdx, shadow, proxy } = geoN.userData.ranges;
  geoN.setDrawRange(0, nearIdx);
  const near = meshes[0].m, far = meshes[1].m;
  near.onBeforeShadow = () => geoN.setDrawRange(nearIdx, shadow);
  near.onAfterShadow = () => geoN.setDrawRange(0, nearIdx);
  // Override-material passes (the AO normal pass) can't pose the rig, so people skip them and draw themselves posed
  // through ao-hooks.js instead (otherwise AO prints the background's occlusion onto faces).
  near.onBeforeRender = (r, s, camera, g, material) => {
    if (camera.isPerspectiveCamera) cam = camera;
    geoN.setDrawRange(0, material === mat || material === aoMat ? nearIdx : 0);
  };
  far.onBeforeRender = (r, s, camera, g, material) => {
    if (camera.isPerspectiveCamera) cam = camera;
    geoF.setDrawRange(0, material === mat || material === aoMat ? Infinity : 0);
  };
  aoHooks.push((renderer, camera) => {
    for (const m of [near, far]) {
      if (!m.visible || !m.count) continue;
      m.material = aoMat;
      renderer.render(m, camera);
      m.material = mat;
    }
  });

  // per-person state
  const X = new Float32Array(capacity), Y = new Float32Array(capacity), Z = new Float32Array(capacity), YAW = new Float32Array(capacity);
  const S = new Float32Array(capacity).fill(1), W = new Float32Array(capacity).fill(1);
  const AN = new Float32Array(capacity * 4), PO = new Float32Array(capacity * 4), EX = new Float32Array(capacity * 4), HID = new Uint8Array(capacity);
  let n = 0, texDirty = true;
  const cnt = [0, 0], visible = [0, 0];
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), sph = new THREE.Sphere();

  const set3 = (o, c) => {
    if (!c) return;
    data[o] = c.r ?? c[0];
    data[o + 1] = c.g ?? c[1];
    data[o + 2] = c.b ?? c[2];
  };
  return {
    meshes: [near, far],
    visible, // [near, far] drawn last frame
    get count() {
      return n;
    },
    // look: {top, bot, skin, acc, hair, shoe, bag (THREE.Color), fem, load, hairStyle, bagKind, skirt, child, outfit,
    //        wrap, sleeve, hem, seed, phase, freq}
    add(L) {
      const i = n++;
      const o = i * TEX_W * 4;
      data.set([L.fem || 0, L.load || 0, L.hairStyle || 0, L.bagKind || 0, L.skirt || 0, L.child || 0, L.outfit || 0, L.wrap || 0], o);
      set3(o + 8, L.top);
      data[o + 11] = L.sleeve ?? 0.2;
      set3(o + 12, L.bot);
      data[o + 15] = L.hem ?? 0;
      set3(o + 16, L.skin);
      data[o + 19] = L.seed ?? 0;
      set3(o + 20, L.acc);
      set3(o + 24, L.hair);
      set3(o + 28, L.shoe);
      set3(o + 32, L.bag);
      const [hk, beard, lips] = hairKind(L);
      data[o + 27] = hk; // texel 6.a: hair kind
      data[o + 31] = beard; // texel 7.a
      data[o + 23] = lips; // texel 5.a
      AN[i * 4] = L.phase || 0;
      AN[i * 4 + 1] = L.freq || 6;
      PO[i * 4] = i;
      texDirty = true;
      return i;
    },
    place(i, x, y, z, yaw, s, b) {
      X[i] = x;
      Y[i] = y;
      Z[i] = z;
      YAW[i] = yaw;
      S[i] = s;
      W[i] = b;
    },
    // speed in m/s (drives the stride), gesture 0..1
    animate(i, speed, gesture) {
      const f = AN[i * 4 + 1];
      AN[i * 4 + 2] = (0.3 * speed * 6.2832) / f / S[i];
      AN[i * 4 + 3] = gesture;
    },
    pose(i, sit, idle, lean = 0) {
      PO[i * 4 + 1] = sit;
      PO[i * 4 + 2] = idle;
      PO[i * 4 + 3] = lean;
    },
    hide(i, h) {
      HID[i] = h ? 1 : 0;
    },
    // Drive the gait directly (e.g. the player): phase in radians (advanced by the caller, so the cadence can change
    // freely), A = half stance span in metres (body units × scale), gesture 0..1
    drive(i, phase, A, gesture = 0) {
      AN[i * 4] = phase;
      AN[i * 4 + 1] = 0;
      AN[i * 4 + 2] = A / S[i];
      AN[i * 4 + 3] = gesture;
    },
    // run 0..1 (running gait: flight phase, pumping arms, lean), air 0..1 (jump pose)
    ext(i, run, air) {
      EX[i * 4] = run;
      EX[i * 4 + 1] = air;
    },
    commit(time) {
      uTime.value = time;
      if (texDirty) (tex.needsUpdate = true), (texDirty = false);
      let cx = 0, cz = 0, cy = 0;
      if (cam) {
        pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        frustum.setFromProjectionMatrix(pv);
        cx = cam.position.x;
        cy = cam.position.y;
        cz = cam.position.z;
      }
      const near2 = NEAR * NEAR, far2 = FAR * FAR;
      cnt[0] = cnt[1] = 0;
      sph.radius = 1.3;
      for (let i = 0; i < n; i++) {
        if (HID[i]) continue;
        let lod = 1;
        if (cam) {
          const dx = X[i] - cx, dy = Y[i] - cy, dz = Z[i] - cz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > far2) continue;
          sph.center.set(X[i], Y[i] + 0.9, Z[i]);
          if (!frustum.intersectsSphere(sph)) continue;
          if (d2 < near2) lod = 0;
        }
        const L = meshes[lod], k = cnt[lod]++;
        const c = Math.cos(YAW[i]), sn = Math.sin(YAW[i]), s = S[i], w = s * W[i], o = k * 16;
        const M = L.M;
        M[o] = c * w; M[o + 1] = 0; M[o + 2] = -sn * w; M[o + 3] = 0;
        M[o + 4] = 0; M[o + 5] = s; M[o + 6] = 0; M[o + 7] = 0;
        M[o + 8] = sn * w; M[o + 9] = 0; M[o + 10] = c * w; M[o + 11] = 0;
        M[o + 12] = X[i]; M[o + 13] = Y[i]; M[o + 14] = Z[i]; M[o + 15] = 1;
        const a = k * 4, j = i * 4;
        L.A[a] = AN[j]; L.A[a + 1] = AN[j + 1]; L.A[a + 2] = AN[j + 2]; L.A[a + 3] = AN[j + 3];
        L.P[a] = PO[j]; L.P[a + 1] = PO[j + 1]; L.P[a + 2] = PO[j + 2]; L.P[a + 3] = PO[j + 3];
        L.E[a] = EX[j]; L.E[a + 1] = EX[j + 1]; L.E[a + 2] = EX[j + 2]; L.E[a + 3] = EX[j + 3];
      }
      for (let l = 0; l < 2; l++) {
        const L = meshes[l], k = cnt[l];
        L.m.count = k;
        for (let u = 0; u < L.ups.length; u++) {
          const attr = L.ups[u][0];
          attr.clearUpdateRanges();
          attr.addUpdateRange(0, Math.max(1, k) * L.ups[u][1]);
          attr.needsUpdate = true;
        }
      }
      visible[0] = cnt[0];
      visible[1] = cnt[1];
    },
  };
}
