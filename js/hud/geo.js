// js/hud/geo.js — map geometry for the HUD: road segment index, nearest street / intersection, curated places,
// fuzzy search and A* routing over DATA.graph (nodes flat [x,z,...], edges reference nodes by flat offset).

const CELL = 80;

export function shortName(n) {
  return n
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\bAvenue\b/g, 'Ave')
    .replace(/\bStreet\b/g, 'St')
    .replace(/\bSteet\b/g, 'St')
    .replace(/\bRoad\b/g, 'Rd')
    .replace(/\bDrive\b/g, 'Dr')
    .replace(/\bCrescent\b/g, 'Cres')
    .replace(/\bTerrace\b/g, 'Tce')
    .replace(/Fourth St\/ S\.V Muzenda/, 'Fourth St')
    .replace(/\s+/g, ' ')
    .trim();
}

const centroid = (p) => {
  let x = 0, z = 0;
  const n = p.length / 2;
  for (let i = 0; i < p.length; i += 2) (x += p[i]), (z += p[i + 1]);
  return [x / n, z / n];
};

export function buildGeo(DATA) {
  // --- road segment grid ------------------------------------------------------------------------------------------
  const segs = []; // {ax,az,bx,bz,r,len}
  const grid = new Map();
  const key = (cx, cz) => cx * 100003 + cz;
  for (const r of DATA.roads) {
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const s = { ax: r.p[i], az: r.p[i + 1], bx: r.p[i + 2], bz: r.p[i + 3], r };
      s.len = Math.hypot(s.bx - s.ax, s.bz - s.az);
      const id = segs.push(s) - 1;
      const x0 = Math.floor(Math.min(s.ax, s.bx) / CELL), x1 = Math.floor(Math.max(s.ax, s.bx) / CELL);
      const z0 = Math.floor(Math.min(s.az, s.bz) / CELL), z1 = Math.floor(Math.max(s.az, s.bz) / CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const k = key(cx, cz);
        let a = grid.get(k);
        if (!a) grid.set(k, (a = []));
        a.push(id);
      }
    }
  }
  const stamp = new Uint32Array(segs.length);
  let stampN = 0;
  // Visit each segment within ~radius of (x,z) once
  function forSegs(x, z, rad, fn) {
    stampN++;
    const x0 = Math.floor((x - rad) / CELL), x1 = Math.floor((x + rad) / CELL);
    const z0 = Math.floor((z - rad) / CELL), z1 = Math.floor((z + rad) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const a = grid.get(key(cx, cz));
      if (!a) continue;
      for (let i = 0; i < a.length; i++) {
        const id = a[i];
        if (stamp[id] === stampN) continue;
        stamp[id] = stampN;
        fn(segs[id]);
      }
    }
  }
  const segDist = (s, x, z) => {
    const dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l2));
    return Math.hypot(x - s.ax - t * dx, z - s.az - t * dz);
  };
  let nsBest = null, nsD = 0;
  function nearestStreet(x, z, rad = 120) {
    nsBest = null;
    nsD = rad;
    forSegs(x, z, rad, (s) => {
      if (!s.r.n) return;
      const d = segDist(s, x, z) - s.r.w / 2;
      if (d < nsD) (nsD = d), (nsBest = s.r.n);
    });
    return nsBest;
  }

  // --- graph + intersections --------------------------------------------------------------------------------------
  const G = DATA.graph;
  const N = G.nodes.length / 2;
  const adj = Array.from({ length: N }, () => []);
  const edgeLen = new Float32Array(G.edges.length);
  const nodeNames = Array.from({ length: N }, () => new Set());
  G.edges.forEach((e, i) => {
    let L = 0;
    for (let j = 0; j + 3 < e.p.length; j += 2) L += Math.hypot(e.p[j + 2] - e.p[j], e.p[j + 3] - e.p[j + 1]);
    edgeLen[i] = L;
    const a = e.a / 2, b = e.b / 2;
    adj[a].push(i);
    adj[b].push(i);
    if (e.n) nodeNames[a].add(e.n), nodeNames[b].add(e.n);
  });
  const junctions = []; // {x,z,names:[...]}
  for (let i = 0; i < N; i++) if (nodeNames[i].size >= 2) junctions.push({ x: G.nodes[i * 2], z: G.nodes[i * 2 + 1], names: [...nodeNames[i]] });
  // Also junctions between named roads that the graph doesn't join (service lanes, links): skip — graph is enough.
  const jgrid = new Map();
  const JC = 150;
  for (const j of junctions) {
    const k = key(Math.floor(j.x / JC), Math.floor(j.z / JC));
    let a = jgrid.get(k);
    if (!a) jgrid.set(k, (a = []));
    a.push(j);
  }
  // Nearest junction; prefer ones on `street`
  function nearestJunction(x, z, street) {
    let best = null, bd = 1e9;
    const cx = Math.floor(x / JC), cz = Math.floor(z / JC);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const a = jgrid.get(key(cx + dx, cz + dz));
      if (!a) continue;
      for (const j of a) {
        let d = Math.hypot(j.x - x, j.z - z);
        if (street && !j.names.includes(street)) d += 400;
        if (d < bd) (bd = d), (best = j);
      }
    }
    return best && bd < 600 ? best : null;
  }

  // --- places -----------------------------------------------------------------------------------------------------
  const bldByName = new Map();
  for (const b of DATA.buildings) if (b.n && !bldByName.has(b.n)) bldByName.set(b.n, b);
  const placeByName = new Map(DATA.places.map((p) => [p.n, p]));
  const at = (src) => {
    if (src.xz) return src.xz;
    if (src.place && placeByName.get(src.place)) {
      const p = placeByName.get(src.place);
      return [p.x, p.z];
    }
    if (src.b && bldByName.get(src.b)) return centroid(bldByName.get(src.b).p);
    if (src.area) {
      const a = DATA.areas.find((a) => a.n === src.area);
      if (a) return centroid(a.p);
    }
    return null;
  };
  const SPOTS = [
    { n: 'Africa Unity Square', d: 'CBD', place: 'Africa Unity Square', icon: 'park' },
    { n: 'Eastgate', d: 'CBD', b: 'Eastgate Shopping Mall', icon: 'mall' },
    { n: 'Joina City', d: 'CBD', b: 'Joina City Tower', icon: 'tower' },
    { n: 'Reserve Bank of Zimbabwe', d: 'CBD', b: 'Reserve Bank of Zimbabwe', icon: 'tower' },
    { n: 'Parliament of Zimbabwe', d: 'CBD', b: 'Parliament of Zimbabwe', icon: 'civic' },
    { n: 'Town House', d: 'CBD', b: 'Harare Town House', icon: 'civic' },
    { n: 'Harare Gardens', d: 'CBD', xz: [-560, -560], icon: 'park' },
    { n: 'National Gallery', d: 'CBD', place: 'National Gallery of Zimbabwe', icon: 'civic' },
    { n: 'Karigamombe Centre', d: 'CBD', b: 'Karigamombe Centre', icon: 'tower' },
    { n: 'Meikles Hotel', d: 'CBD', place: 'Hyatt Regency Harare The Meikles', icon: 'hotel' },
    { n: 'Main Post Office', d: 'CBD', b: 'Harare Main Post Ofiice', icon: 'civic' },
    { n: 'Harare Station', d: 'Railway', b: 'National Railways Of Zimbabwe, Harare Train Station', icon: 'rail' },
    { n: 'Fourth Street rank', d: 'CBD', place: 'Fourth Street Bus Terminus', icon: 'bus' },
    { n: 'Road Port', d: 'CBD', place: 'Roadport', icon: 'bus' },
    { n: 'Market Square', d: 'Kopje', place: 'Market Square', icon: 'bus' },
    { n: 'Charge Office rank', d: 'Kopje', place: 'Charge Office Taxi Rank', icon: 'bus' },
    { n: 'The Kopje', d: 'Kopje', xz: [-1377, 1593], icon: 'hill', walkTo: [-1433, 1229] },
    { n: 'Rainbow Towers', d: 'West', place: 'The Rainbow Towers', icon: 'hotel' },
    { n: 'Harare Polytechnic', d: 'West', b: 'Harare Polytechnic', icon: 'civic' },
    { n: 'Harare Sports Club', d: 'Belgravia', area: 'Harare Sports Club', icon: 'park' },
    { n: 'Greenwood Park', d: 'The Avenues', area: 'Greenwood Park', icon: 'park' },
  ];
  const spots = [];
  for (const s of SPOTS) {
    const p = at(s);
    if (!p) continue;
    spots.push({ ...s, x: p[0], z: p[1], street: null });
  }
  for (const s of spots) s.street = nearestStreet(s.walkTo?.[0] ?? s.x, s.walkTo?.[1] ?? s.z, 300);

  // Neighbourhood labels (approximate centres, metres from Africa Unity Square)
  const districts = [
    { n: 'CBD', x: -150, z: 0, big: true },
    { n: 'The Avenues', x: 520, z: -1150, big: true },
    { n: 'Kopje', x: -1250, z: 1150 },
    { n: 'Belgravia', x: -700, z: -1700 },
    { n: 'Milton Park', x: -2300, z: -1000 },
    { n: 'Eastlea', x: 1800, z: -250 },
    { n: 'Workington', x: -2600, z: 1350 },
    { n: 'Graniteside', x: 600, z: 1300 },
    { n: 'Arcadia', x: 1550, z: 900 },
    { n: 'Chapman Golf Club', x: 2159, z: -530, small: true },
  ];

  // --- search index -----------------------------------------------------------------------------------------------
  const entries = [];
  const seenStreet = new Map();
  for (const r of DATA.roads) {
    if (!r.n) continue;
    const L = r.p.length;
    const mid = (Math.floor(L / 4) * 2) | 0;
    let e = seenStreet.get(r.n);
    if (!e) {
      e = { n: r.n, kind: 'street', x: r.p[mid], z: r.p[mid + 1], len: 0, sub: r.k.replace(/_link$/, '').replace('unclassified', 'street') };
      seenStreet.set(r.n, e);
      entries.push(e);
    }
    // Place the street's marker on its longest piece nearest the core
    let len = 0;
    for (let i = 0; i + 3 < L; i += 2) len += Math.hypot(r.p[i + 2] - r.p[i], r.p[i + 3] - r.p[i + 1]);
    const score = len - Math.hypot(r.p[mid], r.p[mid + 1]) * 0.15;
    if (score > e.len) (e.len = score), (e.x = r.p[mid]), (e.z = r.p[mid + 1]);
  }
  for (const s of spots) entries.push({ n: s.n, kind: 'place', x: s.x, z: s.z, sub: s.street ? shortName(s.street) : s.d, spot: s });
  const seenPlace = new Set(spots.map((s) => s.n));
  for (const p of DATA.places) {
    if (seenPlace.has(p.n)) continue;
    seenPlace.add(p.n);
    entries.push({ n: p.n, kind: 'place', x: p.x, z: p.z, sub: p.k.replace(/_/g, ' ') });
  }
  for (const [n, b] of bldByName) {
    if (seenPlace.has(n)) continue;
    seenPlace.add(n);
    const c = centroid(b.p);
    entries.push({ n, kind: 'building', x: c[0], z: c[1], sub: (b.k || 'building').replace(/_/g, ' ') });
  }
  const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const ORD = { first: '1st', second: '2nd', third: '3rd', fourth: '4th', fifth: '5th', sixth: '6th', seventh: '7th', eighth: '8th', ninth: '9th', tenth: '10th' };
  const ALIAS = { 'Reserve Bank of Zimbabwe': 'rbz', 'Africa Unity Square': 'unity square cecil', 'Joina City': 'joina', 'Fourth Street rank': '4th street terminus kombi', 'Road Port': 'roadport bus', 'Town House': 'city council mayor', 'Harare Station': 'railway train nrz', 'The Kopje': 'kopje hill view', 'Rainbow Towers': 'sheraton hotel hicc' };
  for (const e of entries) {
    let k = norm(e.n);
    for (const w of k.split(' ')) if (ORD[w]) k += ' ' + ORD[w];
    if (ALIAS[e.n]) k += ' ' + ALIAS[e.n];
    e.key = k;
  }

  function score(q, k) {
    const i = k.indexOf(q);
    if (i === 0) return 100 - k.length * 0.1;
    if (i > 0) return (k[i - 1] === ' ' ? 80 : 60) - k.length * 0.1;
    // ordered subsequence with gap penalty
    let qi = 0, gaps = 0, last = -1, start = -1;
    for (let j = 0; j < k.length && qi < q.length; j++) {
      if (k[j] === q[qi]) {
        if (start < 0) start = j;
        if (last >= 0) gaps += j - last - 1;
        last = j;
        qi++;
      }
    }
    if (qi < q.length || gaps > q.length * 2) return -1;
    return 40 - gaps * 1.5 - start * 0.3 - k.length * 0.05;
  }
  function search(q, limit = 8) {
    q = norm(q);
    if (!q) return [];
    const words = q.split(' ');
    const out = [];
    for (const e of entries) {
      let s = 0;
      for (const w of words) {
        const ws = score(w, e.key);
        if (ws < 0) {
          s = -1;
          break;
        }
        s += ws;
      }
      if (s < 0) continue;
      if (e.kind === 'place' && e.spot) s += 12;
      else if (e.kind === 'street') s += 6;
      out.push([s, e]);
    }
    out.sort((a, b) => b[0] - a[0]);
    return out.slice(0, limit).map((o) => o[1]);
  }

  // --- routing ----------------------------------------------------------------------------------------------------
  // Project a point onto the nearest graph edge: {e, seg, t, x, z}
  const egrid = new Map();
  G.edges.forEach((e, i) => {
    for (let j = 0; j + 3 < e.p.length; j += 2) {
      const x0 = Math.floor(Math.min(e.p[j], e.p[j + 2]) / CELL), x1 = Math.floor(Math.max(e.p[j], e.p[j + 2]) / CELL);
      const z0 = Math.floor(Math.min(e.p[j + 1], e.p[j + 3]) / CELL), z1 = Math.floor(Math.max(e.p[j + 1], e.p[j + 3]) / CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const k = key(cx, cz);
        let a = egrid.get(k);
        if (!a) egrid.set(k, (a = []));
        a.push(i * 4096 + j / 2);
      }
    }
  });
  function project(x, z) {
    for (let rad = 1; rad <= 12; rad *= 2) {
      let best = null, bd = 1e18;
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
        const a = egrid.get(key(cx + dx, cz + dz));
        if (!a) continue;
        for (const code of a) {
          const ei = Math.floor(code / 4096), seg = code % 4096, e = G.edges[ei], j = seg * 2;
          const ax = e.p[j], az = e.p[j + 1], ddx = e.p[j + 2] - ax, ddz = e.p[j + 3] - az, l2 = ddx * ddx + ddz * ddz || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * ddx + (z - az) * ddz) / l2));
          const px = ax + t * ddx, pz = az + t * ddz, d = (px - x) ** 2 + (pz - z) ** 2;
          if (d < bd) (bd = d), (best = { e: ei, seg, t, x: px, z: pz });
        }
      }
      if (best) return best;
    }
    return null;
  }
  // Distance along edge from node a to the projection
  const along = (pr) => {
    const p = G.edges[pr.e].p;
    let L = 0;
    for (let j = 0; j < pr.seg * 2; j += 2) L += Math.hypot(p[j + 2] - p[j], p[j + 3] - p[j + 1]);
    return L + pr.t * Math.hypot(p[pr.seg * 2 + 2] - p[pr.seg * 2], p[pr.seg * 2 + 3] - p[pr.seg * 2 + 1]);
  };
  // Polyline pieces from the projection to an end of its edge
  const toA = (pr, out) => {
    const p = G.edges[pr.e].p;
    out.push(pr.x, pr.z);
    for (let j = pr.seg * 2; j >= 0; j -= 2) out.push(p[j], p[j + 1]);
  };
  const toB = (pr, out) => {
    const p = G.edges[pr.e].p;
    out.push(pr.x, pr.z);
    for (let j = pr.seg * 2 + 2; j < p.length; j += 2) out.push(p[j], p[j + 1]);
  };

  const gScore = new Float64Array(N + 2), came = new Int32Array(N + 2), cameEdge = new Int32Array(N + 2), closed = new Uint8Array(N + 2);
  // Route from (x0,z0) to (x1,z1) along the graph; oneway respected when `drive`. Returns {pts, len} or null.
  function route(x0, z0, x1, z1, drive = false) {
    const ps = project(x0, z0), pe = project(x1, z1);
    if (!ps || !pe) return null;
    const S = N, T = N + 1;
    const es = G.edges[ps.e], ee = G.edges[pe.e];
    const sA = along(ps), eA = along(pe);
    gScore.fill(Infinity);
    came.fill(-1);
    closed.fill(0);
    const tx = pe.x, tz = pe.z;
    const nx = (n) => (n === S ? ps.x : n === T ? pe.x : G.nodes[n * 2]);
    const nz = (n) => (n === S ? ps.z : n === T ? pe.z : G.nodes[n * 2 + 1]);
    const h = (n) => Math.hypot(nx(n) - tx, nz(n) - tz);
    // binary heap of [f, n]
    const heap = [];
    const push = (f, n) => {
      heap.push([f, n]);
      let i = heap.length - 1;
      while (i > 0) {
        const pi = (i - 1) >> 1;
        if (heap[pi][0] <= heap[i][0]) break;
        [heap[pi], heap[i]] = [heap[i], heap[pi]];
        i = pi;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    const relax = (from, to, cost, edgeCode) => {
      const g = gScore[from] + cost;
      if (g < gScore[to]) {
        gScore[to] = g;
        came[to] = from;
        cameEdge[to] = edgeCode;
        push(g + h(to), to);
      }
    };
    gScore[S] = 0;
    push(h(S), S);
    const oneway = (e) => drive && e.o;
    while (heap.length) {
      const [, n] = pop();
      if (closed[n]) continue;
      closed[n] = 1;
      if (n === T) break;
      if (n === S) {
        if (!oneway(es)) relax(S, es.a / 2, sA, -1); // code -1: start→a
        relax(S, es.b / 2, edgeLen[ps.e] - sA, -2); // -2: start→b
        if (ps.e === pe.e && (eA >= sA || !oneway(es))) relax(S, T, Math.abs(eA - sA), -5);
        continue;
      }
      for (const ei of adj[n]) {
        const e = G.edges[ei];
        const fwd = e.a / 2 === n;
        if (!fwd && oneway(e)) continue;
        const m = fwd ? e.b / 2 : e.a / 2;
        relax(n, m, edgeLen[ei], fwd ? ei * 2 : ei * 2 + 1);
        if (ei === pe.e) {
          // enter the target edge partway
          if (fwd) relax(n, T, eA, -3);
          else if (!oneway(e)) relax(n, T, edgeLen[ei] - eA, -4);
        }
      }
    }
    if (!closed[T]) return null;
    // Walk back
    const chain = [];
    for (let n = T; n !== S; n = came[n]) chain.push(n);
    chain.reverse();
    const pts = [x0, z0];
    let prev = S;
    for (const n of chain) {
      const code = cameEdge[n];
      if (code === -1) toA(ps, pts);
      else if (code === -2) toB(ps, pts);
      else if (code === -5) pts.push(ps.x, ps.z, pe.x, pe.z);
      else if (code === -3) {
        // from node a to the projection on target edge
        const p = ee.p;
        for (let j = 0; j <= pe.seg * 2; j += 2) pts.push(p[j], p[j + 1]);
        pts.push(pe.x, pe.z);
      } else if (code === -4) {
        const p = ee.p;
        for (let j = p.length - 2; j >= pe.seg * 2 + 2; j -= 2) pts.push(p[j], p[j + 1]);
        pts.push(pe.x, pe.z);
      } else {
        const e = G.edges[code >> 1], p = e.p;
        if ((code & 1) === 0) for (let j = 0; j < p.length; j += 2) pts.push(p[j], p[j + 1]);
        else for (let j = p.length - 2; j >= 0; j -= 2) pts.push(p[j], p[j + 1]);
      }
      prev = n;
    }
    pts.push(x1, z1);
    return { pts, len: gScore[T] + Math.hypot(x0 - ps.x, z0 - ps.z) + Math.hypot(x1 - pe.x, z1 - pe.z) };
  }

  // Nearest point on the road network (graph) for spawning drivers/walkers next to a landmark
  function snapToRoad(x, z) {
    const pr = project(x, z);
    if (!pr) return { x, z, yaw: 0, w: 8 };
    const e = G.edges[pr.e], j = pr.seg * 2;
    const dx = e.p[j + 2] - e.p[j], dz = e.p[j + 3] - e.p[j + 1];
    return { x: pr.x, z: pr.z, dx, dz, w: e.w || 8, o: e.o };
  }

  // Landmarks placed at runtime (the Nehanda statue finds its own corner) join the list and the search
  function addSpot(sp, alias = '') {
    const s = { ...sp, street: nearestStreet(sp.x, sp.z, 300) };
    spots.push(s);
    entries.unshift({ n: s.n, kind: 'place', x: s.x, z: s.z, sub: s.street ? shortName(s.street) : s.d, spot: s, key: norm(s.n) + ' ' + alias });
    return s;
  }
  return { segs, forSegs, nearestStreet, nearestJunction, junctions, spots, districts, entries, search, route, snapToRoad, project, addSpot };
}
