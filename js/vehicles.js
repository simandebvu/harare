// js/vehicles.js — sculpted vehicle models: Honda Fit, sedan, Hilux, ZRP police Hilux, old single-cab pickup, Toyota
// HiAce kombi, ZUPCO bus. Each body is a smooth loft of rounded sections along the car (hood and roof crowns, bevelled
// shoulders, wheel arches cut into the sills), a separate tapered glasshouse with pillars and a painted roof, rounded
// bumpers, mirrors, lamps, grilles, number plates and route boards (decals from one canvas atlas), lathe tyres with rims.
// Local frame: forward = +z, up = +y, +x = the car's left (kerb side, sliding door), origin at ground centre.
// Vertex attributes: color (paint parts are white so the instance colour shows), aMat (paint mask, roughness, metalness,
// lamp kind), aDec (decal kind, cell), aUv, aOpt (optional part bit: luggage sets, light bar).
import * as THREE from 'three';
import { makeGeometry } from './util.js';
import { MeshKit } from './meshkit.js';

const WHITE = [1, 1, 1], GLASS = [0.045, 0.055, 0.065], TYRE = [0.035, 0.035, 0.037], TRIM = [0.06, 0.06, 0.065], PLASTIC = [0.11, 0.11, 0.115];
const CHROME = [0.75, 0.76, 0.78], STEEL = [0.62, 0.63, 0.64], RACK = [0.12, 0.12, 0.12], INTERIOR = [0.03, 0.028, 0.026], LINER = [0.09, 0.09, 0.09];
const HEAD = [0.95, 0.95, 0.92], TAIL = [0.55, 0.03, 0.02], AMBER = [0.9, 0.45, 0.05], PLATE = [1, 1, 1], BLUE = [0.1, 0.28, 0.62];
export const LAMP = { HEAD: 1, TAIL: 2, IND_FL: 3, IND_FR: 4, IND_RL: 5, IND_RR: 6, BAR_R: 7, BAR_B: 8, CABIN: 10 };

// --- attribute presets ------------------------------------------------------------------------------------------------
const m = (color, paint, rough, metal, lamp = 0, opt = 0) => ({ color, aMat: [paint, rough, metal, lamp], aDec: [0, 0], aUv: [0, 0], aOpt: opt });
const PAINT = m(WHITE, 1, 0.32, 0.25);
const GLASS_M = m(GLASS, 0, 0.04, 0.0);
const GLASS_CABIN = m(GLASS, 0, 0.04, 0.0, LAMP.CABIN);
const TRIM_M = m(TRIM, 0, 0.6, 0.0);
const PLASTIC_M = m(PLASTIC, 0, 0.7, 0.0);
const CHROME_M = m(CHROME, 0, 0.18, 1.0);
const TYRE_M = m(TYRE, 0, 0.88, 0.0);
const STEEL_M = m(STEEL, 0, 0.4, 0.8);
const INTERIOR_M = m(INTERIOR, 0, 0.9, 0.0);
const LINER_M = m(LINER, 0, 0.9, 0.0);
const RACK_M = m(RACK, 0, 0.5, 0.6);
const lampM = (color, kind) => m(color, 0, 0.1, 0.0, kind);

// --- profile helpers ------------------------------------------------------------------------------------------------------
const lerpKeys = (keys, z) => {
  if (z <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (z <= keys[i][0]) {
      const [z0, a] = keys[i - 1], [z1, b] = keys[i];
      const t = (z - z0) / (z1 - z0 || 1);
      const s = t * t * (3 - 2 * t);
      return a + (b - a) * (0.35 * t + 0.65 * s);
    }
  }
  return keys[keys.length - 1][1];
};
const se = (v, e) => Math.sign(v) * Math.abs(v) ** e;

// Rounded section: half width hw, from yb to yt, roundness exponents (smaller = boxier)
function section(z, hw, yb, yt, n, eTop = 0.32, eBot = 0.22, eSide = 0.3) {
  const out = [];
  const yc = (yb + yt) / 2, hh = (yt - yb) / 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2; // start at the bottom centre
    const c = Math.cos(a), s = Math.sin(a);
    out.push([se(c, eSide) * hw, yc + se(s, s > 0 ? eTop : eBot) * hh, z]);
  }
  return out;
}

// Rounded box along an axis (bumpers, mirrors, light bars, luggage): sections across, slightly shrunk at the ends
function rbox(k, cx, cy, cz, w, h, d, attrs, detail = 1, e = 0.3) {
  const n = detail ? 12 : 6;
  const xs = [-0.5, -0.47, -0.4, 0.4, 0.47, 0.5];
  const sh = [0.75, 0.93, 1, 1, 0.93, 0.75];
  const P = xs.map((t, i) => {
    const r = [];
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2;
      r.push([cx + t * w, cy + se(Math.sin(a), e) * (h / 2) * sh[i], cz + se(Math.cos(a), e) * (d / 2) * sh[i]]);
    }
    return r;
  });
  k.loft(P, attrs, { closed: true, capStart: true, capEnd: true });
}

