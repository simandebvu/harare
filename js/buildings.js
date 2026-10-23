// js/buildings.js — Harare CBD buildings from OSM footprints, by era:
//   colonial (1890s–1940s): 1–3 storeys, sash windows, parapet + pediment, tin verandah over the pavement
//   modernist (1950s–70s): slabs and podium+tower, sunshade bands / vertical fins / egg-crate, concrete pavement canopy
//   post-independence (1980s–2000s): curtain glass or granite precast towers, setback crowns
// plus suburban houses with tin roofs, and hand-shaped landmarks. Everything merges into one mesh; windows,
// shopfronts, shutters and lit rooms are drawn in the shader.
import * as THREE from 'three';
import { groundY, rng, coreWeight, Grid, polyBounds, pointInPoly, polyCentroid, segDist } from './util.js';

// --- facade styles (shader) ----------------------------------------------------------------------------------------
// 0 colonial sash · 1 modern ribbon · 2 curtain glass · 3 house · 4 sign (emissive at night) · 5 modern fins · 6 precast
const FLOOR = { 0: 4.2, 1: 3.3, 2: 3.6, 3: 3.2, 5: 3.3, 6: 3.6 };

const PALETTE = {
  colonial: ['#ebe0c4', '#e3cf9f', '#f1ece0', '#d9b77e', '#a8553a', '#e8dcc0', '#cfa66b', '#efe6cf'],
  colonialTrim: ['#6b2a26', '#2f4a34', '#f4f1ea', '#3b3f45'],
  modern: ['#e9e6de', '#d6d3cb', '#cfc8b8', '#e2dccd', '#bfbcb5', '#d8cfbd', '#c9c6bd'],
  mosaic: ['#6f8c9c', '#7d927a', '#b48a6e', '#8a9aa6'],
  granite: ['#9b8a84', '#8a7468', '#a59a92', '#6f5a4c', '#b3a69a'],
  house: ['#efe7d6', '#e8dcc2', '#f2d3b3', '#d8c3a5', '#ffffff', '#e4c9a8', '#c9b49a'],
  tin: ['#8e3b2a', '#7a4a3a', '#5e6266', '#9a5a3c', '#6d3527', '#8a8f91', '#3f5e4a'],
  sign: ['#c8102e', '#f2b705', '#0a4ea2', '#1b8a3a', '#e35205', '#6a1b9a', '#00838f'],
  verandah: ['#7d8285', '#8e3b2a', '#5e6266', '#a0a4a6'],
};

