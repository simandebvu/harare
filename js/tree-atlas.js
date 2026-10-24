// js/tree-atlas.js — canvas-painted foliage atlas (leaf sprays, blossom panicles, far-crown clumps) and bark textures
// for js/trees.js. 4×4 tiles of 512 px; albedo in sRGB, alpha = coverage. The mip chain is box-filtered with each tile's
// alpha rescaled so the share of texels above the alpha-test cutoff stays what it is at full size: alpha-tested
// crowns don't thin out and vanish at distance.
import * as THREE from 'three';

export const ATLAS = 2048;
export const TILE = 512;
export const GUTTER = 8;
const COLS = 4;

// Tile slots
export const T = {
  jacBloomA: 0, jacBloomB: 1, jacMixed: 2, flamA: 3, flamB: 4, msasaA: 5, msasaB: 6, gum: 7,
  genA: 8, genB: 9, clumpJac: 10, clumpFlam: 11, clumpMsasa: 12, clumpGum: 13, clumpGen: 14, solid: 15,
};

// uv rectangle of a tile (inside the gutter); v0 = top of the painting
export function tileRect(k) {
  const ox = (k % COLS) * TILE, oy = Math.floor(k / COLS) * TILE;
  return { u0: (ox + GUTTER) / ATLAS, u1: (ox + TILE - GUTTER) / ATLAS, v0: (oy + GUTTER) / ATLAS, v1: (oy + TILE - GUTTER) / ATLAS };
}
// uv of the always-opaque block (shadow stand-in trunks sample it)
export const SOLID_UV = (() => {
  const ox = (T.solid % COLS) * TILE, oy = Math.floor(T.solid / COLS) * TILE;
  return [(ox + TILE / 2) / ATLAS, (oy + TILE / 2) / ATLAS];
})();

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

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const css = (c, k = 1) => `rgb(${Math.min(255, Math.round(c[0] * k))},${Math.min(255, Math.round(c[1] * k))},${Math.min(255, Math.round(c[2] * k))})`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Palettes (sRGB, deliberately a little muted: ACES + the grade add saturation back)
const P = {
  jacBell: ['#a196cc', '#aaa0d2', '#988fc2', '#b2a9d6', '#958cbc'].map(hex),
  jacLeaf: ['#5f7a3c', '#6b8442', '#55703a'].map(hex),
  flamFlower: ['#d23a24', '#c82e20', '#dc4a2a', '#e25e30'].map(hex),
  flamLeaf: ['#5e8a32', '#6c9638', '#537c2e'].map(hex),
  msasaGreen: ['#5f7636', '#6a7f3c', '#566c32', '#748442'].map(hex),
  msasaFlush: ['#9a5434', '#8a4430', '#a8683c', '#7e3e2e', '#b07a46'].map(hex),
  gum: ['#7a8868', '#6d7c5e', '#86917a', '#717f62'].map(hex),
  gen: ['#506e2e', '#5c7834', '#48662a', '#62803a'].map(hex),
  twig: hex('#5a4a3c'),
  twigPale: hex('#8a7a62'),
};