// Wheels: lathe tyre with a rounded shoulder, rim and hub; dark liners in the arches
const tyreCache = new Map();
function tyreGeo(r, w, detail) {
  const key = `${r}|${w}|${detail}`;
  if (tyreCache.has(key)) return tyreCache.get(key);
  const pts = [];
  const rim = r * 0.62;
  const prof = [[rim, -w / 2], [r * 0.9, -w / 2], [r * 0.98, -w * 0.44], [r, -w * 0.3], [r, w * 0.3], [r * 0.98, w * 0.44], [r * 0.9, w / 2], [rim, w / 2]];
  for (const [x, y] of prof) pts.push(new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, detail ? 18 : 8).rotateZ(Math.PI / 2);
  tyreCache.set(key, g);
  return g;
}
function wheels(k, spec, detail) {
  const { R, track, axles, wheelW = 0.22, steel = false, W } = spec;
  const M = new THREE.Matrix4();
  for (const z of axles) {
    for (const s of [1, -1]) {
      const x = s * (track / 2);
      k.geo(tyreGeo(R, wheelW, detail), TYRE_M, M.makeTranslation(x, R, z));
      // rim: a shallow dish, with a hub cap
      const rimG = new THREE.CylinderGeometry(R * 0.6, R * 0.6, 0.02, detail ? 16 : 8).rotateZ(Math.PI / 2);
      k.geo(rimG, steel ? STEEL_M : m([0.7, 0.71, 0.73], 0, 0.3, 0.9), M.makeTranslation(x + s * (wheelW / 2 - 0.03), R, z));
      if (detail) {
        const hub = new THREE.CylinderGeometry(R * 0.2, R * 0.24, 0.04, 10).rotateZ(Math.PI / 2);
        k.geo(hub, steel ? m([0.85, 0.85, 0.86], 0, 0.3, 0.7) : CHROME_M, M.makeTranslation(x + s * (wheelW / 2 - 0.01), R, z));
        // spokes / holes: dark slots in the dish
        for (let a = 0; a < 5; a++) {
          const ang = (a / 5) * Math.PI * 2;
          k.box(x + s * (wheelW / 2 - 0.018), R + Math.sin(ang) * R * 0.4, z + Math.cos(ang) * R * 0.4, 0.012, R * 0.15, R * 0.15, TRIM_M);
        }
      }
    }
    // liner: dark box filling the arch above the wheels
    k.box(0, R + R * 0.55, z, W - 0.12, R * 1.0, R * 2.3, TRIM_M);
  }
}

// --- the body: lower loft (with arches) + glasshouse ------------------------------------------------------------------
// spec: L, W, R, axles, track, sill, top [[z, y]], width [[z, w]], bottom [[z, y]] (optional extra lift at the ends),
//       eTop/eBot/eSide roundness, cells(c) → attrs override for a lower-body cell (c: {x, y, z, nx, ny, nz})
//       gh: {st: [[z, yRoof, roofW, rowType]...], inset, rr}  rowType for the cell row starting at that station:
//       'ws' windscreen, 'roof', 'pil' pillar, 'rear' back glass
function body(k, spec, detail) {
  const { L, W, R, axles } = spec;
  const archR = R + (spec.archGap ?? 0.07);
  const zs = new Set();
  const step = detail ? 0.18 : 0.45;
  for (let z = -L / 2; z <= L / 2 + 1e-6; z += step) zs.add(+z.toFixed(3));
  zs.add(-L / 2);
  zs.add(L / 2);
  for (const z of [-L / 2 + 0.04, L / 2 - 0.04, -L / 2 + 0.12, L / 2 - 0.12]) zs.add(+z.toFixed(3));
  for (const [z] of spec.top) zs.add(z);
  for (const az of axles) {
    const na = detail ? 10 : 4;
    for (let i = 0; i <= na; i++) zs.add(+(az - archR + (2 * archR * i) / na).toFixed(3));
    zs.add(+(az - archR - 0.01).toFixed(3));
    zs.add(+(az + archR + 0.01).toFixed(3));
  }
  for (const z of spec.extraZ || []) zs.add(z);
  const Z = [...zs].filter((z) => z >= -L / 2 - 1e-6 && z <= L / 2 + 1e-6).sort((a, b) => a - b);
  const n = detail ? 24 : 10;
  const P = Z.map((z) => {
    let yb = spec.bottom ? lerpKeys(spec.bottom, z) : spec.sill;
    for (const az of axles) {
      const d = Math.abs(z - az);
      if (d < archR) yb = Math.max(yb, R + Math.sqrt(archR * archR - d * d) * (spec.archTall ?? 1));
    }
    const yt = lerpKeys(spec.top, z);
    return section(z, lerpKeys(spec.width, z) / 2, Math.min(yb, yt - 0.05), yt, n, spec.eTop, spec.eBot, spec.eSide);
  });
  const cellAt = (i, j) => {
    const a = P[i][j], b = P[i + 1][(j + 1) % n];
    return { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, z: (a[2] + b[2]) / 2, z0: a[2], z1: b[2] };
  };
  k.loft(P, (i, j) => {
    const c = cellAt(i, j);
    return (spec.cells && spec.cells(c)) || PAINT;
  }, { closed: true, capStart: true, capEnd: true, capAttrs: PAINT });

  // glasshouse
  const G = spec.gh;
  if (G) {
    const rr = G.rr ?? 0.09;
    const rows = G.st.map(([z, yr, wr]) => {
      const yb = lerpKeys(spec.top, z) - 0.035;
      const wb = lerpKeys(spec.width, z) - (G.inset ?? 0.1);
      const yt = Math.max(yb + 0.004, yr);
      const h = yt - yb;
      const hw = wb / 2, tw = Math.min(hw, wr / 2);
      const r = Math.min(rr, h * 0.45, tw * 0.5);
      const pts = [];
      // left side bottom → up
      const side = (sgn) => {
        const s = [];
        for (const t of [0, 0.4, 0.75]) s.push([sgn * (hw + (tw - hw) * t * ((h - r) / (h || 1))), yb + (h - r) * t, z]);
        s.push([sgn * (hw + (tw - hw) * ((h - r) / (h || 1))), yt - r, z]);
        return s;
      };
      const arc = (sgn) => {
        const s = [];
        for (const t of [0.33, 0.66]) {
          const a = (t * Math.PI) / 2;
          s.push([sgn * (tw - r + Math.cos(a) * r), yt - r + Math.sin(a) * r, z]);
        }
        return s;
      };
      const L1 = side(1), A1 = arc(1);
      const topPts = [];
      for (const t of [1, 0.5, 0, -0.5, -1]) topPts.push([t * (tw - r), yt + (1 - t * t) * (G.crown ?? 0.02), z]);
      const A2 = arc(-1).reverse(), L2 = side(-1).reverse();
      pts.push(...L1, ...A1, ...topPts, ...A2, ...L2);
      return pts;
    });
    // column types: 0..3 side, 4..5 arc, 6..9 top, 10..11 arc, 12..15 side
    const colType = (j) => (j < 3 ? 'side' : j < 6 ? 'corner' : j < 10 ? 'top' : j < 13 ? 'corner' : 'side');
    const crease = rows.map((r, i) => i);
    k.loft(rows, (i, j) => {
      const t = G.st[i][3], c = colType(j);
      if (t === 'pil') return c === 'side' ? G.pillar || TRIM_M : PAINT;
      if (t === 'door' && c === 'side') return j < 8 ? INTERIOR_M : GLASS_M;
      if (t === 'roof' || t === 'door') return c === 'side' ? (G.cabinLit ? GLASS_CABIN : GLASS_M) : PAINT;
      if (t === 'ws' || t === 'rear') return c === 'corner' ? (G.aPillar || PAINT) : c === 'side' && t === 'ws' ? GLASS_M : GLASS_M;
      return PAINT;
    }, { crease, capEnd: false });
    // drip rails / gutters along the roof edges are implied by the painted corner columns
  }
}

