// js/buildings.js — Harare CBD buildings from OSM footprints, by era:
//   colonial (1890s–1940s): 1–3 storeys, steel casements, parapet + pediment, tin verandah over the pavement
//   modernist (1950s–70s): slabs and podium+tower, sunshade bands / vertical fins, face brick, concrete pavement canopy
//   post-independence (1980s–2000s): curtain glass or granite / precast towers, setback crowns
// plus suburban houses with tin roofs, and hand-shaped landmarks. Everything merges into one mesh; wall materials
// (render, face brick, precast, granite, mosaic, tin), recessed windows with parallax-mapped rooms behind them,
// shopfronts and shutters are drawn in the shader. Shop names and billboards come from signs.js.
import * as THREE from 'three';
import { groundY, rng, coreWeight, Grid, polyBounds, pointInPoly, polyCentroid, segDist } from './util.js';
import { buildingMaterials, LAYER_SCALE } from './building-textures.js';
import { createSigns } from './signs.js';

// --- facade styles (shader) ----------------------------------------------------------------------------------------
// 0 colonial steel casement · 1 modern ribbon · 2 curtain glass · 3 house · 4 sign (emissive at night) · 5 modern fins
// 6 precast. Window cells [width, height, lo.x, lo.y, hi.x, hi.y] in metres / cell fractions; the shader mirrors these.
const CELL = {
  0: [3.6, 4.2, 0.33, 0.22, 0.67, 0.78],
  1: [3.0, 3.3, -1, 0.36, 2, 0.86],
  2: [1.6, 3.6, 0.04, 0.05, 0.96, 0.95],
  3: [4.2, 3.2, 0.32, 0.3, 0.68, 0.72],
  5: [1.5, 3.3, 0.12, 0.2, 0.88, 0.88],
  6: [2.4, 3.6, 0.22, 0.3, 0.78, 0.8],
};
const FLOOR = { 0: 4.2, 1: 3.3, 2: 3.6, 3: 3.2, 5: 3.3, 6: 3.6 };
// Wall / roof material codes (texture layer + 1; 9 = glass, untextured)
const MAT = { render: 1, brick: 2, precast: 3, granite: 4, mosaic: 5, tin: 6, roof: 7, concrete: 8, glass: 9 };
const mf = (m) => [0, 0, m * 10];

const PALETTE = {
  colonial: ['#ebe0c4', '#e3cf9f', '#f1ece0', '#d9b77e', '#a8553a', '#e8dcc0', '#cfa66b', '#efe6cf'],
  colonialTrim: ['#6b2a26', '#2f4a34', '#f4f1ea', '#3b3f45'],
  modern: ['#efe6d2', '#e6d6b6', '#f3eee2', '#dcc8a4', '#e8dcc4', '#d9cbb0', '#cfd3cc', '#e9d2b8', '#d8c09a', '#f0e8d8'],
  mosaic: ['#6f8c9c', '#7d927a', '#b48a6e', '#8a9aa6'],
  granite: ['#b8a090', '#a89488', '#c2ae9a', '#9e8a7e', '#c8b8a4', '#b09078'],
  brick: ['#8c4a34', '#9a5a3e', '#7b4433', '#a3684b', '#6f3f30', '#b98a62', '#8a5444', '#c09a70'],
  house: ['#efe7d6', '#e8dcc2', '#f2d3b3', '#d8c3a5', '#ffffff', '#e4c9a8', '#c9b49a'],
  tin: ['#8e3b2a', '#7a4a3a', '#5e6266', '#9a5a3c', '#6d3527', '#8a8f91', '#3f5e4a'],
  sign: ['#c8102e', '#f2b705', '#0a4ea2', '#1b8a3a', '#e35205', '#6a1b9a', '#00838f'],
  verandah: ['#7d8285', '#8e3b2a', '#5e6266', '#a0a4a6'],
};

// Named landmarks: kind overrides the typology, extras add hand-built massing
const LANDMARKS = [
  { re: /Reserve Bank/i, kind: 'post', style: 6, wall: '#8d8a86', mat: MAT.granite, crown: 'cone' }, // granite tower, Great Zimbabwe cone top
  { re: /Joina City/i, kind: 'post', style: 2, wall: '#6f8fa8', mat: MAT.glass, podium: 2, spire: 28 },
  { re: /Karigamombe/i, kind: 'post', style: 6, wall: '#9a8270', mat: MAT.precast, crown: 'step' }, // brown precast
  { re: /Old Mutual Centre/i, kind: 'post', style: 6, wall: '#7a6550', mat: MAT.granite, crown: 'step' },
  { re: /Eastgate Shopping/i, kind: 'modern', style: 5, wall: '#8f8b84', mat: MAT.concrete, chimneys: true, finDepth: 1.0 },
  { re: /ZB Life/i, kind: 'modern', style: 1, wall: '#c9cdcc', mat: MAT.render, bands: true },
  { re: /Meikles/i, kind: 'modern', style: 1, wall: '#efe9dc', mat: MAT.render, bands: true },
  { re: /Rainbow Towers/i, kind: 'post', style: 2, wall: '#a8814f', mat: MAT.glass }, // gold reflective glass
  { re: /^Parliament/i, kind: 'colonial', style: 0, wall: '#efe6cf', mat: MAT.render, verandah: 1 },
  { re: /Town House/i, kind: 'colonial', style: 0, wall: '#f0e3c2', mat: MAT.render, clock: true },
  { re: /Livingstone House/i, kind: 'modern', style: 1, wall: '#d9d6cf', mat: MAT.concrete, bands: true },
  { re: /Pearl House/i, kind: 'modern', style: 5, wall: '#e2dccd', mat: MAT.render },
  { re: /Hurudza/i, kind: 'modern', style: 1, wall: '#c8bba4', mat: MAT.concrete, bands: true, bandDepth: 1.6 },
  { re: /Social Security|NSSA/i, kind: 'post', style: 6, wall: '#a59a92', mat: MAT.granite, crown: 'step' },
  { re: /Main Post/i, kind: 'colonial', style: 0, wall: '#e8dcc0', mat: MAT.render, verandah: 1 },
];

// --- growable typed geometry buffer ---------------------------------------------------------------------------------
class Buf {
  constructor() {
    this.n = 0;
    this.cap = 1 << 18;
    this.alloc();
  }
  alloc() {
    const grow = (old, k) => {
      const a = new Float32Array(this.cap * k);
      if (old) a.set(old.subarray(0, this.n * k));
      return a;
    };
    this.pos = grow(this.pos, 3);
    this.nrm = grow(this.nrm, 3);
    this.col = grow(this.col, 3);
    this.uv = grow(this.uv, 2);
    this.fac = grow(this.fac, 3);
  }
  v(x, y, z, nx, ny, nz, c, u, w, f0, f1, f2) {
    if (this.n >= this.cap) (this.cap *= 2), this.alloc();
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.nrm[i * 3] = nx; this.nrm[i * 3 + 1] = ny; this.nrm[i * 3 + 2] = nz;
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
    this.uv[i * 2] = u; this.uv[i * 2 + 1] = w;
    this.fac[i * 3] = f0; this.fac[i * 3 + 1] = f1; this.fac[i * 3 + 2] = f2;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    const n = this.n;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.slice(0, n * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, n * 3), 3));
    g.setAttribute('aWall', new THREE.BufferAttribute(this.uv.slice(0, n * 2), 2));
    g.setAttribute('aFac', new THREE.BufferAttribute(this.fac.slice(0, n * 3), 3));
    return g;
  }
}

// Unit primitives (non-indexed) to stamp with a transform
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
const UNIT_CYL = new THREE.CylinderGeometry(1, 1, 1, 10).toNonIndexed();
const UNIT_CONE = new THREE.ConeGeometry(1, 1, 12).toNonIndexed();
const _m = new THREE.Matrix4(), _n = new THREE.Matrix3(), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const NOFAC = [0, 0, 0];