// Named landmarks: kind overrides the typology, extras add hand-built massing
const LANDMARKS = [
  { re: /Reserve Bank/i, kind: 'post', style: 6, wall: '#8d8a86', crown: 'cone' }, // granite tower, Great Zimbabwe cone top
  { re: /Joina City/i, kind: 'post', style: 2, wall: '#6f8fa8', podium: 2, spire: 28 },
  { re: /Karigamombe/i, kind: 'post', style: 2, wall: '#8a6a4f', crown: 'step' }, // bronze glass
  { re: /Old Mutual Centre/i, kind: 'post', style: 6, wall: '#7a6550', crown: 'step' },
  { re: /Eastgate Shopping/i, kind: 'modern', style: 5, wall: '#8f8b84', chimneys: true, finDepth: 1.0 },
  { re: /ZB Life/i, kind: 'modern', style: 1, wall: '#c9cdcc', bands: true },
  { re: /Meikles/i, kind: 'modern', style: 1, wall: '#efe9dc', bands: true },
  { re: /Rainbow Towers/i, kind: 'post', style: 2, wall: '#a8814f' }, // gold reflective glass
  { re: /^Parliament/i, kind: 'colonial', style: 0, wall: '#efe6cf', verandah: 1 },
  { re: /Town House/i, kind: 'colonial', style: 0, wall: '#f0e3c2', clock: true },
  { re: /Livingstone House/i, kind: 'modern', style: 1, wall: '#d9d6cf', bands: true },
  { re: /Pearl House/i, kind: 'modern', style: 5, wall: '#e2dccd' },
  { re: /Hurudza/i, kind: 'modern', style: 1, wall: '#c8bba4', bands: true, bandDepth: 1.6 },
  { re: /Social Security|NSSA/i, kind: 'post', style: 6, wall: '#a59a92', crown: 'step' },
  { re: /Main Post/i, kind: 'colonial', style: 0, wall: '#e8dcc0', verandah: 1 },
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

export function buildBuildings(scene, DATA) {
  const B = new Buf();
  const grid = new Grid(40);
  const footprints = [];
  const labels = [];
  const c = new THREE.Color(), c2 = new THREE.Color(), c3 = new THREE.Color();

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
  function walls(ring, y0, y1, base, color, f, parapet = 0) {
    const n = ring.length / 2;
    let s = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      s += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
    }
    const sign = s > 0 ? 1 : -1;
    const edges = [];
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
      // seen from outside: B on the left, A on the right
      quad([bx, y0, bz], [ax, y0, az], [ax, top, az], [bx, top, bz], color, [u + len, y0 - base, u, y0 - base, u, top - base, u + len, top - base], f);
      if (parapet > 0) quad([ax, y1, az], [bx, y1, bz], [bx, top, bz], [ax, top, az], color, null, NOFAC); // inner face
      edges.push({ ax, az, bx, bz, nx, nz, len, mx: (ax + bx) / 2, mz: (az + bz) / 2 });
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

  // --- feature builders ----------------------------------------------------------------------------------------------
  // Sunshade band at every floor: a thin slab proud of each long wall
  function bands(edges, y0, y1, floorH, depth, color) {
    for (const e of edges) {
      if (e.len < 3) continue;
      const yaw = Math.atan2(e.bz - e.az, e.bx - e.ax);
      for (let y = y0 + floorH; y < y1 - 0.5; y += floorH)
        box(e.mx + (e.nx * depth) / 2, e.mz + (e.nz * depth) / 2, y - 0.12, e.len + depth * 0.6, depth, 0.24, color, yaw);
    }
  }
  // Vertical fins at a 1.4–1.6 m pitch, full height
  function fins(edges, y0, y1, depth, color, pitch = 1.5) {
    for (const e of edges) {
      if (e.len < 4) continue;
      const yaw = Math.atan2(e.bz - e.az, e.bx - e.ax);
      const k = Math.floor(e.len / pitch);
      for (let i = 1; i < k; i++) {
        const t = i / k;
        const x = e.ax + (e.bx - e.ax) * t + (e.nx * depth) / 2, z = e.az + (e.bz - e.az) * t + (e.nz * depth) / 2;
        box(x, z, y0, 0.16, depth, y1 - y0, color, yaw);
      }
    }
  }
  // Colonial verandah: lean-to tin roof on posts over the pavement
  function verandah(e, y0, r, tin, post) {
    const depth = 2.8, h = 3.7, yaw = Math.atan2(e.bz - e.az, e.bx - e.ax);
    const ox = e.nx * depth, oz = e.nz * depth;
    const tx = (e.bx - e.ax) / e.len, tz = (e.bz - e.az) / e.len;
    const a0 = [e.ax - tx * 0.2, y0 + h + 0.5, e.az - tz * 0.2], b0 = [e.bx + tx * 0.2, y0 + h + 0.5, e.bz + tz * 0.2];
    const a1 = [a0[0] + ox, y0 + h, a0[2] + oz], b1 = [b0[0] + ox, y0 + h, b0[2] + oz];
    quad(a0, b0, b1, a1, tin, null, NOFAC); // tin roof, sloping outward
    quad(b0, a0, a1, b1, tin.clone().multiplyScalar(0.55), null, NOFAC); // soffit
    const n = Math.max(2, Math.round(e.len / 3.2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      box(e.ax + (e.bx - e.ax) * t + ox - e.nx * 0.1, e.az + (e.bz - e.az) * t + oz - e.nz * 0.1, y0, 0.14, 0.14, h, post, yaw);
    }
    // frilly fascia board
    box(e.mx + ox, e.mz + oz, y0 + h - 0.35, e.len + 0.4, 0.06, 0.35, post, yaw);
  }
  // Modern cantilevered concrete canopy with a painted shop-sign fascia
  function canopy(e, y0, r, concrete) {
    const depth = 2.6, h = 3.9, yaw = Math.atan2(e.bz - e.az, e.bx - e.ax);
    box(e.mx + (e.nx * depth) / 2, e.mz + (e.nz * depth) / 2, y0 + h, e.len, depth, 0.28, concrete, yaw);
    // fascia: runs of shop signs in brand-ish colours
    let t = 0;
    while (t < e.len - 1) {
      const w = Math.min(e.len - t, 4 + r() * 7);
      const col = r() < 0.35 ? concrete : c2.set(PALETTE.sign[Math.floor(r() * PALETTE.sign.length)]);
      const tt = (t + w / 2) / e.len;
      box(e.ax + (e.bx - e.ax) * tt + e.nx * (depth + 0.02), e.az + (e.bz - e.az) * tt + e.nz * (depth + 0.02), y0 + h - 0.15, w - 0.1, 0.06, 0.62, col, yaw, col === concrete ? NOFAC : [4, r() * 50, 2]);
      t += w;
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
  function roofSign(e, y, r) {
    const yaw = Math.atan2(e.bz - e.az, e.bx - e.ax);
    const w = Math.min(e.len * 0.7, 14 + r() * 8), h = 3 + r() * 2;
    const x = e.mx - e.nx * 2, z = e.mz - e.nz * 2;
    for (const s of [-0.4, 0.4]) {
      const t = s * w;
      box(x + Math.cos(yaw) * t, z + Math.sin(yaw) * t, y, 0.2, 0.2, 2, c3.set('#3a3a3a'), yaw);
    }
    const col = c2.set(PALETTE.sign[Math.floor(r() * PALETTE.sign.length)]);
    box(x, z, y + 2, w, 0.3, h, col, yaw, [4, r() * 50, 2]);
    box(x + e.nx * 0.17, z + e.nz * 0.17, y + 2 + h * 0.35, w * 0.8, 0.02, h * 0.3, c3.set('#f4f2ea'), yaw, [4, 1, 2]);
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
    const seed = 1 + r() * 97;

    if (isHouse) {
      // Suburban house: rendered walls, tin roof (hipped when small and simple)
      c.set(PALETTE.house[Math.floor(r() * PALETTE.house.length)]).multiplyScalar(0.92 + r() * 0.1);
      walls(ring, y0, top, base, c, [3, seed, 1]);
      const tin = c2.set(PALETTE.tin[Math.floor(r() * PALETTE.tin.length)]);
      if (n <= 8 && area < 500) {
        const apex = [cx, top + 1.6 + r() * 1.2, cz];
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          triUp([ring[i * 2], top, ring[i * 2 + 1]], [ring[j * 2], top, ring[j * 2 + 1]], apex, tin);
        }
      } else roof(ring, top, tin);
    } else {
      const kind = lm?.kind || pickKind(bd, area, cx, cz, core, r);
      let style, wall;
      if (kind === 'colonial') (style = 0), (wall = PALETTE.colonial[Math.floor(r() * PALETTE.colonial.length)]);
      else if (kind === 'modern') {
        style = r() < 0.35 ? 5 : 1;
        wall = r() < 0.04 ? PALETTE.mosaic[Math.floor(r() * PALETTE.mosaic.length)] : PALETTE.modern[Math.floor(r() * PALETTE.modern.length)];
      } else {
        style = r() < 0.55 ? 2 : 6;
        wall = style === 2 ? ['#6a5440', '#4f6f86', '#5c7a68', '#5e646a', '#8a6a4f'][Math.floor(r() * 5)] : PALETTE.granite[Math.floor(r() * PALETTE.granite.length)];
      }
      if (lm) (style = lm.style), (wall = lm.wall);
      c.set(wall).multiplyScalar(0.94 + r() * 0.1);
      const shop = core > 0.15 ? 1 : 0;
      const f = [style + shop * 0.25, seed, 1];
      const floorH = FLOOR[style];
      const parapet = kind === 'colonial' ? 1.1 : 0.8;
      const roofCol = c3.set(kind === 'colonial' ? '#8a8378' : '#7d7b77').multiplyScalar(0.85 + r() * 0.2).clone();

      // Massing: podium + tower for big modern/post plots, setback crown for post towers
      let edges;
      const tower = (kind !== 'colonial' && area > 1800 && bd.h > 25) || lm?.podium ? inset(ring, 0.74, cx, cz) : null;
      if (tower) {
        const podTop = base + (lm?.podium || 3) * 4.2;
        const pod = walls(ring, y0, podTop, base, c2.copy(c).multiplyScalar(0.92), [style === 2 ? 6 : style, seed, 1], 0.9);
        roof(ring, podTop, roofCol);
        for (const e of pod) if (shop && e.len > 6 && streetGap(e.mx + e.nx, e.mz + e.nz) < 6) canopy(e, base, r, c3.set('#cfc9bd'));
        edges = walls(tower, podTop, top, base, c, f, parapet);
        roof(tower, top, roofCol);
      } else {
        edges = walls(ring, y0, top, base, c, f, parapet);
        roof(ring, top, roofCol);
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
          roof(rr, y + 4, roofCol);
          y += 4;
        }
        const rad = Math.sqrt(area) * k * 0.35;
        stamp(UNIT_CONE, cx, y + rad * 0.9, cz, rad, rad * 1.8, rad, 0, c);
      } else if (lm?.crown === 'step' || (kind === 'post' && r() < 0.5)) {
        const rr = inset(outline, 0.82, cx, cz);
        if (rr) {
          walls(rr, top, top + floorH * 2, base, c, f, 0.6);
          roof(rr, top + floorH * 2, roofCol);
        }
      }

      // Facade relief
      if (kind === 'modern' && bd.h > 7) {
        const relief = c2.copy(c).multiplyScalar(1.04);
        const y1 = top;
        const yStart = tower ? base + (lm?.podium || 3) * 4.2 : base;
        if (style === 5) fins(edges, yStart, y1, lm?.finDepth || 0.7, relief);
        if (style === 1 || lm?.bands || (style === 5 && r() < 0.3)) bands(edges, yStart, y1, floorH, lm?.bandDepth || 0.75, relief);
      }

      // Street level: verandahs (colonial), canopies (modern), plain (post)
      if (!tower)
        for (const e of edges) {
          if (e.len < 5 || streetGap(e.mx + e.nx, e.mz + e.nz) > 6) continue;
          if (kind === 'colonial' && (lm?.verandah || r() < 0.85))
            verandah(e, base, r, c2.set(PALETTE.verandah[Math.floor(r() * PALETTE.verandah.length)]), c3.set(PALETTE.colonialTrim[Math.floor(r() * PALETTE.colonialTrim.length)]));
          else if (kind === 'modern' && shop && r() < 0.65) canopy(e, base, r, c2.copy(c).multiplyScalar(0.95));
        }

      // Colonial pediment / name panel on the longest street wall
      if (kind === 'colonial' && bd.h < 16) {
        const e = edges.reduce((a, b) => (b.len > a.len ? b : a), edges[0]);
        if (e && e.len > 8) {
          const yaw = Math.atan2(e.bz - e.az, e.bx - e.ax);
          const trim = c2.set(PALETTE.colonialTrim[Math.floor(r() * PALETTE.colonialTrim.length)]);
          box(e.mx + e.nx * 0.05, e.mz + e.nz * 0.05, top + parapet, Math.min(8, e.len * 0.35), 0.35, 1.4, c, yaw);
          box(e.mx + e.nx * 0.12, e.mz + e.nz * 0.12, top + parapet * 0.2, e.len, 0.25, 0.25, trim, yaw); // cornice
        }
      }

      // Rooftops: lift motor rooms, water tanks, signs
      if (area > 250) {
        const k = kind === 'colonial' ? 0 : 1 + Math.floor(r() * 2);
        for (let q = 0; q < k; q++) {
          const x = cx + (r() - 0.5) * (bounds[2] - bounds[0]) * 0.3, z = cz + (r() - 0.5) * (bounds[3] - bounds[1]) * 0.3;
          if (pointInPoly(x, z, outline)) box(x, z, top, 3 + r() * 4, 3 + r() * 4, 2.5 + r() * 2.5, c2.copy(c).multiplyScalar(0.9));
        }
        tanks(cx, cz, top, 1 + Math.floor(r() * 4), Math.sqrt(area) * 0.4, outline, r);
      }
      if (bd.h > 28 && !lm && r() < 0.3 && edges.length) roofSign(edges.reduce((a, b) => (b.len > a.len ? b : a), edges[0]), top, r);

      // Landmark extras
      if (lm?.spire) {
        box(cx, cz, top, 7, 7, 5, c);
        stamp(UNIT_CYL, cx, top + 5 + lm.spire / 2, cz, 0.45, lm.spire, 0.45, 0, c2.set('#d0d4d8'));
      }
      if (lm?.clock) {
        // Town House clock tower with a little pyramid roof
        box(cx, cz, top, 5, 5, 12, c);
        box(cx, cz, top + 8.5, 5.2, 5.2, 2.2, c2.set('#f6f3ea'), 0, [4, 3, 2]);
        stamp(UNIT_CONE, cx, top + 14, cz, 3.8, 4, 3.8, Math.PI / 4, c2.set('#7a3a2a'));
      }
      if (lm?.chimneys) {
        // Eastgate's brick ventilation stacks in rows along the roof
        const e = edges.reduce((a, b) => (b.len > a.len ? b : a), edges[0]);
        const ang = Math.atan2(e.bz - e.az, e.bx - e.ax), ca = Math.cos(ang), sa = Math.sin(ang);
        for (let a = -130; a <= 130; a += 7)
          for (const b of [-10, -3.5, 3.5, 10]) {
            const x = cx + a * ca - b * sa, z = cz + a * sa + b * ca;
            if (pointInPoly(x, z, ring)) box(x, z, top, 1.8, 1.8, 7, c2.set('#8a4a33'), ang);
          }
      }
    }

    footprints.push({ p: ring, h: top, bounds });
    grid.insert(footprints.length - 1, ...bounds);
    if (bd.n && lm && !labels.some((l) => lm.re.test(l.n))) labels.push({ n: bd.n, x: cx, y: top + 8, z: cz });
  });

  const geo = B.geometry();
  console.log(`[harare] buildings: ${(B.n / 1e6).toFixed(2)}M vertices`);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0 });
  const uniforms = { uNight: { value: 0 } };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = uniforms.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aFac;\nattribute vec2 aWall;\nvarying vec3 vFac;\nvarying vec2 vWall;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFac = aFac;\nvWall = aWall;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uNight;
        varying vec3 vFac;
        varying vec2 vWall;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float winMask = 0.0;
        float litMask = 0.0;
        float signGlow = 0.0;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float style = floor(vFac.x);
        if (vFac.z > 1.5) {
          // signs and lit panels
          signGlow = 1.0;
        } else if (vFac.z > 0.5) {
          float shop = step(0.2, fract(vFac.x));
          vec2 cell = vec2(3.4, 3.6); vec2 lo = vec2(0.25, 0.25); vec2 hi = vec2(0.75, 0.8);
          if (style < 0.5) { cell = vec2(3.6, 4.2); lo = vec2(0.33, 0.22); hi = vec2(0.67, 0.78); }            // colonial sash
          else if (style < 1.5) { cell = vec2(3.0, 3.3); lo = vec2(-1.0, 0.36); hi = vec2(2.0, 0.86); }       // ribbon
          else if (style < 2.5) { cell = vec2(1.6, 3.6); lo = vec2(0.04, 0.05); hi = vec2(0.96, 0.95); }      // curtain
          else if (style < 3.5) { cell = vec2(4.2, 3.2); lo = vec2(0.32, 0.3); hi = vec2(0.68, 0.72); }       // house
          else if (style > 4.5 && style < 5.5) { cell = vec2(1.5, 3.3); lo = vec2(0.12, 0.2); hi = vec2(0.88, 0.88); } // fins
          else if (style > 5.5) { cell = vec2(2.4, 3.6); lo = vec2(0.22, 0.3); hi = vec2(0.78, 0.8); }        // precast
          vec2 g = vWall / cell;
          vec2 id = floor(g);
          vec2 f = fract(g);
          vec2 fw = clamp(fwidth(g), 0.0, 0.5);
          vec2 m = smoothstep(lo - fw, lo + fw, f) * (1.0 - smoothstep(hi - fw, hi + fw, f));
          winMask = m.x * m.y;
          float rnd = h21(id + vFac.y);
          // reveal shadow under the lintel and a pale sill: windows read as recessed
          float reveal = smoothstep(hi.y - 0.14, hi.y, f.y) * winMask;
          float sill = (1.0 - smoothstep(lo.y - 0.06 - fw.y, lo.y - 0.06, f.y)) * smoothstep(lo.y - 0.12 - fw.y, lo.y - 0.12, f.y) * step(lo.x, f.x) * step(f.x, hi.x);
          bool isShop = shop > 0.5 && vWall.y < 4.2;
          if (isShop) {
            float bay = floor(vWall.x / 5.0), sf = fract(vWall.x / 5.0);
            winMask = smoothstep(0.04, 0.08, sf) * (1.0 - smoothstep(0.92, 0.96, sf)) * step(0.35, vWall.y) * (1.0 - step(3.4, vWall.y));
            id = vec2(bay, -1.0);
            reveal = 0.0; sill = 0.0;
            // roll-up shutters: some bays closed by day, most by night
            if (h21(vec2(bay, vFac.y)) < 0.22 + uNight * 0.6) {
              float ridge = 0.75 + 0.25 * step(0.5, fract(vWall.y * 6.0));
              vec3 shutter = mix(vec3(0.55, 0.56, 0.57), mix(vec3(0.42, 0.13, 0.12), vec3(0.18, 0.32, 0.22), step(0.5, h21(vec2(bay, 7.0)))), step(0.6, h21(vec2(bay, 3.0))));
              diffuseColor.rgb = mix(diffuseColor.rgb, shutter * ridge, winMask);
              winMask = 0.0;
            }
          }
          float fade = smoothstep(0.35, 0.6, max(fw.x, fw.y));
          winMask = mix(winMask, 0.32, fade);
          reveal *= 1.0 - fade; sill *= 1.0 - fade;
          vec3 glass = mix(vec3(0.05, 0.055, 0.06), vec3(0.2, 0.21, 0.21), rnd);
          if (style > 1.5 && style < 2.5) {
            // curtain wall tint from the building colour: bronze, blue, green, grey
            glass = diffuseColor.rgb * mix(0.35, 0.6, rnd);
            diffuseColor.rgb *= 1.25; // lighter mullions
          }
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, winMask);
          diffuseColor.rgb *= 1.0 - reveal * 0.55;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.88, 0.84), sill * 0.6);
          litMask = step(0.74 - 0.3 * step(id.y, -0.5), h21(id * 1.7 + vFac.y * 3.1)) * winMask * (1.0 - fade * 0.6);
        }`
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.1, winMask);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.4, winMask);')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec3 warm = mix(vec3(1.0, 0.62, 0.28), vec3(0.75, 0.85, 1.0), step(0.75, h21(floor(vWall / 3.0) + vFac.y)));
        totalEmissiveRadiance += litMask * uNight * warm * 0.9;
        totalEmissiveRadiance += signGlow * uNight * diffuseColor.rgb * 2.2;`
      );
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);

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

  return { mesh, blocked, labels, setNight: (v) => (uniforms.uNight.value = v) };
}
