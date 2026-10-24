// js/world.js — ground, the Kopje, parks, roads (pavement, asphalt, paint), railway, street lights, Unity Square fountain
import * as THREE from 'three';
import { groundY, rng, hash2, coreWeight, Grid, polyCentroid, makeGeometry, KOPJE } from './util.js';
import { asphaltTexture, pavementTexture, groundTexture } from './textures.js';

const ROAD_RANK = { trunk: 6, primary: 5, secondary: 4, tertiary: 3, trunk_link: 3, primary_link: 3, secondary_link: 3, tertiary_link: 3, residential: 2, unclassified: 2, living_street: 2, pedestrian: 1, service: 0 };
const AREA_COLORS = {
  park: '#5d8a3c', garden: '#5a8b3f', pitch: '#4f8f3a', stadium: '#6a8a45', recreation_ground: '#79904a',
  grass: '#6f8d44', cemetery: '#6c7c4a', railway: '#7d6b58',
};

const tmp = new THREE.Color();

// Resample a flat polyline so no segment is longer than `step` (lets ribbons follow the terrain)
function densify(p, step = 12) {
  const out = [p[0], p[1]];
  for (let i = 2; i < p.length; i += 2) {
    const ax = p[i - 2], az = p[i - 1], bx = p[i], bz = p[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 1; k <= n; k++) out.push(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n);
  }
  return out;
}

// Flat triangle soup with vertex colours and world-planar UVs (1 UV unit = `uvScale` metres)
class Builder {
  constructor(uvScale = 1) {
    this.pos = [];
    this.col = [];
    this.nrm = [];
    this.uv = [];
    this.k = 1 / uvScale;
  }
  tri(a, b, c, color) {
    if (Number.isNaN(a[0] + a[2] + b[0] + b[2] + c[0] + c[2])) return;
    this.pos.push(...a, ...b, ...c);
    this.uv.push(a[0] * this.k, a[2] * this.k, b[0] * this.k, b[2] * this.k, c[0] * this.k, c[2] * this.k);
    for (let i = 0; i < 3; i++) this.col.push(color.r, color.g, color.b), this.nrm.push(0, 1, 0);
  }
  geometry() {
    return makeGeometry(THREE, { position: [this.pos, 3], normal: [this.nrm, 3], color: [this.col, 3], uv: [this.uv, 2] });
  }
}

// Layer heights above the terrain: enough separation for a standard depth buffer at city scale
const Y = { area: 0.05, pitch: 0.07, pave: 0.14, road: 0.22, paint: 0.3, zebra: 0.31 };

// Flat ribbon along a polyline with mitred joins; `side` shifts it sideways (for edge lines)
function ribbon(b, p, half, y, color, side = 0, colorFn = null) {
  const n = p.length / 2;
  if (n < 2) return;
  const L = [], R = [];
  for (let i = 0; i < n; i++) {
    const x = p[i * 2], z = p[i * 2 + 1];
    let tx = 0, tz = 0;
    if (i > 0) {
      const dx = x - p[i * 2 - 2], dz = z - p[i * 2 - 1], l = Math.hypot(dx, dz) || 1;
      (tx += dx / l), (tz += dz / l);
    }
    if (i < n - 1) {
      const dx = p[i * 2 + 2] - x, dz = p[i * 2 + 3] - z, l = Math.hypot(dx, dz) || 1;
      (tx += dx / l), (tz += dz / l);
    }
    const tl = Math.hypot(tx, tz) || 1;
    (tx /= tl), (tz /= tl);
    // miter scale, clamped so hairpins don't explode
    let m = 1;
    if (i > 0 && i < n - 1) {
      const dx = x - p[i * 2 - 2], dz = z - p[i * 2 - 1], l = Math.hypot(dx, dz) || 1;
      m = 1 / Math.max(0.5, (dx / l) * tx + (dz / l) * tz);
    }
    const nx = tz, nz = -tx; // left normal (x east, z south)
    const gy = groundY(x, z) + y;
    L.push([x + nx * (side + half * m), gy, z + nz * (side + half * m)]);
    R.push([x + nx * (side - half * m), gy, z + nz * (side - half * m)]);
  }
  for (let i = 0; i < n - 1; i++) {
    const c = colorFn ? colorFn(p[i * 2], p[i * 2 + 1]) : color;
    b.tri(L[i], R[i], R[i + 1], c);
    b.tri(L[i], R[i + 1], L[i + 1], c);
  }
}

