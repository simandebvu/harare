// js/trees.js — jacarandas (in full purple bloom: it's October), flamboyants, msasas and gums along the avenues and in parks
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { groundY, rng, coreWeight, Grid, segDist, pointInPoly, polyBounds } from './util.js';

// Canopy lobes [x, y, z, size] in units of the canopy radius; trunk colour; height range; canopy radius; y-squash
const KINDS = [
  { // jacaranda: wide umbrella, lavender-blue bloom over a little green
    w: 0.45, colors: ['#8c84d4', '#9a8fdc', '#7f78c6', '#a59ce0', '#8a86c8'], bark: '#4e4038', h: [7, 12], r: [4.5, 7.5], flat: 0.5,
    lobes: [[0, 0.3, 0, 0.6], ...ring(5, 0.62, 0, 0.46, 0.3), ...ring(3, 0.3, 0.45, 0.4, 1.2)],
  },
  { // flamboyant: very flat, very wide, flame red
    w: 0.1, colors: ['#d4452c', '#de5a30', '#c63c28', '#e06a3a'], bark: '#5a4a3e', h: [6, 9], r: [5, 7.5], flat: 0.38,
    lobes: [[0, 0.2, 0, 0.55], ...ring(6, 0.68, 0, 0.42, 0)],
  },
  { // msasa: rounded crown, spring flush of wine-red and copper leaves among the green
    w: 0.25, colors: ['#5e7a34', '#6d8a3a', '#7a8440', '#9a5a32', '#86502e'], bark: '#4a3c32', h: [6, 11], r: [3.5, 6], flat: 0.75,
    lobes: [[0, 0.25, 0, 0.66], ...ring(4, 0.45, -0.05, 0.5, 0.6), [0, 0.7, 0, 0.42]],
  },
  { // gum: tall, ragged and narrow with pale bark
    w: 0.2, colors: ['#5f6f45', '#6f7d55', '#56663e', '#7a8460'], bark: '#cdc3b2', h: [16, 26], r: [4, 6], flat: 1.0,
    lobes: [[0.35, -0.2, 0.1, 0.34], [-0.3, 0.05, -0.25, 0.36], [0.05, 0.45, 0.2, 0.32], [-0.15, -0.3, 0.35, 0.26], [0.4, 0.35, -0.3, 0.26], [-0.45, 0.4, 0.15, 0.22]],
  },
];

function ring(n, rad, y, size, phase) {
  return Array.from({ length: n }, (_, i) => {
    const a = phase + (i / n) * Math.PI * 2;
    return [Math.cos(a) * rad, y, Math.sin(a) * rad, size];
  });
}

// Merge lobes; normals bend toward the crown's centre so it shades as one soft mass, and vertex brightness
// darkens the underside and interior (cheap foliage AO)
function canopyGeometry(lobes, detail) {
  const parts = lobes.map(([x, y, z, s]) => new THREE.IcosahedronGeometry(s, detail).translate(x, y, z));
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  const P = g.attributes.position, N = g.attributes.normal, col = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i);
    n.fromBufferAttribute(N, i);
    // knobbly silhouette: push each vertex in or out by a position hash (shared positions move together, so no cracks)
    const h = Math.sin(v.x * 41.3 + v.y * 17.9 + v.z * 29.1) * 43758.5453;
    const bump = ((h - Math.floor(h)) - 0.5) * 0.22;
    v.addScaledVector(n, bump);
    P.setXYZ(i, v.x, v.y, v.z);
    const radial = v.clone().setY(v.y - 0.1).normalize();
    n.multiplyScalar(0.35).addScaledVector(radial, 0.65).normalize();
    N.setXYZ(i, n.x, n.y, n.z);
    const k = (0.55 + 0.45 * THREE.MathUtils.smoothstep(v.y, -0.6, 0.7) * (0.75 + 0.25 * Math.min(1, v.length()))) * (0.86 + bump * 1.3);
    col.push(k, k, k);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// Trunk plus three limbs reaching up into the crown (unit: x/z in canopy radii, y in trunk heights)
