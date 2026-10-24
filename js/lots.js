// js/lots.js — the ground between buildings in the CBD core: a paved/tarred base layer, and DATA.lots from
// tools/infill.mjs — tarred parking with painted bays and parked cars, slab-paved forecourts, concrete service yards —
// with precast concrete boundary walls (painted, grimy at the foot) and steel gates. Built once, a handful of meshes.
//
// Lot rings: p0→p1 is the street frontage, p3 is behind p0; `w` bit i = edge p_i→p_i+1 needs a wall.
import * as THREE from 'three';
import { groundY, rng, hash2, coreWeight, makeGeometry, pointInPoly, polyBounds } from './util.js';
import { canvas, noise, speckle, asphaltTexture, pavementTexture } from './textures.js';
import { vehicleGeometry, VEHICLE_TYPES } from './vehicles.js';

// Heights above terrain (between parks +0.05 and pavements +0.14; lots never overlap either)
const Y = { core: 0.03, lot: 0.1, bay: 0.125, forecourt: 0.14 };
const CORE_X0 = -1110, CORE_X1 = 810, CORE_Z0 = -500, CORE_Z1 = 660, CELL = 8;
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

class Soup {
  constructor(uvScale = 1) {
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.uv = [];
    this.k = 1 / uvScale;
  }
  v(x, y, z, nx, ny, nz, c) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.col.push(c.r, c.g, c.b);
    this.uv.push(x * this.k, z * this.k);
  }
  // Upward-facing triangle (re-ordered so the normal points +y)
  up(a, b, c, ca, cb = ca, cc = ca) {
    const cy = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    if (cy < 0) ([b, c] = [c, b]), ([cb, cc] = [cc, cb]);
    this.v(...a, 0, 1, 0, ca);
    this.v(...b, 0, 1, 0, cb);
    this.v(...c, 0, 1, 0, cc);
  }
  quadUp(a, b, c, d, col) {
    this.up(a, b, c, col);
    this.up(a, c, d, col);
  }
  // Vertical quad a→b along the ground, from y0 to y1, facing normal (nx, nz); bottom colour cb, top ct
  wall(ax, az, bx, bz, y0, y1, nx, nz, cb, ct) {
    const A0 = [ax, y0, az], B0 = [bx, y0, bz], A1 = [ax, y1, az], B1 = [bx, y1, bz];
    // CCW seen from the normal side
    const cross = (bx - ax) * nz - (bz - az) * nx; // sign tells which order faces the normal
    const tri = (p, q, r, cp, cq, cr) => {
      this.v(...p, nx, 0, nz, cp);
      this.v(...q, nx, 0, nz, cq);
      this.v(...r, nx, 0, nz, cr);
    };
    if (cross > 0) tri(A0, B0, B1, cb, cb, ct), tri(A0, B1, A1, cb, ct, ct);
    else tri(B0, A0, A1, cb, cb, ct), tri(B0, A1, B1, cb, ct, ct);
  }
  // Oriented box: centre (x, z), along unit (ux, uz) half-length a, across half-width b, from y0 to y1
  box(x, z, ux, uz, a, b, y0, y1, cb, ct) {
    const vx = -uz, vz = ux;
    const P = (s, t) => [x + ux * s + vx * t, z + uz * s + vz * t];
    const c = [P(-a, -b), P(a, -b), P(a, b), P(-a, b)];
    const ns = [[-vx, -vz], [ux, uz], [vx, vz], [-ux, -uz]];
    for (let i = 0; i < 4; i++) {
      const p = c[i], q = c[(i + 1) % 4];
      this.wall(p[0], p[1], q[0], q[1], y0, y1, ns[i][0], ns[i][1], cb, ct);
    }
    this.quadUp([c[0][0], y1, c[0][1]], [c[1][0], y1, c[1][1]], [c[2][0], y1, c[2][1]], [c[3][0], y1, c[3][1]], ct);
  }
  mesh(mat) {
    const g = makeGeometry(THREE, { position: [this.pos, 3], normal: [this.nrm, 3], color: [this.col, 3], uv: [this.uv, 2] });
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    return m;
  }
}

