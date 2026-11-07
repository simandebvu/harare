// js/features/furniture.js — street furniture, all instanced: Harare street-name posts (black on white blades) at
// CBD junctions, council litter bins, kombi/bus shelters on the main roads, phone booths and airtime vendors'
// umbrellas at corners, bollards and planters on First Street Mall, guard huts at big blocks and satellite dishes
// (rooftop and wall-mounted, all aimed north-east at the equatorial arc). Spots for huts and dishes come from
// buildings.spots. The dense kerbside layer (painted kerbs, hydrants, meters, ZESA boxes, road signs, tuckshops, ATMs,
// scaffolding, overhead lines) lives in street-clutter.js.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Grid, segDist, coreWeight, rng, groundY } from '../util.js';
import { buildClutter } from './street-clutter.js';

const PAVE = 0.14, MALL = 0.22;
const RANK = { trunk: 6, primary: 5, secondary: 4, tertiary: 3, trunk_link: 3, primary_link: 3, secondary_link: 3, residential: 2, unclassified: 2, pedestrian: 1, service: 0 };

let THREE;

// Several coloured parts → one geometry with a baked colour attribute (instance colour multiplies it)
function parts(list) {
  const geos = list.map(([g, col, m]) => {
    let geo = g.index ? g.toNonIndexed() : g.clone();
    if (m) geo.applyMatrix4(m);
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
    const c = new THREE.Color(col), n = geo.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) (a[i * 3] = c.r), (a[i * 3 + 1] = c.g), (a[i * 3 + 2] = c.b);
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return geo;
  });
  return mergeGeometries(geos);
}
const T = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));

// One material per kind; big sets are split into ~1.3 km tiles, each with its own instance bounding sphere, so the
// camera and shadow frusta can skip the parts of town that aren't in view
function instanced(scene, geo, items, opts = {}) {
  if (!items.length) return null;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: opts.rough ?? 0.7, metalness: opts.metal ?? 0.1, side: opts.side ?? THREE.FrontSide });
  const TILE = 1300, tiles = new Map();
  if (items.length > 300) for (const it of items) {
    const k = Math.floor(it.x / TILE) * 1000 + Math.floor(it.z / TILE);
    (tiles.get(k) || tiles.set(k, []).get(k)).push(it);
  }
  else tiles.set(0, items);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  let first = null;
  for (const list of tiles.values()) {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => {
      q.setFromEuler(e.set(it.rx || 0, it.yaw || 0, 0, 'YXZ'));
      m.compose(p.set(it.x, it.y, it.z), q, s.setScalar(it.s || 1));
      mesh.setMatrixAt(i, m);
      if (it.c) mesh.setColorAt(i, c.set(it.c));
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = !!opts.shadow;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.userData.fur = 1;
    scene.add(mesh);
    first ||= mesh;
  }
  return first;
}

// Street-name blades: one canvas of names, one merged mesh of double-sided quads
function nameAtlas(names) {
  const CW = 384, CH = 48, cols = 3, rows = Math.ceil(names.length / cols);
  const c = document.createElement('canvas');
  c.width = CW * cols;
  c.height = Math.max(64, rows * CH);
  const g = c.getContext('2d');
  g.fillStyle = '#f4f4f0';
  g.fillRect(0, 0, c.width, c.height);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const cells = new Map();
  names.forEach((n, i) => {
    const x = (i % cols) * CW, y = Math.floor(i / cols) * CH;
    g.fillStyle = '#f4f4f0';
    g.fillRect(x, y, CW, CH);
    g.strokeStyle = '#111';
    g.lineWidth = 3;
    g.strokeRect(x + 4, y + 4, CW - 8, CH - 8);
    g.fillStyle = '#111';
    let size = 31;
    g.font = `bold ${size}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
    const w = g.measureText(n).width;
    if (w > CW - 26) size = Math.floor((size * (CW - 26)) / w);
    g.font = `bold ${size}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
    g.fillText(n, x + CW / 2, y + CH / 2 + 2);
    cells.set(n, [(x + 2) / c.width, 1 - (y + CH - 2) / c.height, (x + CW - 2) / c.width, 1 - (y + 2) / c.height]);
  });
  return { canvas: c, cells, aspect: CW / CH };
}
const shortName = (n) =>
  n.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s*\/.*$/, '').replace(/\bAvenue\b/, 'Ave').replace(/\bStreet\b/, 'St').replace(/\bRoad\b/, 'Rd').replace(/\bDrive\b/, 'Dr').replace(/\bLane\b/, 'Ln').replace(/\bTerrace\b/, 'Tce').trim().toUpperCase();

