// js/tree-grow.js — procedural tree skeletons and their geometry for js/trees.js. Per species: a trunk (or leader)
// carrying scaffold limbs, branches and twigs grown from seeded rules as tapered, curving bark tubes; leaf-spray cards
// (tree-atlas.js) hung on the twig tips. Three levels of detail per variant plus a shadow stand-in:
//   lod 0  every tube, a spray card on every twig            (street level, < ~80 m)
//   lod 1  trunk / limbs / branches, fewer and larger cards   (~80–300 m)
//   lod 2  trunk and limbs as prisms, a shell of whole-crown clump cards round the crown ellipsoid
//   proxy  clump cards + a trunk prism, drawn only into the shadow map
// Vertex attribute aTree = (ao, sway weight, random, 0): interior occlusion, wind weight up the hierarchy, per card.
import * as THREE from 'three';
import { T, TILE_METERS, tileRect, SOLID_UV } from './tree-atlas.js';

const V3 = THREE.Vector3;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Species, in metres at scale 1. trunk: radius, top (where the leader ends), lean, taper (top radius share).
// limbs / branches / twigs: count, heights or span along the parent, tilt or angle off it, length (metres for limbs,
// share of the parent for branches, metres for twigs), bending per metre (up / out / droop), wander. cards: per twig,
// size range, droop (tilts the spray's up vector down; > 1 hangs it), faceUp (turns faces skyward), tile weights per
// variant. shell: whole-crown clump cards of lod 2 (count, tile, ellipsoid squash).
export const SPECIES = [
  { // 0 jacaranda: short trunk forking low into arching limbs, a wide vase / umbrella of fine branches
    name: 'jacaranda', bark: '#7a6a5c', barkTex: 'rough',
    trunk: { r: 0.24, top: 2.6, lean: 0.09, taper: 0.75, segs: 5 },
    limbs: { n: 5, y: [1.9, 2.6], tilt: [0.95, 0.6], len: [5.4, 4.8], r: 0.6, up: 0, out: 0.06, droop: 0.035, jitter: 0.1, segs: 6 },
    branches: { n: 4, t: [0.3, 0.98], angle: [0.5, 0.95], len: [0.5, 0.36], up: 0.04, out: 0.03, droop: 0.02, jitter: 0.14, segs: 4 },
    twigs: { n: 3, t: [0.3, 1.0], angle: [0.45, 0.95], len: [1.1, 0.75], up: 0.08, out: 0, droop: 0, jitter: 0.16, segs: 2 },
    cards: { perTwig: 3, scale: [0.85, 1.1], droop: -0.15, faceUp: 0.35, tiles: [[[T.jacBloomA, 4], [T.jacBloomB, 4], [T.jacMixed, 1]], [[T.jacBloomA, 3], [T.jacBloomB, 3], [T.jacMixed, 3]], [[T.jacBloomB, 3], [T.jacMixed, 4]]] },
    shell: { n: 18, tile: T.clumpJac },
  },
  { // 1 flamboyant: low fork, long near-horizontal limbs turning up at the ends, a very wide flat umbrella
    name: 'flamboyant', bark: '#857565', barkTex: 'rough',
    trunk: { r: 0.3, top: 2.1, lean: 0.06, taper: 0.8, segs: 4 },
    limbs: { n: 6, y: [1.6, 2.1], tilt: [1.38, 1.18], len: [6.4, 5.6], r: 0.58, up: 0.04, out: 0, droop: 0, jitter: 0.07, segs: 6 },
    branches: { n: 5, t: [0.25, 1.0], angle: [0.6, 1.1], len: [0.42, 0.3], up: 0.035, out: 0.02, droop: 0, jitter: 0.1, segs: 4 },
    twigs: { n: 3, t: [0.3, 1.0], angle: [0.5, 1.0], len: [1.1, 0.8], up: 0.05, out: 0, droop: 0, jitter: 0.14, segs: 2 },
    cards: { perTwig: 3, scale: [1.1, 1.35], droop: 0.1, faceUp: 0.6, tiles: [[[T.flamA, 3], [T.flamB, 2]], [[T.flamA, 2], [T.flamB, 3]], [[T.flamA, 1], [T.flamB, 3]]] },
    shell: { n: 16, tile: T.clumpFlam, squash: 0.8 },
  },
  { // 2 msasa: leader with ascending limbs, a dense rounded crown, green with copper-red new flush
    name: 'msasa', bark: '#6e6052', barkTex: 'rough',
    trunk: { r: 0.24, top: 5.2, lean: 0.06, taper: 0.35, segs: 6 },
    limbs: { n: 6, y: [2.3, 4.9], tilt: [1.05, 0.45], len: [3.9, 2.5], r: 0.62, up: 0.05, out: 0, droop: 0.01, jitter: 0.12, segs: 5 },
    branches: { n: 4, t: [0.3, 0.98], angle: [0.55, 1.0], len: [0.6, 0.42], up: 0.03, out: 0.02, droop: 0.02, jitter: 0.12, segs: 4 },
    twigs: { n: 3, t: [0.3, 1.0], angle: [0.55, 1.0], len: [0.95, 0.65], up: 0.03, out: 0, droop: 0.03, jitter: 0.14, segs: 2 },
    cards: { perTwig: 3, scale: [1.2, 1.45], droop: 0.05, faceUp: 0.2, tiles: [[[T.msasaA, 3], [T.msasaB, 2]], [[T.msasaA, 1], [T.msasaB, 3]], [[T.msasaA, 2], [T.msasaB, 2]]] },
    shell: { n: 16, tile: T.clumpMsasa },
  },
  { // 3 gum: tall straight pale bole, a few high limbs, sparse drooping grey-green foliage
    name: 'gum', bark: '#d8d0c2', barkTex: 'gum',
    trunk: { r: 0.36, top: 17.5, lean: 0.05, taper: 0.22, segs: 10 },
    limbs: { n: 7, y: [7.5, 16.5], tilt: [0.8, 0.4], len: [5.0, 3.0], r: 0.5, up: 0.02, out: 0, droop: 0.03, jitter: 0.16, segs: 5 },
    branches: { n: 3, t: [0.35, 0.98], angle: [0.5, 0.9], len: [0.55, 0.4], up: 0, out: 0.02, droop: 0.06, jitter: 0.16, segs: 4 },
    twigs: { n: 3, t: [0.3, 1.0], angle: [0.6, 1.1], len: [1.0, 0.7], up: 0, out: 0, droop: 0.2, jitter: 0.16, segs: 2 },
    cards: { perTwig: 3, scale: [1.15, 1.4], droop: 0, hang: 0.7, faceUp: 0, tiles: [[[T.gum, 1]], [[T.gum, 1]], [[T.gum, 1]]] },
    shell: { n: 14, tile: T.clumpGum },
  },
  { // 4 generic street tree: clear trunk and leader, a modest rounded crown of plain green leaves
    name: 'street', bark: '#7a6e64', barkTex: 'rough',
    trunk: { r: 0.2, top: 6.0, lean: 0.04, taper: 0.3, segs: 7 },
    limbs: { n: 6, y: [2.6, 5.6], tilt: [1.05, 0.38], len: [3.6, 2.2], r: 0.62, up: 0.06, out: 0, droop: 0, jitter: 0.08, segs: 5 },
    branches: { n: 4, t: [0.3, 0.98], angle: [0.55, 0.95], len: [0.6, 0.42], up: 0.05, out: 0.02, droop: 0, jitter: 0.1, segs: 4 },
    twigs: { n: 3, t: [0.3, 1.0], angle: [0.6, 1.05], len: [0.85, 0.6], up: 0.02, out: 0, droop: 0.04, jitter: 0.12, segs: 2 },
    cards: { perTwig: 3, scale: [1.25, 1.5], droop: 0.05, faceUp: 0.15, tiles: [[[T.genA, 1], [T.genB, 1]], [[T.genA, 2], [T.genB, 1]], [[T.genA, 1], [T.genB, 2]]] },
    shell: { n: 16, tile: T.clumpGen },
  },
];
export const VARIANTS = 3;