function disc(b, x, z, r, y, color, seg = 14) {
  const gy = groundY(x, z) + y;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    b.tri([x, gy, z], [x + Math.cos(a1) * r, gy, z + Math.sin(a1) * r], [x + Math.cos(a0) * r, gy, z + Math.sin(a0) * r], color);
  }
}

function dashes(b, p, half, y, color, on = 3, off = 6, side = 0) {
  let acc = 0;
  for (let i = 2; i < p.length; i += 2) {
    const ax = p[i - 2], az = p[i - 1], bx = p[i], bz = p[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    let s = (on + off - (acc % (on + off))) % (on + off);
    for (; s < len; s += on + off) {
      const e = Math.min(len, s + on);
      const t0 = s / len, t1 = e / len;
      ribbon(b, [ax + (bx - ax) * t0, az + (bz - az) * t0, ax + (bx - ax) * t1, az + (bz - az) * t1], half, y, color, side);
    }
    acc += len;
  }
}

export function buildWorld(scene, DATA, renderer) {
  const group = new THREE.Group();
  scene.add(group);
  const vcMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const groundTex = groundTexture(renderer);
  const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, map: groundTex });

  // --- ground: dry-season highveld, red earth and tawny grass --------------------------------------------------------
  const SIZE = 9000, SEG = 220;
  const gGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  gGeo.rotateX(-Math.PI / 2);
  gGeo.translate(-400, 0, 200);
  const gp = gGeo.attributes.position;
  const gc = [];
  const earth = new THREE.Color('#9a6b48'), grass = new THREE.Color('#a39060'), green = new THREE.Color('#7c8550'), rock = new THREE.Color('#8b8072');
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i);
    const y = groundY(x, z);
    gp.setY(i, y);
    const n = hash2(Math.floor(x / 37), Math.floor(z / 37)) * 0.6 + hash2(Math.floor(x / 9), Math.floor(z / 9)) * 0.4;
    tmp.copy(grass).lerp(earth, n * 0.7).lerp(green, Math.max(0, hash2(Math.floor(x / 140), Math.floor(z / 140)) - 0.55));
    if (y > 8) tmp.lerp(rock, Math.min(0.7, (y - 8) / 40) * (0.5 + 0.5 * n)); // granite kopje
    tmp.lerp(new THREE.Color('#8c7d6a'), coreWeight(x, z) * 0.55); // trampled, dusty CBD lots
    gc.push(tmp.r, tmp.g, tmp.b);
  }
  gGeo.setAttribute('color', new THREE.Float32BufferAttribute(gc, 3));
  const guv = gGeo.attributes.uv;
  for (let i = 0; i < gp.count; i++) guv.setXY(i, gp.getX(i) / 24, gp.getZ(i) / 24);
  gGeo.computeVertexNormals();
  const ground = new THREE.Mesh(gGeo, groundMat);
  ground.receiveShadow = true;
  group.add(ground);
  // Veld out to the horizon so the ground never ends (fog swallows it)
  const outer = new THREE.Mesh(new THREE.RingGeometry(4000, 40000, 64, 1).rotateX(-Math.PI / 2).translate(-400, -0.6, 200), new THREE.MeshStandardMaterial({ color: '#8f7d5a', roughness: 1 }));
  group.add(outer);

  // Granite boulders (dwalas) scattered over the Kopje
  {
    const r = rng(7);
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#9b9187', roughness: 0.9, flatShading: true }), 260);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), e = new THREE.Euler();
    for (let i = 0; i < mesh.count; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * KOPJE.r * 0.75;
      const x = KOPJE.x + Math.cos(a) * d, z = KOPJE.z + Math.sin(a) * d;
      const k = 2 + r() * r() * 9;
      s.set(k * (1 + r()), k * (0.6 + r() * 0.5), k * (1 + r()));
      q.setFromEuler(e.set(r() * 0.4, r() * 6, r() * 0.4));
      m.compose(new THREE.Vector3(x, groundY(x, z) + k * 0.2, z), q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }

  // --- parks, pitches, rail yards -----------------------------------------------------------------------------------
  {
    const b = new Builder(24);
    for (const a of DATA.areas) {
      const col = new THREE.Color(AREA_COLORS[a.k] || '#6f8d44');
      const pts = [];
      for (let i = 0; i < a.p.length; i += 2) pts.push(new THREE.Vector2(a.p[i], a.p[i + 1]));
      const tris = THREE.ShapeUtils.triangulateShape(pts, []);
      const y = a.k === 'pitch' ? Y.pitch : Y.area;
      for (const [i, j, k] of tris) {
        const P = (n) => [pts[n].x, groundY(pts[n].x, pts[n].y) + y, pts[n].y];
        // keep triangles facing up
        const A = pts[i], B = pts[j], C = pts[k];
        const up = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x) < 0;
        if (up) b.tri(P(i), P(j), P(k), col);
        else b.tri(P(i), P(k), P(j), col);
      }
    }
    const m = new THREE.Mesh(b.geometry(), groundMat);
    m.receiveShadow = true;
    group.add(m);
  }

  // --- junctions: where markings stop and zebra crossings go ----------------------------------------------------------
  const G = DATA.graph;
  const deg = new Map(), jw = new Map(), jedges = new Map();
  for (const e of G.edges)
    for (const n of [e.a, e.b]) {
      deg.set(n, (deg.get(n) || 0) + 1);
      jw.set(n, Math.max(jw.get(n) || 0, e.w));
      (jedges.get(n) || jedges.set(n, []).get(n)).push(e);
    }
  const junctions = [];
  const jGrid = new Grid(40);
  for (const [n, d] of deg) {
    if (d < 3) continue;
    const j = { x: G.nodes[n], z: G.nodes[n + 1], r: jw.get(n) / 2 + 1.2, n };
    junctions.push(j);
    jGrid.insert(j, j.x - j.r - 8, j.z - j.r - 8, j.x + j.r + 8, j.z + j.r + 8);
  }
  const inJunction = (x, z, pad = 0) => jGrid.query(x, z).some((j) => Math.hypot(x - j.x, z - j.z) < j.r + pad);
  // Split a polyline into runs that stay outside junction boxes
  // (tested every 2 m, but only run ends and the original vertices are kept, so ribbons stay light)
  function clipRuns(p, pad = 0) {
    const runs = [];
    let cur = [], lx = 0, lz = 0;
    for (let i = 0; i < p.length; i += 2) {
      const ax = p[i], az = p[i + 1];
      const last = i + 2 >= p.length;
      const bx = last ? ax : p[i + 2], bz = last ? az : p[i + 3];
      const n = last ? 1 : Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
      for (let k = 0; k < n; k++) {
        const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
        if (inJunction(x, z, pad)) {
          if (cur.length) cur.push(lx, lz); // close the run at the last sample outside
          if (cur.length >= 4) runs.push(cur);
          cur = [];
        } else {
          if (k === 0 || !cur.length) cur.push(x, z);
          (lx = x), (lz = z);
        }
      }
    }
    if (cur.length >= 4) runs.push(cur);
    // drop zero-length steps
    return runs.map(dedupe).filter((r) => r.length >= 4);
  }
  function dedupe(r) {
    const o = [r[0], r[1]];
    for (let i = 2; i < r.length; i += 2) if (Math.hypot(r[i] - o[o.length - 2], r[i + 1] - o[o.length - 1]) > 0.05) o.push(r[i], r[i + 1]);
    return o;
  }

  // --- roads ----------------------------------------------------------------------------------------------------------
  const roadGrid = new Grid(40);
  {
    const pave = new Builder(4.8), asphalt = new Builder(16), paint = new Builder();
    const concrete = new THREE.Color('#c4baa9'), dirt = new THREE.Color('#a0704f'), tar = new THREE.Color('#47484a'), tarOld = new THREE.Color('#57534f');
    const brick = new THREE.Color('#9a6e5a'), white = new THREE.Color('#e9e6dc'), yellow = new THREE.Color('#e0b733');
    const kerb = new THREE.Color('#cfc8bb'), kerbOld = new THREE.Color('#a59a8a'), gutter = new THREE.Color('#2a2826');
    const roads = [...DATA.roads].sort((a, b) => (ROAD_RANK[a.k] || 0) - (ROAD_RANK[b.k] || 0));
    const vergeColor = (x, z) => tmp.copy(dirt).lerp(concrete, Math.min(1, coreWeight(x, z) * 1.6)).clone();
    for (const r of roads) {
      const p = densify(r.p);
      const half = r.w / 2;
      const rank = ROAD_RANK[r.k] || 0;
      const y = Y.road + rank * 0.006;
      if (rank > 0) ribbon(pave, p, half + 2.6, Y.pave, null, 0, vergeColor);
      if (r.k === 'pedestrian') {
        ribbon(asphalt, p, half, y, brick);
      } else {
        const c = rank >= 3 ? tar : tarOld;
        ribbon(asphalt, p, half, y, c);
        disc(asphalt, p[0], p[1], half, y, c);
        disc(asphalt, p[p.length - 2], p[p.length - 1], half, y, c);
        if (rank > 0) {
          disc(pave, p[0], p[1], half + 2.6, Y.pave, vergeColor(p[0], p[1]));
          disc(pave, p[p.length - 2], p[p.length - 1], half + 2.6, Y.pave, vergeColor(p[p.length - 2], p[p.length - 1]));
        }
        const yp = Y.paint + rank * 0.006;
        for (const run of clipRuns(r.p, 1.5)) {
          if (rank >= 2 && !r.o && r.w >= 7.5) dashes(paint, run, 0.08, yp, white);
          if (r.o && r.w >= 9) dashes(paint, run, 0.07, yp, white, 2.5, 5, 0);
          if (rank >= 4) {
            ribbon(paint, run, 0.08, yp, yellow, half - 0.45);
            ribbon(paint, run, 0.08, yp, yellow, -(half - 0.45));
          }
          // Kerb: pale concrete lip with a dark gutter on the road side
          if (rank >= 2) {
            const k = coreWeight(run[0], run[1]) > 0.05 ? kerb : kerbOld;
            for (const sd of [1, -1]) {
              ribbon(paint, run, 0.16, yp, k, sd * (half + 0.16));
              ribbon(paint, run, 0.2, yp - 0.01, gutter, sd * (half - 0.2));
            }
          }
        }
      }
      for (let i = 2; i < r.p.length; i += 2) {
        const ax = r.p[i - 2], az = r.p[i - 1], bx = r.p[i], bz = r.p[i + 1];
        roadGrid.insert({ r, ax, az, bx, bz }, Math.min(ax, bx) - 10, Math.min(az, bz) - 10, Math.max(ax, bx) + 10, Math.max(az, bz) + 10);
      }
    }
    // Zebra crossings on each approach to CBD junctions
    const zebra = new THREE.Color('#ecebe4');
    for (const j of junctions) {
      if (coreWeight(j.x, j.z) < 0.05) continue;
      for (const e of jedges.get(j.n)) {
        if (e.w < 7) continue;
        // direction away from the junction along the edge
        const atA = e.a === j.n;
        const px = atA ? e.p[2] : e.p[e.p.length - 4], pz = atA ? e.p[3] : e.p[e.p.length - 3];
        let dx = px - j.x, dz = pz - j.z;
        const l = Math.hypot(dx, dz);
        if (l < j.r + 5) continue;
        (dx /= l), (dz /= l);
        const nx = dz, nz = -dx, c0 = j.r + 1.2, half = e.w / 2 - 0.4;
        for (let s = -half; s < half; s += 1.0) {
          const x0 = j.x + dx * c0 + nx * s, z0 = j.z + dz * c0 + nz * s;
          ribbon(paint, [x0, z0, x0 + dx * 3, z0 + dz * 3], 0.25, Y.zebra, zebra);
        }
      }
    }
    const roadMats = [
      [pave, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, map: pavementTexture(renderer) })],
      [asphalt, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, map: asphaltTexture(renderer), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })],
      [paint, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })],
    ];
    for (const [b, mat] of roadMats) {
      const m = new THREE.Mesh(b.geometry(), mat);
      m.receiveShadow = true;
      group.add(m);
    }
  }

  // --- railway (the line out of Harare station) -------------------------------------------------------------------------
  {
    const b = new Builder();
    const ballast = new THREE.Color('#77695d'), steel = new THREE.Color('#5d5a57');
    for (const r of DATA.rail) {
      const p = densify(r);
      ribbon(b, p, 1.8, Y.pave, ballast);
      ribbon(b, p, 0.07, 0.35, steel, 0.53);
      ribbon(b, p, 0.07, 0.35, steel, -0.53);
    }
    const m = new THREE.Mesh(b.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.2 }));
    m.receiveShadow = true;
    group.add(m);
  }

  // --- Africa Unity Square: fountain and cross paths ---------------------------------------------------------------------
  const unity = DATA.areas.find((a) => /Unity Square/.test(a.n || ''));
  if (unity) {
    const [cx, cz] = polyCentroid(unity.p);
    const stone = new THREE.MeshStandardMaterial({ color: '#cfc6b6', roughness: 0.8 });
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.5, 0.7, 40), stone);
    basin.position.set(cx, 0.35, cz);
    const water = new THREE.Mesh(new THREE.CircleGeometry(8.4, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#4f7d8c', roughness: 0.05, metalness: 0.3 }));
    water.position.set(cx, 0.62, cz);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.2, 3, 16), stone);
    spout.position.set(cx, 1.5, cz);
    const b = new Builder();
    const path = new THREE.Color('#c9b9a0');
    ribbon(b, [cx - 70, cz - 50, cx + 70, cz + 50], 1.8, Y.pitch + 0.03, path);
    ribbon(b, [cx - 70, cz + 50, cx + 70, cz - 50], 1.8, Y.pitch + 0.03, path);
    const paths = new THREE.Mesh(b.geometry(), vcMat);
    for (const m of [basin, spout]) (m.castShadow = true), (m.receiveShadow = true);
    group.add(basin, water, spout, paths);
  }

  // --- street lights ------------------------------------------------------------------------------------------------
  const lightSpots = [];
  {
    const r = rng(11);
    for (const road of DATA.roads) {
      const rank = ROAD_RANK[road.k] || 0;
      if (rank < 2) continue;
      const spacing = rank >= 4 ? 38 : 55;
      let acc = r() * spacing, side = 1;
      for (let i = 2; i < road.p.length; i += 2) {
        const ax = road.p[i - 2], az = road.p[i - 1], bx = road.p[i], bz = road.p[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const nx = (bz - az) / (len || 1), nz = -(bx - ax) / (len || 1);
        for (; acc < len; acc += spacing) {
          const t = acc / len, off = road.w / 2 + 1.2;
          const lx = ax + (bx - ax) * t + nx * off * side, lz = az + (bz - az) * t + nz * off * side;
          // ZESA load-shedding: whole stretches go dark; LED retrofits in the core, old sodium elsewhere
          const on = hash2(Math.floor(lx / 260), Math.floor(lz / 260)) > 0.1 && r() > 0.06;
          const led = r() < 0.15 + coreWeight(lx, lz) * 0.5;
          lightSpots.push([lx, lz, -nx * side, -nz * side, on, led]);
          side = -side;
        }
        acc -= len;
      }
    }
  }
  const nL = lightSpots.length;
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.14, 8, 6).translate(0, 4, 0);
  const armGeo = new THREE.BoxGeometry(0.1, 0.1, 1.6).translate(0, 7.9, 0.8);
  const headGeo = new THREE.BoxGeometry(0.35, 0.14, 0.7).translate(0, 7.82, 1.5);
  const poles = new THREE.InstancedMesh(mergeSimple([poleGeo, armGeo]), new THREE.MeshStandardMaterial({ color: '#6d6f70', roughness: 0.6, metalness: 0.4 }), nL);
  const headMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
  const heads = new THREE.InstancedMesh(headGeo, headMat, nL);
  const glowTex = radialTexture();
  const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, color: '#ffb766', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const glows = new THREE.InstancedMesh(new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2), glowMat, nL);
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    const hc = new THREE.Color();
    lightSpots.forEach(([x, z, dx, dz, on, led], i) => {
      heads.setColorAt(i, on ? hc.set(led ? '#e6eeff' : '#ffb15e') : hc.set('#222222'));
      const y = groundY(x, z);
      q.setFromAxisAngle(up, Math.atan2(dx, dz));
      m.compose(new THREE.Vector3(x, y, z), q, one);
      poles.setMatrixAt(i, m);
      heads.setMatrixAt(i, m);
      m.makeTranslation(x + dx * 1.5, y + 0.4, z + dz * 1.5);
      if (!on) m.makeScale(0, 0, 0);
      glows.setMatrixAt(i, m);
    });
  }
  poles.castShadow = true;
  glows.renderOrder = 2;
  group.add(poles, heads, glows);

  // Nearest named street to a point, for the HUD
  function streetAt(x, z) {
    let best = null, bd = 30;
    for (const s of roadGrid.query(x, z)) {
      if (!s.r.n) continue;
      const dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l2));
      const d = Math.hypot(x - s.ax - t * dx, z - s.az - t * dz) - s.r.w / 2;
      if (d < bd) (bd = d), (best = s.r.n);
    }
    return best;
  }

  function setNight(night) {
    glowMat.opacity = night * 0.35; // the real light pools come from features/lighting.js; this is just haze
    headMat.color.setScalar(night > 0.05 ? 1 + night * 3 : 0.45);
  }

  return { group, streetAt, setNight, lightSpots };
}

function mergeSimple(geos) {
  const pos = [], nrm = [];
  for (let g of geos) {
    g = g.index ? g.toNonIndexed() : g;
    pos.push(...g.attributes.position.array);
    nrm.push(...g.attributes.normal.array);
  }
  return makeGeometry(THREE, { position: [pos, 3], normal: [nrm, 3] });
}

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export { mergeSimple, radialTexture };