// Cast-in-place concrete: 4 m panels with saw-cut joints, oil and rust stains, hairline cracks, red dust. Covers 8 m.
function concreteTexture(renderer) {
  const S = 512, r = rng(31);
  const [c, g] = canvas(S);
  g.fillStyle = '#d9d6d0';
  g.fillRect(0, 0, S, S);
  noise(g, S, r, [[24, 110], [90, 34], [300, 8]], 0.1, 255, 110);
  // oil drips and drive-over smudges
  for (let i = 0; i < 26; i++) {
    const x = r() * S, y = r() * S, rr = 6 + r() * 26;
    const grd = g.createRadialGradient(x, y, 0, x, y, rr);
    grd.addColorStop(0, `rgba(40,36,32,${0.12 + r() * 0.2})`);
    grd.addColorStop(1, 'rgba(40,36,32,0)');
    g.fillStyle = grd;
    g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  g.strokeStyle = 'rgba(60,56,52,0.5)';
  g.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    let x = r() * S, y = r() * S;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) g.lineTo((x += (r() - 0.5) * 50), (y += (r() - 0.5) * 50));
    g.stroke();
  }
  g.strokeStyle = 'rgba(70,66,62,0.75)';
  g.lineWidth = 2;
  for (const t of [0, S / 2]) {
    g.beginPath(); g.moveTo(t + 1, 0); g.lineTo(t + 1, S); g.stroke();
    g.beginPath(); g.moveTo(0, t + 1); g.lineTo(S, t + 1); g.stroke();
  }
  speckle(g, S, r, 20000, 255, 90);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 8;
  return t;
}

const WALL_PAINT = ['#e8e0cc', '#ecebe4', '#d9c79e', '#c9a46a', '#b7c2a4', '#bf8d6c', '#d6d0c4', '#b9b3a8', '#b9b3a8', '#a8a39a'];
const GATE = ['#2f4a3a', '#3a3d40', '#5a2a24', '#28344a', '#4a4a44'];
const CONTAINER = ['#8a3a2a', '#2f5a7a', '#6a6a62', '#3d6a45', '#b08a3a', '#7a2a2a'];
const PARK_TYPES = ['fit', 'sedan', 'sedan', 'hilux', 'fit', 'pickup'];