// Paints one tile. Sprays: metres, attachment at the bottom centre, `M` m tall (and wide). Clumps: centred.
function painter(ctx, k, M, rng) {
  const R = (a, b) => a + (b - a) * rng();
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const ox = (k % COLS) * TILE, oy = Math.floor(k / COLS) * TILE;
  const s = (TILE - 2 * GUTTER) / M;
  const X = (x) => ox + TILE / 2 + x * s;
  const Y = (y) => oy + TILE - GUTTER - y * s;
  const api = {
    R, pick, s,
    // polyline twig, width tapering w0 → w1 (metres)
    twig(pts, w0, w1, col) {
      ctx.lineCap = 'round';
      for (let i = 0; i < pts.length - 1; i++) {
        ctx.beginPath();
        ctx.moveTo(X(pts[i][0]), Y(pts[i][1]));
        ctx.lineTo(X(pts[i + 1][0]), Y(pts[i + 1][1]));
        ctx.lineWidth = Math.max(1, (w0 + (w1 - w0) * (i / (pts.length - 1))) * s);
        ctx.strokeStyle = css(col);
        ctx.stroke();
      }
    },
    // pointed oval leaf from p along angle a (0 = up), len × wid metres; folded: one half a little darker
    leaf(p, a, len, wid, col, skew = 0) {
      const d = [Math.sin(a), Math.cos(a)], n = [d[1], -d[0]];
      const f = (u, v) => [X(p[0] + d[0] * u * len + n[0] * v * wid), Y(p[1] + d[1] * u * len + n[1] * v * wid)];
      ctx.beginPath();
      ctx.moveTo(...f(0, 0));
      ctx.bezierCurveTo(...f(0.08, 0.62 + skew), ...f(0.62, 0.64), ...f(1, 0));
      ctx.bezierCurveTo(...f(0.62, -0.64), ...f(0.08, -0.62 + skew), ...f(0, 0));
      ctx.fillStyle = css(col);
      ctx.fill();
      if (len * s > 7) {
        ctx.beginPath();
        ctx.moveTo(...f(0, 0));
        ctx.bezierCurveTo(...f(0.08, 0.62 + skew), ...f(0.62, 0.64), ...f(1, 0));
        ctx.closePath();
        ctx.fillStyle = css(col, 0.86);
        ctx.fill();
      }
    },
    // a jacaranda bell: a slightly flared tube with a paler mouth
    bell(p, a, len, col) {
      const d = [Math.sin(a), Math.cos(a)], n = [d[1], -d[0]];
      const f = (u, v) => [X(p[0] + d[0] * u * len + n[0] * v * len), Y(p[1] + d[1] * u * len + n[1] * v * len)];
      ctx.beginPath();
      ctx.moveTo(...f(0, 0.1));
      ctx.quadraticCurveTo(...f(0.6, 0.16), ...f(1, 0.36));
      ctx.quadraticCurveTo(...f(1.08, 0), ...f(1, -0.36));
      ctx.quadraticCurveTo(...f(0.6, -0.16), ...f(0, -0.1));
      ctx.closePath();
      ctx.fillStyle = css(col, 0.9);
      ctx.fill();
      if (len * s > 5) {
        ctx.beginPath();
        ctx.ellipse(...f(0.88, 0), len * 0.26 * s, len * 0.16 * s, -a, 0, Math.PI * 2);
        ctx.fillStyle = css(mix(col, [236, 230, 250], 0.3));
        ctx.fill();
      }
    },
    // five round petals (flamboyant): one paler, streaked standard petal
    flower(p, r, col) {
      const rot = R(0, Math.PI * 2);
      for (let i = 0; i < 5; i++) {
        const a = rot + (i / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(X(p[0] + Math.cos(a) * r * 0.55), Y(p[1] + Math.sin(a) * r * 0.55), r * 0.5 * s, r * 0.36 * s, -a, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? css(mix(col, [236, 214, 150], 0.55)) : css(col, R(0.9, 1.05));
        ctx.fill();
      }
    },
    blob(p, r, col) {
      ctx.beginPath();
      ctx.arc(X(p[0]), Y(p[1]), Math.max(0.6, r * s), 0, Math.PI * 2);
      ctx.fillStyle = css(col);
      ctx.fill();
    },
  };
  return api;
}

// Curving polyline from (x, y) at angle a off vertical, len m, curling by `curl` rad over its length
function curve(rng, x, y, a, len, curl, segs = 10, wander = 0.04) {
  const pts = [[x, y]];
  let ang = a;
  for (let i = 1; i <= segs; i++) {
    ang += curl / segs + (rng() - 0.5) * wander;
    const p = pts[i - 1];
    pts.push([p[0] + Math.sin(ang) * len / segs, p[1] + Math.cos(ang) * len / segs]);
  }
  return pts;
}
function at(pts, t) {
  const f = Math.min(pts.length - 1.001, t * (pts.length - 1));
  const i = Math.floor(f), k = f - i, a = pts[i], b = pts[i + 1];
  return { p: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], a: Math.atan2(b[0] - a[0], b[1] - a[1]) };
}

// Bipinnate frond (jacaranda / flamboyant): a rachis with pinnae of tiny leaflets, very fine and feathery
function frond(g, rng, p, a, len, leaflet, cols, pinnaLen) {
  const rach = curve(rng, p[0], p[1], a, len, g.R(-0.4, 0.4), 8);
  g.twig(rach, 0.006, 0.003, P.twig);
  for (let t = 0.12; t < 0.98; t += 0.09) {
    const q = at(rach, t);
    for (const sd of [-1, 1]) {
      const pl = pinnaLen * (1 - Math.abs(t - 0.45) * 0.9) * g.R(0.8, 1.1);
      const pin = curve(rng, q.p[0], q.p[1], q.a + sd * g.R(1.0, 1.35), pl, sd * 0.2, 5);
      const col = g.pick(cols);
      for (let u = 0.1; u < 1; u += 0.13) {
        const r = at(pin, u);
        for (const s2 of [-1, 1]) g.leaf(r.p, r.a + s2 * 1.2, leaflet, leaflet * 0.45, mix(col, [0, 0, 0], g.R(-0.08, 0.12)));
      }
    }
  }
}

// Panicle of jacaranda bells: a loose cone of nodding trumpets round the axis
function panicle(g, rng, p, a, len, n) {
  const ax = [Math.sin(a), Math.cos(a)];
  g.twig([p, [p[0] + ax[0] * len * 0.85, p[1] + ax[1] * len * 0.85]], 0.007, 0.003, P.twigPale);
  for (let i = 0; i < n; i++) {
    const t = Math.pow(rng(), 0.8);
    const spread = (1 - t * 0.7) * len * 0.5;
    const off = g.R(-1, 1) * spread;
    const c = [p[0] + ax[0] * t * len + ax[1] * off, p[1] + ax[1] * t * len - ax[0] * off];
    const col = g.pick(P.jacBell);
    // bells nod outward and a little down from the axis
    const ba = a + Math.sign(off || 1) * g.R(0.8, 1.9);
    g.bell(c, ba, g.R(0.042, 0.058), mix(col, [40, 30, 70], t < 0.25 ? 0.12 : g.R(-0.1, 0.08)));
  }
}

function paintJacaranda(g, rng, bloom) {
  // a few twigs fanning up from the base, fronds along them, panicles at and near the tips
  const tips = [];
  const n = 4;
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n - 0.5;
    const pts = curve(rng, f * 0.1, 0, f * 1.5 + g.R(-0.15, 0.15), g.R(0.95, 1.25) * (1 - Math.abs(f) * 0.3), f * 0.5, 10);
    g.twig(pts, 0.016, 0.006, P.twig);
    for (let t = 0.25; t < 0.9; t += g.R(0.18, 0.26)) {
      const q = at(pts, t);
      if (rng() < 1.15 - bloom) frond(g, rng, q.p, q.a + (rng() < 0.5 ? -1 : 1) * g.R(0.5, 1.0), g.R(0.32, 0.44), 0.016, P.jacLeaf, 0.08);
      else tips.push([q.p, q.a + (rng() < 0.5 ? -1 : 1) * g.R(0.3, 0.7)]);
    }
    const tp = at(pts, 1);
    tips.push([tp.p, tp.a]);
  }
  for (const [p, a] of tips) panicle(g, rng, p, a + g.R(-0.2, 0.2), g.R(0.3, 0.42), Math.round(80 * (0.6 + bloom * 0.5)));
}

