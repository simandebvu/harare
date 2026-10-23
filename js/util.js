// js/util.js — shared helpers: terrain height, seeded random, polygon tests, spatial grid

// The Kopje: granite hill just south-west of the CBD (OSM peak at -17.8439, 31.0388)
export const KOPJE = { x: -1377, z: 1593, r: 420, h: 70 };

// Gentle highveld undulation plus the Kopje. Flat (0) over the CBD grid so streets stay level.
export function groundY(x, z) {
  const dx = x - KOPJE.x, dz = z - KOPJE.z;
  const d = Math.hypot(dx, dz) / KOPJE.r;
  let y = 0;
  if (d < 1) {
    const t = 1 - d * d;
    y += KOPJE.h * t * t * (1 + 0.08 * Math.sin(dx * 0.03) * Math.cos(dz * 0.025));
  }
  return y;
}

export function rng(seed = 1) {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => (s = (s * 48271) % 2147483647) / 2147483647;
}

export function hash2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// p: flat [x0, z0, x1, z1, ...]
export function pointInPoly(x, z, p) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function polyCentroid(p) {
  let x = 0, z = 0;
  const n = p.length / 2;
  for (let i = 0; i < p.length; i += 2) (x += p[i]), (z += p[i + 1]);
  return [x / n, z / n];
}

export function polyBounds(p) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]);
    z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]);
  }
  return [x0, z0, x1, z1];
}

// Uniform grid bucketing items by bounding box, for "what's near (x, z)" queries
export class Grid {
  constructor(cell = 50) {
    this.cell = cell;
    this.map = new Map();
  }
  key(i, j) {
    return i * 100003 + j;
  }
  insert(item, x0, z0, x1, z1) {
    const c = this.cell;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++)
      for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
        const k = this.key(i, j);
        let b = this.map.get(k);
        if (!b) this.map.set(k, (b = []));
        b.push(item);
      }
  }
  query(x, z) {
    return this.map.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))) || [];
  }
  // Items in cells overlapping a radius (may contain duplicates)
  queryRadius(x, z, r) {
    const c = this.cell, out = [];
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++)
      for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) {
        const b = this.map.get(this.key(i, j));
        if (b) for (const it of b) out.push(it);
      }
    return out;
  }
}

// Distance from point to segment, plus the closest parameter t
export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return [Math.hypot(px - (ax + t * dx), pz - (az + t * dz)), t];
}

// Merge plain {position, normal, color, ...} arrays into a BufferGeometry
export function makeGeometry(THREE, attrs, index) {
  const g = new THREE.BufferGeometry();
  for (const [name, [arr, size]] of Object.entries(attrs)) g.setAttribute(name, new THREE.Float32BufferAttribute(arr, size));
  if (index) g.setIndex(index);
  return g;
}

// 1 inside the CBD grid core (towers, pavements, vendors), fading to 0 over the Avenues and industrial edges
export function coreWeight(x, z) {
  const dx = Math.max(0, Math.abs(x + 150) - 650) / 400;
  const dz = Math.max(0, Math.abs(z - 80) - 350) / 300;
  return Math.max(0, 1 - Math.hypot(dx, dz));
}
