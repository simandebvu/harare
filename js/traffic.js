// js/traffic.js — vehicles driving on the left over the OSM road graph, with robots (traffic lights) at CBD junctions
// and kombis that pull up whenever they like to load passengers.
import * as THREE from 'three';
import { groundY, rng, coreWeight } from './util.js';
import { VEHICLE_TYPES, vehicleGeometry, lampGeometry } from './vehicles.js';

const SPEED = { trunk: 16, primary: 14, secondary: 13, tertiary: 11, residential: 8.5, unclassified: 8, living_street: 5 };
const RANK = { trunk: 6, primary: 5, secondary: 4, tertiary: 3, residential: 2, unclassified: 2 };
const CYCLE = 40; // s: EW green 17, amber 3, NS green 17, amber 3

export function createTraffic(scene, DATA, count = 650) {
  const r = rng(99);
  const G = DATA.graph;
  const nodeXZ = (n) => [G.nodes[n * 2], G.nodes[n * 2 + 1]];

  // --- edges: cumulative lengths, lane layout --------------------------------------------------------------------
  const edges = G.edges.map((e) => {
    const n = e.p.length / 2;
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(e.p[i * 2] - e.p[i * 2 - 2], e.p[i * 2 + 1] - e.p[i * 2 - 1]));
    const k = (RANK[e.k] ? e.k : e.k.replace('_link', '')) || 'residential';
    const lanesDir = e.o ? e.l : Math.max(1, Math.floor(e.l / 2));
    const laneW = Math.min(3.3, (e.o ? e.w : e.w / 2) / lanesDir);
    return { ...e, cum, L: cum[n - 1], lanesDir, laneW, vmax: SPEED[k] || 9, rank: RANK[k] || 1 };
  });

  const out = new Map(); // node -> [{e, dir}]
  const add = (n, v) => (out.get(n) || out.set(n, []).get(n)).push(v);
  edges.forEach((e, i) => {
    if (e.L < 1) return;
    if (e.o !== -1) add(e.a, { e: i, dir: 1 });
    if (e.o !== 1) add(e.b, { e: i, dir: -1 });
  });
  const endNode = (e, dir) => (dir > 0 ? edges[e].b : edges[e].a);

  // Point and tangent at distance s along edge e travelling in dir
  function sample(e, dir, s, res) {
    const E = edges[e];
    const d = dir > 0 ? s : E.L - s;
    let i = 1;
    while (i < E.cum.length - 1 && E.cum[i] < d) i++;
    const t = (d - E.cum[i - 1]) / (E.cum[i] - E.cum[i - 1] || 1);
    const ax = E.p[i * 2 - 2], az = E.p[i * 2 - 1], bx = E.p[i * 2], bz = E.p[i * 2 + 1];
    const l = Math.hypot(bx - ax, bz - az) || 1;
    res.x = ax + (bx - ax) * t;
    res.z = az + (bz - az) * t;
    res.tx = ((bx - ax) / l) * dir;
    res.tz = ((bz - az) / l) * dir;
    return res;
  }

  // --- robots at busy CBD junctions ------------------------------------------------------------------------------------
  const lights = new Map(); // node -> {offset, x, z}
  const degree = new Map();
  edges.forEach((e) => {
    for (const n of [e.a, e.b]) degree.set(n, Math.max(degree.get(n) || 0, 0) + 1);
  });
  for (const [n, deg] of degree) {
    const [x, z] = nodeXZ(n);
    if (deg < 3 || coreWeight(x, z) < 0.05) continue;
    const touching = edges.filter((e) => e.a === n || e.b === n);
    if (!touching.some((e) => e.rank >= 2)) continue;
    const w = Math.max(...touching.map((e) => e.w));
    lights.set(n, { offset: r() * CYCLE, x, z, w });
  }
  const phaseOf = (L, t) => ((t + L.offset) % CYCLE + CYCLE) % CYCLE;
  // 0 green, 1 amber, 2 red for an approach axis (0 = east-west, 1 = north-south)
  const signal = (L, axis, t) => {
    const ph = phaseOf(L, t);
    const a = axis === 0 ? ph : (ph + CYCLE / 2) % CYCLE;
    return a < 17 ? 0 : a < 20 ? 1 : 2;
  };

  // --- vehicles ----------------------------------------------------------------------------------------------------
  const typeNames = Object.keys(VEHICLE_TYPES);
  const pickType = () => {
    let t = r();
    for (const k of typeNames) if ((t -= VEHICLE_TYPES[k].weight) <= 0) return k;
    return 'fit';
  };
  const totalW = edges.reduce((s, e) => s + e.L * e.lanesDir * (e.o ? 1 : 2) * (0.3 + coreWeight(e.p[0], e.p[1])), 0);
  const pickEdge = () => {
    let t = r() * totalW;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      if ((t -= e.L * e.lanesDir * (e.o ? 1 : 2) * (0.3 + coreWeight(e.p[0], e.p[1]))) <= 0) return i;
    }
    return 0;
  };

  function chooseNext(car) {
    const node = endNode(car.e, car.dir);
    const opts = (out.get(node) || []).filter((o) => !(o.e === car.e && o.dir === -car.dir));
    if (!opts.length) return out.get(node)?.find((o) => o.e === car.e) || { e: car.e, dir: -car.dir };
    const here = sample(car.e, car.dir, Math.max(0, edges[car.e].L - 0.5), {});
    let best = opts[0], bw = -1;
    for (const o of opts) {
      const s = sample(o.e, o.dir, Math.min(2, edges[o.e].L), {});
      const straight = here.tx * s.tx + here.tz * s.tz; // 1 straight, 0 turn, -1 back
      const w = (1.4 + straight) * (0.6 + edges[o.e].rank * 0.25) * r();
      if (w > bw) (bw = w), (best = o);
    }
    return best;
  }

  const cars = [];
  for (let i = 0; i < count; i++) {
    const type = pickType();
    const T = VEHICLE_TYPES[type];
    const e = pickEdge();
    const E = edges[e];
    const dir = E.o === -1 ? -1 : E.o === 1 ? 1 : r() < 0.5 ? 1 : -1;
    const car = {
      type, len: T.len, e, dir, s: r() * E.L, lane: Math.floor(r() * E.lanesDir), v: 0, wait: 0,
      drive: (0.85 + r() * 0.3) * T.maxV, kombi: !!T.kombi, x: 0, z: 0, h: 0, init: false, color: T.colors[Math.floor(r() * T.colors.length)],
    };
    car.next = chooseNext(car);
    cars.push(car);
  }

  // --- meshes --------------------------------------------------------------------------------------------------------
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.3 });
  const lampMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const meshes = {};
  for (const type of typeNames) {
    const list = cars.filter((c) => c.type === type);
    const body = new THREE.InstancedMesh(vehicleGeometry(type), bodyMat, Math.max(1, list.length));
    const lamps = new THREE.InstancedMesh(lampGeometry(type), lampMat, Math.max(1, list.length));
    body.count = lamps.count = list.length;
    body.castShadow = true;
    body.frustumCulled = lamps.frustumCulled = false;
    const c = new THREE.Color();
    list.forEach((car, i) => {
      car.slot = i;
      body.setColorAt(i, c.set(car.color));
    });
    scene.add(body, lamps);
    meshes[type] = { body, lamps };
  }

  // Robot heads: one box per approach axis per junction, recoloured each frame
  const lightList = [...lights.entries()];
  const headGeo = new THREE.BoxGeometry(0.5, 1.3, 0.5);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), lightList.length * 2);
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.1, 3.6, 6).translate(0, 1.8, 0), new THREE.MeshStandardMaterial({ color: '#2d2f31' }), lightList.length * 2);
  {
    const m = new THREE.Matrix4();
    lightList.forEach(([, L], i) => {
      const o = L.w / 2 + 1.6;
      const spots = [[L.x + o, L.z - o], [L.x - o, L.z + o]];
      spots.forEach(([x, z], k) => {
        const y = groundY(x, z);
        m.makeTranslation(x, y, z);
        poles.setMatrixAt(i * 2 + k, m);
        m.makeTranslation(x, y + 4.1, z);
        heads.setMatrixAt(i * 2 + k, m);
      });
    });
  }
  scene.add(heads, poles);
  const COLORS = [new THREE.Color(0.1, 2.2, 0.5), new THREE.Color(2.4, 1.3, 0.05), new THREE.Color(2.6, 0.1, 0.05)];

  // --- simulation --------------------------------------------------------------------------------------------------------
  const tmpS = {}, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), v3 = new THREE.Vector3();
  let time = 0;
  const buckets = new Map();

  function update(dt, nightness) {
    dt = Math.min(dt, 0.1);
    time += dt;

    buckets.clear();
    for (const c of cars) {
      const k = c.e * 2 + (c.dir > 0 ? 1 : 0);
      (buckets.get(k) || buckets.set(k, []).get(k)).push(c);
    }
    for (const b of buckets.values()) b.sort((a, b2) => a.s - b2.s);

    for (const c of cars) {
      const E = edges[c.e];
      const remaining = E.L - c.s;
      let gap = 1e9;
      // Leader in the same lane on this edge
      const b = buckets.get(c.e * 2 + (c.dir > 0 ? 1 : 0));
      for (let i = b.indexOf(c) + 1; i < b.length; i++)
        if (b[i].lane === c.lane || E.lanesDir === 1) {
          gap = b[i].s - c.s - (b[i].len + c.len) / 2;
          break;
        }
      // ... or the first car on the edge we're turning into
      if (gap > remaining) {
        const nb = buckets.get(c.next.e * 2 + (c.next.dir > 0 ? 1 : 0));
        if (nb?.length) gap = Math.min(gap, remaining + nb[0].s - (nb[0].len + c.len) / 2);
      }
      // Robots
      const L = lights.get(endNode(c.e, c.dir));
      if (L) {
        sample(c.e, c.dir, Math.max(0, E.L - 1), tmpS);
        const axis = Math.abs(tmpS.tx) > Math.abs(tmpS.tz) ? 0 : 1;
        const sig = signal(L, axis, time);
        const stop = remaining - L.w / 2 - 3;
        if (stop > -0.5 && (sig === 2 || (sig === 1 && stop > 6))) gap = Math.min(gap, stop + c.len / 2);
      }
      // Kombis stop wherever passengers wave
      if (c.kombi) {
        if (c.wait > 0) (c.wait -= dt), (gap = 0);
        else if (c.v > 4 && r() < dt * 0.02 * (0.3 + coreWeight(c.x, c.z))) c.wait = 4 + r() * 8;
      }
      const target = Math.min(E.vmax * c.drive, Math.max(0, (gap - 2.5) * 0.9));
      c.v += Math.max(-9 * dt, Math.min(2.8 * dt, target - c.v));
      if (c.v < 0) c.v = 0;
      c.s += c.v * dt;
      while (c.s >= edges[c.e].L && edges[c.next.e].L > 0.01) {
        c.s -= edges[c.e].L;
        const nxt = c.next;
        c.e = nxt.e;
        c.dir = nxt.dir;
        c.lane = Math.min(c.lane, edges[c.e].lanesDir - 1);
        if (r() < 0.2) c.lane = Math.floor(r() * edges[c.e].lanesDir);
        c.next = chooseNext(c);
      }

      // Pose: offset to the left lane (we drive on the left), smoothed through junctions
      const E2 = edges[c.e];
      sample(c.e, c.dir, c.s, tmpS);
      const off = E2.o ? (c.lane - (E2.lanesDir - 1) / 2) * E2.laneW : E2.laneW * (c.lane + 0.5);
      const tx = tmpS.x + tmpS.tz * off, tz = tmpS.z - tmpS.tx * off; // left normal = (tz, -tx)
      const th = Math.atan2(tmpS.tx, tmpS.tz);
      if (!c.init) (c.x = tx), (c.z = tz), (c.h = th), (c.init = true);
      const k = Math.min(1, dt * 6);
      c.x += (tx - c.x) * k;
      c.z += (tz - c.z) * k;
      let dh = th - c.h;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      c.h += dh * Math.min(1, dt * 5);

      const M = meshes[c.type];
      q.setFromAxisAngle(up, c.h);
      m4.compose(v3.set(c.x, groundY(c.x, c.z), c.z), q, one);
      M.body.setMatrixAt(c.slot, m4);
      M.lamps.setMatrixAt(c.slot, m4);
    }
    for (const M of Object.values(meshes)) {
      M.body.instanceMatrix.needsUpdate = true;
      M.lamps.instanceMatrix.needsUpdate = true;
    }
    lampMat.color.setScalar(0.35 + nightness * 2.2);

    lightList.forEach(([, L], i) => {
      heads.setColorAt(i * 2, COLORS[signal(L, 0, time)]);
      heads.setColorAt(i * 2 + 1, COLORS[signal(L, 1, time)]);
    });
    if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
  }

  return { update, cars, lightCount: lights.size };
}