export default {
  init(ctx) {
    THREE = ctx.THREE;
    const { DATA, scene, buildings } = ctx;
    const blocked = buildings.blocked;
    const r = rng(4242);

    // Road segments, for "is this spot on the carriageway?"
    const roadGrid = new Grid(30);
    for (const rd of DATA.roads) {
      if (rd.k === 'service') continue;
      for (let i = 2; i < rd.p.length; i += 2) {
        const ax = rd.p[i - 2], az = rd.p[i - 1], bx = rd.p[i], bz = rd.p[i + 1];
        roadGrid.insert({ ax, az, bx, bz, w: rd.w, k: rd.k }, Math.min(ax, bx) - 12, Math.min(az, bz) - 12, Math.max(ax, bx) + 12, Math.max(az, bz) + 12);
      }
    }
    const kerbGap = (x, z) => {
      let best = 1e9;
      for (const s of roadGrid.query(x, z)) best = Math.min(best, segDist(x, z, s.ax, s.az, s.bx, s.bz)[0] - s.w / 2);
      return best;
    };
    const taken = new Grid(10), takenList = [];
    const free = (x, z, rad) => {
      for (const t of taken.query(x, z)) if (Math.hypot(t.x - x, t.z - z) < rad + t.r) return false;
      return true;
    };
    const take = (x, z, rad) => taken.insert({ x, z, r: rad }, x - rad - 6, z - rad - 6, x + rad + 6, z + rad + 6);
    // A pavement spot: clear of the road, of buildings, and of other furniture
    const okPave = (x, z, rad = 0.5, minGap = 0.3, maxGap = 3.2) => {
      const g = kerbGap(x, z);
      return g > minGap && g < maxGap && !blocked(x, z) && !blocked(x + rad, z) && !blocked(x - rad, z) && !blocked(x, z + rad) && !blocked(x, z - rad) && free(x, z, rad);
    };

    // --- junctions ----------------------------------------------------------------------------------------------------
    const G = DATA.graph;
    const inc = new Map();
    for (const e of G.edges) for (const n of [e.a, e.b]) (inc.get(n) || inc.set(n, []).get(n)).push(e);
    const junctions = [];
    for (const [n, es] of inc) {
      if (es.length < 3) continue;
      const x = G.nodes[n], z = G.nodes[n + 1];
      if (coreWeight(x, z) < 0.02) continue;
      // outward direction of each incident edge
      const arms = es.filter((e) => e.k !== 'service').map((e) => {
        const atA = e.a === n, p = e.p;
        const px = atA ? p[2] : p[p.length - 4], pz = atA ? p[3] : p[p.length - 3];
        const l = Math.hypot(px - x, pz - z) || 1;
        return { e, dx: (px - x) / l, dz: (pz - z) / l, ang: Math.atan2(pz - z, px - x), w: e.w, name: e.n ? shortName(e.n) : null };
      });
      if (arms.length < 3) continue;
      arms.sort((a, b) => a.ang - b.ang);
      junctions.push({ n, x, z, arms });
    }

    // --- street name posts ----------------------------------------------------------------------------------------------
    const signNames = new Set(), posts = [], blades = [];
    for (const j of junctions) {
      if (coreWeight(j.x, j.z) < 0.08) continue;
      const named = j.arms.filter((a) => a.name);
      if (new Set(named.map((a) => a.name)).size < 2) continue;
      // try the corners between consecutive arms carrying different names
      let placed = false;
      for (let k = 0; k < j.arms.length && !placed; k++) {
        const a = j.arms[k], b = j.arms[(k + 1) % j.arms.length];
        if (!a.name || !b.name || a.name === b.name) continue;
        const x = j.x + a.dx * (b.w / 2 + 1.7) + b.dx * (a.w / 2 + 1.7), z = j.z + a.dz * (b.w / 2 + 1.7) + b.dz * (a.w / 2 + 1.7);
        if (!okPave(x, z, 0.4, 0.5, 3.5)) continue;
        take(x, z, 0.6);
        posts.push({ x, y: groundY(x, z) + PAVE, z });
        blades.push({ x, z, y: groundY(x, z) + PAVE + 2.62, dx: a.dx, dz: a.dz, name: a.name });
        blades.push({ x, z, y: groundY(x, z) + PAVE + 2.36, dx: b.dx, dz: b.dz, name: b.name });
        signNames.add(a.name).add(b.name);
        placed = true;
      }
    }
    if (posts.length) {
      const postGeo = parts([
        [new THREE.CylinderGeometry(0.045, 0.05, 2.85, 8), '#6c6e70', T(0, 1.425, 0)],
        [new THREE.CylinderGeometry(0.052, 0.052, 0.5, 8), '#1d1d1d', T(0, 0.25, 0)],
      ]);
      instanced(scene, postGeo, posts, { metal: 0.5, rough: 0.5 });
      const atlas = nameAtlas([...signNames]);
      const pos = [], nrm = [], uv = [];
      const BW = 1.25, BH = BW / atlas.aspect;
      for (const b of blades) {
        // blade runs along its street, starting at the post; text on both faces
        const cx = b.x + b.dx * (BW / 2 + 0.06), cz = b.z + b.dz * (BW / 2 + 0.06);
        const [u0, v0, u1, v1] = atlas.cells.get(b.name);
        for (const side of [1, -1]) {
          const nx = b.dz * side, nz = -b.dx * side; // face normal
          const rx = nz, rz = -nx; // right, seen from the front
          const ox = nx * 0.012, oz = nz * 0.012;
          const P = [
            [cx - (rx * BW) / 2 + ox, b.y, cz - (rz * BW) / 2 + oz, u0, v0],
            [cx + (rx * BW) / 2 + ox, b.y, cz + (rz * BW) / 2 + oz, u1, v0],
            [cx + (rx * BW) / 2 + ox, b.y + BH, cz + (rz * BW) / 2 + oz, u1, v1],
            [cx - (rx * BW) / 2 + ox, b.y + BH, cz - (rz * BW) / 2 + oz, u0, v1],
          ];
          for (const k of [0, 1, 2, 0, 2, 3]) pos.push(P[k][0], P[k][1], P[k][2]), nrm.push(nx, 0, nz), uv.push(P[k][3], P[k][4]);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      const tex = new THREE.CanvasTexture(atlas.canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = ctx.renderer.capabilities.getMaxAnisotropy();
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.1 }));
      mesh.receiveShadow = true;
      mesh.userData.fur = 1;
      scene.add(mesh);
    }

    // --- phone booths and airtime umbrellas at corners ------------------------------------------------------------------
    const booths = [], umbrellas = [], tables = [];
    const BRANDS = ['#5b2a86', '#c6f432', '#c8102e', '#f2c200', '#0a4ea2', '#1b8a3a'];
    for (const j of junctions) {
      if (coreWeight(j.x, j.z) < 0.2) continue;
      for (let k = 0; k < j.arms.length; k++) {
        const a = j.arms[k], b = j.arms[(k + 1) % j.arms.length];
        const t = r();
        if (t > 0.42) continue;
        const along = 5 + r() * 8;
        // a little way down arm a, on the b side of it
        const sx = b.dx - a.dx * (b.dx * a.dx + b.dz * a.dz), sz = b.dz - a.dz * (b.dx * a.dx + b.dz * a.dz), sl = Math.hypot(sx, sz) || 1;
        const off = a.w / 2 + (t < 0.14 ? 2.2 : 1.6);
        const x = j.x + a.dx * (b.w / 2 + along) + (sx / sl) * off, z = j.z + a.dz * (b.w / 2 + along) + (sz / sl) * off;
        if (!okPave(x, z, 0.8, 0.6, 3.6)) continue;
        take(x, z, 1.1);
        const y = groundY(x, z) + PAVE, yaw = Math.atan2(-sx / sl, -sz / sl); // face the road
        if (t < 0.14) booths.push({ x, y, z, yaw, c: r() < 0.6 ? '#e8b400' : '#2b6cb0' });
        else {
          umbrellas.push({ x, y, z, yaw: r() * 6.28, c: BRANDS[Math.floor(r() * BRANDS.length)] });
          tables.push({ x: x + (sx / sl) * 0.3, y, z: z + (sz / sl) * 0.3, yaw });
        }
      }
    }
    // Booth: coloured frame (instance colour), glazed on three sides, open to the road (+z), phone on the back wall
    const glass = '#9fb3bd';
    instanced(scene, parts([
      [new THREE.BoxGeometry(1.0, 0.16, 1.0), '#ffffff', T(0, 2.3, 0)],
      [new THREE.BoxGeometry(0.96, 0.1, 0.96), '#ffffff', T(0, 0.05, 0)],
      ...[[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]].map(([x, z]) => [new THREE.BoxGeometry(0.08, 2.2, 0.08), '#ffffff', T(x, 1.15, z)]),
      [new THREE.BoxGeometry(0.84, 0.9, 0.03), '#ffffff', T(0, 0.55, -0.45)],
      [new THREE.BoxGeometry(0.03, 0.9, 0.84), '#ffffff', T(-0.45, 0.55, 0)],
      [new THREE.BoxGeometry(0.03, 0.9, 0.84), '#ffffff', T(0.45, 0.55, 0)],
    ]), booths, { shadow: true, rough: 0.45 });
    instanced(scene, parts([
      [new THREE.BoxGeometry(0.84, 1.1, 0.02), glass, T(0, 1.6, -0.45)],
      [new THREE.BoxGeometry(0.02, 1.1, 0.84), glass, T(-0.45, 1.6, 0)],
      [new THREE.BoxGeometry(0.02, 1.1, 0.84), glass, T(0.45, 1.6, 0)],
      [new THREE.BoxGeometry(0.24, 0.36, 0.12), '#2a2a2a', T(0, 1.4, -0.38)],
      [new THREE.BoxGeometry(0.9, 0.18, 0.03), '#f4f2ea', T(0, 2.13, 0.47)],
    ]), booths.map(({ c, ...b }) => b), { rough: 0.1, metal: 0.3 });
    instanced(scene, parts([
      [new THREE.ConeGeometry(1.25, 0.45, 8, 1, true), '#ffffff', T(0, 2.2, 0)],
      [new THREE.CylinderGeometry(0.025, 0.025, 2.2, 5), '#dddddd', T(0, 1.1, 0)],
    ]), umbrellas, { rough: 0.8, side: THREE.DoubleSide });
    instanced(scene, parts([
      [new THREE.BoxGeometry(0.9, 0.05, 0.55), '#7a5a3a', T(0, 0.78, 0)],
      [new THREE.BoxGeometry(0.85, 0.72, 0.5), '#3b4a8a', T(0, 0.38, 0)],
      [new THREE.BoxGeometry(0.42, 0.06, 0.04), '#f2c200', T(0, 0.55, 0.26)],
      [new THREE.BoxGeometry(0.4, 0.04, 0.4), '#c8102e', T(0.75, 0.45, 0.2)],
      [new THREE.BoxGeometry(0.05, 0.45, 0.05), '#555555', T(0.75, 0.22, 0.2)],
    ]), tables, { rough: 0.8 });

    // --- litter bins and kombi shelters along the streets --------------------------------------------------------------
    const bins = [], shelters = [];
    for (const rd of DATA.roads) {
      const rank = RANK[rd.k] || 0;
      if (rank < 2 || rd.k === 'pedestrian') continue;
      const binEvery = 42, shEvery = rank >= 4 ? 170 : 0;
      let accB = r() * binEvery, accS = shEvery ? 40 + r() * shEvery : 1e9, side = r() < 0.5 ? 1 : -1;
      for (let i = 2; i < rd.p.length; i += 2) {
        const ax = rd.p[i - 2], az = rd.p[i - 1], bx = rd.p[i], bz = rd.p[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.1) continue;
        const dx = (bx - ax) / len, dz = (bz - az) / len, nx = dz, nz = -dx;
        for (; accB < len; accB += binEvery) {
          const px = ax + dx * accB, pz = az + dz * accB;
          if (coreWeight(px, pz) < 0.25) continue;
          side = -side;
          const off = rd.w / 2 + 0.55, x = px + nx * off * side, z = pz + nz * off * side;
          if (!okPave(x, z, 0.3, 0.3, 1.2) || junctions.some((j) => Math.hypot(j.x - x, j.z - z) < 9)) continue;
          take(x, z, 0.4);
          bins.push({ x, y: groundY(x, z) + PAVE, z, yaw: Math.atan2(nx * side, nz * side), c: r() < 0.55 ? '#2f6b3a' : r() < 0.6 ? '#d0701c' : '#4a4d50' });
        }
        accB -= len;
        for (; accS < len; accS += shEvery) {
          const px = ax + dx * accS, pz = az + dz * accS;
          if (coreWeight(px, pz) < 0.15) continue;
          const sd = r() < 0.5 ? 1 : -1, off = rd.w / 2 + 1.2, x = px + nx * off * sd, z = pz + nz * off * sd;
          // the whole 4 m footprint has to be clear
          let ok = okPave(x, z, 0.9, 0.5, 3.5) && !blocked(x + nx * sd * 3.4, z + nz * sd * 3.4);
          for (const t of [-2, 2]) ok = ok && !blocked(x + dx * t + nx * sd * 3.4, z + dz * t + nz * sd * 3.4) && kerbGap(x + dx * t, z + dz * t) > 0.5 && free(x + dx * t, z + dz * t, 0.8);
          if (!ok || junctions.some((j) => Math.hypot(j.x - x, j.z - z) < 16)) continue;
          for (const t of [-2, 0, 2]) take(x + dx * t, z + dz * t, 1.2);
          shelters.push({ x, y: groundY(x, z) + PAVE, z, yaw: Math.atan2(-nx * sd, -nz * sd), c: r() < 0.5 ? '#2f7a52' : r() < 0.5 ? '#c9c9c4' : '#b03a2e' });
        }
        accS -= len;
      }
    }
    instanced(scene, parts([
      [new THREE.CylinderGeometry(0.04, 0.04, 1.05, 6), '#555555', T(0, 0.52, -0.25)],
      [new THREE.CylinderGeometry(0.22, 0.19, 0.6, 10, 1, true), '#ffffff', T(0, 0.7, 0)],
      [new THREE.CylinderGeometry(0.19, 0.19, 0.04, 10), '#222222', T(0, 0.42, 0)],
      [new THREE.TorusGeometry(0.22, 0.02, 4, 12), '#dddddd', T(0, 1.0, 0, Math.PI / 2)],
    ]), bins, { rough: 0.6, metal: 0.3 });
    // Shelter: local +z faces the road. Steel frame, coloured roof (instance colour), perspex back, bench.
    instanced(scene, parts([
      [new THREE.BoxGeometry(4.2, 0.1, 1.8), '#ffffff', T(0, 2.55, 0.1, -0.06)],
      [new THREE.BoxGeometry(4.2, 0.28, 0.06), '#ffffff', T(0, 2.45, 1.0)],
    ]), shelters, { shadow: true, rough: 0.5, metal: 0.3 });
    instanced(scene, parts([
      ...[-1.95, 0, 1.95].map((x) => [new THREE.BoxGeometry(0.08, 2.55, 0.08), '#3a3d40', T(x, 1.27, -0.6)]),
      [new THREE.BoxGeometry(3.9, 1.6, 0.03), '#b9c8cf', T(0, 1.35, -0.6)],
      [new THREE.BoxGeometry(0.03, 1.6, 1.1), '#b9c8cf', T(-1.95, 1.35, -0.1)],
      [new THREE.BoxGeometry(3.4, 0.06, 0.4), '#6b4a2e', T(0, 0.48, -0.35)],
      ...[-1.4, 1.4].map((x) => [new THREE.BoxGeometry(0.06, 0.48, 0.3), '#3a3d40', T(x, 0.24, -0.35)]),
    ]), shelters, { shadow: true, rough: 0.45, metal: 0.25 });

    // --- First Street Mall (and other pedestrian streets): bollards across the ends, planters down the middle -----------
    const bollards = [], planters = [];
    for (const rd of DATA.roads) {
      if (rd.k !== 'pedestrian' || coreWeight(rd.p[0], rd.p[1]) < 0.05) continue;
      const half = rd.w / 2;
      const ends = [[0, 2], [rd.p.length - 2, rd.p.length - 4]];
      for (const [i, k] of ends) {
        const x0 = rd.p[i], z0 = rd.p[i + 1];
        let dx = rd.p[k] - x0, dz = rd.p[k + 1] - z0;
        const l = Math.hypot(dx, dz) || 1;
        (dx /= l), (dz /= l);
        // step in until clear of the cross street
        let s = 2;
        while (s < 30 && kerbGap(x0 + dx * s, z0 + dz * s) < 0 && roadGrid.query(x0 + dx * s, z0 + dz * s).some((q) => q.k !== 'pedestrian' && segDist(x0 + dx * s, z0 + dz * s, q.ax, q.az, q.bx, q.bz)[0] < q.w / 2 + 0.5)) s += 1;
        s += 1.5;
        for (let t = -half + 0.6; t <= half - 0.6; t += 1.5) {
          const x = x0 + dx * s - dz * t, z = z0 + dz * s + dx * t;
          if (!blocked(x, z)) bollards.push({ x, y: groundY(x, z) + MALL, z, c: '#2b2b2b' });
        }
      }
      // along the edges and planters every 24 m
      let acc = 6, accP = 12;
      for (let i = 2; i < rd.p.length; i += 2) {
        const ax = rd.p[i - 2], az = rd.p[i - 1], bx = rd.p[i], bz = rd.p[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.1) continue;
        const dx = (bx - ax) / len, dz = (bz - az) / len;
        for (; acc < len; acc += 5) {
          for (const sd of [1, -1]) {
            const x = ax + dx * acc + dz * (half - 0.35) * sd, z = az + dz * acc - dx * (half - 0.35) * sd;
            if (!blocked(x, z) && !junctions.some((j) => Math.hypot(j.x - x, j.z - z) < 10)) bollards.push({ x, y: groundY(x, z) + MALL, z, c: '#2b2b2b' });
          }
        }
        acc -= len;
        for (; accP < len; accP += 24) {
          const x = ax + dx * accP, z = az + dz * accP;
          if (!blocked(x, z) && !junctions.some((j) => Math.hypot(j.x - x, j.z - z) < 12) && free(x, z, 1)) take(x, z, 1.2), planters.push({ x, y: groundY(x, z) + MALL, z, yaw: Math.atan2(dx, dz) });
        }
        accP -= len;
      }
    }
    instanced(scene, parts([
      [new THREE.CylinderGeometry(0.1, 0.12, 0.85, 10), '#ffffff', T(0, 0.425, 0)],
      [new THREE.SphereGeometry(0.1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), '#ffffff', T(0, 0.85, 0)],
      [new THREE.CylinderGeometry(0.105, 0.105, 0.08, 10), '#e0b733', T(0, 0.7, 0)],
    ]), bollards, { rough: 0.4, metal: 0.5 });
    instanced(scene, parts([
      [new THREE.BoxGeometry(1.4, 0.55, 1.4), '#bdb6a8', T(0, 0.275, 0)],
      [new THREE.BoxGeometry(1.25, 0.05, 1.25), '#4a3426', T(0, 0.56, 0)],
      [new THREE.IcosahedronGeometry(0.55, 1), '#4f7a35', T(0, 0.95, 0)],
      [new THREE.IcosahedronGeometry(0.35, 1), '#6b9142', T(0.3, 1.25, 0.15)],
    ]), planters, { shadow: true, rough: 0.9 });

    // --- guard huts and satellite dishes from buildings.js ---------------------------------------------------------------
    const huts = [];
    for (const h of buildings.spots?.huts || []) {
      if (blocked(h.x, h.z) || !free(h.x, h.z, 12) || kerbGap(h.x, h.z) < 0.8) continue;
      take(h.x, h.z, 1.1);
      huts.push({ ...h, y: groundY(h.x, h.z) + PAVE, c: r() < 0.6 ? '#efe9dc' : '#d9cfae' });
    }
    instanced(scene, parts([
      [new THREE.BoxGeometry(1.5, 2.3, 1.5), '#ffffff', T(0, 1.15, 0)],
      [new THREE.BoxGeometry(1.9, 0.12, 1.9), '#5a5e62', T(0, 2.36, 0)],
      [new THREE.BoxGeometry(1.2, 0.75, 0.04), '#1e2a30', T(0, 1.55, 0.76)],
      [new THREE.BoxGeometry(0.04, 0.75, 1.2), '#1e2a30', T(0.76, 1.55, 0)],
      [new THREE.BoxGeometry(0.04, 0.75, 1.2), '#1e2a30', T(-0.76, 1.55, 0)],
      [new THREE.BoxGeometry(0.7, 1.9, 0.04), '#6b4a2e', T(0, 0.95, -0.76)],
    ]), huts, { shadow: true, rough: 0.8 });
    const dishes = buildings.spots?.dishes || [];
    instanced(scene, parts([
      // dish faces local +z, tipped up ~40° toward the satellites
      [new THREE.SphereGeometry(0.42, 14, 4, 0, Math.PI * 2, 0, 0.75), '#e8e8e4', T(0, 0.55 + 0.42 * 0.64, 0.05 + 0.42 * 0.77, Math.PI + 0.87)],
      [new THREE.CylinderGeometry(0.012, 0.012, 0.5, 4), '#888888', T(0, 0.62, 0.3, 0.87)],
      [new THREE.BoxGeometry(0.06, 0.06, 0.1), '#333333', T(0, 0.84, 0.42)],
      [new THREE.CylinderGeometry(0.03, 0.03, 0.6, 5), '#666666', T(0, 0.3, -0.1)],
    ]), dishes, { rough: 0.5, metal: 0.2, side: THREE.DoubleSide });

    // The dense layer: corners, kerbside clutter, kiosks, ATMs, scaffolding, overhead lines (street-clutter.js)
    const clutter = buildClutter(ctx, { parts, T, instanced, okPave, take, free, kerbGap, junctions, blocked, r });

    // Solid street furniture for js/collision-world.js, matching the instanced parts above (local +z = instance yaw).
    // Shelters only block at their back and side panels so you can still step in under the roof.
    const solid = (it, lx, lz, hw, hl, h) => {
      const yaw = it.yaw || 0, c = Math.cos(yaw), s = Math.sin(yaw);
      ctx.contacts?.addStaticBox(it.x + lx * c + lz * s, it.z - lx * s + lz * c, yaw, hw, hl, h);
    };
    for (const b of booths) solid(b, 0, 0, 0.5, 0.5, 2.4);
    for (const h of huts) solid(h, 0, 0, 0.78, 0.78, 2.4);
    for (const b of bins) solid(b, 0, 0, 0.22, 0.22, 1.0);
    for (const t of tables) solid(t, 0, 0, 0.45, 0.28, 0.8);
    for (const b of bollards) solid(b, 0, 0, 0.12, 0.12, 0.9);
    for (const p of planters) solid(p, 0, 0, 0.7, 0.7, 0.55);
    for (const sh of shelters) solid(sh, 0, -0.6, 1.98, 0.05, 2.55), solid(sh, -1.95, -0.1, 0.05, 0.55, 2.55);
    console.log(`[harare] furniture: ${posts.length} street-name posts, ${bins.length} bins, ${shelters.length} shelters, ${booths.length} booths, ${umbrellas.length} airtime umbrellas, ${bollards.length} bollards, ${planters.length} planters, ${huts.length} guard huts, ${dishes.length} dishes; ${clutter}`);
  },
  update() {},
};