export function buildBuildings(scene, DATA, renderer) {
  const B = new Buf();
  const grid = new Grid(40);
  const footprints = [];
  const labels = [];
  const signs = createSigns(renderer);
  const spots = { dishes: [], huts: [] }; // for js/features/furniture.js
  const c = new THREE.Color(), c2 = new THREE.Color(), c3 = new THREE.Color();
  const acCol = new THREE.Color('#d8d5cb'), acDark = new THREE.Color('#b4b2aa');
  let acCount = 0;

  // Streets nearby, to find street-facing walls for verandahs and canopies
  const roadGrid = new Grid(30);
  for (const r of DATA.roads) {
    if (r.k === 'service') continue;
    for (let i = 2; i < r.p.length; i += 2) {
      const ax = r.p[i - 2], az = r.p[i - 1], bx = r.p[i], bz = r.p[i + 1];
      roadGrid.insert({ ax, az, bx, bz, w: r.w }, Math.min(ax, bx) - 15, Math.min(az, bz) - 15, Math.max(ax, bx) + 15, Math.max(az, bz) + 15);
    }
  }
  const streetGap = (x, z) => {
    let best = 1e9;
    for (const s of roadGrid.query(x, z)) best = Math.min(best, segDist(x, z, s.ax, s.az, s.bx, s.bz)[0] - s.w / 2);
    return best;
  };

  // --- primitive emitters --------------------------------------------------------------------------------------------
  const quad = (p0, p1, p2, p3, color, uv, f) => {
    // p0..p3 counter-clockwise seen from the front
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2], bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    (nx /= l), (ny /= l), (nz /= l);
    const U = uv || [0, 0, 0, 0, 0, 0, 0, 0];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const p = [p0, p1, p2, p3][k];
      B.v(p[0], p[1], p[2], nx, ny, nz, color, U[k * 2], U[k * 2 + 1], f[0], f[1], f[2]);
    }
  };
  const triUp = (a, b, cc, color, f = NOFAC) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = cc[0] - a[0], vy = cc[1] - a[1], vz = cc[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (ny < 0) ([b, cc] = [cc, b]), (nx = -nx), (ny = -ny), (nz = -nz);
    const l = Math.hypot(nx, ny, nz) || 1;
    for (const p of [a, b, cc]) B.v(p[0], p[1], p[2], nx / l, ny / l, nz / l, color, -1, -1, f[0], f[1], f[2]);
  };
  const stamp = (geo, x, y, z, sx, sy, sz, yaw, color, f = NOFAC) => {
    _q.setFromAxisAngle(UP, yaw);
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    _n.getNormalMatrix(_m);
    const P = geo.attributes.position, N = geo.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i).applyMatrix4(_m);
      const px = _v.x, py = _v.y, pz = _v.z;
      _v.fromBufferAttribute(N, i).applyMatrix3(_n).normalize();
      B.v(px, py, pz, _v.x, _v.y, _v.z, color, -1, -1, f[0], f[1], f[2]);
    }
  };
  // Box resting on y0, centred on (x, z), rotated so its local x runs along `yaw`
  const box = (x, z, y0, w, d, h, color, yaw = 0, f = NOFAC) => stamp(UNIT_BOX, x, y0 + h / 2, z, w, h, d, -yaw, color, f);

  // Walls of a ring from y0 to y1; v measured from `base`, u along the perimeter. Returns per-edge info.
  // The wall's top (above base) rides in the fraction of the seed so the shader stops windows under the parapet.
  // blank(edge) → that wall gets no windows (party walls, blank flanks).
  function walls(ring, y0, y1, base, color, f, parapet = 0, blank = null) {
    const n = ring.length / 2;
    let s = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      s += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
    }
    const sign = s > 0 ? 1 : -1;
    const edges = [];
    const fw = [f[0], Math.floor(f[1]) + Math.min(0.999, Math.max(0, y1 - base) / 1000), f[2]];
    const fb = [fw[0], fw[1], Math.floor(f[2] / 10) * 10 + 3];
    let u = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      let ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) continue;
      // outward normal = right of travel for CCW rings
      const nx = (sign * (bz - az)) / len, nz = (-sign * (bx - ax)) / len;
      if (sign < 0) [ax, az, bx, bz] = [bx, bz, ax, az]; // walk so that the outside is on the right
      const top = y1 + parapet;
      const e = { ax, az, bx, bz, nx, nz, len, mx: (ax + bx) / 2, mz: (az + bz) / 2, u0: u };
      e.blank = f[2] % 10 === 1 && blank ? blank(e) : false;
      // seen from outside: B on the left, A on the right
      quad([bx, y0, bz], [ax, y0, az], [ax, top, az], [bx, top, bz], color, [u + len, y0 - base, u, y0 - base, u, top - base, u + len, top - base], e.blank ? fb : fw);
      if (parapet > 0) quad([ax, y1, az], [bx, y1, bz], [bx, top, bz], [ax, top, az], color, null, [0, 0, Math.floor(f[2] / 10) * 10]); // inner face
      edges.push(e);
      u += len;
    }
    return edges;
  }
  function roof(ring, y, color, f = NOFAC) {
    const pts = [];
    for (let i = 0; i < ring.length; i += 2) pts.push(new THREE.Vector2(ring[i], ring[i + 1]));
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(pts, [])) triUp([pts[i].x, y, pts[i].y], [pts[j].x, y, pts[j].y], [pts[k].x, y, pts[k].y], color, f);
  }
  // Ring scaled toward its centroid; null if any point would fall outside the original (concave footprints)
  function inset(ring, k, cx, cz) {
    const out = [];
    for (let i = 0; i < ring.length; i += 2) {
      const x = cx + (ring[i] - cx) * k, z = cz + (ring[i + 1] - cz) * k;
      if (k < 1 && !pointInPoly(x, z, ring)) return null;
      out.push(x, z);
    }
    return out;
  }
  const at = (e, t, out = 0) => [e.ax + (e.bx - e.ax) * t + e.nx * out, e.az + (e.bz - e.az) * t + e.nz * out];
  const yawOf = (e) => Math.atan2(e.bz - e.az, e.bx - e.ax);

  // --- feature builders ----------------------------------------------------------------------------------------------
  // Sunshade band at every floor line (on the shader's window grid, measured from base)
  function bands(edges, base, yStart, y1, floorH, depth, color, f) {
    for (const e of edges) {
      if (e.len < 3) continue;
      const yaw = yawOf(e);
      for (let y = base + Math.ceil((yStart - base + 0.5) / floorH) * floorH; y < y1 - 0.5; y += floorH)
        box(e.mx + (e.nx * depth) / 2, e.mz + (e.nz * depth) / 2, y - 0.12, e.len + depth * 2, depth, 0.24, color, yaw, f);
    }
  }
  // Vertical fins on the window-cell boundaries (pitch = the style's cell width), full height
  function fins(edges, y0, y1, depth, color, pitch, f) {
    for (const e of edges) {
      if (e.len < 4) continue;
      const yaw = yawOf(e);
      for (let j = Math.ceil((e.u0 + 0.3) / pitch); j * pitch < e.u0 + e.len - 0.3; j++) {
        const [x, z] = at(e, (j * pitch - e.u0) / e.len, depth / 2);
        box(x, z, y0, 0.16, depth, y1 - y0, color, yaw, f);
      }
    }
  }
  // Window air-conditioners hung under the sills, on the shader's window grid
  function acUnits(edges, base, wallTop, style, r, prob) {
    const C = CELL[style];
    if (!C || acCount > 9000) return;
    const [cw, ch, , ly] = C;
    const nF = Math.floor((wallTop + 0.3) / ch);
    for (const e of edges) {
      if (e.len < cw || e.blank) continue;
      const yaw = yawOf(e);
      for (let i = Math.ceil(e.u0 / cw); (i + 1) * cw <= e.u0 + e.len; i++) {
        for (let k = 1; k < nF; k++) {
          if (r() > prob) continue;
          const [x, z] = at(e, ((i + 0.5 + (r() - 0.5) * 0.3) * cw - e.u0) / e.len, 0.27);
          const y = base + k * ch + ly * ch - 0.66;
          box(x, z, y, 0.74, 0.52, 0.48, r() < 0.8 ? acCol : acDark, yaw);
          acCount++;
        }
      }
    }
  }
  // Colonial verandah: lean-to tin roof on posts over the pavement, painted shop name on the fascia
  function verandah(e, y0, r, tin, post) {
    const depth = 2.8, h = 3.7, yaw = yawOf(e);
    const ox = e.nx * depth, oz = e.nz * depth;
    const tx = (e.bx - e.ax) / e.len, tz = (e.bz - e.az) / e.len;
    const a0 = [e.ax - tx * 0.2, y0 + h + 0.5, e.az - tz * 0.2], b0 = [e.bx + tx * 0.2, y0 + h + 0.5, e.bz + tz * 0.2];
    const a1 = [a0[0] + ox, y0 + h, a0[2] + oz], b1 = [b0[0] + ox, y0 + h, b0[2] + oz];
    quad(a0, b0, b1, a1, tin, null, mf(MAT.tin)); // tin roof, sloping outward
    quad(b0, a0, a1, b1, tin.clone().multiplyScalar(0.55), null, NOFAC); // soffit
    const n = Math.max(2, Math.round(e.len / 3.2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      box(e.ax + (e.bx - e.ax) * t + ox - e.nx * 0.1, e.az + (e.bz - e.az) * t + oz - e.nz * 0.1, y0, 0.14, 0.14, h, post, yaw);
    }
    // fascia board, with a hand-painted firm name on most
    box(e.mx + ox, e.mz + oz, y0 + h - 0.5, e.len + 0.4, 0.06, 0.62, post, yaw);
    if (r() < 0.7 && e.len > 5) {
      const w = Math.min(e.len * 0.75, 4.6);
      signs.painted(e.mx + ox + e.nx * 0.035, y0 + h - 0.47, e.mz + oz + e.nz * 0.035, e.nx, e.nz, w, Math.min(0.56, w / 8), r);
    }
  }
  // Modern cantilevered concrete canopy with a fascia upstand carrying shop signs
  function canopy(e, y0, r, concrete) {
    const depth = 2.6, h = 3.9, yaw = yawOf(e);
    box(e.mx + (e.nx * depth) / 2, e.mz + (e.nz * depth) / 2, y0 + h, e.len, depth, 0.28, concrete, yaw, mf(MAT.concrete));
    box(e.mx + e.nx * (depth + 0.03), e.mz + e.nz * (depth + 0.03), y0 + h - 0.14, e.len, 0.06, 0.8, concrete, yaw, mf(MAT.concrete));
    shopSigns(e, y0 + h - 0.06, depth + 0.065, r, 0.85);
  }
  // A run of shop signs along a wall line (offset `out` from the wall), 4–6 m each with gaps
  function shopSigns(e, y, out, r, p) {
    let t = 0.3 + r() * 1.2;
    while (t < e.len - 4.2) {
      const w = 4.2 + r() * 1.4;
      if (t + w > e.len - 0.2) break;
      if (r() < p) {
        const [x, z] = at(e, (t + w / 2) / e.len, out);
        signs.fascia(x, y, z, e.nx, e.nz, w, 0.62, r);
      }
      t += w + 0.3 + r() * 1.2;
    }
  }
  function tanks(cx, cz, y, n, spread, ring, r) {
    for (let i = 0; i < n; i++) {
      const x = cx + (r() - 0.5) * spread, z = cz + (r() - 0.5) * spread;
      if (!pointInPoly(x, z, ring)) continue;
      const col = c2.set(r() < 0.6 ? '#1d1f1e' : r() < 0.5 ? '#2e5a3a' : '#d8d4c8');
      box(x, z, y, 1.8, 1.8, 1.2, c3.set('#5a5a58')); // stand
      stamp(UNIT_CYL, x, y + 2.1, z, 0.85, 1.8, 0.85, 0, col);
    }
  }
  // Backlit rooftop billboard on a steel frame, facing the street
  function roofSign(e, y, r) {
    const yaw = yawOf(e);
    const w = Math.min(e.len * 0.75, 11 + r() * 5), h = (w * 192) / 512;
    const x = e.mx - e.nx * 2, z = e.mz - e.nz * 2;
    const steel = c3.set('#3a3a3a');
    for (const s of [-0.4, 0, 0.4]) {
      const t = s * w;
      box(x + Math.cos(yaw) * t - e.nx * 0.6, z + Math.sin(yaw) * t - e.nz * 0.6, y, 0.22, 0.22, 2.4 + h * 0.7, steel, yaw);
      box(x + Math.cos(yaw) * t - e.nx * 1.4, z + Math.sin(yaw) * t - e.nz * 1.4, y, 0.16, 0.16, 2.4 + h * 0.4, steel, yaw);
    }
    box(x - e.nx * 0.15, z - e.nz * 0.15, y + 2.4, w + 0.3, 0.3, h + 0.3, c2.set('#4a4a48'), yaw); // backing frame
    box(x + e.nx * 0.5, z + e.nz * 0.5, y + 2.25, w + 0.4, 0.9, 0.08, steel, yaw); // catwalk
    for (const s of [-0.3, 0, 0.3]) box(x + Math.cos(yaw) * s * w + e.nx * 0.9, z + Math.sin(yaw) * s * w + e.nz * 0.9, y + 2.3, 0.12, 0.12, 0.5, steel, yaw); // lamp posts
    signs.billboard(x + e.nx * 0.02, y + 2.55, z + e.nz * 0.02, e.nx, e.nz, w, h, r);
  }

  // Hipped tin roof with a ridge along the long axis and 0.6 m eaves, over the footprint's oriented box.
  // Returns false for footprints that fill their box poorly (L-shapes), which get a flat roof instead.
  function hipRoof(ring, top, color, r, f) {
    const n = ring.length / 2;
    let best = 0, ang = 0, area = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const dx = ring[j * 2] - ring[i * 2], dz = ring[j * 2 + 1] - ring[i * 2 + 1], l = Math.hypot(dx, dz);
      if (l > best) (best = l), (ang = Math.atan2(dz, dx));
      area += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
    }
    const ux = Math.cos(ang), uz = Math.sin(ang), vx = -uz, vz = ux;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const pu = ring[i * 2] * ux + ring[i * 2 + 1] * uz, pv = ring[i * 2] * vx + ring[i * 2 + 1] * vz;
      (u0 = Math.min(u0, pu)), (u1 = Math.max(u1, pu)), (v0 = Math.min(v0, pv)), (v1 = Math.max(v1, pv));
    }
    if (Math.abs(area / 2) / ((u1 - u0) * (v1 - v0)) < 0.78) return false;
    let a = (u1 - u0) / 2 + 0.6, b = (v1 - v0) / 2 + 0.6;
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    let swap = false;
    if (b > a) ([a, b] = [b, a]), (swap = true);
    const H = Math.min(2.8, b * (0.36 + r() * 0.12));
    // P(s, t): s along the long axis, t across it
    const P = (s, t, y) => {
      const [su, sv] = swap ? [t, s] : [s, t];
      const pu = cu + su, pv = cv + sv;
      return [pu * ux + pv * vx, y, pu * uz + pv * vz];
    };
    const e = top - 0.15, rl = a - b;
    const A = P(-a, -b, e), B_ = P(a, -b, e), C = P(a, b, e), D = P(-a, b, e), R0 = P(-rl, 0, top + H), R1 = P(rl, 0, top + H);
    triUp(A, B_, R1, color, f); triUp(A, R1, R0, color, f); // long side
    triUp(C, D, R0, color, f); triUp(C, R0, R1, color, f); // long side
    triUp(B_, C, R1, color, f); triUp(D, A, R0, color, f); // hipped ends
    // fascia under the eaves
    const fas = c3.copy(color).multiplyScalar(0.6);
    for (const [p, q] of [[A, B_], [B_, C], [C, D], [D, A]]) quad([q[0], e - 0.2, q[2]], [p[0], e - 0.2, p[2]], p, q, fas, null, NOFAC), quad(p, q, [q[0], e - 0.2, q[2]], [p[0], e - 0.2, p[2]], fas, null, NOFAC);
    return true;
  }

  // --- typology --------------------------------------------------------------------------------------------------------
  function pickKind(bd, area, cx, cz, core, r) {
    const h = bd.h;
    let w = h < 12 ? [0.65, 0.3, 0.05] : h < 25 ? [0.15, 0.7, 0.15] : h < 60 ? [0, 0.6, 0.4] : [0, 0.25, 0.75];
    const d = Math.hypot(cx, cz);
    if (d < 500 && h >= 10) w[0] *= 0.5;
    if (cx < -350) w[0] *= 1.5; // the older Kopje end of town
    if (area < 300) (w[0] *= 1.5), (w[2] *= 0.5);
    const t = r() * (w[0] + w[1] + w[2]);
    return t < w[0] ? 'colonial' : t < w[0] + w[1] ? 'modern' : 'post';
  }
  // Satellite dishes point at the equatorial arc, north-east of Harare
  const DISH_YAW = Math.atan2(0.62, -0.78);
  const neEdge = (edges) => edges.reduce((a, b) => (b.len > 3 && b.nx * 0.62 - b.nz * 0.78 > (a ? a.nx * 0.62 - a.nz * 0.78 : -9) ? b : a), null);

  DATA.buildings.forEach((bd, idx) => {
    const ring = bd.p;
    const n = ring.length / 2;
    const [cx, cz] = polyCentroid(ring);
    const r = rng(Math.floor(cx * 13.7 + cz * 7.3) + idx * 31);
    const core = coreWeight(cx, cz);
    const bounds = polyBounds(ring);
    const area = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]);
    const lm = bd.n ? LANDMARKS.find((l) => l.re.test(bd.n)) : null;
    const isHouse = !lm && (/^(house|detached|residential|bungalow|garage|shed|hut)$/.test(bd.k || '') || (core < 0.15 && bd.h < 8 && area < 600));

    let base = Infinity;
    for (let i = 0; i < n; i++) base = Math.min(base, groundY(ring[i * 2], ring[i * 2 + 1]));
    const y0 = base - 0.3 + (bd.m || 0);
    const top = base + bd.h;
    const seed = 1 + Math.floor(r() * 97);

    if (isHouse) {
      // Suburban house: rendered or face-brick walls, tin roof (hipped when small and simple), burglar bars
      const brick = r() < 0.3;
      if (brick) c.set(PALETTE.brick[Math.floor(r() * PALETTE.brick.length)]);
      else c.set(PALETTE.house[Math.floor(r() * PALETTE.house.length)]).multiplyScalar(0.92 + r() * 0.1);
      const edges = walls(ring, y0, top, base, c, [3, seed, 1 + 10 * (brick ? MAT.brick : MAT.render)]);
      const tin = c2.set(PALETTE.tin[Math.floor(r() * PALETTE.tin.length)]);
      if (!hipRoof(ring, top, tin, r, mf(MAT.tin))) roof(ring, top, tin, mf(MAT.tin));
      if (r() < 0.35) {
        const e = neEdge(edges);
        if (e) {
          const [x, z] = at(e, 0.15 + r() * 0.7, 0.35);
          spots.dishes.push({ x, y: top - 0.6, z, yaw: DISH_YAW, s: 0.8 });
        }
      }
    } else {
      const kind = lm?.kind || pickKind(bd, area, cx, cz, core, r);
      let style, wall, mat;
      if (kind === 'colonial') {
        style = 0;
        mat = r() < 0.22 ? MAT.brick : MAT.render;
        wall = mat === MAT.brick ? PALETTE.brick[Math.floor(r() * 5)] : PALETTE.colonial[Math.floor(r() * PALETTE.colonial.length)];
      } else if (kind === 'modern') {
        style = r() < 0.35 ? 5 : 1;
        const t = r();
        if (t < 0.05) (mat = MAT.mosaic), (wall = PALETTE.mosaic[Math.floor(r() * PALETTE.mosaic.length)]);
        else if (t < 0.42) (mat = MAT.brick), (wall = PALETTE.brick[Math.floor(r() * PALETTE.brick.length)]);
        else (mat = t < 0.55 ? MAT.concrete : t < 0.68 ? MAT.precast : MAT.render), (wall = PALETTE.modern[Math.floor(r() * PALETTE.modern.length)]);
      } else {
        style = r() < 0.55 ? 2 : 6;
        if (style === 2) (mat = MAT.glass), (wall = ['#5e6a74', '#4f6f86', '#5c7068', '#6a737a', '#7a6a58', '#58646e'][Math.floor(r() * 6)]);
        else (mat = r() < 0.55 ? MAT.granite : MAT.precast), (wall = PALETTE.granite[Math.floor(r() * PALETTE.granite.length)]);
      }
      if (lm) (style = lm.style), (wall = lm.wall), (mat = lm.mat);
      c.set(wall).multiplyScalar(0.94 + r() * 0.1);
      const shop = core > 0.15 ? 1 : 0;
      const f = [style + shop * 0.25, seed, 1 + 10 * mat];
      const floorH = FLOOR[style];
      const parapet = kind === 'colonial' ? 1.1 : 0.8;
      const ROOFS = ['#7d7b77', '#9a968e', '#8a8680', '#a9a49b', '#6e6c68', '#8f8a7f'];
      const roofTin = kind === 'colonial';
      const roofCol = c3.set(roofTin ? PALETTE.tin[Math.floor(r() * PALETTE.tin.length)] : ROOFS[Math.floor(r() * ROOFS.length)]).multiplyScalar(0.88 + r() * 0.2).clone();
      const roofF = mf(roofTin ? MAT.tin : MAT.roof);
      const solidMat = mat === MAT.glass ? MAT.precast : mat;
      // Blank flanks: party walls and back walls away from the street get no windows
      const pBlank = kind === 'colonial' ? 0.7 : style === 2 ? 0 : 0.4;
      // infill plots abut their neighbours: any wall not on the street is a windowless party wall
      const blank = (e) => e.len > 4 && streetGap(e.mx + e.nx, e.mz + e.nz) > (bd.k === 'infill' ? 5 : 9) && (bd.k === 'infill' || r() < pBlank);

      // Massing: podium + tower for big modern/post plots, setback crown for post towers
      let edges, podEdges = null;
      const tower = (kind !== 'colonial' && area > 1800 && bd.h > 25) || lm?.podium ? inset(ring, 0.74, cx, cz) : null;
      const podTop = base + (lm?.podium || 3) * 4.2;
      if (tower) {
        podEdges = walls(ring, y0, podTop, base, c2.copy(c).multiplyScalar(0.92), [style === 2 ? 6 : style, seed, 1 + 10 * solidMat], 0.9, blank);
        roof(ring, podTop, roofCol, roofF);
        for (const e of podEdges) if (shop && e.len > 6 && streetGap(e.mx + e.nx, e.mz + e.nz) < 6) canopy(e, base, r, c3.set('#cfc9bd'));
        edges = walls(tower, podTop, top, base, c, f, parapet);
        roof(tower, top, roofCol, roofF);
      } else {
        edges = walls(ring, y0, top, base, c, f, parapet, blank);
        roof(ring, top, roofCol, roofF);
      }
      const outline = tower || ring;

      // Crowns
      if (lm?.crown === 'cone') {
        // Stepped drum and cone: the RBZ's nod to the conical tower at Great Zimbabwe
        let k = 1, y = top;
        for (let i = 0; i < 4; i++) {
          k *= 0.82;
          const rr = inset(outline, k, cx, cz);
          if (!rr) break;
          walls(rr, y, y + 4, base, c, f);
          roof(rr, y + 4, roofCol, roofF);
          y += 4;
        }
        const rad = Math.sqrt(area) * k * 0.35;
        stamp(UNIT_CONE, cx, y + rad * 0.9, cz, rad, rad * 1.8, rad, 0, c, mf(mat));
      } else if (lm?.crown === 'step' || (kind === 'post' && r() < 0.5)) {
        const rr = inset(outline, 0.82, cx, cz);
        if (rr) {
          walls(rr, top, top + floorH * 2, base, c, f, 0.6);
          roof(rr, top + floorH * 2, roofCol, roofF);
        }
      }

      // Facade relief: concrete bands and fins (pale concrete against face brick)
      if (kind === 'modern' && bd.h > 7) {
        const brick = mat === MAT.brick;
        const relief = brick ? c2.set('#cfc9bd').multiplyScalar(0.95 + r() * 0.08) : c2.copy(c).multiplyScalar(1.04);
        const rf = mf(brick || mat === MAT.mosaic ? MAT.concrete : mat);
        const yStart = tower ? podTop : base;
        if (style === 5) fins(edges, yStart, top, lm?.finDepth || 0.7, relief, CELL[5][0], rf);
        if (style === 1 || lm?.bands || (style === 5 && r() < 0.3)) bands(edges, base, yStart, top, floorH, lm?.bandDepth || 0.75, relief, rf);
      }
      // Air-conditioners on older office blocks and colonial upper floors
      if (style !== 2 && core > 0.05) acUnits(edges, base, top - base, style, r, kind === 'post' ? 0.03 : 0.07);

      // Street level: verandahs (colonial), canopies (modern), signs over shopfronts
      if (!tower)
        for (const e of edges) {
          if (e.len < 5 || streetGap(e.mx + e.nx, e.mz + e.nz) > 6) continue;
          if (kind === 'colonial' && (lm?.verandah || r() < 0.85))
            verandah(e, base, r, c2.set(PALETTE.verandah[Math.floor(r() * PALETTE.verandah.length)]), c3.set(PALETTE.colonialTrim[Math.floor(r() * PALETTE.colonialTrim.length)]));
          else if (kind === 'modern' && shop && r() < 0.65) canopy(e, base, r, c2.copy(c).multiplyScalar(0.95));
          else if (shop && !lm && e.len > 6) shopSigns(e, base + 3.5, 0.05, r, 0.6);
        }

      // Colonial pediment / name panel on the longest street wall
      if (kind === 'colonial' && bd.h < 16) {
        const e = edges.reduce((a, b) => (b.len > a.len ? b : a), edges[0]);
        if (e && e.len > 8) {
          const yaw = yawOf(e);
          const trim = c2.set(PALETTE.colonialTrim[Math.floor(r() * PALETTE.colonialTrim.length)]);
          box(e.mx + e.nx * 0.05, e.mz + e.nz * 0.05, top + parapet, Math.min(8, e.len * 0.35), 0.35, 1.4, c, yaw, mf(mat));
          box(e.mx + e.nx * 0.12, e.mz + e.nz * 0.12, top + parapet * 0.2, e.len, 0.25, 0.25, trim, yaw); // cornice
        }
        // Faded painted advert on a blank flank
        const flank = edges.find((e) => e.blank && e.len > 6);
        if (flank && bd.h > 5.5 && r() < 0.32) {
          const h = Math.min(bd.h - 1.6, flank.len * 0.35, 5), w = h * 2;
          const [x, z] = at(flank, 0.5, 0.03);
          signs.wallAd(x, base + Math.max(1.2, (bd.h - h) * 0.55), z, flank.nx, flank.nz, w, h, r);
        }
      }

      // Rooftops: lift motor rooms, water tanks, dishes, billboards
      if (area > 250) {
        const k = kind === 'colonial' ? 0 : 1 + Math.floor(r() * 2);
        for (let q = 0; q < k; q++) {
          const x = cx + (r() - 0.5) * (bounds[2] - bounds[0]) * 0.3, z = cz + (r() - 0.5) * (bounds[3] - bounds[1]) * 0.3;
          if (pointInPoly(x, z, outline)) box(x, z, top, 3 + r() * 4, 3 + r() * 4, 2.5 + r() * 2.5, c2.copy(c).multiplyScalar(0.9), 0, mf(solidMat === MAT.mosaic ? MAT.render : solidMat));
        }
        tanks(cx, cz, top, 1 + Math.floor(r() * 4), Math.sqrt(area) * 0.4, outline, r);
        if (kind !== 'colonial' && r() < 0.35)
          for (let q = 1 + Math.floor(r() * 3); q > 0; q--) {
            const x = cx + (r() - 0.5) * (bounds[2] - bounds[0]) * 0.6, z = cz + (r() - 0.5) * (bounds[3] - bounds[1]) * 0.6;
            if (pointInPoly(x, z, outline)) spots.dishes.push({ x, y: top, z, yaw: DISH_YAW, s: 1 + r() * 0.8, roof: true });
          }
      }
      if (kind === 'colonial' && bd.h > 7 && r() < 0.18) {
        const e = neEdge(edges);
        if (e) {
          const [x, z] = at(e, 0.2 + r() * 0.6, 0.35);
          spots.dishes.push({ x, y: base + 4.2 + 1.2, z, yaw: DISH_YAW, s: 0.75 });
        }
      }
      const longest = edges.reduce((a, b) => (b.len > a.len ? b : a), edges[0]);
      if (bd.h > 28 && !lm && r() < 0.3 && edges.length) roofSign(longest, top, r);
      else if (kind === 'post' && bd.h > 30 && !lm && longest && longest.len > 12 && r() < 0.6) {
        // Company name lit up near the top of the tower
        const w = Math.min(longest.len * 0.6, 20), [x, z] = at(longest, 0.5, 0.06);
        signs.crown(x, top - w / 8 - 0.8, z, longest.nx, longest.nz, w, w / 8, r);
      }
      // Guard hut at the gate of big CBD blocks
      if (core > 0.3 && kind !== 'colonial' && area > 1500 && r() < 0.5) {
        const e = (podEdges || edges).find((e) => e.len > 12 && streetGap(e.mx + e.nx, e.mz + e.nz) < 6);
        if (e) {
          const [x, z] = at(e, r() < 0.5 ? 0.08 : 0.92, 1.1);
          spots.huts.push({ x, z, yaw: Math.atan2(e.nx, e.nz) });
        }
      }

      // Landmark extras
      if (lm?.spire) {
        box(cx, cz, top, 7, 7, 5, c);
        stamp(UNIT_CYL, cx, top + 5 + lm.spire / 2, cz, 0.45, lm.spire, 0.45, 0, c2.set('#d0d4d8'));
      }
      if (lm?.clock) {
        // Town House clock tower with a little pyramid roof
        box(cx, cz, top, 5, 5, 12, c, 0, mf(MAT.render));
        box(cx, cz, top + 8.5, 5.2, 5.2, 2.2, c2.set('#f6f3ea'), 0, [4, 3, 2]);
        stamp(UNIT_CONE, cx, top + 14, cz, 3.8, 4, 3.8, Math.PI / 4, c2.set('#7a3a2a'), mf(MAT.tin));
      }
      if (lm?.chimneys) {
        // Eastgate's brick ventilation stacks in rows along the roof
        const e = edges.reduce((a, b) => (b.len > a.len ? b : a), edges[0]);
        const ang = Math.atan2(e.bz - e.az, e.bx - e.ax), ca = Math.cos(ang), sa = Math.sin(ang);
        for (let a = -130; a <= 130; a += 7)
          for (const b of [-10, -3.5, 3.5, 10]) {
            const x = cx + a * ca - b * sa, z = cz + a * sa + b * ca;
            if (pointInPoly(x, z, ring)) box(x, z, top, 1.8, 1.8, 7, c2.set('#8a4a33'), ang, mf(MAT.brick));
          }
      }
    }

    footprints.push({ p: ring, h: top, bounds });
    grid.insert(footprints.length - 1, ...bounds);
    if (bd.n && lm && !labels.some((l) => lm.re.test(l.n))) labels.push({ n: bd.n, x: cx, y: top + 8, z: cz });
  });

  const geo = B.geometry();
  console.log(`[harare] buildings: ${(B.n / 1e6).toFixed(2)}M vertices, ${acCount} air-cons`);
  const { texture: matTex, means } = buildingMaterials(renderer);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0 });
  const uniforms = { uNight: { value: 0 }, uTime: { value: 0 }, uMatTex: { value: matTex }, uMatMean: { value: means } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aFac;\nattribute vec2 aWall;\nvarying vec3 vFac;\nvarying vec2 vWall;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFac = aFac;\nvWall = aWall;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_COMMON)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_FACADE)
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        if (matRough > 0.0) roughnessFactor = matRough;
        roughnessFactor = mix(roughnessFactor, glassRough, glassMask);`
      )
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(matMetal, glassMetal, glassMask);')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectSpecular *= 1.0 + glassMask * mix(1.6, 0.4, glassMetal);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nif (useNW) normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += roomEmit;
        totalEmissiveRadiance += signGlow * uNight * diffuseColor.rgb * 2.2;`
      );
  };
  mat.customProgramCacheKey = () => 'harare-buildings-v2';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.onBeforeRender = () => (uniforms.uTime.value = performance.now() / 1000);
  scene.add(mesh);
  const signMesh = signs.build(scene);

  // Is (x, z) inside a building taller than y?
  function blocked(x, z, y = 0) {
    for (const i of grid.query(x, z)) {
      const fp = footprints[i];
      const b = fp.bounds;
      if (x < b[0] || x > b[2] || z < b[1] || z > b[3] || y > fp.h) continue;
      if (pointInPoly(x, z, fp.p)) return true;
    }
    return false;
  }

  return {
    mesh,
    blocked,
    labels,
    spots,
    signs: signMesh.mesh,
    setNight: (v) => {
      uniforms.uNight.value = v;
      signMesh.setNight(v);
    },
  };
}