// decal quad facing ±z (plates) or ±x (side panels); u along +x / +z
function decalZ(k, x, y, z, w, h, facing, kind, cell = 0, attrs = m(PLATE, 0, 0.35, 0.0)) {
  const a = { ...attrs, aDec: [kind, cell] };
  const hw = w / 2, hh = h / 2;
  if (facing < 0) k.decal([x + hw, y - hh, z], [x - hw, y - hh, z], [x - hw, y + hh, z], [x + hw, y + hh, z], a);
  else k.decal([x - hw, y - hh, z], [x + hw, y - hh, z], [x + hw, y + hh, z], [x - hw, y + hh, z], a);
}
function decalX(k, x, y, z, w, h, facing, kind, cell = 0, attrs = m(PLATE, 0, 0.35, 0.0)) {
  const a = { ...attrs, aDec: [kind, cell] };
  const hw = w / 2, hh = h / 2;
  if (facing < 0) k.decal([x, y - hh, z - hw], [x, y - hh, z + hw], [x, y + hh, z + hw], [x, y + hh, z - hw], a);
  else k.decal([x, y - hh, z + hw], [x, y - hh, z - hw], [x, y + hh, z - hw], [x, y + hh, z + hw], a);
}
// slanted decal lying in the windscreen plane (route board on the dash)
function decalPlane(k, c, u, v, w, h, kind, cell, attrs) {
  const a = { ...attrs, aDec: [kind, cell] };
  const P = (su, sv) => [c[0] + u[0] * su * w + v[0] * sv * h, c[1] + u[1] * su * w + v[1] * sv * h, c[2] + u[2] * su * w + v[2] * sv * h];
  k.decal(P(-0.5, -0.5), P(0.5, -0.5), P(0.5, 0.5), P(-0.5, 0.5), a);
}

// Where the body's front (dir 1) or back (dir -1) surface is at (x, y): march in from the end until the rounded
// section contains the point
function surfZ(S, x, y, dir) {
  const eT = S.eTop ?? 0.32, eB = S.eBot ?? 0.22, eS = S.eSide ?? 0.3;
  for (let z = (dir * S.L) / 2; z * dir > -S.L / 2; z -= dir * 0.004) {
    const hw = lerpKeys(S.width, z) / 2, yt = lerpKeys(S.top, z), yb = S.bottom ? lerpKeys(S.bottom, z) : S.sill;
    const yc = (yb + yt) / 2, hh = (yt - yb) / 2;
    const cx = Math.abs(x / hw), cy = Math.abs((y - yc) / hh);
    if (cx > 1 || cy > 1) continue;
    const c = cx ** (1 / eS), sv = cy ** (1 / (y > yc ? eT : eB));
    if (c * c + sv * sv <= 1) return z;
  }
  return 0;
}
// the outermost surface over a small rectangle (so a flat part doesn't sink into a curved panel)
const surfMax = (S, x, y, w, h, dir) => {
  let best = -Infinity * dir;
  for (const dx of [-w / 2, 0, w / 2]) for (const dy of [-h / 2, 0, h / 2]) {
    const z = surfZ(S, x + dx, y + dy, dir);
    best = dir > 0 ? Math.max(best, z) : Math.min(best, z);
  }
  return best;
};
// Lamp lenses: a rounded block in a dark bezel, its face 1 cm proud of the body
function lamp(k, S, x, y, w, h, facing, color, kind, detail) {
  const z = surfMax(S, x, y, w, h, facing);
  if (detail) {
    rbox(k, x, y, z - facing * 0.035, w + 0.03, h + 0.03, 0.08, TRIM_M, 1, 0.25);
    rbox(k, x, y, z - facing * 0.03, w, h, 0.08, lampM(color, kind), 1, 0.25);
  } else k.box(x, y, z - facing * 0.03, w, h, 0.08, lampM(color, kind));
}
function mirrors(k, W, y, z, big, detail) {
  if (!detail) return;
  for (const s of [1, -1]) {
    k.box(s * (W / 2 + 0.04), y - 0.02, z, 0.1, 0.03, 0.03, TRIM_M);
    rbox(k, s * (W / 2 + (big ? 0.16 : 0.12)), y + (big ? 0.06 : 0.02), z - 0.02, big ? 0.06 : 0.16, big ? 0.32 : 0.11, big ? 0.16 : 0.07, PAINT, 1, 0.3);
  }
}