function trunkGeometry(gum) {
  const parts = [new THREE.CylinderGeometry(0.032, 0.05, 1, 6).translate(0, 0.5, 0)];
  const limbs = gum ? 2 : 3;
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + 0.4;
    const L = gum ? 0.35 : 0.55;
    const limb = new THREE.CylinderGeometry(0.016, 0.026, L, 5).translate(0, L / 2, 0);
    limb.rotateZ(gum ? 0.35 : 0.75).rotateY(a).translate(0, gum ? 0.62 : 0.78, 0);
    parts.push(limb);
  }
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
}

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

  // Stay inside the detailed map box: greater Harare outside it plants its own trees (features/suburbs.js)
  for (let i = spots.length - 1; i >= 0; i--) {
    const [x, z] = spots[i];
    if (x < -2500 || x > 1400 || z < -1800 || z > 1400) spots.splice(i, 1);
  }

  const n = spots.length;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
  const pick = () => {
    let t = r();
    for (let k = 0; k < KINDS.length; k++) if ((t -= KINDS[k].w) <= 0) return k;
    return 0;
  };

  // Instances grouped by species and 500 m cell, so off-screen chunks are culled and distant ones drop detail
  const CELL = 500;
  const chunks = new Map();
  spots.forEach(([x, z, forced]) => {
    const k = forced >= 0 ? forced : pick();
    const key = `${k}:${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`;
    (chunks.get(key) || chunks.set(key, { k, list: [] }).get(key)).list.push([x, z]);
  });

  const uniforms = { uTime: { value: 0 } };
  const sway = (mat) => {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uniforms.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            float ph = instanceMatrix[3].x * 0.05 + instanceMatrix[3].z * 0.07;
            float k = max(0.0, position.y + 0.6) * 0.06;
            transformed.x += sin(uTime * 1.3 + ph) * k;
            transformed.z += cos(uTime * 1.1 + ph * 1.3) * k;
          #endif`
        );
    };
    return mat;
  };
  const geos = KINDS.map((K, i) => ({
    hi: canopyGeometry(K.lobes, 1),
    lo: canopyGeometry(K.lobes, 0),
    far: canopyGeometry(K.lobes.slice(0, 3).map(([x, y, z, sz]) => [x * 0.6, y, z * 0.6, sz * 1.45]), 0),
    trunk: trunkGeometry(i === 3),
  }));
  const leafMat = sway(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  const barkMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
  const shadowMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const meshes = [];
  for (const { k, list } of chunks.values()) {
    const K = KINDS[k], G = geos[k], cnt = list.length;
    const crown = new THREE.InstancedMesh(G.hi, leafMat, cnt);
    const shadow = new THREE.InstancedMesh(G.lo, shadowMat, cnt); // cheap stand-in for the shadow pass
    const trunk = new THREE.InstancedMesh(G.trunk, barkMat, cnt);
    list.forEach(([x, z], i) => {
      const h = K.h[0] + r() * (K.h[1] - K.h[0]);
      const rad = K.r[0] + r() * (K.r[1] - K.r[0]);
      const y = groundY(x, z);
      const trunkH = h - rad * K.flat * 0.75;
      const yaw = r() * 6.28;
      q.setFromEuler(e.set(0, yaw, 0));
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(rad, trunkH, rad));
      trunk.setMatrixAt(i, m);
      trunk.setColorAt(i, c.set(K.bark).multiplyScalar(0.85 + r() * 0.3));
      q.setFromEuler(e.set((r() - 0.5) * 0.15, yaw, (r() - 0.5) * 0.15));
      m.compose(new THREE.Vector3(x, y + trunkH + rad * K.flat * 0.15, z), q, new THREE.Vector3(rad, rad * K.flat, rad * (0.85 + r() * 0.3)));
      crown.setMatrixAt(i, m);
      shadow.setMatrixAt(i, m);
      crown.setColorAt(i, c.set(K.colors[Math.floor(r() * K.colors.length)]).multiplyScalar(0.9 + r() * 0.2));
    });
    for (const im of [crown, shadow, trunk]) im.computeBoundingSphere();
    crown.receiveShadow = trunk.receiveShadow = true;
    shadow.castShadow = trunk.castShadow = true;
    scene.add(crown, shadow, trunk);
    meshes.push({ crown, trunk, G, center: crown.boundingSphere.center, radius: crown.boundingSphere.radius });
  }

  // Fallen jacaranda blossom: purple carpets under the avenue trees
  const carpet = spots.filter((s) => s[2] === 0 && r() < 0.6);
  const petals = new THREE.InstancedMesh(
    new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#9a90d0', roughness: 1, transparent: true, opacity: 0.3, depthWrite: false }),
    carpet.length
  );
  carpet.forEach(([x, z], i) => {
    const k = 2 + r() * 2.5;
    m.compose(new THREE.Vector3(x + r() * 2 - 1, groundY(x, z) + 0.17, z + r() * 2 - 1), q.identity(), new THREE.Vector3(k, 1, k * (0.7 + r() * 0.5)));
    petals.setMatrixAt(i, m);
  });
  petals.receiveShadow = true;
  petals.renderOrder = 1;
  scene.add(petals);

  return {
    count: n,
    update(dt, camera) {
      uniforms.uTime.value += dt;
      for (const ch of meshes) {
        const d = camera.position.distanceTo(ch.center) - ch.radius;
        ch.crown.geometry = d < 300 ? ch.G.hi : d < 900 ? ch.G.lo : ch.G.far;
        ch.trunk.visible = d < 1100;
      }
    },
  };
}