// ---------------------------------------------------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------------------------------------------------
function deflect(dir, angle, azimuth) {
  const ref = Math.abs(dir.y) < 0.95 ? new V3(0, 1, 0) : new V3(1, 0, 0);
  const u = new V3().crossVectors(dir, ref).normalize();
  const w = new V3().crossVectors(dir, u);
  return dir.clone().multiplyScalar(Math.cos(angle)).addScaledVector(u, Math.sin(angle) * Math.cos(azimuth)).addScaledVector(w, Math.sin(angle) * Math.sin(azimuth)).normalize();
}

function growBranch(p0, dir, len, r0, r1, segs, bend, rng, level, schedule = null) {
  const ts = schedule || Array.from({ length: segs + 1 }, (_, i) => i / segs);
  const pts = [p0.clone()], rad = [r0];
  const d = dir.clone(), p = p0.clone(), out = new V3();
  for (let i = 1; i < ts.length; i++) {
    const t = ts[i], step = (t - ts[i - 1]) * len;
    out.set(p.x, 0, p.z);
    if (out.lengthSq() > 1e-6) out.normalize();
    d.x += out.x * bend.out * step + (rng() - 0.5) * bend.jitter;
    d.y += (bend.up - bend.droop * t * 2.0) * step + (rng() - 0.5) * bend.jitter * 0.6;
    d.z += out.z * bend.out * step + (rng() - 0.5) * bend.jitter;
    d.normalize();
    p.addScaledVector(d, step);
    pts.push(p.clone());
    rad.push(r0 + (r1 - r0) * Math.pow(t, 0.8));
  }
  return { pts, rad, len, level, ts };
}