// --- types --------------------------------------------------------------------------------------------------------------
const SPECS = {
  fit: {
    L: 3.96, W: 1.69, R: 0.29, track: 1.47, axles: [1.27, -1.23], sill: 0.27,
    top: [[-1.98, 0.86], [-1.9, 0.98], [-1.5, 0.97], [0.9, 0.9], [1.3, 0.85], [1.75, 0.77], [1.92, 0.66], [1.98, 0.55]],
    width: [[-1.98, 1.52], [-1.85, 1.66], [-1.5, 1.69], [1.5, 1.69], [1.85, 1.62], [1.98, 1.45]],
    bottom: [[-1.98, 0.38], [-1.85, 0.3], [1.85, 0.3], [1.98, 0.36]],
    eTop: 0.3, eBot: 0.2, eSide: 0.3,
    gh: { st: [[1.32, 0.0, 1.5, 'ws'], [0.25, 1.52, 1.24, 'roof'], [-0.2, 1.53, 1.24, 'pil'], [-0.3, 1.53, 1.24, 'roof'], [-1.7, 1.5, 1.2, 'rear'], [-1.9, 0.0, 1.4, 'x']], inset: 0.1, rr: 0.1 },
    lamps: { head: [0.58, 0.8, 1.9, 0.34, 0.12], tail: [0.66, 1.0, -1.93, 0.14, 0.3], plateF: [0.43, 1.98], plateR: [0.62, -1.98] },
    bumper: [0.42, 0.3],
  },
  sedan: {
    L: 4.56, W: 1.76, R: 0.31, track: 1.52, axles: [1.36, -1.3], sill: 0.28,
    top: [[-2.28, 0.8], [-2.18, 0.93], [-1.5, 0.97], [-1.0, 0.97], [0.9, 0.93], [1.35, 0.87], [1.95, 0.8], [2.18, 0.71], [2.28, 0.56]],
    width: [[-2.28, 1.56], [-2.12, 1.72], [-1.8, 1.76], [1.8, 1.76], [2.12, 1.7], [2.28, 1.52]],
    bottom: [[-2.28, 0.4], [-2.12, 0.3], [2.12, 0.3], [2.28, 0.38]],
    eTop: 0.3, eBot: 0.2, eSide: 0.3,
    gh: { st: [[0.92, 0.0, 1.5, 'ws'], [0.08, 1.43, 1.22, 'roof'], [-0.38, 1.44, 1.22, 'pil'], [-0.47, 1.44, 1.22, 'roof'], [-0.9, 1.42, 1.2, 'rear'], [-1.55, 0.0, 1.45, 'x']], inset: 0.1, rr: 0.1 },
    lamps: { head: [0.6, 0.76, 2.22, 0.36, 0.12], tail: [0.62, 0.86, -2.24, 0.34, 0.13], plateF: [0.45, 2.29], plateR: [0.72, -2.25] },
    bumper: [0.42, 0.3],
  },
  hilux: {
    L: 5.3, W: 1.84, R: 0.38, track: 1.58, axles: [1.58, -1.5], sill: 0.5, wheelW: 0.26,
    top: [[-2.65, 1.12], [-0.84, 1.13], [-0.8, 1.15], [1.15, 1.13], [1.8, 1.1], [2.45, 1.04], [2.6, 0.95], [2.65, 0.76]],
    width: [[-2.65, 1.78], [-2.5, 1.82], [2.3, 1.84], [2.55, 1.76], [2.65, 1.58]],
    bottom: [[-2.65, 0.62], [-2.4, 0.52], [2.4, 0.5], [2.65, 0.6]],
    eTop: 0.25, eBot: 0.2, eSide: 0.28, archGap: 0.09,
    gh: { st: [[1.18, 0.0, 1.62, 'ws'], [0.45, 1.83, 1.4, 'roof'], [-0.12, 1.84, 1.4, 'pil'], [-0.2, 1.84, 1.4, 'roof'], [-0.74, 1.83, 1.4, 'rear'], [-0.8, 0.0, 1.62, 'x']], inset: 0.12, rr: 0.1 },
    bed: [-0.84, -2.6, 0.86],
    lamps: { head: [0.62, 1.0, 2.58, 0.4, 0.14], tail: [0.86, 0.98, -2.63, 0.1, 0.34], plateF: [0.62, 2.66], plateR: [0.62, -2.68] },
    bumper: [0.62, 0.3], chromeGrille: true,
  },
  pickup: {
    L: 4.72, W: 1.66, R: 0.34, track: 1.42, axles: [1.42, -1.35], sill: 0.45, wheelW: 0.2,
    top: [[-2.36, 1.02], [-0.46, 1.03], [-0.42, 1.05], [0.95, 1.03], [1.6, 1.0], [2.2, 0.96], [2.32, 0.86], [2.36, 0.68]],
    width: [[-2.36, 1.62], [-2.25, 1.66], [2.15, 1.66], [2.3, 1.6], [2.36, 1.5]],
    bottom: [[-2.36, 0.55], [-2.25, 0.46], [2.25, 0.45], [2.36, 0.55]],
    eTop: 0.18, eBot: 0.16, eSide: 0.2,
    gh: { st: [[1.0, 0.0, 1.44, 'ws'], [0.5, 1.66, 1.3, 'roof'], [-0.34, 1.66, 1.3, 'rear'], [-0.4, 0.0, 1.44, 'x']], inset: 0.1, rr: 0.06, crown: 0.01 },
    bed: [-0.46, -2.3, 0.8],
    lamps: { head: [0.58, 0.88, 2.3, 0.26, 0.16], tail: [0.78, 0.82, -2.34, 0.08, 0.28], plateF: [0.5, 2.37], plateR: [0.55, -2.38] },
    bumper: [0.5, 0.2], chromeBumper: true, chromeGrille: true,
  },
  kombi: {
    L: 4.84, W: 1.78, R: 0.32, track: 1.52, axles: [1.42, -1.22], sill: 0.34, steel: true,
    top: [[-2.42, 1.08], [-2.36, 1.12], [2.18, 1.13], [2.33, 1.06], [2.4, 0.92], [2.42, 0.62]],
    width: [[-2.42, 1.7], [-2.32, 1.78], [2.2, 1.78], [2.36, 1.72], [2.42, 1.6]],
    bottom: [[-2.42, 0.42], [-2.3, 0.34], [2.3, 0.34], [2.42, 0.42]],
    eTop: 0.2, eBot: 0.16, eSide: 0.24,
    extraZ: [1.12, 0.06, 1.15, 0.03],
    cells: (c) => (c.x > 0.82 && c.z > 0.06 && c.z < 1.12 && c.y > 0.42 ? INTERIOR_M : null), // open sliding door
    gh: {
      st: [[2.22, 0.0, 1.66, 'ws'], [1.6, 2.02, 1.6, 'pil'], [1.5, 2.03, 1.6, 'roof'], [1.2, 2.03, 1.6, 'pil'], [1.12, 2.03, 1.6, 'door'], [0.06, 2.03, 1.6, 'pil'],
        [-0.04, 2.03, 1.6, 'roof'], [-1.0, 2.03, 1.6, 'pil'], [-1.08, 2.03, 1.6, 'roof'], [-2.3, 2.02, 1.6, 'rear'], [-2.38, 0.0, 1.66, 'x']],
      inset: 0.06, rr: 0.14, crown: 0.025, cabinLit: true, aPillar: TRIM_M,
    },
    lamps: { head: [0.62, 0.84, 2.38, 0.3, 0.16], tail: [0.8, 0.82, -2.41, 0.12, 0.3], plateF: [0.5, 2.43], plateR: [0.62, -2.43] },
    bumper: [0.42, 0.28],
  },
  zupco: {
    L: 11.5, W: 2.5, R: 0.5, track: 2.06, axles: [3.4, -2.75], sill: 0.42, steel: true, wheelW: 0.3,
    top: [[-5.75, 1.18], [-5.6, 1.25], [5.6, 1.25], [5.72, 1.2], [5.75, 1.0]],
    width: [[-5.75, 2.42], [-5.6, 2.5], [5.6, 2.5], [5.75, 2.4]],
    bottom: [[-5.75, 0.55], [-5.5, 0.42], [5.5, 0.42], [5.75, 0.55]],
    eTop: 0.14, eBot: 0.12, eSide: 0.16,
    extraZ: [4.55, 5.45, 4.6, 5.4, 0.45, 1.35, 0.5, 1.3],
    cells: (c) => (c.x > 1.15 && c.y > 0.45 && ((c.z > 4.6 && c.z < 5.4) || (c.z > 0.5 && c.z < 1.3)) ? INTERIOR_M : c.y > 0.62 && c.y < 0.98 && Math.abs(c.x) > 1.15 ? m(BLUE, 0, 0.3, 0.2) : null),
    gh: {
      st: [[5.72, 0.0, 2.3, 'ws'], [5.52, 3.12, 2.32, 'pil'], [5.42, 3.14, 2.32, 'door'], [4.6, 3.14, 2.32, 'pil'], [4.5, 3.14, 2.32, 'roof'], [3.3, 3.14, 2.32, 'pil'], [3.2, 3.14, 2.32, 'roof'],
        [2.0, 3.14, 2.32, 'pil'], [1.9, 3.14, 2.32, 'roof'], [0.6, 3.14, 2.32, 'pil'], [0.5, 3.14, 2.32, 'roof'], [-0.7, 3.14, 2.32, 'pil'], [-0.8, 3.14, 2.32, 'roof'],
        [-2.0, 3.14, 2.32, 'pil'], [-2.1, 3.14, 2.32, 'roof'], [-3.3, 3.14, 2.32, 'pil'], [-3.4, 3.14, 2.32, 'roof'], [-4.6, 3.14, 2.32, 'pil'], [-4.7, 3.14, 2.32, 'roof'],
        [-5.6, 3.12, 2.32, 'rear'], [-5.72, 0.0, 2.3, 'x']],
      inset: 0.04, rr: 0.16, crown: 0.03, cabinLit: true, aPillar: TRIM_M,
    },
    lamps: { head: [0.9, 0.78, 5.74, 0.34, 0.16], tail: [1.08, 0.95, -5.74, 0.14, 0.36], plateF: [0.5, 5.76], plateR: [0.62, -5.76] },
    bumper: [0.5, 0.32],
  },
};
SPECS.police = { ...SPECS.hilux, police: true };