function paintFlamboyant(g, rng, flowers) {
  const tips = [];
  const n = 4;
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n - 0.5;
    const pts = curve(rng, f * 0.1, 0, f * 1.6 + g.R(-0.1, 0.1), g.R(0.9, 1.2) * (1 - Math.abs(f) * 0.25), f * 0.4, 10);
    g.twig(pts, 0.018, 0.007, P.twig);
    for (let t = 0.2; t < 1.01; t += g.R(0.2, 0.28)) {
      const q = at(pts, Math.min(1, t));
      frond(g, rng, q.p, q.a + (rng() < 0.5 ? -1 : 1) * g.R(0.35, 0.9), g.R(0.42, 0.55), 0.02, P.flamLeaf, 0.1);
      if (rng() < flowers) tips.push(q.p);
    }
  }
  for (const p of tips) {
    // corymbs of flame-red flowers held above the fronds
    const m = Math.round(g.R(8, 15));
    const col = g.pick(P.flamFlower);
    for (let j = 0; j < m; j++) g.flower([p[0] + g.R(-0.17, 0.17), p[1] + g.R(-0.05, 0.2)], g.R(0.05, 0.068), mix(col, [60, 20, 10], g.R(-0.06, 0.12)));
  }
}

function paintMsasa(g, rng, flush) {
  const n = 5;
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n - 0.5;
    const pts = curve(rng, f * 0.08, 0, f * 1.6 + g.R(-0.1, 0.1), g.R(0.75, 0.95) * (1 - Math.abs(f) * 0.3), f * 0.6, 10);
    g.twig(pts, 0.014, 0.006, P.twig);
    for (let t = 0.18; t < 1.01; t += g.R(0.14, 0.2)) {
      const q = at(pts, Math.min(1, t));
      // pinnate leaf: rachis with 3–4 pairs of leaflets and one at the tip; new leaves flush copper and wine-red
      const young = rng() < flush * (0.5 + t);
      const base = young ? g.pick(P.msasaFlush) : g.pick(P.msasaGreen);
      const la = q.a + (rng() < 0.5 ? -1 : 1) * g.R(0.4, 0.9);
      const rl = g.R(0.2, 0.28);
      const rach = curve(rng, q.p[0], q.p[1], la, rl, g.R(-0.3, 0.3), 5);
      g.twig(rach, 0.005, 0.003, P.twig);
      for (let u = 0.3; u < 0.95; u += 0.2) {
        const r = at(rach, u);
        for (const sd of [-1, 1]) g.leaf(r.p, r.a + sd * g.R(0.6, 0.9), g.R(0.07, 0.09), 0.036, mix(base, [0, 0, 0], g.R(-0.1, 0.14)), sd * 0.1);
      }
      const e = at(rach, 1);
      g.leaf(e.p, e.a, 0.085, 0.036, base);
    }
  }
}