function along(b, t) {
  const ts = b.ts;
  let i = 0;
  while (i < ts.length - 2 && ts[i + 1] < t) i++;
  const k = Math.min(1, Math.max(0, (t - ts[i]) / (ts[i + 1] - ts[i])));
  return { p: b.pts[i].clone().lerp(b.pts[i + 1], k), d: b.pts[i + 1].clone().sub(b.pts[i]).normalize(), r: lerp(b.rad[i], b.rad[i + 1], k) };
}

function growTree(sp, seed) {
  const rng = mulberry32(seed);
  const R = (a, b) => a + (b - a) * rng();
  const branches = [];
  const still = { up: 0, out: 0, droop: 0, jitter: 0.03 };
  const Tk = sp.trunk;
  const lean = R(0, Math.PI * 2);
  const trunkDir = new V3(Math.cos(lean) * Tk.lean, 1, Math.sin(lean) * Tk.lean).normalize();
  const schedule = [0, 0.03, 0.08];
  for (let i = 1; i <= Tk.segs; i++) schedule.push(0.08 + (0.92 * i) / Tk.segs);
  const trunk = growBranch(new V3(), trunkDir, Tk.top, Tk.r, Tk.r * Tk.taper, Tk.segs, still, rng, 0, schedule);
  trunk.rad = trunk.rad.map((r, i) => r * (1 + 0.7 * Math.exp(-(trunk.ts[i] * Tk.top) / 0.3))); // root flare
  branches.push(trunk);

  const L = sp.limbs, B = sp.branches, W = sp.twigs;
  let az = R(0, Math.PI * 2);
  for (let i = 0; i < L.n; i++) {
    const f = L.n > 1 ? i / (L.n - 1) : 0;
    const y = lerp(L.y[0], L.y[1], f) + R(-0.25, 0.25);
    const base = along(trunk, Math.min(0.98, y / Tk.top));
    az += 2.39996 + R(-0.35, 0.35);
    const tilt = lerp(L.tilt[0], L.tilt[1], f) + R(-0.08, 0.08);
    const dir = new V3(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az));
    const len = lerp(L.len[0], L.len[1], f) * R(0.85, 1.12);
    const limb = growBranch(base.p, dir, len, base.r * L.r, 0.035, L.segs, L, rng, 1);
    branches.push(limb);

    const nb = B.n + (rng() < 0.5 ? 1 : 0);
    let baz = R(0, Math.PI * 2);
    for (let j = 0; j < nb; j++) {
      const bt = lerp(B.t[0], B.t[1], (j + R(0.15, 0.85)) / nb);
      const a = along(limb, bt);
      baz += 2.39996 + R(-0.4, 0.4);
      const bdir = deflect(a.d, R(B.angle[0], B.angle[1]), baz);
      const outw = new V3(a.p.x, 0, a.p.z).normalize();
      if (bdir.dot(outw) < -0.15) bdir.addScaledVector(outw, 0.7).normalize(); // keep out of the crown core
      const blen = len * lerp(B.len[0], B.len[1], bt) * R(0.85, 1.12);
      const br = growBranch(a.p, bdir, blen, Math.max(0.022, a.r * 0.62), 0.014, B.segs, B, rng, 2);
      branches.push(br);

      const nw = W.n + (rng() < 0.4 ? 1 : 0);
      let taz = R(0, Math.PI * 2);
      for (let k = 0; k < nw; k++) {
        const tt = lerp(W.t[0], W.t[1], (k + R(0.2, 0.8)) / nw);
        const ta = along(br, tt);
        taz += 2.39996 + R(-0.5, 0.5);
        const tdir = deflect(ta.d, R(W.angle[0], W.angle[1]), taz);
        branches.push(growBranch(ta.p, tdir, lerp(W.len[0], W.len[1], tt) * R(0.8, 1.2), Math.max(0.012, ta.r * 0.7), 0.006, W.segs, W, rng, 3));
      }
    }
  }
  return branches;
}