function build(type, k, detail, full) {
  const S = SPECS[type];
  body(k, S, detail);
  const { L, W } = S;
  const fz = L / 2, rz = -L / 2;
  // bumpers, hugging the nose and tail
  const [by, bh] = S.bumper;
  const bm = S.chromeBumper ? CHROME_M : type === 'sedan' || type === 'fit' ? PAINT : PLASTIC_M;
  const bzF = surfMax(S, 0, by, W * 0.9, bh * 0.6, 1) + 0.03, bzR = surfMax(S, 0, by, W * 0.9, bh * 0.6, -1) - 0.03;
  rbox(k, 0, by, bzF, W * 0.97, bh * 0.6, 0.12, bm, detail);
  rbox(k, 0, by, bzR, W * 0.97, bh * 0.6, 0.12, bm, detail);
  if (detail) rbox(k, 0, by - bh * 0.32, bzF - 0.02, W * 0.85, 0.06, 0.12, PLASTIC_M, detail);
  // lamps
  const lp = S.lamps;
  const [hx, hy, , hw, hh] = lp.head;
  const [tx, ty, , tw, th] = lp.tail;
  for (const s of [1, -1]) {
    lamp(k, S, s * hx, hy, hw, hh, 1, HEAD, LAMP.HEAD, detail);
    lamp(k, S, s * (hx + hw / 2 + 0.065), hy - 0.01, 0.07, hh * 0.7, 1, AMBER, s > 0 ? LAMP.IND_FL : LAMP.IND_FR, detail);
    lamp(k, S, s * tx, ty, tw, th, -1, TAIL, LAMP.TAIL, detail);
    if (th > tw) lamp(k, S, s * tx, ty - th / 2 - 0.06, tw, 0.07, -1, AMBER, s > 0 ? LAMP.IND_RL : LAMP.IND_RR, detail);
    else lamp(k, S, s * (tx - tw / 2 - 0.065), ty, 0.08, th * 0.8, -1, AMBER, s > 0 ? LAMP.IND_RL : LAMP.IND_RR, detail);
  }
  // grille between the headlamps
  const gw = hx * 2 - hw - 0.08;
  if (gw > 0.2) {
    const gz = surfMax(S, 0, hy, gw, hh, 1);
    k.box(0, hy - 0.01, gz - 0.02, gw, hh * 1.1, 0.06, S.chromeGrille ? CHROME_M : TRIM_M);
    if (detail) for (let i = -1; i <= 1; i++) k.box(0, hy - 0.01 + i * hh * 0.3, gz + 0.012, gw - 0.04, 0.012, 0.01, S.chromeGrille ? TRIM_M : PLASTIC_M);
  }
  // plates (Zimbabwe: black on white, yellowish at the back): front on the bumper, rear on the tailgate / boot
  if (detail) {
    decalZ(k, 0, by, bzF + 0.062, 0.44, 0.11, 1, 1, 0);
    const pr = lp.plateR[0];
    const prz = pr < by + bh * 0.3 ? bzR - 0.062 : surfMax(S, 0, pr, 0.44, 0.11, -1) - 0.006;
    decalZ(k, 0, pr, prz, 0.44, 0.11, -1, 1, 1);
  }
  // mirrors at the base of the A pillars
  const gh0 = S.gh.st[0];
  mirrors(k, W, lerpKeys(S.top, gh0[0]) + 0.12, gh0[0] - 0.1, type === 'kombi' || type === 'zupco', detail);
  wheels(k, S, detail);

  // open load bed: liner floor, side walls, tailgate
  if (S.bed) {
    const [z0, z1, fy] = S.bed, len = z0 - z1, cz = (z0 + z1) / 2, top = lerpKeys(S.top, z1 + 0.1) + 0.02;
    k.box(0, fy, cz, W - 0.12, 0.04, len, LINER_M);
    k.box(0, (fy + top) / 2 - 0.01, z0 + 0.0, W - 0.1, top - fy, 0.06, LINER_M);
    for (const s of [1, -1]) k.box(s * (W / 2 - 0.08), (fy + top) / 2, cz, 0.04, top - fy, len, LINER_M);
  }
  if (type === 'hilux' || type === 'police') {
    // roll bar behind the cab and side steps
    if (detail) {
      for (const s of [1, -1]) k.box(s * 0.7, 1.45, -0.95, 0.06, 0.62, 0.06, CHROME_M);
      k.box(0, 1.74, -0.95, 1.46, 0.06, 0.06, CHROME_M);
      for (const s of [1, -1]) k.box(s * (W / 2 - 0.02), 0.5, 0.05, 0.14, 0.05, 1.8, PLASTIC_M);
    }
  }
  if (S.police) {
    // light bar on the cab roof + doors lettered ZRP POLICE + blue band
    const y = 1.88;
    rbox(k, 0, y, 0.1, 1.2, 0.12, 0.26, TRIM_M, detail);
    for (const s of [1, -1]) rbox(k, s * 0.32, y + 0.02, 0.1, 0.5, 0.12, 0.24, lampM(s > 0 ? [0.8, 0.05, 0.05] : [0.05, 0.15, 0.9], s > 0 ? LAMP.BAR_R : LAMP.BAR_B), detail);
    for (const s of [1, -1]) {
      k.box(s * (W / 2 + 0.003), 0.86, 0.0, 0.006, 0.12, 4.9, m(BLUE, 0, 0.3, 0.1));
      if (detail) decalX(k, s * (W / 2 + 0.008), 0.98, 0.35, 1.3, 0.2, s, 3, 61);
    }
  }
  if (type === 'kombi') {
    // blue waist stripe, step under the door, roof rack, route board on the dash
    for (const s of [1, -1]) {
      k.box(s * (W / 2 + 0.003), 0.95, -0.6, 0.006, 0.07, 3.5, m(BLUE, 0, 0.3, 0.1));
      k.box(s * (W / 2 + 0.003), 0.95, 1.8, 0.006, 0.07, 0.8, m(BLUE, 0, 0.3, 0.1));
    }
    k.box(W / 2 - 0.08, 0.36, 0.58, 0.2, 0.05, 1.0, PLASTIC_M);
    for (const s of [1, -1]) k.box(s * 0.74, 2.1, -0.4, 0.04, 0.04, 3.4, RACK_M);
    for (const z of [-2.0, -1.1, -0.2, 0.7, 1.25]) k.box(0, 2.1, z, 1.52, 0.035, 0.04, RACK_M);
    for (const z of [-1.9, 0.9]) for (const s of [1, -1]) k.box(s * 0.74, 2.065, z, 0.04, 0.07, 0.04, RACK_M);
    // luggage on the rack: two optional sets
    const lug = (opt, list) => {
      for (const [x, y, z, w, h, d, c] of list) {
        if (detail) rbox(k, x, y, z, w, h, d, { ...m(c, 0, 0.85, 0), aOpt: opt }, 1, 0.45);
        else k.box(x, y, z, w, h, d, { ...m(c, 0, 0.85, 0), aOpt: opt });
      }
    };
    lug(1, [[0.3, 2.28, -1.2, 0.6, 0.34, 0.75, [0.2, 0.32, 0.6]], [-0.35, 2.26, -1.35, 0.55, 0.3, 0.6, [0.55, 0.12, 0.1]], [0.0, 2.25, -0.3, 0.9, 0.28, 0.7, [0.7, 0.66, 0.6]]]);
    if (full) lug(2, [[-0.2, 2.3, 0.3, 0.8, 0.38, 0.9, [0.16, 0.5, 0.75]], [0.4, 2.24, -0.6, 0.45, 0.26, 0.5, [0.25, 0.25, 0.22]], [-0.35, 2.22, -1.6, 0.5, 0.22, 0.6, [0.62, 0.4, 0.15]], [0.3, 2.27, -1.75, 0.55, 0.32, 0.55, [0.7, 0.68, 0.66]]]);
    if (detail) {
      // dash board behind the windscreen: TOWN – <suburb>
      const zb = 2.22, zt = 1.6, yb = 1.1, yt = 2.02;
      const vl = Math.hypot(zt - zb, yt - yb), v = [0, (yt - yb) / vl, (zt - zb) / vl];
      const nrm = [0, v[2], -v[1]].map((q) => -q);
      const c = [0.3, yb + v[1] * 0.17 + nrm[1] * 0.012, zb + v[2] * 0.17 + nrm[2] * 0.012];
      decalPlane(k, c, [1, 0, 0], v, 0.66, 0.15, 2, 0, m([1, 1, 1], 0, 0.6, 0));
    }
  }
  if (type === 'zupco') {
    for (const s of [1, -1]) {
      k.box(s * (W / 2 + 0.003), 1.06, -0.2, 0.006, 0.05, 10.8, m([0.75, 0.08, 0.08], 0, 0.3, 0.1));
      if (detail) decalX(k, s * (W / 2 + 0.008), 0.8, -2.4, 2.4, 0.36, s, 3, 60);
    }
    rbox(k, 0, 3.25, -1.0, 1.7, 0.22, 2.6, m([0.82, 0.83, 0.84], 0, 0.4, 0.3), detail);
    if (detail) decalZ(k, 0, 2.92, 5.68, 1.4, 0.24, 1, 3, 62, m([1, 1, 1], 0, 0.5, 0));
  }
}