// --- shaders --------------------------------------------------------------------------------------------------------
const L = LAYER_SCALE.slice(0, 8).map(([x, y]) => `vec2(${x.toFixed(3)}, ${y.toFixed(3)})`).join(', ');
const FRAG_COMMON = /* glsl */ `
precision highp sampler2DArray;
uniform float uNight;
uniform float uTime;
uniform sampler2DArray uMatTex;
uniform vec3 uMatMean[9];
varying vec3 vFac;
varying vec2 vWall;
varying vec3 vWPos;
varying vec3 vWNrm;
// per material layer: tile size (m), bump depth (m), roughness, metalness
const vec2 MSC[8] = vec2[8](${L});
const float MBUMP[8] = float[8](0.02, 0.012, 0.008, 0.004, 0.003, 0.03, 0.008, 0.008);
const float MROUGH[8] = float[8](0.92, 0.88, 0.85, 0.42, 0.32, 0.42, 0.93, 0.9);
const float MSTR[8] = float[8](0.55, 1.0, 0.6, 0.85, 0.9, 0.8, 0.75, 0.5);
const float MMETAL[8] = float[8](0.0, 0.0, 0.0, 0.0, 0.0, 0.35, 0.0, 0.0);
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + 1.0), f.x), f.y);
}
float signGlow = 0.0;
float glassMask = 0.0;
float glassRough = 0.05;
float glassMetal = 0.0;
float matRough = -1.0;
float matMetal = 0.0;
vec3 roomEmit = vec3(0.0);
vec3 nW = vec3(0.0, 1.0, 0.0);
bool useNW = false;
float bar(float x, float at, float hw, float aa) { return 1.0 - smoothstep(hw - aa, hw + aa, abs(x - at)); }

// Parallax room behind a window: ray from the glass point o (room frame: x across, y up from the room floor,
// z into the room) along d, against a box roomW × roomH × depth. Returns radiance (emissive).
vec3 interior(vec3 o, vec3 d, vec2 rid, float roomW, float roomH, float depth, float kind, float seed, float day, float night,
              vec2 winId, vec2 cu, out float glassDark) {
  float r1 = h21(rid + seed), r2 = h21(rid * 1.37 + seed * 0.71 + 3.1), r3 = h21(rid * 0.73 + seed * 1.9 + 9.4);
  bool home = kind > 0.5 && kind < 1.5, shop = kind > 1.5;
  float sx = d.x >= 0.0 ? max(d.x, 1e-4) : min(d.x, -1e-4);
  float sy = d.y >= 0.0 ? max(d.y, 1e-4) : min(d.y, -1e-4);
  float tX = ((sx > 0.0 ? 0.5 : -0.5) * roomW - o.x) / sx;
  float tY = ((sy > 0.0 ? roomH : 0.0) - o.y) / sy;
  float tZ = depth / d.z;
  float t = min(tZ, min(tX, tY));
  vec3 p = o + d * t;
  vec3 q = vec3(p.x / roomW + 0.5, p.y / roomH, p.z / depth);
  bool onBack = tZ <= min(tX, tY);
  bool onY = !onBack && tY <= tX;
  bool onCeil = onY && sy > 0.0, onFloor = onY && sy < 0.0;

  // lighting: who's in, which lamp
  float pN = shop ? 0.9 : home ? 0.55 : 0.22;
  float pD = shop ? 1.0 : home ? 0.04 : 0.55;
  float rl = h21(rid * 2.11 + seed * 0.37);
  float lit = mix(step(1.0 - pD, rl), step(1.0 - pN, rl), night);
  vec3 warmC = mix(vec3(1.0, 0.62, 0.3), vec3(1.0, 0.78, 0.5), r1);
  vec3 coolC = mix(vec3(0.82, 0.92, 1.0), vec3(0.88, 1.0, 0.86), r2);
  vec3 lampC = home ? (r2 < 0.75 ? warmC : coolC) : (r1 < 0.35 ? mix(warmC, vec3(1.0, 0.9, 0.75), 0.5) : coolC);
  if (home && r2 > 0.86) lampC = vec3(0.45, 0.6, 1.0) * (0.75 + 0.25 * sin(uTime * 7.0 + r1 * 40.0) * sin(uTime * 2.3 + r3 * 9.0)); // telly

  // shell albedo
  vec3 wallC = home ? (r1 < 0.2 ? vec3(0.85, 0.6, 0.45) : r1 < 0.4 ? vec3(0.6, 0.78, 0.64) : r1 < 0.6 ? vec3(0.62, 0.7, 0.84) : r1 < 0.8 ? vec3(0.88, 0.8, 0.62) : vec3(0.84, 0.62, 0.64))
                    : shop ? vec3(0.9, 0.9, 0.88) : (r1 < 0.5 ? vec3(0.7, 0.65, 0.52) : r1 < 0.75 ? vec3(0.55, 0.62, 0.52) : vec3(0.66, 0.66, 0.64));
  vec3 col;
  if (onFloor) {
    vec2 fq = p.xz;
    if (home) col = r3 < 0.55 ? vec3(0.42, 0.07, 0.05) * (0.9 + 0.2 * step(0.5, fract(fq.x * 0.5))) // red polished floor
                              : vec3(0.36, 0.2, 0.1) * (0.85 + 0.3 * h21(floor(fq * vec2(1.0, 6.0))));
    else if (shop) col = vec3(0.82, 0.8, 0.76) * (0.9 + 0.1 * step(0.08, fract(fq.x / 0.6)) * step(0.08, fract(fq.y / 0.6)));
    else col = r3 < 0.5 ? vec3(0.2, 0.22, 0.27) : vec3(0.5, 0.48, 0.44) * (0.92 + 0.16 * h21(floor(fq * 3.0)));
  } else if (onCeil) {
    col = vec3(0.85, 0.85, 0.83);
    if (!home) col *= 0.9 + 0.1 * step(0.03, fract(p.x / 0.6)) * step(0.03, fract(p.z / 0.6)); // ceiling tiles
  } else {
    col = wallC * (1.0 - 0.45 * smoothstep(0.1, 0.0, p.y)); // skirting
    if (onBack) {
      float dx = mix(-0.3, 0.3, r2) * roomW;
      if (!shop && abs(p.x - dx) < 0.45 && p.y < 2.05) col = home ? vec3(0.35, 0.22, 0.12) : vec3(0.42, 0.42, 0.4); // door
      float px = mix(0.3, -0.3, r2) * roomW;
      if (home && abs(p.x - px) < 0.35 && abs(p.y - 1.6) < 0.25) col = mix(vec3(0.15, 0.25, 0.4), vec3(0.6, 0.35, 0.2), r3); // picture
      if (!home && !shop && abs(p.x - px) < 0.5 && p.y < 1.3) col = vec3(0.35, 0.37, 0.38) * (0.85 + 0.15 * step(0.1, fract(p.y / 0.42))); // filing cabinet
    }
  }
  // shop shelving on the side and back walls, with packed colourful stock
  float shopT = h21(rid * 3.7 + seed * 0.13);
  vec3 screens = vec3(0.0);
  if (shop && !onY && p.y < 2.3 && p.y > 0.2) {
    float along = onBack ? p.x : p.z;
    float shelf = floor(p.y / 0.42);
    float item = floor(along / 0.22);
    vec3 rnd = vec3(h21(vec2(item, shelf) + rid), h21(vec2(item, shelf + 9.0)), h21(vec2(shelf, item + 3.0)));
    float sy = fract(p.y / 0.42);
    if (shopT < 0.45) {
      // general dealer: packed tins, packets and bottles
      vec3 stock = 0.06 + 0.6 * rnd * rnd;
      col = sy < 0.1 ? vec3(0.55) : stock * (0.6 + 0.4 * step(0.3, fract(along / 0.22))) * (sy > 0.8 ? 0.45 : 1.0);
    } else if (shopT < 0.72) {
      // clothing: garments on rails, folded stock on the back wall
      float g = floor(along / 0.07);
      vec3 cloth = 0.08 + 0.55 * vec3(h21(vec2(g, 1.0) + rid), h21(vec2(g, 2.0) + rid), h21(vec2(g, 3.0) + rid));
      if (!onBack && p.y > 0.85 && p.y < 1.95) col = cloth * (0.75 + 0.25 * step(0.15, fract(along / 0.07)));
      else if (onBack && p.y > 0.9 && p.y < 2.1) col = sy < 0.12 ? vec3(0.5) : (0.1 + 0.5 * rnd);
    } else if (shopT < 0.86) {
      // phones and electronics: dark display walls with lit screens
      col = vec3(0.12, 0.12, 0.13);
      vec2 sc = vec2(fract(along / 0.5), fract(p.y / 0.45));
      if (p.y > 0.9 && sc.x > 0.12 && sc.x < 0.88 && sc.y > 0.15 && sc.y < 0.85) screens = mix(vec3(0.2, 0.45, 0.9), vec3(0.9, 0.5, 0.2), rnd.x) * 0.9;
    } else {
      // hardware: paint tins, pipes and sacks in workmanlike colours
      vec3 hw = rnd.x < 0.3 ? vec3(0.5, 0.48, 0.45) : rnd.x < 0.5 ? vec3(0.55, 0.3, 0.12) : rnd.x < 0.7 ? vec3(0.15, 0.25, 0.45) : vec3(0.6, 0.55, 0.4);
      col = sy < 0.1 ? vec3(0.35, 0.25, 0.18) : hw * (0.7 + 0.3 * rnd.y) * (sy > 0.75 ? 0.5 : 1.0);
    }
  }
  // furniture: a desk / sofa / counter card facing the window
  float zf = shop ? 1.6 : mix(1.2, min(2.8, depth - 0.6), r2);
  float tf = zf / d.z;
  vec3 pf = o + d * tf;
  float fx = shop ? -0.25 * roomW : (r1 - 0.5) * roomW * 0.5;
  float fhw = shop ? 0.25 * roomW : mix(0.55, 1.0, r3);
  float fh = shop ? 1.0 : home ? 0.85 : 0.75;
  bool furn = tf < t && abs(pf.x - fx) < fhw && pf.y < fh + (home || shop ? 0.0 : 0.42);
  bool monitor = false;
  if (furn && !home && !shop && pf.y > fh) { furn = abs(pf.x - fx) < 0.24 && pf.y < fh + 0.38; monitor = furn; }
  if (furn) {
    p = pf; q = vec3(p.x / roomW + 0.5, p.y / roomH, p.z / depth);
    col = monitor ? vec3(0.03) : home ? mix(vec3(0.3, 0.12, 0.08), vec3(0.15, 0.2, 0.28), r3) : shop ? vec3(0.55, 0.12, 0.1) : vec3(0.28, 0.18, 0.1);
    col *= 1.0 - 0.4 * smoothstep(fh - 0.05, 0.0, p.y);
  }
  // soft corner occlusion and daylight falling off away from the window
  vec3 aq = clamp(q, 0.0, 1.0);
  float ao = mix(0.6, 1.0, smoothstep(0.0, 0.12, min(min(aq.x, 1.0 - aq.x), min(aq.y, 1.0 - aq.y))));
  vec3 dayL = vec3(0.92, 0.96, 1.0) * day * mix(0.34, 0.05, sqrt(aq.z)) * (onFloor ? 1.25 : 1.0);
  float lampTerm;
  vec3 fixture = vec3(0.0);
  if (home) {
    vec3 lp = vec3(0.0, roomH - 0.25, depth * 0.5);
    float dl = length(p - lp);
    lampTerm = 1.6 / (1.0 + 0.35 * dl * dl);
    if (onCeil && length(p.xz - lp.xz) < 0.16 && !furn) fixture = lampC * 3.0;
  } else {
    lampTerm = 0.95 * (1.0 - 0.25 * aq.z);
    if (onCeil && !furn) {
      float tube = shop ? step(abs(fract(p.x / 1.25) - 0.5), 0.05) : step(abs(fract(p.x / 2.4) - 0.5), 0.12) * step(abs(fract(p.z / 2.4) - 0.5), 0.3);
      fixture = lampC * tube * 1.15;
    }
    if (monitor) fixture = vec3(0.35, 0.5, 0.8) * night * 0.8;
    fixture += screens;
  }
  float lampK = mix(0.3, home ? 0.85 : 0.6, night);
  vec3 rad = col * ao * (dayL + lampC * lampTerm * lit * lampK) + fixture * lit * mix(0.5, 1.0, night);

  // curtains, blinds and nets hung just inside the glass (per window)
  float ch = h21(winId + seed * 2.3 + 5.0), cw1 = h21(winId * 1.9 + seed), cw2 = h21(winId * 0.7 + seed + 2.0);
  glassDark = 0.0;
  if (!shop) {
    vec3 fab = vec3(0.0);
    float cover = 0.0, trans = 0.3;
    if (home ? ch < 0.55 : ch < 0.12) {
      // drapes drawn partway from both sides
      float lw = cw1 * cw1 * 0.5, rw = cw2 * cw2 * 0.5;
      float aa = fwidth(cu.x) + 0.01;
      cover = max(smoothstep(lw + aa, lw - aa, cu.x), smoothstep(1.0 - rw - aa, 1.0 - rw + aa, cu.x));
      float pk = fract(r1 * 5.7 + cw1);
      fab = pk < 0.25 ? vec3(0.78, 0.7, 0.55) : pk < 0.45 ? vec3(0.55, 0.2, 0.15) : pk < 0.65 ? vec3(0.3, 0.42, 0.55) : pk < 0.85 ? vec3(0.5, 0.55, 0.35) : vec3(0.7, 0.5, 0.25);
      fab *= 0.85 + 0.25 * sin(cu.x * 70.0 + cw1 * 6.0);
    } else if (home && ch < 0.75) {
      cover = 0.62; fab = vec3(0.92, 0.92, 0.88); trans = 0.55; // net curtain
    } else if (!home && ch < 0.55) {
      // venetian blinds lowered to a random level, slats tilted open
      float lv = cw1 < 0.3 ? 1.0 : cw1 * 0.9;
      float slat = step(0.22, fract(cu.y * 26.0 + 0.5));
      cover = step(1.0 - lv, cu.y) * mix(1.0, 0.75, 1.0 - slat);
      fab = mix(vec3(0.82, 0.8, 0.74), vec3(0.62, 0.66, 0.7), step(0.5, cw2)) * (0.85 + 0.15 * slat);
      trans = 0.45;
    } else if (!home && ch < 0.7) {
      // vertical blinds, some vanes turned
      float vane = fract(cu.x * 9.0);
      cover = step(cw1 * 0.7, cu.x) * step(0.15 + cw2 * 0.4, vane);
      fab = vec3(0.78, 0.76, 0.7);
      trans = 0.4;
    }
    vec3 fabRad = fab * (dayL * 1.4 + lampC * lit * trans * 0.9);
    rad = mix(rad, fabRad, cover);
  }
  return rad;
}
`;