// ---------------------------------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------------------------------
class Builder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.attr = [];
    this.idx = [];
  }
  vertex(p, n, u, v, ao, sway, rnd) {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.attr.push(ao, sway, rnd, 0);
    return this.pos.length / 3 - 1;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aTree', new THREE.Float32BufferAttribute(this.attr, 4));
    const n = this.pos.length / 3;
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.userData.triangles = this.idx.length / 3;
    return g;
  }
}

// Tapered tube along a branch, parallel-transported rings at every `stride`-th point; uv in metres
function addTube(gb, b, radial, stride, aoAt, swayAt, solidUV = null) {
  const n = b.pts.length;
  const keep = [];
  for (let i = 0; i < n; i += stride) keep.push(i);
  if (keep[keep.length - 1] !== n - 1) keep.push(n - 1);
  const tangent = (i) => b.pts[Math.min(n - 1, i + 1)].clone().sub(b.pts[Math.max(0, i - 1)]).normalize();
  let Tn = tangent(keep[0]);
  let N = Math.abs(Tn.y) < 0.9 ? new V3(0, 1, 0).cross(Tn).normalize() : new V3(1, 0, 0).cross(Tn).normalize();
  const q = new THREE.Quaternion();
  const around = 2 * Math.PI * Math.max(b.rad[0], 0.02);
  let vLen = 0;
  const base = gb.pos.length / 3;
  const dir = new V3(), p = new V3();
  keep.forEach((i, ki) => {
    if (ki > 0) {
      const T2 = tangent(i);
      q.setFromUnitVectors(Tn, T2);
      N.applyQuaternion(q).normalize();
      Tn = T2;
      vLen += b.pts[i].distanceTo(b.pts[keep[ki - 1]]);
    }
    const Bn = new V3().crossVectors(Tn, N);
    const ao = aoAt(b.pts[i]);
    const sway = swayAt(b, b.ts[i]);
    for (let j = 0; j <= radial; j++) {
      const ang = (j / radial) * Math.PI * 2;
      dir.copy(N).multiplyScalar(Math.cos(ang)).addScaledVector(Bn, Math.sin(ang));
      p.copy(b.pts[i]).addScaledVector(dir, b.rad[i]);
      if (solidUV) gb.vertex(p, dir, solidUV[0], solidUV[1], ao, sway, 0);
      else gb.vertex(p, dir, (j / radial) * around, vLen, ao, sway, 0);
    }
  });
  for (let k = 0; k < keep.length - 1; k++)
    for (let j = 0; j < radial; j++) {
      const a = base + k * (radial + 1) + j, c = a + radial + 1;
      gb.idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
}

// Card: bottom edge centred on `at`, rising along `up`, facing `face`
function addCard(gb, at, up, face, size, tile, mirror, rnd, crown) {
  const side = new V3().crossVectors(up, face).normalize();
  const nrm = new V3().crossVectors(side, up).normalize();
  const r = tileRect(tile);
  let u0 = r.u0, u1 = r.u1;
  if (mirror) [u0, u1] = [u1, u0];
  const corners = [[-0.5, 0, u0, r.v1], [0.5, 0, u1, r.v1], [0.5, 1, u1, r.v0], [-0.5, 1, u0, r.v0]];
  const base = gb.pos.length / 3;
  const p = new V3();
  for (const [sx, sy, u, v] of corners) {
    p.copy(at).addScaledVector(side, sx * size).addScaledVector(up, sy * size);
    const { n, ao } = crown.shade(p, nrm);
    gb.vertex(p, n, u, v, ao, lerp(0.8, 1.0, sy), rnd);
  }
  gb.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

// Crown ellipsoid from the foliage: shell normals (the crown shades as one soft mass) and interior occlusion
function makeCrown(points) {
  const box = new THREE.Box3().setFromPoints(points);
  const C = box.getCenter(new V3());
  const Rr = box.getSize(new V3()).multiplyScalar(0.5).max(new V3(0.5, 0.5, 0.5));
  const tmp = new V3(), sn = new V3();
  return {
    C, R: Rr, box,
    shade(p, face) {
      tmp.copy(p).sub(C).divide(Rr);
      const e = tmp.length();
      sn.copy(tmp).normalize();
      sn.y += 0.25;
      sn.normalize();
      const f = face.dot(sn) < 0 ? face.clone().negate() : face.clone();
      const n = sn.clone().multiplyScalar(0.7).addScaledVector(f, 0.3).normalize();
      const top = Math.min(1, Math.max(-1, (p.y - C.y) / Rr.y));
      const ao = (0.42 + 0.58 * smooth(0.1, 1.0, e)) * (0.88 + 0.12 * top);
      return { n, ao };
    },
    barkAO(p) {
      if (p.y < box.min.y) return 0.95;
      tmp.copy(p).sub(C).divide(Rr);
      return lerp(0.55, 0.9, smooth(0.2, 1.0, tmp.length()));
    },
  };
}

function swayWeight(b, t) {
  switch (b.level) {
    case 0: return 0;
    case 1: return 0.18 * t;
    case 2: return 0.18 + 0.4 * t;
    default: return 0.58 + 0.4 * t;
  }
}

function pickTile(weights, rng) {
  let sum = 0;
  for (const [, w] of weights) sum += w;
  let t = rng() * sum;
  for (const [k, w] of weights) if ((t -= w) <= 0) return k;
  return weights[0][0];
}

function placeCards(sp, variant, branches, lod, rng, crown, shellAt = 0.55, shellSize = 1.2) {
  const R = (a, b) => a + (b - a) * rng();
  const C = sp.cards;
  const tiles = C.tiles[variant % C.tiles.length];
  const cards = [];
  const outward = (p) => new V3(p.x - crown.C.x, (p.y - crown.C.y) * 0.6, p.z - crown.C.z).normalize();
  const orient = (p, d, tangent = false) => {
    const o = outward(p);
    if (C.hang && !tangent) {
      // hanging sprays (gum): the spray's up vector points down along the drooping twig, faces turned outward
      const up = d.clone().multiplyScalar(0.55).addScaledVector(o, 0.45).add(new V3(R(-0.3, 0.3), R(-0.2, 0.3), R(-0.3, 0.3)));
      up.y -= C.hang;
      up.normalize();
      let face = o.clone().add(new V3(R(-0.9, 0.9), R(-0.6, 0.9), R(-0.9, 0.9))).normalize();
      face.addScaledVector(up, -face.dot(up));
      if (face.lengthSq() < 1e-4) face = new V3(0, 1, 0).cross(up);
      return { up, face: face.normalize() };
    }
    // sprays lie roughly tangent to the crown (faces out of it, so crowns read from the street and from the air),
    // growing along the twig, with enough scatter to give the crown depth
    const face = o.clone().add(new V3(R(-0.6, 0.6), R(-0.45, 0.6) + C.faceUp, R(-0.6, 0.6))).normalize();
    let up = d.clone().add(new V3(R(-0.35, 0.35), R(-0.2, 0.35) - C.droop, R(-0.35, 0.35)));
    up.addScaledVector(face, -up.dot(face));
    if (up.lengthSq() < 1e-4) up = new V3(1, 0, 0).cross(face);
    return { up: up.normalize(), face };
  };
  const card = (at, d, mul) => {
    const tile = pickTile(tiles, rng);
    const { up, face } = orient(at, d);
    cards.push({ at, up, face, size: TILE_METERS[tile] * mul, tile });
  };
  if (lod === 0) {
    for (const b of branches) {
      if (b.level !== 3) continue;
      for (let k = 0; k < C.perTwig; k++) {
        const a = along(b, lerp(0.25, 1.0, (k + R(0.3, 0.9)) / C.perTwig));
        card(a.p, a.d, R(C.scale[0], C.scale[1]));
      }
    }
    for (const b of branches) {
      if (b.level !== 2) continue;
      const a = along(b, 1);
      card(a.p, a.d, R(0.9, 1.1));
    }
  } else if (lod === 1) {
    // clump cards (a dense mass of leaves) centred on the branches: at this range single sprays are sub-pixel lace
    const tile = sp.shell.tile;
    for (const b of branches) {
      if (b.level !== 2) continue;
      for (const t of [0.5, 1.0]) {
        const a = along(b, Math.min(1, t + R(-0.08, 0.02)));
        const { up, face } = orient(a.p, a.d, true);
        const size = R(2.6, 3.2) * (sp.shell.lod1 || 1);
        const at = a.p.clone().addScaledVector(outward(a.p), 0.3).addScaledVector(up, -size / 2);
        cards.push({ at, up, face, size, tile });
      }
    }
  } else {
    // Fibonacci directions over the crown (fewer underneath); cards centred just inside the shell, facing out
    const n = sp.shell.n;
    const meanR = (crown.R.x + crown.R.y + crown.R.z) / 3;
    const s = Math.max(meanR * shellSize, 2.4);
    for (let i = 0; i < n; i++) {
      const y = 1 - ((i + 0.5) / n) * 1.55;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const ph = i * 2.39996 + R(-0.2, 0.2);
      const dir = new V3(Math.cos(ph) * r, y, Math.sin(ph) * r);
      const center = crown.C.clone().add(dir.clone().multiply(crown.R).multiplyScalar(shellAt));
      const face = dir.clone().add(new V3(R(-0.25, 0.25), R(-0.25, 0.25), R(-0.25, 0.25))).normalize();
      let up = new V3(0, 1, 0).addScaledVector(face, -face.y);
      if (up.lengthSq() < 1e-3) up = new V3(1, 0, 0);
      up.normalize().applyAxisAngle(face, R(-0.5, 0.5));
      cards.push({ at: center.clone().addScaledVector(up, -s * 0.5), up, face, size: s * (sp.shell.squash && Math.abs(face.y) < 0.5 ? sp.shell.squash : 1), tile: sp.shell.tile });
    }
  }
  return cards;
}

// One species / variant → { lods: [{ leaf, bark }, ...], proxy, crown }
export function buildTreeGeometries(speciesIndex, variant) {
  const sp = SPECIES[speciesIndex];
  const seed = 7919 * (speciesIndex + 1) + 104729 * (variant + 1);
  const branches = growTree(sp, seed);

  const rngC = mulberry32(seed ^ 0x5bd1e995);
  const tips = [];
  for (const b of branches) if (b.level === 3) tips.push(b.pts[b.pts.length - 1]);
  const rough = makeCrown(tips);
  const cards0 = placeCards(sp, variant, branches, 0, rngC, rough);
  const pts = [];
  for (const c of cards0) pts.push(c.at.clone().addScaledVector(c.up, c.size * 0.5), c.at.clone().addScaledVector(c.up, c.size));
  const crown = makeCrown(pts);
  const aoAt = (p) => crown.barkAO(p);

  const lods = [];
  for (const lod of [0, 1, 2]) {
    const leaf = new Builder(), bark = new Builder();
    const rng = mulberry32(seed + lod * 31337);
    for (const b of branches) {
      if (lod === 0) addTube(bark, b, [8, 6, 4, 3][b.level], 1, aoAt, swayWeight);
      else if (lod === 1 && b.level <= 2) addTube(bark, b, [6, 4, 3][b.level], 2, aoAt, swayWeight);
      else if (lod === 2 && b.level <= 1) addTube(bark, b, b.level === 0 ? 5 : 3, b.level === 0 ? 3 : 6, aoAt, swayWeight);
    }
    const cards = lod === 0 ? cards0 : placeCards(sp, variant, branches, lod, rng, crown);
    for (const c of cards) addCard(leaf, c.at, c.up, c.face, c.size, c.tile, rng() < 0.5, rng(), crown);
    lods.push({ leaf: leaf.build(), bark: bark.build(), cards: cards.length });
  }

  // Shadow stand-in: the far shell (fewer cards) + trunk prism sampling the atlas's opaque block
  const px = new Builder();
  const rngP = mulberry32(seed + 999);
  const shellCards = placeCards({ ...sp, shell: { ...sp.shell, n: Math.max(10, sp.shell.n - 4) } }, variant, branches, 2, rngP, crown, 0.38, 0.95);
  for (const c of shellCards) addCard(px, c.at, c.up, c.face, c.size, c.tile, false, 0, crown);
  addTube(px, branches[0], 4, 4, () => 1, () => 0, SOLID_UV);
  const proxy = px.build();

  return { lods, proxy, crown: { cy: crown.C.y, r: Math.max(crown.R.x, crown.R.z), ry: crown.R.y, top: crown.box.max.y } };
}