export const VEHICLE_TYPES = {
  fit: { len: 4.0, maxV: 1.0, weight: 0.28, colors: ['#c8ccd0', '#e8e8e6', '#2b3a55', '#8a1c1c', '#3c3f42', '#d9d2c0', '#5e7d9a', '#b5b8bb'] },
  sedan: { len: 4.6, maxV: 1.05, weight: 0.22, colors: ['#f0f0ee', '#b9bcc0', '#1e1f22', '#22406a', '#6b6f73', '#7a2a24', '#c9c3b2'] },
  hilux: { len: 5.3, maxV: 1.0, weight: 0.13, colors: ['#f2f2f0', '#a7aaae', '#3a3c3e', '#b33a2a', '#d4c7a8', '#1f2a3a'] },
  pickup: { len: 4.75, maxV: 0.85, weight: 0.07, old: true, colors: ['#8a9a7a', '#c9c1a8', '#9a3a28', '#3a5a7a', '#d8d3c6', '#6a6458', '#e6e2d6'] },
  police: { len: 5.3, maxV: 1.1, weight: 0.015, colors: ['#f4f4f2'] },
  kombi: { len: 4.9, maxV: 1.15, weight: 0.24, kombi: true, colors: ['#f4f4f2', '#eeeeec', '#e9eae8', '#f1efe8', '#e8e6df'] },
  zupco: { len: 11.5, maxV: 0.85, weight: 0.05, colors: ['#f6f6f4'] },
};
// head / tail lamp positions (local) for the glow sprites and light pools: [half spacing x, head y, front z, tail y, rear z]
for (const t in VEHICLE_TYPES) {
  const S = SPECS[t];
  const hz = surfMax(S, S.lamps.head[0], S.lamps.head[1], S.lamps.head[3], S.lamps.head[4], 1) + 0.02;
  const tz = surfMax(S, S.lamps.tail[0], S.lamps.tail[1], S.lamps.tail[3], S.lamps.tail[4], -1) - 0.02;
  S.lamps.head[2] = hz;
  S.lamps.tail[2] = tz;
  VEHICLE_TYPES[t].lampDims = [S.lamps.head[0], S.lamps.head[1], hz, S.lamps.tail[1], tz, S.lamps.tail[0]];
  VEHICLE_TYPES[t].lights = [[S.lamps.head[0], S.lamps.head[1], S.lamps.head[2]], [-S.lamps.head[0], S.lamps.head[1], S.lamps.head[2]]];
  VEHICLE_TYPES[t].tail = [[S.lamps.tail[0], S.lamps.tail[1], S.lamps.tail[2]], [-S.lamps.tail[0], S.lamps.tail[1], S.lamps.tail[2]]];
  VEHICLE_TYPES[t].axles = S.axles;
  VEHICLE_TYPES[t].width = S.W;
}