const FRAG_FACADE = /* glsl */ `
{
  float matC = floor(vFac.z * 0.1 + 0.001);
  float flag = vFac.z - matC * 10.0;
  float style = floor(vFac.x);
  float seed = floor(vFac.y);
  float wallTop = fract(vFac.y) * 1000.0;
  float day = 1.0 - uNight;
  vec3 N = normalize(vWNrm);
  vec3 T = abs(N.y) > 0.98 ? vec3(1.0, 0.0, 0.0) : normalize(vec3(-N.z, 0.0, N.x));
  vec3 Bt = cross(T, N);
  bool facade = (flag > 0.5 && flag < 1.5) || flag > 2.5;
  vec2 wuv = facade ? vWall : vec2(dot(vWPos, T), dot(vWPos, Bt));
  vec3 toFrag = vWPos - cameraPosition;
  float dist = length(toFrag);
  vec3 V = toFrag / dist;
  nW = N;

  // ---- wall / roof material: tinted detail texture + bump
  if (matC > 0.5 && matC < 8.5) {
    int li = int(matC) - 1;
    vec2 sc = MSC[li];
    vec2 tuv = wuv / sc;
    float layer = float(li);
    vec4 tx = texture(uMatTex, vec3(tuv, layer));
    diffuseColor.rgb *= mix(vec3(1.0), tx.rgb / max(uMatMean[li], vec3(0.02)), MSTR[li] * mix(1.0, 0.6, smoothstep(60.0, 400.0, dist)));
    vec2 tpp = fwidth(tuv) * 512.0; // texels per pixel: fade the bump before it aliases
    float bf = (1.0 - smoothstep(25.0, 140.0, dist)) * (1.0 - smoothstep(1.5, 5.0, max(tpp.x, tpp.y)));
    if (bf > 0.0) {
      float e = 1.0 / 512.0;
      float hx = texture(uMatTex, vec3(tuv + vec2(e, 0.0), layer)).a;
      float hy = texture(uMatTex, vec3(tuv + vec2(0.0, e), layer)).a;
      vec2 grad = vec2(hx - tx.a, hy - tx.a) / (e * sc) * MBUMP[li] * bf;
      nW = normalize(N - grad.x * T - grad.y * Bt);
      useNW = true;
    }
    matRough = MROUGH[li];
    matMetal = MMETAL[li];
  }
  // ---- weathering on walls: run-off streaks, dirt under the parapet, red dust splashed up from the ground
  if (abs(N.y) < 0.5 && matC > 0.5 && matC < 9.5) {
    float st = texture(uMatTex, vec3(wuv / vec2(6.0, 9.0) + vec2(seed * 0.37, 0.0), 8.0)).r;
    float wk = matC < 1.5 ? 0.85 : matC < 2.5 ? 0.45 : matC > 8.5 ? 0.25 : 0.75;
    float patchy = smoothstep(0.3, 0.75, vnoise(wuv / vec2(4.0, 6.5) + seed * 1.7));
    diffuseColor.rgb *= mix(1.0, st, wk * patchy);
    diffuseColor.rgb *= 0.93 + 0.14 * vnoise(wuv / 9.0 + seed); // uneven paint and weathering
    if (facade) {
      float splash = (1.0 - smoothstep(0.0, 1.1, vWall.y)) * 0.4;
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.8, 0.6, 0.48), splash);
      if (wallTop > 0.5) diffuseColor.rgb *= 1.0 - 0.18 * smoothstep(wallTop - 2.0, wallTop + 0.6, vWall.y) * wk;
    }
  }

  if (flag > 1.5 && flag < 2.5) {
    signGlow = 1.0; // clock faces and lit panels
  } else if (flag > 0.5 && flag < 1.5 && style != 4.0) {
    bool shopF = fract(vFac.x) > 0.2;
    vec2 cell = vec2(3.4, 3.6); vec2 lo = vec2(0.25); vec2 hi = vec2(0.75, 0.8); float rec = 0.18;
    if (style < 0.5) { cell = vec2(3.6, 4.2); lo = vec2(0.33, 0.22); hi = vec2(0.67, 0.78); rec = 0.26; }       // colonial casement
    else if (style < 1.5) { cell = vec2(3.0, 3.3); lo = vec2(-1.0, 0.36); hi = vec2(2.0, 0.86); rec = 0.1; }  // ribbon
    else if (style < 2.5) { cell = vec2(1.6, 3.6); lo = vec2(0.04, 0.05); hi = vec2(0.96, 0.95); rec = 0.04; } // curtain
    else if (style < 3.5) { cell = vec2(4.2, 3.2); lo = vec2(0.32, 0.3); hi = vec2(0.68, 0.72); rec = 0.16; }  // house
    else if (style > 4.5 && style < 5.5) { cell = vec2(1.5, 3.3); lo = vec2(0.12, 0.2); hi = vec2(0.88, 0.88); rec = 0.12; } // fins
    else if (style > 5.5) { cell = vec2(2.4, 3.6); lo = vec2(0.22, 0.3); hi = vec2(0.78, 0.8); rec = 0.3; }  // precast
    bool isShop = shopF && vWall.y < 4.2;
    float kind = style > 2.5 && style < 3.5 ? 1.0 : 0.0;
    if (isShop) { cell = vec2(5.0, 4.2); lo = vec2(0.03, 0.083); hi = vec2(0.97, 0.81); rec = 0.15; kind = 2.0; }
    vec2 g = vWall / cell;
    vec2 id = floor(g);
    vec2 f = fract(g);
    vec2 fw = clamp(fwidth(g), 0.0, 0.5);
    float lod = smoothstep(0.3, 0.6, max(fw.x, fw.y));
    // whole floors only: no windows poking into the parapet
    float under = wallTop > 0.5 ? step((id.y + 1.0) * cell.y, wallTop + 0.35) : 1.0;
    vec2 mm = smoothstep(lo - fw, lo + fw, f) * (1.0 - smoothstep(hi - fw, hi + fw, f));
    float m = mm.x * mm.y * under;
    vec3 wallCol = diffuseColor.rgb;
    float bh = h21(vec2(seed, 3.3));
    vec3 frameC = style < 0.5 ? (bh < 0.35 ? vec3(0.78, 0.77, 0.72) : bh < 0.6 ? vec3(0.05, 0.11, 0.07) : bh < 0.85 ? vec3(0.04) : vec3(0.22, 0.05, 0.04))
                              : (bh < 0.45 ? vec3(0.5, 0.51, 0.52) : bh < 0.75 ? vec3(0.1, 0.075, 0.05) : bh < 0.9 ? vec3(0.7) : vec3(0.03));
    if (style > 2.5 && style < 3.5) frameC = bh < 0.6 ? vec3(0.75, 0.74, 0.7) : vec3(0.06);

    if (isShop && h21(vec2(id.x, seed)) < 0.22 + uNight * 0.6) {
      // roll-up shutter
      float ridge = 0.75 + 0.25 * step(0.5, fract(vWall.y * 6.0));
      vec3 shutter = mix(vec3(0.55, 0.56, 0.57), mix(vec3(0.42, 0.13, 0.12), vec3(0.18, 0.32, 0.22), step(0.5, h21(vec2(id.x, 7.0)))), step(0.6, h21(vec2(id.x, 3.0))));
      diffuseColor.rgb = mix(diffuseColor.rgb, shutter * ridge, m);
      nW = normalize(mix(nW, normalize(N + Bt * 0.5 * sin(vWall.y * 37.7)), m * (1.0 - lod)));
      useNW = true;
      matRough = mix(matRough, 0.5, m); matMetal = mix(matMetal, 0.4, m);
      m = 0.0;
    }
    // sills, surrounds, panel joints and streaks: the wall around the opening
    if (!isShop && style != 2.0 && lod < 0.99 && under > 0.5) {
      vec2 fm = f * cell, lom = lo * cell, him = hi * cell;
      float aa = max(fw.x * cell.x, 0.004);
      bool inSpan = style == 1.0 || (fm.x > lom.x - 0.06 && fm.x < him.x + 0.06);
      float sill = inSpan && fm.y > lom.y - 0.08 && fm.y < lom.y ? 1.0 : 0.0;
      float drip = inSpan && fm.y > lom.y - 0.2 && fm.y <= lom.y - 0.08 ? 1.0 : 0.0;
      vec3 sillC = matC == 2.0 ? vec3(0.45, 0.42, 0.38) : vec3(0.82, 0.8, 0.75);
      diffuseColor.rgb = mix(diffuseColor.rgb, sillC, sill * (1.0 - lod));
      diffuseColor.rgb *= 1.0 - 0.3 * drip * (1.0 - lod);
      if (sill > 0.5) { nW = normalize(N + Bt * 0.9); useNW = true; }
      // grime washed down from the sill ends
      if (style != 1.0 && fm.y < lom.y - 0.08 && fm.y > lom.y - 2.2 && fm.x > lom.x - 0.1 && fm.x < him.x + 0.1) {
        float s2 = texture(uMatTex, vec3(vec2(vWall.x / 1.3, vWall.y / 2.5), 8.0)).r;
        float k = smoothstep(lom.y - 2.2, lom.y - 0.1, fm.y) * (matC < 1.5 ? 1.0 : 0.6);
        diffuseColor.rgb *= 1.0 - (1.0 - s2) * 2.2 * k * (1.0 - lod);
      }
      // colonial window surrounds in a contrasting trim; soldier-course lintels on face brick
      if (style == 0.0 || style == 3.0) {
        float band = 0.13;
        bool ring = fm.x > lom.x - band && fm.x < him.x + band && fm.y > lom.y && fm.y < him.y + band && !(fm.x > lom.x && fm.x < him.x && fm.y < him.y);
        if (ring) {
          if (matC == 2.0) {
            vec4 sb = texture(uMatTex, vec3(vec2(vWall.y, vWall.x) / MSC[1] * vec2(1.0, 0.5), 1.0));
            if (fm.y > him.y) diffuseColor.rgb = vColor.rgb * sb.rgb / max(uMatMean[1], vec3(0.02)) * 0.9;
          } else diffuseColor.rgb = mix(diffuseColor.rgb, style == 0.0 ? vec3(0.9, 0.88, 0.82) : diffuseColor.rgb * 1.12, 0.75 * (1.0 - lod));
        }
      }
      // precast panels: deep joints on the cell grid
      if (style > 5.5 && matC == 3.0) {
        float j = max(bar(fm.x, 0.0, 0.012, aa), bar(fm.x, cell.x, 0.012, aa)) + max(bar(fm.y, 0.0, 0.012, aa), bar(fm.y, cell.y, 0.012, aa));
        diffuseColor.rgb *= 1.0 - 0.5 * clamp(j, 0.0, 1.0) * (1.0 - lod);
      }
    }

    if (m > 0.0) {
      vec3 openCol = vec3(0.0), openEmit = vec3(0.0), openN = N;
      float glassAmt = 0.0;
      if (lod < 0.99) {
        float dX = dot(V, T), dY = dot(V, Bt), dZ = max(-dot(V, N), 0.035);
        // the glass sits rec metres back: parallax into the reveal
        vec2 pg = vWall + vec2(dX, dY) * (rec / dZ);
        vec2 fg = (pg - id * cell) / cell;
        bool inX = lo.x < -0.5 || (fg.x > lo.x && fg.x < hi.x);
        bool inY = fg.y > lo.y && fg.y < hi.y;
        if (!(inX && inY)) {
          // reveal: soffit in shadow, sill top catching light, jambs in between
          float sh = 0.7;
          if (fg.y >= hi.y) { sh = 0.42; openN = -Bt; }
          else if (fg.y <= lo.y) { sh = 0.95; openN = Bt; }
          else if (fg.x <= lo.x) openN = T;
          else openN = -T;
          openCol = wallCol * sh;
        } else {
          vec2 om = (fg - lo) * cell;
          vec2 osz = (hi - lo) * cell;
          if (lo.x < -0.5) { om.x = fract(pg.x / 1.1) * 1.1; osz.x = 1.1; }
          vec2 pw = max(fwidth(pg), vec2(0.004));
          float aa = max(pw.x, pw.y);
          float edge = min(min(om.x, osz.x - om.x), min(om.y, osz.y - om.y));
          float fr = 1.0 - smoothstep(0.045 - aa, 0.045 + aa, edge);
          if (lo.x < -0.5) fr = max(bar(om.x, 0.0, 0.03, aa), max(bar(om.y, 0.0, 0.04, aa), bar(om.y, osz.y, 0.04, aa)));
          float bars = 0.0;
          if (style < 0.5 && !isShop) {
            for (int k = 1; k < 3; k++) bars = max(bars, bar(om.x, osz.x * float(k) / 3.0, 0.016, aa));
            for (int k = 1; k < 4; k++) bars = max(bars, bar(om.y, osz.y * float(k) / 4.0, 0.016, aa));
          } else if (style < 1.5 && !isShop) bars = bar(om.y, osz.y * 0.3, 0.025, aa);
          else if (style > 2.5 && style < 3.5) {
            bars = max(bar(om.x, osz.x * 0.5, 0.03, aa), bar(om.y, osz.y * 0.62, 0.03, aa));
            float bb = max(bar(fract(om.x / 0.14) * 0.14, 0.07, 0.007, aa), bar(fract(om.y / 0.42) * 0.42, 0.21, 0.007, aa)); // burglar bars
            bars = max(bars, bb);
          } else if (style > 4.5 && style < 5.5 && !isShop) bars = max(bar(om.y, osz.y * 0.32, 0.025, aa), bar(om.x, osz.x * 0.5, 0.018, aa));
          else if (style > 5.5 && !isShop) bars = max(bar(om.x, osz.x * 0.5, 0.025, aa), bar(om.y, osz.y * 0.74, 0.025, aa));
          if (isShop) bars = max(bar(fract(om.x / 1.21) * 1.21, 0.0, 0.035, aa), bar(om.y, 2.1, 0.04, aa));
          float solid = max(fr, bars);
          // the room
          float floorI = id.y;
          float fh = h21(vec2(floorI, seed * 1.31));
          float bays = isShop ? 1.0 : cell.x < 2.0 ? 2.0 + floor(fh * 3.0) : 1.0 + floor(fh * 1.99);
          float ph = floor(h21(vec2(floorI, seed + 7.7)) * bays);
          float rx = (pg.x / cell.x + ph) / bays;
          float roomW = bays * cell.x;
          float roomH = isShop ? 3.6 : cell.y - 0.3;
          float depth = isShop ? 7.5 : mix(3.5, 6.5, h21(vec2(floor(rx), floorI) + seed * 0.3));
          vec3 o = vec3((fract(rx) - 0.5) * roomW, clamp(pg.y - floorI * cell.y, 0.03, roomH - 0.03), 0.0);
          float rk = kind;
          if (style < 0.5 && !isShop) rk = h21(vec2(floorI, seed + 1.0)) < 0.5 ? 1.0 : 0.0; // flats above old shops
          vec2 cu = vec2(lo.x < -0.5 ? fract(pg.x / cell.x) : (fg.x - lo.x) / (hi.x - lo.x), (fg.y - lo.y) / (hi.y - lo.y));
          float gd;
          vec3 room = interior(o, vec3(dX, dY, dZ), vec2(floor(rx), floorI), roomW, roomH, depth, rk, seed, day, uNight, id, cu, gd);
          float curtainWall = style > 1.5 && style < 2.5 ? 1.0 : 0.0;
          room *= mix(1.0, 0.25, curtainWall * day);
          openEmit = room * (1.0 - solid);
          // glass: dark (the room is emissive); curtain walls are tinted mirrors
          openCol = mix(mix(vec3(0.015), wallCol * 0.45, curtainWall), frameC, solid);
          glassAmt = 1.0 - solid;
          // old panes and big lights are never quite flat: per-pane wobble in the reflections
          float wob = curtainWall > 0.5 ? 0.012 : 0.03;
          openN = normalize(N + (T * (h21(id + seed * 0.1) - 0.5) + Bt * (h21(id * 1.3 + 2.0) - 0.5)) * wob * (1.0 - solid));
        }
        if (lod > 0.0) {
          // distant: fade toward the mean so far towers don't twinkle
          vec3 meanEmit = mix(vec3(0.9, 0.75, 0.55), vec3(0.75, 0.85, 1.0), 0.4) * (uNight * (kind > 0.5 ? 0.5 : 0.3) + day * 0.12);
          openEmit = mix(openEmit, meanEmit, lod);
          openCol = mix(openCol, vec3(0.03), lod);
          glassAmt = mix(glassAmt, 0.5, lod);
          openN = normalize(mix(openN, N, lod));
        }
      } else {
        // far away: a mean of glass and lit rooms
        float pLit = (uNight * (kind > 0.5 ? 0.5 : 0.3) + day * 0.12);
        openEmit = mix(vec3(0.9, 0.75, 0.55), vec3(0.75, 0.85, 1.0), 0.4) * pLit;
        openCol = vec3(0.03);
        glassAmt = 0.5;
      }
      float cov = mix(m, 0.32 * under, lod);
      diffuseColor.rgb = mix(diffuseColor.rgb, openCol, cov);
      roomEmit = openEmit * cov;
      glassMask = glassAmt * cov;
      glassMetal = style > 1.5 && style < 2.5 ? 0.85 : 0.0;
      glassRough = 0.04;
      nW = normalize(mix(nW, openN, cov));
      useNW = true;
    } else if (style > 1.5 && style < 2.5) {
      diffuseColor.rgb *= 1.25; // lighter curtain-wall mullions and spandrels
    }
  }
}
`;
