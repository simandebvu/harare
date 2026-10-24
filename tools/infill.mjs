// tools/infill.mjs — fills the bare street frontage OSM leaves between mapped buildings in the CBD core.
// Harare's grid is built to the back of the pavement; where OSM has no footprint we add plausible infill blocks
// (k: 'infill') and the occasional open plot (DATA.lots: parking | forecourt | yard).
//
// Method: rasterise everything that must stay clear (roads + pavements, OSM buildings, parks, rail, kombi ranks,
// mapped trees) into a 0.5 m mask, then walk both sides of every street just behind the pavement edge
// (road width/2 + 2.6 m), casting rays inward to find how deep the free ground runs. Free frontage is cut into
// 8–30 m plots; each plot becomes an infill building, a lot, or (for shallow setbacks in front of OSM buildings)
// a paved forecourt strip. Placed plots are stamped back into the mask so nothing overlaps.
//
// Lots: { k, p: [x0,z0, x1,z1, x2,z2, x3,z3], w } — p0→p1 is the street frontage, then the ring runs back into the
// plot; w is a bitmask of edges (bit i = edge p_i→p_i+1) that need a boundary wall (not already backed by a building).

const CELL = 0.5;
const X0 = -1260, Z0 = -640, X1 = 960, Z1 = 800; // covers coreWeight > 0 with margin
const NX = Math.ceil((X1 - X0) / CELL), NZ = Math.ceil((Z1 - Z0) / CELL);
const ROAD = 1, BLD = 2, KEEP = 4, INF = 8, LOT = 16;
const PAVE = 2.6;

const rngOf = (seed) => {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => (s = (s * 48271) % 2147483647) / 2147483647;
};
const q = (v) => Math.round(v * 10) / 10;

export function coreWeight(x, z) {
  const dx = Math.max(0, Math.abs(x + 150) - 650) / 400;
  const dz = Math.max(0, Math.abs(z - 80) - 350) / 300;
  return Math.max(0, 1 - Math.hypot(dx, dz));
}