const ATTRS = { color: 3, aMat: 4, aDec: 2, aUv: 2, aOpt: 1 };
const geoCache = new Map();
// detail 1: near LOD (default), 0: far LOD. full: include every optional part (traffic toggles them per instance with
// aOpt); without it a standalone model (e.g. the player's kombi) gets just the first luggage set.
export function vehicleGeometry(type, detail = 1, full = false) {
  const key = type + detail + (full ? 'f' : '');
  if (!geoCache.has(key)) {
    const k = new MeshKit(ATTRS);
    build(type, k, detail, full);
    const g = k.build();
    g.userData.verts = k.vertexCount;
    geoCache.set(key, g);
  }
  return geoCache.get(key).clone();
}

function boxes(list) {
  const pos = [], nrm = [], col = [];
  for (const [cx, cy, cz, w, h, d, color] of list) {
    const g = new THREE.BoxGeometry(w, h, d).translate(cx, cy, cz).toNonIndexed();
    pos.push(...g.attributes.position.array);
    nrm.push(...g.attributes.normal.array);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(...color);
  }
  return makeGeometry(THREE, { position: [pos, 3], normal: [nrm, 3], color: [col, 3] });
}

// Head and tail lamp lenses as one geometry (for a standalone vehicle, e.g. the player's kombi): white at the front,
// red at the back (vertex colours), sitting just proud of the body's own lenses
export function lampGeometry(type) {
  const S = SPECS[type];
  const [hx, hy, hz, hw, hh] = S.lamps.head, [tx, ty, tz, tw, th] = S.lamps.tail;
  const list = [];
  for (const s of [1, -1]) {
    list.push([s * hx, hy, hz + 0.012, hw * 0.92, hh * 0.85, 0.02, [1, 0.95, 0.8]]);
    list.push([s * tx, ty, tz - 0.012, tw * 0.9, th * 0.9, 0.02, [1, 0.08, 0.04]]);
  }
  return boxes(list);
}

