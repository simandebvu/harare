// js/trees.js — jacarandas (in full purple bloom: it's October), flamboyants, msasas and gums along the avenues and in parks
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { groundY, rng, coreWeight, Grid, segDist, pointInPoly, polyBounds } from './util.js';

const KINDS = [
  // weight, canopy colours, height range, canopy radius, flatness
  { w: 0.45, colors: ['#8a63c9', '#9b72d6', '#7b58b8', '#a07fd8'], h: [7, 12], r: [4, 7], flat: 0.55 }, // jacaranda
  { w: 0.12, colors: ['#d8432c', '#e2582f', '#c93a26'], h: [6, 9], r: [4, 6.5], flat: 0.5 }, // flamboyant
  { w: 0.23, colors: ['#5c7a32', '#6d8a3a', '#7c8a3a', '#a0612e'], h: [6, 11], r: [3.5, 6], flat: 0.65 }, // msasa (new red leaves)
  { w: 0.2, colors: ['#5f6f45', '#71805a', '#56663e'], h: [14, 24], r: [3, 5], flat: 1.3 }, // gum
];

export function buildTrees(scene, DATA, blocked) {
  const r = rng(2026);
  const spots = [];

  const segs = new Grid(30);
  for (const road of DATA.roads)
    for (let i = 2; i < road.p.length; i += 2) {
      const ax = road.p[i - 2], az = road.p[i - 1], bx = road.p[i], bz = road.p[i + 1];
      segs.insert({ ax, az, bx, bz, w: road.w }, Math.min(ax, bx) - 12, Math.min(az, bz) - 12, Math.max(ax, bx) + 12, Math.max(az, bz) + 12);
    }
  const clear = (x, z, pad) => {
    for (const s of segs.query(x, z)) if (segDist(x, z, s.ax, s.az, s.bx, s.bz)[0] < s.w / 2 + pad) return false;
    return !blocked(x, z) && !blocked(x + 2.5, z) && !blocked(x - 2.5, z) && !blocked(x, z + 2.5) && !blocked(x, z - 2.5);
  };

  // Street trees on the verges; the Avenues are lined with jacarandas
  for (const road of DATA.roads) {
    if (!/residential|tertiary|secondary|primary|unclassified/.test(road.k)) continue;
    const avenue = /Avenue|Ave/.test(road.n || '');
    let acc = r() * 10;
    for (let i = 2; i < road.p.length; i += 2) {
      const ax = road.p[i - 2], az = road.p[i - 1], bx = road.p[i], bz = road.p[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const nx = (bz - az) / (len || 1), nz = -(bx - ax) / (len || 1);
      for (; acc < len; acc += 11 + r() * 6) {
        const t = acc / len;
        const mx = ax + (bx - ax) * t, mz = az + (bz - az) * t;
        const core = coreWeight(mx, mz);
        if (r() < core * 0.75) continue; // sparser in the CBD core
        for (const side of [1, -1]) {
          if (r() < 0.25) continue;
          const off = road.w / 2 + 3 + r() * 1.5;
          const x = mx + nx * off * side, z = mz + nz * off * side;
          if (clear(x, z, 2)) spots.push([x, z, avenue && r() < 0.8 ? 0 : -1]);
        }
      }
      acc -= len;
    }
  }

  // Parks: Harare Gardens and friends get dense mixed planting; pitches stay open
  for (const a of DATA.areas) {
    if (!/park|garden|grass|cemetery|recreation_ground/.test(a.k)) continue;
    const [x0, z0, x1, z1] = polyBounds(a.p);
    const area = (x1 - x0) * (z1 - z0);
    const n = Math.min(900, Math.floor(area / (a.k === 'park' || a.k === 'garden' ? 220 : 500)));
    for (let i = 0; i < n; i++) {
      const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
      if (pointInPoly(x, z, a.p) && clear(x, z, 3)) spots.push([x, z, -1]);
    }
  }

  // Scattered yard trees in the low-density blocks around the core
  for (let i = 0; i < 9000; i++) {
    const x = -2700 + r() * 4300, z = -1700 + r() * 3300;
    if (coreWeight(x, z) > 0.3 || r() < 0.5) continue;
    if (clear(x, z, 4)) spots.push([x, z, -1]);
  }

  const n = spots.length;
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.32, 1, 6).translate(0, 0.5, 0);
  // Lumpy canopy: a cluster of lobes reads as foliage rather than a single blob
  const lobes = [[0, 0.15, 0, 0.75], [0.5, 0, 0.2, 0.55], [-0.45, -0.05, 0.3, 0.55], [0.1, -0.05, -0.55, 0.55], [-0.2, 0.35, -0.15, 0.5], [0.3, 0.3, 0.35, 0.45]];
  const canopyGeo = mergeGeometries(lobes.map(([x, y, z, s]) => new THREE.IcosahedronGeometry(s, 0).translate(x, y, z)));
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: '#5a4636', roughness: 0.9 }), n);
  const canopies = new THREE.InstancedMesh(canopyGeo, new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
  const pick = () => {
    let t = r();
    for (let k = 0; k < KINDS.length; k++) if ((t -= KINDS[k].w) <= 0) return k;
    return 0;
  };
  spots.forEach(([x, z, forced], i) => {
    const K = KINDS[forced >= 0 ? forced : pick()];
    const h = K.h[0] + r() * (K.h[1] - K.h[0]);
    const rad = K.r[0] + r() * (K.r[1] - K.r[0]);
    const y = groundY(x, z);
    const trunkH = h - rad * K.flat * 0.9;
    m.compose(new THREE.Vector3(x, y, z), q.identity(), new THREE.Vector3(1 + rad * 0.04, trunkH, 1 + rad * 0.04));
    trunks.setMatrixAt(i, m);
    q.setFromEuler(e.set(0, r() * 6.28, 0));
    m.compose(new THREE.Vector3(x, y + trunkH + rad * K.flat * 0.35, z), q, new THREE.Vector3(rad, rad * K.flat, rad * (0.85 + r() * 0.3)));
    canopies.setMatrixAt(i, m);
    canopies.setColorAt(i, c.set(K.colors[Math.floor(r() * K.colors.length)]).multiplyScalar(0.85 + r() * 0.3));
  });
  trunks.castShadow = canopies.castShadow = true;
  canopies.receiveShadow = true;
  scene.add(trunks, canopies);

  // Fallen jacaranda blossom: purple carpets under the avenue trees
  const carpet = spots.filter((s) => s[2] === 0 || r() < 0.1);
  const petals = new THREE.InstancedMesh(
    new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#8f6bc8', roughness: 1, transparent: true, opacity: 0.55, depthWrite: false }),
    carpet.length
  );
  carpet.forEach(([x, z], i) => {
    const k = 3 + r() * 3;
    m.compose(new THREE.Vector3(x + r() * 2 - 1, groundY(x, z) + 0.17, z + r() * 2 - 1), q.identity(), new THREE.Vector3(k, 1, k * (0.7 + r() * 0.5)));
    petals.setMatrixAt(i, m);
  });
  petals.receiveShadow = true;
  petals.renderOrder = 1;
  scene.add(petals);

  return { count: n };
}