export function buildInfill({ buildings, roads, areas, rail, trees, ranks, rankOf }) {
  const mask = new Uint8Array(NX * NZ);
  const at = (x, z) => {
    const i = Math.floor((x - X0) / CELL), j = Math.floor((z - Z0) / CELL);
    if (i < 0 || j < 0 || i >= NX || j >= NZ) return 255;
    return mask[j * NX + i];
  };

  // Fill a polygon (flat [x,z,...]) with `bit`, grown by `pad` metres (approximate: also stamps the padded edges)
  function fillPoly(p, bit, pad = 0) {
    let z0 = Infinity, z1 = -Infinity;
    for (let i = 1; i < p.length; i += 2) (z0 = Math.min(z0, p[i])), (z1 = Math.max(z1, p[i]));
    const j0 = Math.max(0, Math.floor((z0 - Z0) / CELL)), j1 = Math.min(NZ - 1, Math.floor((z1 - Z0) / CELL));
    const xs = [];
    for (let j = j0; j <= j1; j++) {
      const z = Z0 + (j + 0.5) * CELL;
      xs.length = 0;
      for (let a = 0, b = p.length - 2; a < p.length; b = a, a += 2) {
        const za = p[a + 1], zb = p[b + 1];
        if (za > z !== zb > z) xs.push(p[a] + ((z - za) / (zb - za)) * (p[b] - p[a]));
      }
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.round((xs[k] - X0) / CELL)), i1 = Math.min(NX - 1, Math.round((xs[k + 1] - X0) / CELL) - 1);
        for (let i = i0; i <= i1; i++) mask[j * NX + i] |= bit;
      }
    }
    if (pad > 0) for (let a = 0, b = p.length - 2; a < p.length; b = a, a += 2) capsule(p[b], p[b + 1], p[a], p[a + 1], pad, bit);
  }
  function capsule(ax, az, bx, bz, r, bit) {
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - X0) / CELL)), i1 = Math.min(NX - 1, Math.floor((Math.max(ax, bx) + r - X0) / CELL));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - r - Z0) / CELL)), j1 = Math.min(NZ - 1, Math.floor((Math.max(az, bz) + r - Z0) / CELL));
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, r2 = r * r;
    for (let j = j0; j <= j1; j++) {
      const z = Z0 + (j + 0.5) * CELL;
      for (let i = i0; i <= i1; i++) {
        const x = X0 + (i + 0.5) * CELL;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        const ex = x - ax - t * dx, ez = z - az - t * dz;
        if (ex * ex + ez * ez <= r2) mask[j * NX + i] |= bit;
      }
    }
  }
  const polyline = (p, r, bit) => {
    for (let i = 2; i < p.length; i += 2) capsule(p[i - 2], p[i - 1], p[i], p[i + 1], r, bit);
  };

  // --- keep-out mask ---
  for (const r of roads) polyline(r.p, r.k === 'service' ? r.w / 2 + 0.6 : r.w / 2 + PAVE, ROAD);
  for (const b of buildings) fillPoly(b.p, BLD, 0.6);
  for (const a of areas) fillPoly(a.p, KEEP, 1);
  for (const r of rail) polyline(r, 7, KEEP);
  for (let i = 0; i < trees.length; i += 2) capsule(trees[i], trees[i + 1], trees[i], trees[i + 1], 2.5, KEEP);
  for (const R of ranks) capsule(R.x, R.z, R.x, R.z, R.r + 6, KEEP);

  // Neighbourhood heights: OSM buildings bucketed by centroid on a 40 m grid
  const hGrid = new Map();
  const hkey = (i, j) => i * 10007 + j;
  for (const b of buildings) {
    let cx = 0, cz = 0;
    const n = b.p.length / 2;
    for (let i = 0; i < b.p.length; i += 2) (cx += b.p[i] / n), (cz += b.p[i + 1] / n);
    const k = hkey(Math.floor(cx / 40), Math.floor(cz / 40));
    (hGrid.get(k) || hGrid.set(k, []).get(k)).push({ x: cx, z: cz, h: b.h });
  }
  const neighbourHeights = (x, z, rad = 60) => {
    const out = [];
    for (let i = Math.floor((x - rad) / 40); i <= Math.floor((x + rad) / 40); i++)
      for (let j = Math.floor((z - rad) / 40); j <= Math.floor((z + rad) / 40); j++)
        for (const b of hGrid.get(hkey(i, j)) || []) if (Math.hypot(b.x - x, b.z - z) < rad) out.push(b.h);
    return out.sort((a, b) => a - b);
  };

  const infill = [], lots = [];
  const stats = { infill: 0, parking: 0, forecourt: 0, yard: 0, frontage: 0 };

  // Walk every street side, busiest roads first so they get the corner plots
  const streets = roads.filter((r) => r.k !== 'service').sort((a, b) => rankOf(b.k) - rankOf(a.k));
  const STEP = 0.5;
  for (const road of streets) {
    const off = road.w / 2 + PAVE + 0.3;
    for (let s = 2; s < road.p.length; s += 2) {
      const ax = road.p[s - 2], az = road.p[s - 1], bx = road.p[s], bz = road.p[s + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 9) continue;
      const tx = (bx - ax) / len, tz = (bz - az) / len;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const core = coreWeight(mx, mz);
      if (core < 0.25) continue;
      for (const side of [1, -1]) {
        const nx = tz * side, nz = -tx * side; // pointing away from the road, into the block
        const rnd = rngOf(Math.floor(mx * 7.1 + mz * 13.3) * 2 + (side > 0 ? 1 : 0));
        // free depth behind each frontage sample (and what stopped the ray)
        const N = Math.floor(len / STEP) + 1;
        const depth = new Float32Array(N), stopBy = new Uint8Array(N);
        for (let k = 0; k < N; k++) {
          const u = k * STEP;
          const fx = ax + tx * u + nx * off, fz = az + tz * u + nz * off;
          let d = 0, hit = 0;
          for (; d < 32; d += 0.5) {
            const m = at(fx + nx * d, fz + nz * d);
            if (m) {
              hit = m;
              break;
            }
          }
          depth[k] = d;
          stopBy[k] = hit;
        }
        // runs of samples with usable depth
        let k = 0;
        while (k < N) {
          if (depth[k] < 1.5) {
            k++;
            continue;
          }
          let e = k;
          while (e + 1 < N && depth[e + 1] >= 1.5) e++;
          cutRun(k, e);
          k = e + 1;
        }

        function cutRun(k0, k1) {
          // split into deep (≥ 8 m, buildable) and shallow stretches
          let k = k0;
          while (k <= k1) {
            const deep = depth[k] >= 8;
            let e = k;
            while (e + 1 <= k1 && depth[e + 1] >= 8 === deep) e++;
            // tiny deep bumps inside a shallow stretch (and vice versa) stay with their neighbours
            if (deep) deepRun(k, e);
            else shallowRun(k, e);
            k = e + 1;
          }
        }
        function minDepth(k0, k1) {
          let d = 99, by = 0;
          for (let i = k0; i <= k1; i++) if (depth[i] < d) (d = depth[i]), (by = stopBy[i]);
          return [d, by];
        }
        function deepRun(k0, k1) {
          const runLen = (k1 - k0) * STEP;
          if (runLen < 6) return shallowRun(k0, k1);
          let u = k0 * STEP;
          const uEnd = k1 * STEP;
          while (uEnd - u >= 6) {
            let L = core > 0.6 ? 9 + rnd() * rnd() * 21 : 10 + rnd() * 20;
            if (uEnd - u - L < 8) L = uEnd - u; // swallow a short remainder
            if (L > 34) L = (uEnd - u) / 2;
            const i0 = Math.round(u / STEP), i1 = Math.min(k1, Math.round((u + L) / STEP));
            const [dmin, by] = minDepth(i0, i1);
            const target = 12 + rnd() * (core > 0.6 ? 18 : 12);
            const d = Math.min(target, dmin - 0.4);
            plot(u, u + L, d, by, dmin);
            u += L;
          }
          stats.frontage += runLen;
        }
        function shallowRun(k0, k1) {
          // setbacks in front of buildings / walls: paved forecourts, split where the depth jumps
          let i = k0;
          while (i <= k1) {
            let e = i, dmin = depth[i];
            while (e + 1 <= k1 && Math.abs(depth[e + 1] - depth[i]) < 2.5 && (e - i) * STEP < 50) (e++), (dmin = Math.min(dmin, depth[e]));
            const L = (e - i) * STEP;
            if (L >= 4 && dmin >= 2.8) emitLot('forecourt', i * STEP, e * STEP, Math.min(dmin, 8) - 0.3, true);
            i = e + 1;
          }
        }
        function corners(u0, u1, d) {
          const P = (u, dd) => [ax + tx * u + nx * (off - 0.3 + dd), az + tz * u + nz * (off - 0.3 + dd)];
          // CCW in x-east/z-south seen from above depends on side; normalise later
          return [P(u0, 0), P(u1, 0), P(u1, d + 0.3), P(u0, d + 0.3)];
        }
        function emitLot(kind, u0, u1, d, open = false) {
          const c = corners(u0, u1, d);
          const p = c.flatMap(([x, z]) => [q(x), q(z)]);
          lots.push(open ? { k: kind, p, open } : { k: kind, p });
          fillPoly(p, LOT, 0.2);
          stats[kind]++;
        }
        function plot(u0, u1, d, by, dmin) {
          const L = u1 - u0;
          const [cx, cz] = (() => {
            const c = corners(u0, u1, d);
            return [(c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2];
          })();
          const w = coreWeight(cx, cz);
          // open plots: more of them toward the fringe; a building behind a short plot reads as its forecourt
          const pOpen = 0.14 + (1 - w) * 0.25;
          if (rnd() < pOpen) {
            const t = rnd();
            const kind = by & BLD && d < 18 && t < 0.5 ? 'forecourt' : t < 0.62 ? 'parking' : 'yard';
            return emitLot(kind, u0, u1, kind === 'parking' ? Math.max(d, Math.min(dmin - 0.4, 16)) : d);
          }
          const hs = neighbourHeights(cx, cz);
          const med = hs.length ? hs[hs.length >> 1] : 8;
          let floors = Math.round(((med - 1) / 3.5) * (0.45 + rnd() * 0.55));
          const cap = 2 + Math.round(4 * w);
          floors = Math.max(2, Math.min(cap, floors));
          if (med > 28 && rnd() < 0.25 * w) floors += 2 + Math.floor(rnd() * 6); // near the towers
          if (L < 10) floors = Math.min(floors, 4);
          if (rnd() < 0.15) floors = Math.max(1, floors - 1);
          const h = floors * 3.5 + 1 + rnd() * 0.8;
          const c = corners(u0, u1, d);
          // inset 0.15 m from the plot line so neighbouring infill walls don't z-fight
          const ex = c[1][0] - c[0][0], ez = c[1][1] - c[0][1], el = Math.hypot(ex, ez) || 1;
          const ix = (ex / el) * 0.15, iz = (ez / el) * 0.15;
          const ring = [[c[0][0] + ix, c[0][1] + iz], [c[1][0] - ix, c[1][1] - iz], [c[2][0] - ix, c[2][1] - iz], [c[3][0] + ix, c[3][1] + iz]];
          // consistent winding with build-data (positive ringArea)
          let a = 0;
          for (let i = 0, j = 3; i < 4; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
          if (a < 0) ring.reverse();
          const p = ring.flatMap(([x, z]) => [q(x), q(z)]);
          infill.push({ h: q(h), p, k: 'infill' });
          fillPoly(p, INF, 0.3);
          stats.infill++;
        }
      }
    }
  }

  // Boundary walls: a lot edge needs one unless a building (OSM or infill) stands right behind it
  for (const lot of lots) {
    const p = lot.p;
    if (lot.open) {
      delete lot.open; // setback strips in front of buildings: no walls
      continue;
    }
    let w = 0;
    for (let i = 0; i < 4; i++) {
      const ax = p[i * 2], az = p[i * 2 + 1], bx = p[((i + 1) % 4) * 2], bz = p[((i + 1) % 4) * 2 + 1];
      const l = Math.hypot(bx - ax, bz - az) || 1;
      // outward normal: away from the lot centre
      const cx = (p[0] + p[4]) / 2, cz = (p[1] + p[5]) / 2;
      let nx = (bz - az) / l, nz = -(bx - ax) / l;
      if (((ax + bx) / 2 - cx) * nx + ((az + bz) / 2 - cz) * nz < 0) (nx = -nx), (nz = -nz);
      let built = 0, n = 0;
      for (let t = 0.1; t < 0.95; t += 0.2) {
        n++;
        const m = at(ax + (bx - ax) * t + nx * 0.9, az + (bz - az) * t + nz * 0.9);
        if (m & (BLD | INF)) built++;
      }
      if (built / n < 0.6) w |= 1 << i;
    }
    if (w) lot.w = w;
  }

  return { infill, lots, stats };
}