// --- decal atlas: number plates, route boards, liveries ------------------------------------------------------------------
export const ATLAS = { cols: 4, rows: 16, plates: 48, routes: 12 };
export const ROUTES = ['MBARE', 'HIGHFIELD', 'CHITUNGWIZA', 'KUWADZANA', 'EPWORTH', 'BUDIRIRO', 'GLEN VIEW', 'WARREN PARK', 'DZIVARASEKWA', 'MABVUKU', 'TAFARA', 'MUFAKOSE'];
let atlasTex = null;
export function decalAtlas() {
  if (atlasTex) return atlasTex;
  const cw = 256, ch = 64;
  const cv = document.createElement('canvas');
  cv.width = cw * ATLAS.cols;
  cv.height = ch * ATLAS.rows;
  const g = cv.getContext('2d');
  const r = (() => {
    let s = 77;
    return () => (s = (s * 48271) % 2147483647) / 2147483647;
  })();
  const L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  const cell = (i) => [(i % ATLAS.cols) * cw, Math.floor(i / ATLAS.cols) * ch];
  for (let i = 0; i < ATLAS.plates; i++) {
    const [x, y] = cell(i);
    g.fillStyle = '#f4f2ea';
    g.fillRect(x, y, cw, ch);
    g.strokeStyle = '#111';
    g.lineWidth = 4;
    g.strokeRect(x + 4, y + 4, cw - 8, ch - 8);
    // little ZW flag stripe at the left edge
    ['#2c8a3a', '#f2c230', '#c8261e', '#111', '#c8261e', '#f2c230', '#2c8a3a'].forEach((c, k) => {
      g.fillStyle = c;
      g.fillRect(x + 10, y + 12 + k * 5.7, 18, 5.7);
    });
    const letters = (i % 3 === 0 ? 2 : 3);
    let t = '';
    for (let k = 0; k < letters; k++) t += L[Math.floor(r() * L.length)];
    t += ' ' + String(1000 + Math.floor(r() * 9000));
    g.fillStyle = '#111';
    g.font = 'bold 42px "Arial Narrow", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(t, x + cw / 2 + 14, y + ch / 2 + 2, cw - 50);
  }
  for (let i = 0; i < ATLAS.routes; i++) {
    const [x, y] = cell(ATLAS.plates + i);
    g.fillStyle = '#f6f4ec';
    g.fillRect(x, y, cw, ch);
    g.fillStyle = '#c42a1e';
    g.fillRect(x, y, cw, 12);
    g.fillStyle = '#111';
    g.font = 'bold 30px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(`TOWN – ${ROUTES[i]}`, x + cw / 2, y + ch / 2 + 6, cw - 12);
  }
  const text = (i, bg, fg, s, size = 40) => {
    const [x, y] = cell(i);
    g.fillStyle = bg;
    g.fillRect(x, y, cw, ch);
    g.fillStyle = fg;
    g.font = `bold ${size}px Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(s, x + cw / 2, y + ch / 2 + 2, cw - 10);
  };
  text(60, '#f6f6f4', '#1a3f8a', 'ZUPCO', 52);
  text(61, '#f4f4f2', '#1a3f8a', 'ZRP  POLICE', 40);
  text(62, '#101010', '#ffb21a', 'TOWN  ·  ZUPCO', 34);
  atlasTex = new THREE.CanvasTexture(cv);
  atlasTex.colorSpace = THREE.SRGBColorSpace;
  atlasTex.anisotropy = 4;
  atlasTex.generateMipmaps = true;
  return atlasTex;
}
