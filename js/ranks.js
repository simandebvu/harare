// js/ranks.js — kombi ranks at Harare's termini. A deterministic layout (parked kombi slots, queues, milling crowds,
// touts, shelters, stalls) shared by traffic.js (parks the kombis) and people.js (fills the rank with people).
import { pointInPoly, polyBounds, rng } from './util.js';

const RANKS = [
  { n: 'Fourth Street', place: 'Fourth Street Bus Terminus', x: 422, z: 57, r: 64, max: 90 },
  { n: 'Road Port', place: 'Road Port', x: 546, z: 76, r: 40, max: 22 },
  { n: 'Market Square', place: 'Market Square', x: -1049, z: 803, r: 52, max: 50 },
  { n: 'Charge Office', place: 'Charge Office Taxi Rank', x: -319, z: 502, r: 36, max: 30 },
  { n: 'Copacabana', x: -330, z: 380, r: 50, max: 26 },
];
export const KOMBI_W = 1.9, KOMBI_L = 4.9;

let cache = null;

export function rankLayout(DATA) {
  if (cache && cache.DATA === DATA) return cache.out;
  const r = rng(2024);
  const out = [];
  for (const R of RANKS) {
    const pl = R.place && DATA.places.find((p) => p.n === R.place);
    const cx = pl ? pl.x : R.x, cz = pl ? pl.z : R.z, rad = R.r;
    const near = (p) => {
      for (let i = 0; i < p.length; i += 2) if (Math.abs(p[i] - cx) < rad + 60 && Math.abs(p[i + 1] - cz) < rad + 60) return true;
      return false;
    };
    const bld = DATA.buildings.filter((b) => near(b.p)).map((b) => ({ p: b.p, bb: polyBounds(b.p) }));
    const roads = DATA.graph.edges.filter((e) => near(e.p));
    const service = DATA.roads.filter((e) => e.k === 'service' && near(e.p));

    const segDist = (x, z, p) => {
      let best = 1e9;
      for (let k = 0; k + 3 < p.length; k += 2) {
        const ax = p[k], az = p[k + 1], dx = p[k + 2] - ax, dz = p[k + 3] - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
        best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
      }
      return best;
    };
    const inBuilding = (x, z) => bld.some(({ p, bb }) => x > bb[0] - 0.5 && x < bb[2] + 0.5 && z > bb[1] - 0.5 && z < bb[3] + 0.5 && pointInPoly(x, z, p));
    // Clear of buildings and of the carriageway of graph roads (where traffic drives), with a margin
    const free = (x, z, margin = 1) => {
      if (Math.hypot(x - cx, z - cz) > rad) return false;
      if (inBuilding(x, z)) return false;
      for (const e of roads) if (segDist(x, z, e.p) < e.w / 2 + margin) return false;
      return true;
    };
    // Height of whatever surface (x, z) lies on: service road asphalt, pavement next to a street, or bare ground
    const surfaceY = (x, z) => {
      for (const e of service) if (segDist(x, z, e.p) < e.w / 2) return 0.22;
      for (const e of roads) if (segDist(x, z, e.p) < e.w / 2 + 3.5) return 0.15;
      return 0.05;
    };

    // Oriented-rectangle overlap test against parked kombis (in each slot's frame, slightly padded)
    const slots = [];
    const hits = (x, z, hw, hl, pad = 0.3) => {
      for (const s of slots) {
        const dx = x - s.x, dz = z - s.z;
        const lx = dx * Math.cos(s.yaw) - dz * Math.sin(s.yaw), lz = dx * Math.sin(s.yaw) + dz * Math.cos(s.yaw);
        const ext = Math.max(hw, hl);
        if (Math.abs(lx) < KOMBI_W / 2 + ext + pad && Math.abs(lz) < KOMBI_L / 2 + ext + pad) return true;
      }
      return false;
    };
    const local = (s, lx, lz) => [s.x + Math.cos(s.yaw) * lx + Math.sin(s.yaw) * lz, s.z - Math.sin(s.yaw) * lx + Math.cos(s.yaw) * lz];
    const slotFree = (x, z, yaw) => {
      const s = { x, z, yaw };
      for (const [lx, lz] of [[0, 0], [1, 2.5], [-1, 2.5], [1, -2.5], [-1, -2.5]]) {
        const [px, pz] = local(s, lx, lz);
        if (!free(px, pz, 1.2)) return false;
      }
      for (const o of slots) if (Math.hypot(o.x - x, o.z - z) < 2.1) return false;
      return !hitsKombi(x, z, yaw);
    };
    // Two kombis overlap if any corner of one lies inside the other
    const hitsKombi = (x, z, yaw) => {
      const s = { x, z, yaw };
      const pts = [[0, 0], [0.95, 2.45], [-0.95, 2.45], [0.95, -2.45], [-0.95, -2.45], [0.95, 0], [-0.95, 0]].map(([a, b]) => local(s, a, b));
      for (const o of slots) {
        if (Math.hypot(o.x - x, o.z - z) > 7) continue;
        for (const [px, pz] of pts) {
          const dx = px - o.x, dz = pz - o.z;
          const lx = dx * Math.cos(o.yaw) - dz * Math.sin(o.yaw), lz = dx * Math.sin(o.yaw) + dz * Math.cos(o.yaw);
          if (Math.abs(lx) < KOMBI_W / 2 + 0.25 && Math.abs(lz) < KOMBI_L / 2 + 0.3) return true;
        }
      }
      return false;
    };

    // 1) Queues of kombis nose-to-tail along the rank's service lanes
    for (const e of service) {
      const p = e.p;
      let carry = r() * 3;
      for (let k = 0; k + 3 < p.length && slots.length < R.max; k += 2) {
        const ax = p[k], az = p[k + 1], dx = p[k + 2] - ax, dz = p[k + 3] - az;
        const L = Math.hypot(dx, dz);
        const yaw = Math.atan2(dx, dz);
        for (let d = carry; d < L && slots.length < R.max; d += 5.6) {
          const x = ax + (dx * d) / L, z = az + (dz * d) / L;
          if (r() < 0.12) continue; // a gap where one has just pulled out
          if (slotFree(x, z, yaw)) slots.push({ x, z, yaw: yaw + (r() - 0.5) * 0.06, lane: true });
        }
        carry = 0;
      }
    }
    // 2) Side-by-side rows on open ground, aligned with the nearest street
    if (slots.length < R.max * 0.7) {
      let yaw = 0, bd = 1e9;
      for (const e of roads) {
        for (let k = 0; k + 3 < e.p.length; k += 2) {
          const d = segDist(cx, cz, [e.p[k], e.p[k + 1], e.p[k + 2], e.p[k + 3]]);
          if (d < bd) (bd = d), (yaw = Math.atan2(e.p[k + 2] - e.p[k], e.p[k + 3] - e.p[k + 1]));
        }
      }
      // rows run along the street; kombis stand across it, 2.6 m apart, rows 11 m apart with an aisle
      const ux = Math.sin(yaw), uz = Math.cos(yaw), vx = Math.cos(yaw), vz = -Math.sin(yaw);
      for (let row = -6; row <= 6 && slots.length < R.max; row++)
        for (let col = -16; col <= 16 && slots.length < R.max; col++) {
          if (r() < 0.15) continue;
          const x = cx + vx * row * 11 + ux * col * 2.6, z = cz + vz * row * 11 + uz * col * 2.6;
          const ky = yaw + Math.PI / 2 + (row % 2 ? Math.PI : 0) + (r() - 0.5) * 0.08;
          if (slotFree(x, z, ky)) slots.push({ x, z, yaw: ky, lane: false });
        }
    }
    for (const s of slots) s.y = surfaceY(s.x, s.z) > 0.2 ? 0.22 : 0.05;

    // 3) People: queues at the sliding door (kombi's left, +x local), touts, milling crowd; shelters over some queues
    const crowd = [], shelters = [], stalls = [];
    const person = (x, z, yaw, kind) => crowd.push({ x, z, y: surfaceY(x, z), yaw, kind });
    slots.forEach((s, i) => {
      if (r() < 0.55) {
        const n = 2 + Math.floor(r() * 5);
        for (let j = 0; j < n; j++) {
          const [x, z] = local(s, 1.5 + r() * 1.2, -2 + j * 0.75 + (r() - 0.5) * 0.3);
          if (free(x, z, 0.5) && !hits(x, z, 0.2, 0.2, -0.1)) person(x, z, s.yaw - Math.PI / 2 + (r() - 0.5) * 1.2, 'queue');
        }
      }
      if (i % 6 === 2) {
        const [x, z] = local(s, 1.8, 3.2);
        if (free(x, z, 0.5) && !hits(x, z, 0.2, 0.2, 0)) person(x, z, s.yaw + (r() - 0.5) * 2, 'tout');
      }
      if (i % 9 === 4) {
        const len = 7 + r() * 5;
        const [x, z] = local(s, 2.9, 0);
        let ok = true;
        for (const t of [-0.5, 0, 0.5]) {
          const [px, pz] = local({ x, z, yaw: s.yaw }, 0, t * len);
          if (!free(px, pz, 0.6) || hits(px, pz, 1.1, 0.4, 0)) ok = false;
        }
        if (ok && !shelters.some((o) => Math.hypot(o.x - x, o.z - z) < len)) shelters.push({ x, z, y: surfaceY(x, z), yaw: s.yaw, len });
      }
    });
    const nMill = Math.round(slots.length * 2.2 + 30);
    for (let k = 0, tries = 0; k < nMill && tries < nMill * 20; tries++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (!free(x, z, 0.6) || hits(x, z, 0.3, 0.3, 0)) continue;
      person(x, z, r() * Math.PI * 2, r() < 0.12 ? 'tout' : 'mill');
      k++;
    }
    // Stalls on the rank's edges: airtime, sweets, fruit
    for (let k = 0, tries = 0; k < Math.round(rad / 6) && tries < 400; tries++) {
      const a = r() * Math.PI * 2, d = rad * (0.55 + r() * 0.45);
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (!free(x, z, 1.5) || hits(x, z, 1.6, 1.6, 0.3) || stalls.some((o) => Math.hypot(o.x - x, o.z - z) < 4)) continue;
      stalls.push({ x, z, y: surfaceY(x, z), yaw: Math.atan2(cx - x, cz - z) });
      k++;
    }
    const clear = (x, z) => free(x, z, 0.5) && !hits(x, z, 0.25, 0.25, 0);
    out.push({ n: R.n, x: cx, z: cz, r: rad, slots, crowd, shelters, stalls, free, clear, surfaceY });
  }
  cache = { DATA, out };
  return out;
}