function paintGum(g, rng) {
  // painted upright, hung upside down on the tree: long pendulous twigs with sparse sickle leaves almost along them
  const n = 6;
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n - 0.5;
    const pts = curve(rng, f * 0.2, 0, f * 0.9 + g.R(-0.1, 0.1), g.R(1.1, 1.5), f * 0.3, 12, 0.08);
    g.twig(pts, 0.012, 0.004, P.twigPale);
    for (let t = 0.08; t < 1.01; t += g.R(0.035, 0.06)) {
      const q = at(pts, Math.min(1, t));
      const sd = rng() < 0.5 ? -1 : 1;
      g.leaf(q.p, q.a + sd * g.R(0.15, 0.5), g.R(0.13, 0.18), 0.022, mix(g.pick(P.gum), [0, 0, 0], g.R(-0.1, 0.15)), sd * 0.25);
    }
  }
}

function paintGeneric(g, rng) {
  const n = 5;
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n - 0.5;
    const pts = curve(rng, f * 0.06, 0, f * 1.6 + g.R(-0.1, 0.1), g.R(0.65, 0.85) * (1 - Math.abs(f) * 0.25), f * 0.8, 12);
    g.twig(pts, 0.013, 0.005, P.twig);
    let sd = 1;
    for (let t = 0.1; t < 0.97; t += g.R(0.07, 0.1)) {
      const q = at(pts, t);
      sd = -sd;
      g.leaf(q.p, q.a + sd * g.R(0.6, 1.0), g.R(0.09, 0.12) * (1 - t * 0.2), 0.05, mix(g.pick(P.gen), [0, 0, 0], g.R(-0.1, 0.15)), sd * 0.1);
    }
    const tip = at(pts, 1);
    g.leaf(tip.p, tip.a, 0.09, 0.05, g.pick(P.gen));
  }
}

