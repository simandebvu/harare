// js/people.js — pedestrians on the pavements and street vendors with umbrellas, crates of tomatoes and bananas
import * as THREE from 'three';
import { groundY, rng, coreWeight } from './util.js';

const CLOTHES = ['#2d3e66', '#8a2222', '#e8e2d2', '#1f1f22', '#3f6f3a', '#d9a521', '#6b4c8a', '#c2562c', '#4a6d8c', '#7c7f84', '#f0c9d0', '#2e7f7a'];
const SKIN = ['#4a2e20', '#5c3a26', '#3b2418', '#6b4630', '#2f1d14', '#7a5238'];
const UMBRELLAS = ['#d63a2a', '#f2c230', '#2f6fb3', '#3d8d46', '#e86d24', '#ffffff', '#7d3fb0'];
const PRODUCE = ['#c7271c', '#e8c22a', '#4c7a2a', '#e07b22', '#6e3b1f', '#f0e6c8'];

export function createPeople(scene, DATA, blocked, count = 2600) {
  const r = rng(314);
  const G = DATA.graph;
  const edges = G.edges.map((e) => {
    const n = e.p.length / 2;
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(e.p[i * 2] - e.p[i * 2 - 2], e.p[i * 2 + 1] - e.p[i * 2 - 1]));
    const [mx, mz] = [e.p[Math.floor(n / 2) * 2], e.p[Math.floor(n / 2) * 2 + 1]];
    return { ...e, cum, L: cum[n - 1], core: coreWeight(mx, mz) };
  });
  const at = new Map();
  edges.forEach((e, i) => {
    if (e.L < 1) return;
    (at.get(e.a) || at.set(e.a, []).get(e.a)).push(i);
    (at.get(e.b) || at.set(e.b, []).get(e.b)).push(i);
  });

  function sample(e, d, res) {
    const E = edges[e];
    let i = 1;
    while (i < E.cum.length - 1 && E.cum[i] < d) i++;
    const t = (d - E.cum[i - 1]) / (E.cum[i] - E.cum[i - 1] || 1);
    const ax = E.p[i * 2 - 2], az = E.p[i * 2 - 1], bx = E.p[i * 2], bz = E.p[i * 2 + 1];
    const l = Math.hypot(bx - ax, bz - az) || 1;
    res.x = ax + (bx - ax) * t;
    res.z = az + (bz - az) * t;
    res.tx = (bx - ax) / l;
    res.tz = (bz - az) / l;
    return res;
  }

  // Weighted toward the CBD, where the pavements are packed
  const weight = (e) => e.L * (0.02 + e.core * e.core);
  const total = edges.reduce((s, e) => s + weight(e), 0);
  const pickEdge = () => {
    let t = r() * total;
    for (let i = 0; i < edges.length; i++) if ((t -= weight(edges[i])) <= 0) return i;
    return 0;
  };

  const people = [];
  for (let i = 0; i < count; i++) {
    const e = pickEdge();
    people.push({
      e, d: r() * edges[e].L, dir: r() < 0.5 ? 1 : -1, side: r() < 0.5 ? 1 : -1, lat: r() * 1.6,
      v: 1.0 + r() * 0.6, ph: r() * 6.28, h: 1.55 + r() * 0.3, x: 0, z: 0, yaw: 0, init: false,
    });
  }

  // Body (clothes) and skin as two instanced meshes sharing transforms
  const bodyGeo = mergeBoxes([
    [0, 0.45, 0, 0.32, 0.9, 0.22], // legs / trousers
    [0, 1.17, 0, 0.44, 0.6, 0.26], // torso
  ]);
  const skinGeo = new THREE.SphereGeometry(0.12, 8, 6).translate(0, 1.6, 0);
  const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), count);
  const heads = new THREE.InstancedMesh(skinGeo, new THREE.MeshStandardMaterial({ roughness: 0.7 }), count);
  const c = new THREE.Color();
  people.forEach((p, i) => {
    bodies.setColorAt(i, c.set(CLOTHES[Math.floor(r() * CLOTHES.length)]));
    heads.setColorAt(i, c.set(SKIN[Math.floor(r() * SKIN.length)]));
  });
  bodies.castShadow = true;
  bodies.frustumCulled = heads.frustumCulled = false;
  scene.add(bodies, heads);

  // --- vendors: static stalls on CBD pavements ---------------------------------------------------------------------
  const stalls = [];
  for (const e of edges) {
    if (e.core < 0.2) continue;
    const n = Math.floor((e.L / 25) * e.core * (r() < 0.5 ? 1 : 0.5));
    for (let k = 0; k < n; k++) {
      const d = r() * e.L;
      const s = sample(edges.indexOf(e), d, {});
      const side = r() < 0.5 ? 1 : -1;
      const off = (e.w / 2 + 2.3) * side;
      const x = s.x + s.tz * off, z = s.z - s.tx * off;
      if (!blocked(x, z)) stalls.push({ x, z, side, yaw: Math.atan2(s.tx, s.tz) });
    }
  }
  const ns = stalls.length;
  const table = new THREE.InstancedMesh(mergeBoxes([[0, 0.75, 0, 1.4, 0.06, 0.8], [0.6, 0.37, 0.3, 0.06, 0.74, 0.06], [-0.6, 0.37, 0.3, 0.06, 0.74, 0.06], [0.6, 0.37, -0.3, 0.06, 0.74, 0.06], [-0.6, 0.37, -0.3, 0.06, 0.74, 0.06]]), new THREE.MeshStandardMaterial({ color: '#7a5a3a', roughness: 0.9 }), ns);
  const produce = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 7, 5).scale(1.6, 0.5, 1).translate(0, 0.86, 0), new THREE.MeshStandardMaterial({ roughness: 0.6 }), ns);
  const umbrella = new THREE.InstancedMesh(new THREE.ConeGeometry(1.3, 0.5, 8).translate(0, 2.25, 0), new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide }), ns);
  const stick = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.025, 2.1, 4).translate(0, 1.05, 0), new THREE.MeshStandardMaterial({ color: '#cccccc' }), ns);
  const seller = new THREE.InstancedMesh(mergeBoxes([[0, 0.3, 0, 0.36, 0.6, 0.36], [0, 0.85, 0, 0.42, 0.55, 0.26]]), new THREE.MeshStandardMaterial({ roughness: 0.9 }), ns);
  const sellerHead = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 8, 6).translate(0, 1.26, 0), new THREE.MeshStandardMaterial({ roughness: 0.7 }), ns);
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    stalls.forEach((s, i) => {
      const y = groundY(s.x, s.z) + 0.1;
      q.setFromAxisAngle(up, s.yaw);
      m.compose(v.set(s.x, y, s.z), q, one);
      table.setMatrixAt(i, m);
      produce.setMatrixAt(i, m);
      stick.setMatrixAt(i, m);
      umbrella.setMatrixAt(i, m);
      produce.setColorAt(i, c.set(PRODUCE[Math.floor(r() * PRODUCE.length)]));
      umbrella.setColorAt(i, c.set(UMBRELLAS[Math.floor(r() * UMBRELLAS.length)]));
      // Seller on a crate behind the table, facing the street
      const bx = s.x + Math.cos(s.yaw) * 0.9 * s.side, bz = s.z - Math.sin(s.yaw) * 0.9 * s.side;
      q.setFromAxisAngle(up, s.yaw + Math.PI / 2);
      m.compose(v.set(bx, y, bz), q, one);
      seller.setMatrixAt(i, m);
      sellerHead.setMatrixAt(i, m);
      seller.setColorAt(i, c.set(CLOTHES[Math.floor(r() * CLOTHES.length)]));
      sellerHead.setColorAt(i, c.set(SKIN[Math.floor(r() * SKIN.length)]));
    });
  }
  for (const m of [table, umbrella, seller]) m.castShadow = true;
  if (ns) scene.add(table, produce, umbrella, stick, seller, sellerHead);

  // --- walking -------------------------------------------------------------------------------------------------------
  const tmp = {}, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v3 = new THREE.Vector3(), sc = new THREE.Vector3();

  function update(dt) {
    dt = Math.min(dt, 0.1);
    people.forEach((p, i) => {
      p.d += p.v * dt * p.dir;
      const E = edges[p.e];
      if (p.d < 0 || p.d > E.L) {
        const node = p.d < 0 ? E.a : E.b;
        const opts = (at.get(node) || []).filter((o) => o !== p.e);
        // Prefer the busier streets so the crowd stays in town
        let next = p.e, bw = -1;
        for (const o of opts) {
          const w = (0.15 + edges[o].core) * r();
          if (w > bw) (bw = w), (next = o);
        }
        const N = edges[next];
        if (next === p.e) p.dir = -p.dir, (p.d = Math.max(0, Math.min(E.L, p.d)));
        else if (N.a === node) (p.e = next), (p.dir = 1), (p.d = 0);
        else (p.e = next), (p.dir = -1), (p.d = N.L);
      }
      const N = edges[p.e];
      sample(p.e, p.d, tmp);
      const off = (N.w / 2 + 0.8 + p.lat) * p.side;
      const tx = tmp.x + tmp.tz * off, tz = tmp.z - tmp.tx * off;
      if (!p.init) (p.x = tx), (p.z = tz), (p.init = true);
      const k = Math.min(1, dt * 3);
      p.x += (tx - p.x) * k;
      p.z += (tz - p.z) * k;
      p.yaw = Math.atan2(tmp.tx * p.dir, tmp.tz * p.dir);
      p.ph += dt * p.v * 5.5;
      const bob = Math.abs(Math.sin(p.ph)) * 0.05;
      q.setFromAxisAngle(up, p.yaw + Math.sin(p.ph) * 0.06);
      const s = p.h / 1.72;
      m4.compose(v3.set(p.x, groundY(p.x, p.z) + 0.12 + bob, p.z), q, sc.set(s, s, s));
      bodies.setMatrixAt(i, m4);
      heads.setMatrixAt(i, m4);
    });
    bodies.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
  }

  return { update, count, stalls: ns };
}

function mergeBoxes(list) {
  const pos = [], nrm = [];
  for (const [x, y, z, w, h, d] of list) {
    const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();
    pos.push(...g.attributes.position.array);
    nrm.push(...g.attributes.normal.array);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}
