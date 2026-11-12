// js/protected.js — places the powers leave alone: the Mbuya Nehanda statue and its plaza, Parliament, and the city's
// churches and cathedrals. Heat vision glances off them without scorching or setting fires (features/heat-vision.js).
// Each is a footprint (a polygon, or a circle) grown by a small margin so the pavement right against the wall counts.
const zones = [];
const PAD = 1.5;

function inPoly(p, x, z) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function edgeGap(p, x, z) {
  let g = Infinity;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const ax = p[j], az = p[j + 1], dx = p[i] - ax, dz = p[i + 1] - az, L = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L));
    g = Math.min(g, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return g;
}

export function protectCircle(x, z, r, name) {
  zones.push({ name, x, z, r, box: [x - r, z - r, x + r, z + r] });
}

export function protectPoly(p, name) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) (x0 = Math.min(x0, p[i])), (x1 = Math.max(x1, p[i])), (z0 = Math.min(z0, p[i + 1])), (z1 = Math.max(z1, p[i + 1]));
  zones.push({ name, p, box: [x0 - PAD, z0 - PAD, x1 + PAD, z1 + PAD] });
}

// Parliament and places of worship from the OpenStreetMap buildings
const SACRED = /\b(parliament of zimbabwe|cathedral|church|mosque|synagogue|temple)\b/i;
export function protectFromData(DATA) {
  for (const b of DATA.buildings) {
    if (b.k === 'church' || (b.n && SACRED.test(b.n) && !/offices?\b/i.test(b.n))) protectPoly(b.p, b.n || 'the church');
  }
}

// The name of the protected place at (x, z), or null
export function protectedAt(x, z) {
  for (const o of zones) {
    const [x0, z0, x1, z1] = o.box;
    if (x < x0 || x > x1 || z < z0 || z > z1) continue;
    if (o.r ? Math.hypot(x - o.x, z - o.z) <= o.r : inPoly(o.p, x, z) || edgeGap(o.p, x, z) <= PAD) return o.name;
  }
  return null;
}

export const protectedZones = zones;