// Far-crown clump: a ragged mass that stands for a whole section of a distant crown (painted centred, M tall)
function paintClump(g, rng, M, kind) {
  const lobes = Array.from({ length: 7 }, () => ({ a: g.R(0, Math.PI * 2), r: g.R(0.72, 1.0), w: g.R(0.5, 0.9) }));
  const edge = (ang) => 0.46 * M * lobes.reduce((m, l) => Math.max(m, l.r * Math.cos(Math.min(Math.PI / 2, Math.abs(((ang - l.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) / l.w))), 0.55);
  const cy = M / 2;
  // patches (flower trusses / flush) are clustered, not salt-and-pepper
  const patches = Array.from({ length: 9 }, () => [g.R(-0.35, 0.35) * M, cy + g.R(-0.3, 0.4) * M]);
  const near = (x, y, r) => patches.some(([px, py]) => Math.hypot(x - px, y - py) < r);
  const count = kind === 'gum' ? 520 : kind === 'jac' ? 1300 : 950;
  for (let i = 0; i < count; i++) {
    const ang = g.R(0, Math.PI * 2);
    const rr = Math.sqrt(rng()) * edge(ang);
    const x = Math.cos(ang) * rr, y = cy + Math.sin(ang) * rr;
    const lift = 0.82 + 0.3 * ((y - cy) / M + 0.5); // brighter on top, darker below
    let col, len = g.R(0.1, 0.15) * M / 3;
    if (kind === 'jac') col = rng() < 0.82 ? g.pick(P.jacBell) : g.pick(P.jacLeaf);
    else if (kind === 'flam') col = near(x, y, 0.14 * M) && rng() < 0.75 ? g.pick(P.flamFlower) : g.pick(P.flamLeaf);
    else if (kind === 'msasa') col = near(x, y, 0.13 * M) && rng() < 0.7 ? g.pick(P.msasaFlush) : g.pick(P.msasaGreen);
    else if (kind === 'gum') (col = g.pick(P.gum)), (len *= 1.3);
    else col = g.pick(P.gen);
    if (kind === 'jac' && rng() < 0.8) g.bell([x, y], g.R(-Math.PI, Math.PI), len * 0.75, mix(col, [0, 0, 0], 1 - lift));
    else g.leaf([x, y], g.R(-Math.PI, Math.PI), len, len * (kind === 'gum' ? 0.25 : 0.5), mix(col, [0, 0, 0], 1 - lift));
  }
}

// Tile sizes in metres (the leaf card's world size)
export const TILE_METERS = new Array(16).fill(1.6);
TILE_METERS[T.jacBloomA] = TILE_METERS[T.jacBloomB] = TILE_METERS[T.jacMixed] = 1.75;
TILE_METERS[T.flamA] = TILE_METERS[T.flamB] = 1.85;
TILE_METERS[T.msasaA] = TILE_METERS[T.msasaB] = 1.45;
TILE_METERS[T.gum] = 1.75;
TILE_METERS[T.genA] = TILE_METERS[T.genB] = 1.25;
const CLUMP_M = 3;

export function createLeafAtlas() {
  const c = document.createElement('canvas');
  c.width = c.height = ATLAS;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, ATLAS, ATLAS);
  const rng = mulberry32(20261024);
  const G = (k) => painter(ctx, k, TILE_METERS[k], rng);
  paintJacaranda(G(T.jacBloomA), rng, 1.0);
  paintJacaranda(G(T.jacBloomB), rng, 0.9);
  paintJacaranda(G(T.jacMixed), rng, 0.45);
  paintFlamboyant(G(T.flamA), rng, 0.55);
  paintFlamboyant(G(T.flamB), rng, 0.32);
  paintMsasa(G(T.msasaA), rng, 0.35);
  paintMsasa(G(T.msasaB), rng, 0.12);
  paintGum(G(T.gum), rng);
  paintGeneric(G(T.genA), rng);
  paintGeneric(G(T.genB), rng);
  const clump = (k, kind) => paintClump(painter(ctx, k, CLUMP_M, rng), rng, CLUMP_M, kind);
  clump(T.clumpJac, 'jac');
  clump(T.clumpFlam, 'flam');
  clump(T.clumpMsasa, 'msasa');
  clump(T.clumpGum, 'gum');
  clump(T.clumpGen, 'gen');
  {
    const ox = (T.solid % COLS) * TILE, oy = Math.floor(T.solid / COLS) * TILE;
    ctx.fillStyle = css(P.twig);
    ctx.fillRect(ox + TILE / 2 - 64, oy + TILE / 2 - 64, 128, 128);
  }

  // Empty texels take their tile's mean leaf colour, so filtering never pulls black into the leaf edges
  const img = ctx.getImageData(0, 0, ATLAS, ATLAS).data;
  const level0 = new Uint8Array(img.length);
  level0.set(img);
  for (let ty = 0; ty < COLS; ty++)
    for (let tx = 0; tx < COLS; tx++) {
      let r = 0, gg = 0, b = 0, n = 0;
      for (let y = ty * TILE; y < (ty + 1) * TILE; y++)
        for (let x = tx * TILE; x < (tx + 1) * TILE; x++) {
          const i = (y * ATLAS + x) * 4;
          if (level0[i + 3] > 200) (r += level0[i]), (gg += level0[i + 1]), (b += level0[i + 2]), n++;
        }
      if (!n) continue;
      (r /= n), (gg /= n), (b /= n);
      for (let y = ty * TILE; y < (ty + 1) * TILE; y++)
        for (let x = tx * TILE; x < (tx + 1) * TILE; x++) {
          const i = (y * ATLAS + x) * 4, a = level0[i + 3] / 255;
          if (a < 1) (level0[i] = level0[i] * a + r * (1 - a)), (level0[i + 1] = level0[i + 1] * a + gg * (1 - a)), (level0[i + 2] = level0[i + 2] * a + b * (1 - a));
        }
    }

  const tex = new THREE.DataTexture(level0, ATLAS, ATLAS, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.mipmaps = coverageMips(level0, ATLAS, COLS);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.needsUpdate = true;
  tex.name = 'TreeLeafAtlas';
  return tex;
}

// Box-filtered mip chain whose alpha is rescaled per tile so the share above the cutoff matches level 0
function coverageMips(level0, size, tiles, cutoff = 128) {
  const levels = [{ data: level0, width: size, height: size }];
  const target = [];
  const tilePx = size / tiles;
  for (let ty = 0; ty < tiles; ty++)
    for (let tx = 0; tx < tiles; tx++) {
      let n = 0;
      for (let y = ty * tilePx; y < (ty + 1) * tilePx; y++) for (let x = tx * tilePx; x < (tx + 1) * tilePx; x++) if (level0[(y * size + x) * 4 + 3] >= cutoff) n++;
      target.push(n / (tilePx * tilePx));
    }
  const meanTarget = target.reduce((a, b) => a + b, 0) / target.length;
  let src = level0, w = size;
  const hist = new Uint32Array(256);
  while (w > 1) {
    const h = w >> 1;
    const dst = new Uint8Array(h * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < h; x++) {
        const i0 = (2 * y * w + 2 * x) * 4, i1 = i0 + w * 4, o = (y * h + x) * 4;
        for (let c = 0; c < 4; c++) dst[o + c] = (src[i0 + c] + src[i0 + 4 + c] + src[i1 + c] + src[i1 + 4 + c] + 2) >> 2;
      }
    const nt = h >= tiles ? tiles : 1;
    const tp = h / nt;
    for (let ty = 0; ty < nt; ty++)
      for (let tx = 0; tx < nt; tx++) {
        const want = (nt === tiles ? target[ty * tiles + tx] : meanTarget) * tp * tp;
        if (want <= 0) continue;
        hist.fill(0);
        for (let y = ty * tp; y < (ty + 1) * tp; y++) for (let x = tx * tp; x < (tx + 1) * tp; x++) hist[dst[(y * h + x) * 4 + 3]]++;
        let acc = 0, aStar = 255;
        for (let a = 255; a >= 1; a--) {
          acc += hist[a];
          if (acc >= want) {
            aStar = a;
            break;
          }
        }
        const scale = cutoff / Math.max(aStar, 1);
        if (Math.abs(scale - 1) < 0.01) continue;
        for (let y = ty * tp; y < (ty + 1) * tp; y++)
          for (let x = tx * tp; x < (tx + 1) * tp; x++) {
            const i = (y * h + x) * 4 + 3;
            dst[i] = Math.min(255, Math.round(dst[i] * scale));
          }
      }
    levels.push({ data: dst, width: h, height: h });
    src = dst;
    w = h;
  }
  return levels;
}

// Bark: grey-brown fissured (most species) and the gum's smooth, pale, peeling patchwork. Greyscale-ish detail that
// the per-species bark colour multiplies; u round the stem and v along it, both in metres (1 × 2 m per repeat).
export function createBarkTextures() {
  const make = (paint) => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 256;
    const g = c.getContext('2d');
    paint(g, mulberry32(77));
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.repeat.set(1, 0.5);
    return t;
  };
  const rough = make((g, r) => {
    g.fillStyle = '#d4d0cc';
    g.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 70; i++) {
      // vertical fissures, wandering
      let x = r() * 128, y = r() * 256;
      const len = 30 + r() * 90;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < len; k += 6) (x += (r() - 0.5) * 4), (y += 6), g.lineTo(x, y);
      g.lineWidth = 1 + r() * 2.5;
      g.strokeStyle = `rgba(40,34,30,${0.35 + r() * 0.4})`;
      g.stroke();
    }
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.12})`;
      g.fillRect(r() * 128, r() * 256, 2 + r() * 6, 2 + r() * 10);
    }
  });
  const gum = make((g, r) => {
    g.fillStyle = '#e8e2d6';
    g.fillRect(0, 0, 128, 256);
    const cols = ['#d6cdbd', '#c9c2b4', '#b8b4a6', '#ece6da', '#c2a98a', '#a8a294'];
    for (let i = 0; i < 46; i++) {
      // peeling patches: soft-edged, elongated along the stem
      const x = r() * 128, y = r() * 256, w = 8 + r() * 30, h = 20 + r() * 70;
      g.fillStyle = cols[Math.floor(r() * cols.length)];
      g.beginPath();
      g.ellipse(x, y, w / 2, h / 2, (r() - 0.5) * 0.3, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(90,80,70,0.25)';
      g.lineWidth = 1;
      g.stroke();
    }
  });
  return { rough, gum };
}