export function buildLots(group, DATA, renderer) {
  const r = rng(4242);
  const tmp = new THREE.Color();
  const concreteMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, map: concreteTexture(renderer) });
  const tarMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, map: asphaltTexture(renderer) });
  const slabMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, map: pavementTexture(renderer) });
  const plainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });

  // --- core base layer: concrete, old tar and dusty paving wherever buildings and roads leave ground --------------
  {
    const b = new Soup(8);
    const conc = new THREE.Color('#aaa398'), tarOld = new THREE.Color('#6a6560'), dust = new THREE.Color('#a8896c');
    const nx = Math.round((CORE_X1 - CORE_X0) / CELL), nz = Math.round((CORE_Z1 - CORE_Z0) / CELL);
    const cols = [], wts = [];
    for (let j = 0; j <= nz; j++)
      for (let i = 0; i <= nx; i++) {
        const x = CORE_X0 + i * CELL, z = CORE_Z0 + j * CELL;
        const w = coreWeight(x, z);
        const n = hash2(Math.floor(x / 24), Math.floor(z / 24)), n2 = hash2(Math.floor(x / 9) + 7, Math.floor(z / 9));
        tmp.copy(conc).multiplyScalar(0.9 + n2 * 0.16);
        if (n < 0.3) tmp.lerp(tarOld, 0.75 - n);
        // dust and bare earth creep back in toward the fringe
        tmp.lerp(dust, 0.15 + (1 - smooth(0.25, 0.55, w)) * 0.55);
        cols.push(tmp.clone());
        wts.push(w);
      }
    const id = (i, j) => j * (nx + 1) + i;
    // parks and squares keep their grass: skip cells lying wholly inside an area
    const areas = DATA.areas.map((a) => ({ p: a.p, bb: polyBounds(a.p) }));
    const inArea = (x, z) => areas.some(({ p, bb }) => x > bb[0] && x < bb[2] && z > bb[1] && z < bb[3] && pointInPoly(x, z, p));
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const k = [id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)];
        if (Math.min(...k.map((q) => wts[q])) < 0.22) continue;
        const x0 = CORE_X0 + i * CELL, z0 = CORE_Z0 + j * CELL;
        if (inArea(x0 + CELL / 2, z0 + CELL / 2) && inArea(x0 + 0.5, z0 + 0.5) && inArea(x0 + CELL - 0.5, z0 + 0.5) && inArea(x0 + 0.5, z0 + CELL - 0.5) && inArea(x0 + CELL - 0.5, z0 + CELL - 0.5)) continue;
        const P = (q, di, dj) => {
          const x = CORE_X0 + (i + di) * CELL, z = CORE_Z0 + (j + dj) * CELL;
          return [x, groundY(x, z) + Y.core, z];
        };
        const A = P(0, 0, 0), B = P(0, 1, 0), C = P(0, 1, 1), D = P(0, 0, 1);
        b.up(A, B, C, cols[k[0]], cols[k[1]], cols[k[2]]);
        b.up(A, C, D, cols[k[0]], cols[k[2]], cols[k[3]]);
      }
    const m = b.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, map: concreteMat.map }));
    group.add(m);
  }

  const lots = DATA.lots || [];
  const tar = new Soup(16), conc = new Soup(8), slab = new Soup(4.8), paint = new Soup(), walls = new Soup();
  const cars = new Map(); // type -> [matrix, colour]
  const counts = { parking: 0, forecourt: 0, yard: 0, cars: 0, wallM: 0 };
  const white = new THREE.Color('#e8e6dc'), yellow = new THREE.Color('#d8b23a');
  const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);

  for (const lot of lots) {
    const p = lot.p;
    const C = [[p[0], p[1]], [p[2], p[3]], [p[4], p[5]], [p[6], p[7]]];
    const [o, f1, , b0] = C;
    // frame: u along the frontage, v back into the plot
    const U = Math.hypot(f1[0] - o[0], f1[1] - o[1]), V = Math.hypot(b0[0] - o[0], b0[1] - o[1]);
    const ux = (f1[0] - o[0]) / U, uz = (f1[1] - o[1]) / U, vx = (b0[0] - o[0]) / V, vz = (b0[1] - o[1]) / V;
    const at = (s, t) => [o[0] + ux * s + vx * t, o[1] + uz * s + vz * t];
    const lr = rng(Math.floor(o[0] * 31 + o[1] * 17));
    const y = groundY(o[0], o[1]);
    const surf = (soup, yy, col) => soup.quadUp(...C.map(([x, z]) => [x, y + yy, z]), col);
    counts[lot.k]++;

    if (lot.k === 'parking') {
      surf(tar, Y.lot, tmp.set('#4f4f50').multiplyScalar(0.9 + lr() * 0.2).clone());
      // rows of 2.5 m bays parallel to the frontage, nose-in: back row against the wall, aisles of 6 m
      // [t0, t1, dir]: bay spans v ∈ [t0, t1]; dir +1 → noses toward the back of the lot
      const rows = [];
      let t = V - 0.3;
      if (t >= 8) rows.push([t - 5, t, 1]), (t -= 5);
      // then aisle + nose-to-nose double rows while there's still a 4 m aisle left at the front
      while (t - 6 - 10 >= 4) {
        t -= 6;
        rows.push([t - 5, t, -1], [t - 10, t - 5, 1]);
        t -= 10;
      }
      const n = Math.floor((U - 0.6) / 2.5);
      const s0 = (U - n * 2.5) / 2;
      const occ = 0.35 + lr() * 0.5;
      for (const [t0, t1, dir] of rows) {
        for (let k = 0; k <= n; k++) {
          const s = s0 + k * 2.5;
          const a = at(s, t0), b = at(s, t1);
          lineQuad(paint, a, b, 0.06, y + Y.bay, white);
          if (k < n && lr() < occ) {
            const type = PARK_TYPES[Math.floor(lr() * PARK_TYPES.length)];
            const L = VEHICLE_TYPES[type].len;
            const tc = dir > 0 ? t1 - 0.4 - L / 2 : t0 + 0.4 + L / 2;
            const [cx, cz] = at(s + 1.25 + (lr() - 0.5) * 0.3, tc + (lr() - 0.5) * 0.4);
            const yaw = Math.atan2(vx * dir, vz * dir) + (lr() - 0.5) * 0.08;
            qt.setFromAxisAngle(UP, yaw);
            m4.compose(new THREE.Vector3(cx, y + Y.lot, cz), qt, one);
            const cl = VEHICLE_TYPES[type].colors;
            (cars.get(type) || cars.set(type, []).get(type)).push([m4.clone(), new THREE.Color(cl[Math.floor(lr() * cl.length)])]);
            counts.cars++;
          }
        }
        lineQuad(paint, at(s0, dir > 0 ? t1 - 0.05 : t0 + 0.05), at(s0 + n * 2.5, dir > 0 ? t1 - 0.05 : t0 + 0.05), 0.06, y + Y.bay, white);
      }
      // painted entrance lines at the street
      lineQuad(paint, at(0.3, 0.4), at(U - 0.3, 0.4), 0.05, y + Y.bay, yellow);
    } else if (lot.k === 'forecourt') {
      surf(slab, Y.forecourt, tmp.set('#c4baa9').multiplyScalar(0.92 + lr() * 0.1).clone());
    } else {
      surf(conc, Y.lot, tmp.set('#a39b8f').multiplyScalar(0.88 + lr() * 0.16).clone());
      // a shipping container or two at the back of the yard
      if (V > 10 && U > 9 && lr() < 0.65) {
        const k = lr() < 0.3 ? 2 : 1;
        for (let i = 0; i < k; i++) {
          const [cx, cz] = at(U * (0.3 + 0.4 * lr()), V - 1.6 - i * 2.6);
          tmp.set(CONTAINER[Math.floor(lr() * CONTAINER.length)]);
          walls.box(cx, cz, ux, uz, 3.0, 1.2, y + Y.lot, y + Y.lot + 2.6, tmp.clone().multiplyScalar(0.8), tmp.clone());
        }
      }
    }

    // --- boundary walls ---
    const w = lot.w || 0;
    if (!w) continue;
    const H = lot.k === 'forecourt' ? 1.1 : 1.9 + lr() * 0.5;
    const paintC = new THREE.Color(WALL_PAINT[Math.floor(lr() * WALL_PAINT.length)]);
    const grime = paintC.clone().multiplyScalar(0.62).lerp(new THREE.Color('#7a5a44'), 0.25);
    for (let e = 0; e < 4; e++) {
      if (!(w & (1 << e))) continue;
      if (e === 0 && lot.k === 'forecourt') continue;
      const A = C[e], B = C[(e + 1) % 4];
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const ex = (B[0] - A[0]) / L, ez = (B[1] - A[1]) / L;
      // the street side gets an opening: a gate for yards, a driveway for parking
      let gap = null;
      if (e === 0) {
        const gw = lot.k === 'yard' ? Math.min(6, L * 0.45) : Math.min(7, L * 0.6);
        const g0 = (L - gw) / 2 + (lr() - 0.5) * (L - gw) * 0.6;
        gap = [g0, g0 + gw];
      }
      const spans = gap ? [[0, gap[0]], [gap[1], L]] : [[0, L]];
      for (const [s0, s1] of spans) {
        if (s1 - s0 < 0.4) continue;
        wallRun(A, ex, ez, s0, s1, y, H, paintC, grime);
        counts.wallM += s1 - s0;
      }
      if (gap && lot.k === 'yard') {
        // sliding steel gate between two fat gateposts
        const gc = new THREE.Color(GATE[Math.floor(lr() * GATE.length)]);
        const mid = (gap[0] + gap[1]) / 2, half = (gap[1] - gap[0]) / 2;
        const cx = A[0] + ex * mid, cz = A[1] + ez * mid;
        walls.box(cx, cz, ex, ez, half, 0.04, y, y + H - 0.1, gc.clone().multiplyScalar(0.7), gc);
        for (const s of [gap[0], gap[1]]) walls.box(A[0] + ex * s, A[1] + ez * s, ex, ez, 0.25, 0.25, y, y + H + 0.3, grime, paintC);
      }
    }
  }

  // Precast panel wall: 0.15 m panels slotted between posts every 2.4 m, with a slight coping
  function wallRun(A, ex, ez, s0, s1, y, H, col, grime) {
    const ax = A[0] + ex * s0, az = A[1] + ez * s0;
    const L = s1 - s0;
    const top = col.clone().multiplyScalar(1.03);
    walls.box(ax + ex * (L / 2), az + ez * (L / 2), ex, ez, L / 2, 0.08, y, y + H, grime, top);
    const n = Math.max(1, Math.round(L / 2.4));
    for (let k = 0; k <= n; k++) {
      const s = (k / n) * L;
      walls.box(ax + ex * s, az + ez * s, ex, ez, 0.13, 0.14, y, y + H + 0.12, grime, col);
    }
  }

  function lineQuad(soup, a, b, half, yy, col) {
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    const nx = (-dz / l) * half, nz = (dx / l) * half;
    soup.quadUp([a[0] + nx, yy, a[1] + nz], [b[0] + nx, yy, b[1] + nz], [b[0] - nx, yy, b[1] - nz], [a[0] - nx, yy, a[1] - nz], col);
  }

  group.add(tar.mesh(tarMat), conc.mesh(concreteMat), slab.mesh(slabMat), paint.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })));
  const wm = walls.mesh(plainMat);
  wm.castShadow = true;
  group.add(wm);

  // --- parked cars: instanced far-LOD bodies, paint mask tinted by the instance colour -------------------------------
  const carMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25 });
  carMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aMat;')
      .replace('#include <color_vertex>', `vColor = color;
      #ifdef USE_INSTANCING_COLOR
        vColor *= mix(vec3(1.0), instanceColor.rgb, aMat.x);
      #endif`);
  };
  carMat.customProgramCacheKey = () => 'parked-car';
  for (const [type, list] of cars) {
    const geo = vehicleGeometry(type, 0);
    const im = new THREE.InstancedMesh(geo, carMat, list.length);
    list.forEach(([mm, cc], i) => (im.setMatrixAt(i, mm), im.setColorAt(i, cc)));
    im.castShadow = im.receiveShadow = true;
    group.add(im);
  }
  return counts;
}
