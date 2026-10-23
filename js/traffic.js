// js/traffic.js — vehicles driving on the left over the OSM road graph, with robots (traffic lights) at CBD junctions,
// kombis that pull up whenever they like to load passengers, and rows of kombis parked at the ranks.
// Junctions are reserved: a car only enters when the box is empty or everyone inside is travelling parallel to it
// (same or opposing approach), robots permitting. Waiting cars get priority over a steady stream, and anyone stuck
// for too long forces their way through, so the grid can't lock up.
import * as THREE from 'three';
import { groundY, rng, coreWeight } from './util.js';
import { VEHICLE_TYPES, vehicleGeometry, lampGeometry } from './vehicles.js';
import { STREET } from './street.js';
import { rankLayout } from './ranks.js';

const SPEED = { trunk: 16, primary: 14, secondary: 13, tertiary: 11, residential: 8.5, unclassified: 8, living_street: 5 };
const RANK = { trunk: 6, primary: 5, secondary: 4, tertiary: 3, residential: 2, unclassified: 2 };
const CYCLE = 40; // s: EW green 17, amber 3, NS green 17, amber 3
const ROAD_Y = 0.22; // asphalt surface above groundY
const FORCE_AFTER = 7; // s waiting at a free-for-all junction before pushing through anyway
const STALE_AFTER = 14; // s a reservation may stand before it's treated as abandoned

export function createTraffic(scene, DATA, count = 650) {
  const r = rng(99);
  const G = DATA.graph;
  // Edge endpoints a/b are offsets into the flat nodes array (x at n, z at n + 1), so per-node arrays use that length
  const nodeXZ = (n) => [G.nodes[n], G.nodes[n + 1]];
  const nodeCount = G.nodes.length;

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
  const startNode = (e, dir) => (dir > 0 ? edges[e].a : edges[e].b);

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
  const lights = new Map(); // node -> {offset, x, z, w}
  const degree = new Map();
  const maxW = new Float32Array(nodeCount);
  edges.forEach((e) => {
    for (const n of [e.a, e.b]) {
      degree.set(n, (degree.get(n) || 0) + 1);
      maxW[n] = Math.max(maxW[n], e.w);
    }
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
  const axisPhase = (L, axis, t) => {
    const ph = phaseOf(L, t);
    return axis === 0 ? ph : (ph + CYCLE / 2) % CYCLE;
  };
  // 0 green, 1 amber, 2 red for an approach axis (0 = east-west, 1 = north-south)
  const signal = (L, axis, t) => {
    const a = axisPhase(L, axis, t);
    return a < 17 ? 0 : a < 20 ? 1 : 2;
  };
  Object.assign(STREET, { lights, edges, signal, axisPhase, CYCLE, time: 0 });

  // --- junction reservations ------------------------------------------------------------------------------------------
  const isJn = new Uint8Array(nodeCount);
  const jRad = new Float32Array(nodeCount); // half-size of the junction box
  for (const [n, deg] of degree) if (deg >= 3) (isJn[n] = 1), (jRad[n] = lights.get(n)?.w / 2 || maxW[n] / 2);
  const jOcc = new Int16Array(nodeCount); // cars inside (or committed)
  const jDx = new Float32Array(nodeCount), jDz = new Float32Array(nodeCount); // approach direction of the occupants
  const jSince = new Float32Array(nodeCount); // when the current occupancy began
  const jStarve = new Float32Array(nodeCount).fill(-1e9); // last time a car had been kept waiting > 3 s

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

  const hereS = {}, nextS = {};
  function chooseNext(car) {
    const node = endNode(car.e, car.dir);
    const all = out.get(node);
    let n = 0;
    if (all) for (const o of all) if (!(o.e === car.e && o.dir === -car.dir)) n++;
    if (!n) return all?.find((o) => o.e === car.e) || { e: car.e, dir: -car.dir };
    sample(car.e, car.dir, Math.max(0, edges[car.e].L - 0.5), hereS);
    let best = null, bw = -1;
    for (const o of all) {
      if (o.e === car.e && o.dir === -car.dir) continue;
      sample(o.e, o.dir, Math.min(2, edges[o.e].L), nextS);
      const straight = hereS.tx * nextS.tx + hereS.tz * nextS.tz; // 1 straight, 0 turn, -1 back
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
      jn: -1, hold: 0, ax: 0, az: 0, bi: 0, bucket: null,
    };
    car.next = chooseNext(car);
    cars.push(car);
  }

  // --- meshes --------------------------------------------------------------------------------------------------------
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.3 });
  const lampMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const meshes = {};
  const c = new THREE.Color();
  for (const type of typeNames) {
    const list = cars.filter((car) => car.type === type);
    const body = new THREE.InstancedMesh(vehicleGeometry(type), bodyMat, Math.max(1, list.length));
    const lamps = new THREE.InstancedMesh(lampGeometry(type), lampMat, Math.max(1, list.length));
    body.count = lamps.count = list.length;
    body.castShadow = true;
    body.frustumCulled = lamps.frustumCulled = false;
    list.forEach((car, i) => {
      car.slot = i;
      body.setColorAt(i, c.set(car.color));
    });
    scene.add(body, lamps);
    meshes[type] = { body, lamps, M: body.instanceMatrix.array, ML: lamps.instanceMatrix.array };
  }

  // Kombis parked in rows at the ranks; kombis driving past a rank pull in to load far more often
  const rankList = rankLayout(DATA);
  const slots = rankList.flatMap((R) => R.slots);
  const nearRank = new Uint8Array(edges.length);
  edges.forEach((e, i) => {
    for (let k = 0; k < e.p.length; k += 2) if (rankList.some((R) => Math.hypot(e.p[k] - R.x, e.p[k + 1] - R.z) < R.r + 40)) nearRank[i] = 1;
  });
  if (slots.length) {
    const parked = new THREE.InstancedMesh(vehicleGeometry('kombi'), bodyMat, slots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    const KC = VEHICLE_TYPES.kombi.colors;
    slots.forEach((s, i) => {
      q.setFromAxisAngle(up, s.yaw);
      m.compose(v.set(s.x, groundY(s.x, s.z) + s.y, s.z), q, one);
      parked.setMatrixAt(i, m);
      parked.setColorAt(i, c.set(KC[Math.floor(r() * KC.length)]));
    });
    parked.castShadow = parked.receiveShadow = true;
    scene.add(parked);
  }

  // Robot heads: a dark housing per approach axis per junction, with one lamp (red / amber / green) lit and moved
  // to its slot whenever the phase changes. Lamps poke through both faces so they read from either direction.
  const lightList = [...lights.entries()];
  const nHeads = lightList.length * 2;
  const housings = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 1.25, 0.42), new THREE.MeshStandardMaterial({ color: '#1d1f21', roughness: 0.6 }), nHeads);
  const lampBox = new THREE.BoxGeometry(0.5, 0.3, 0.3);
  const heads = new THREE.InstancedMesh(lampBox, new THREE.MeshBasicMaterial({ toneMapped: false }), nHeads);
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.1, 3.6, 6).translate(0, 1.8, 0), new THREE.MeshStandardMaterial({ color: '#2d2f31' }), nHeads);
  const headPos = new Float32Array(nHeads * 3);
  {
    const m = new THREE.Matrix4();
    lightList.forEach(([, L], i) => {
      const o = L.w / 2 + 1.6;
      const spots = [[L.x + o, L.z - o], [L.x - o, L.z + o]];
      spots.forEach(([x, z], k) => {
        const y = groundY(x, z) + 0.14;
        m.makeTranslation(x, y, z);
        poles.setMatrixAt(i * 2 + k, m);
        m.makeTranslation(x, y + 4.1, z);
        housings.setMatrixAt(i * 2 + k, m);
        headPos.set([x, y + 4.1, z], (i * 2 + k) * 3);
      });
    });
  }
  housings.castShadow = poles.castShadow = true;
  scene.add(heads, housings, poles);
  const COLORS = [new THREE.Color(0.1, 2.2, 0.5), new THREE.Color(2.4, 1.3, 0.05), new THREE.Color(2.6, 0.1, 0.05)];
  const LAMP_Y = [-0.4, 0, 0.4]; // green bottom, amber middle, red top
  const lastSig = new Int8Array(nHeads).fill(-1);
  const lampM = new THREE.Matrix4();
  const setLamp = (h, sig) => {
    // axis 0 heads face traffic moving east-west (lamp long along x), axis 1 north-south
    lampM.makeRotationY((h % 2) * Math.PI / 2).setPosition(headPos[h * 3], headPos[h * 3 + 1] + LAMP_Y[sig], headPos[h * 3 + 2]);
    heads.setMatrixAt(h, lampM);
    heads.setColorAt(h, COLORS[sig]);
  };

  // --- simulation --------------------------------------------------------------------------------------------------------
  const tmpS = {};
  let time = 0;
  const buckets = new Map(); // edge*2+dir -> cars sorted by s (arrays reused frame to frame)

  function release(car) {
    const n = car.jn;
    if (n < 0) return;
    if (jOcc[n] > 0) jOcc[n]--;
    car.jn = -1;
  }
  function reserve(car, n) {
    release(car);
    if (jOcc[n] === 0) (jDx[n] = car.ax), (jDz[n] = car.az), (jSince[n] = time);
    jOcc[n]++;
    car.jn = n;
    car.hold = 0;
  }
  // May this car enter junction n now?
  function canEnter(car, n) {
    if (jOcc[n] === 0) return true;
    if (time - jSince[n] > STALE_AFTER) {
      jOcc[n] = 0; // a reservation left behind by a car that got stuck or warped
      return true;
    }
    const parallel = Math.abs(car.ax * jDx[n] + car.az * jDz[n]) > 0.75;
    if (!parallel) return false;
    // don't let a steady stream starve someone who's been waiting across it
    return car.hold > 3 || time - jStarve[n] > 0.5;
  }

  function update(dt, nightness) {
    dt = Math.min(dt, 0.1);
    time += dt;
    STREET.time = time;

    for (const b of buckets.values()) b.length = 0;
    for (const car of cars) {
      const k = car.e * 2 + (car.dir > 0 ? 1 : 0);
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = []));
      b.push(car);
    }
    for (const b of buckets.values()) {
      if (b.length > 1) b.sort(byS);
      for (let i = 0; i < b.length; i++) (b[i].bi = i), (b[i].bucket = b);
    }

    for (const car of cars) {
      const E = edges[car.e];
      const remaining = E.L - car.s;
      let gap = 1e9;
      // Leader in the same lane on this edge
      const b = car.bucket;
      for (let i = car.bi + 1; i < b.length; i++)
        if (b[i].lane === car.lane || E.lanesDir === 1) {
          gap = b[i].s - car.s - (b[i].len + car.len) / 2;
          break;
        }
      // ... or the last car on the edge we're turning into
      let exitRoom = 1e9;
      const nb = buckets.get(car.next.e * 2 + (car.next.dir > 0 ? 1 : 0));
      if (nb?.length) exitRoom = nb[0].s - nb[0].len / 2;
      if (gap > remaining && nb?.length) gap = Math.min(gap, remaining + exitRoom - car.len / 2);

      // Junction ahead: robots, then the reservation
      const node = endNode(car.e, car.dir);
      if (isJn[node] && car.jn !== node) {
        const front = remaining - car.len / 2; // distance from our bumper to the node
        const stopAt = jRad[node] + 2.5; // stop line
        const toLine = front - stopAt;
        if (toLine > -1.5) {
          let held = false;
          const L = lights.get(node);
          if (L) {
            sample(car.e, car.dir, Math.max(0, E.L - 1), tmpS);
            const sig = signal(L, Math.abs(tmpS.tx) > Math.abs(tmpS.tz) ? 0 : 1, time);
            if (sig === 2 || (sig === 1 && toLine > 6)) held = true;
          }
          const brake = (car.v * car.v) / 12 + 2;
          if (held) {
            gap = Math.min(gap, toLine + 2.5);
            car.hold = 0;
          } else if (toLine < brake) {
            sample(car.e, car.dir, Math.max(0, E.L - 1), tmpS);
            car.ax = tmpS.tx;
            car.az = tmpS.tz;
            const exitClear = exitRoom > jRad[node] + car.len + 1;
            if ((exitClear && canEnter(car, node)) || car.hold > FORCE_AFTER) reserve(car, node);
            else {
              gap = Math.min(gap, toLine + 2.5);
              if (car.v < 0.5) car.hold += dt;
              if (car.hold > 3) jStarve[node] = time;
            }
          }
        }
      }

      // Kombis stop wherever passengers wave (but not in the middle of a junction)
      if (car.kombi) {
        if (car.wait > 0) (car.wait -= dt), (gap = 0);
        else if (car.v > 4 && car.jn < 0 && remaining > 25 && r() < dt * (nearRank[car.e] ? 0.1 : 0.02 * (0.3 + coreWeight(car.x, car.z)))) car.wait = nearRank[car.e] ? 6 + r() * 10 : 4 + r() * 8;
      }
      const target = Math.min(E.vmax * car.drive, Math.max(0, (gap - 2.5) * 0.9));
      car.v += Math.max(-9 * dt, Math.min(2.8 * dt, target - car.v));
      if (car.v < 0) car.v = 0;
      car.s += car.v * dt;
      while (car.s >= edges[car.e].L && edges[car.next.e].L > 0.01) {
        car.s -= edges[car.e].L;
        const nxt = car.next;
        // crossed a junction without a reservation (spawned inside, or a dead-end U-turn): count us in anyway
        const passed = endNode(car.e, car.dir);
        if (isJn[passed] && car.jn !== passed) reserve(car, passed);
        car.e = nxt.e;
        car.dir = nxt.dir;
        car.lane = Math.min(car.lane, edges[car.e].lanesDir - 1);
        if (r() < 0.2) car.lane = Math.floor(r() * edges[car.e].lanesDir);
        car.next = chooseNext(car);
      }
      // Leave the junction box once our tail is clear of it
      if (car.jn >= 0) {
        const n = car.jn;
        if (startNode(car.e, car.dir) === n) {
          if (car.s - car.len / 2 > jRad[n] + 0.5 || car.s > edges[car.e].L - 1) release(car);
        } else if (endNode(car.e, car.dir) !== n) release(car);
      }

      // Pose: offset to the left lane (we drive on the left), smoothed through junctions
      const E2 = edges[car.e];
      sample(car.e, car.dir, car.s, tmpS);
      const off = E2.o ? (car.lane - (E2.lanesDir - 1) / 2) * E2.laneW : E2.laneW * (car.lane + 0.5);
      const tx = tmpS.x + tmpS.tz * off, tz = tmpS.z - tmpS.tx * off; // left normal = (tz, -tx)
      const th = Math.atan2(tmpS.tx, tmpS.tz);
      if (!car.init) (car.x = tx), (car.z = tz), (car.h = th), (car.init = true);
      const k = Math.min(1, dt * 6);
      car.x += (tx - car.x) * k;
      car.z += (tz - car.z) * k;
      let dh = th - car.h;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      car.h += dh * Math.min(1, dt * 5);

      // Write both instance matrices directly (yaw-only rotation)
      const M = meshes[car.type], o = car.slot * 16;
      const cs = Math.cos(car.h), sn = Math.sin(car.h), y = groundY(car.x, car.z) + ROAD_Y;
      writeYaw(M.M, o, cs, sn, car.x, y, car.z);
      writeYaw(M.ML, o, cs, sn, car.x, y, car.z);
    }
    for (const type in meshes) {
      meshes[type].body.instanceMatrix.needsUpdate = true;
      meshes[type].lamps.instanceMatrix.needsUpdate = true;
    }
    lampMat.color.setScalar(0.35 + nightness * 2.2);

    let dirty = false;
    for (let i = 0; i < lightList.length; i++) {
      const L = lightList[i][1];
      for (let k = 0; k < 2; k++) {
        const s = signal(L, k, time);
        if (s !== lastSig[i * 2 + k]) {
          lastSig[i * 2 + k] = s;
          setLamp(i * 2 + k, s);
          dirty = true;
        }
      }
    }
    if (dirty) {
      heads.instanceMatrix.needsUpdate = true;
      if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
    }
  }

  return { update, cars, lightCount: lights.size, parked: slots.length };
}

const byS = (a, b) => a.s - b.s;

function writeYaw(A, o, cs, sn, x, y, z) {
  A[o] = cs; A[o + 1] = 0; A[o + 2] = -sn; A[o + 3] = 0;
  A[o + 4] = 0; A[o + 5] = 1; A[o + 6] = 0; A[o + 7] = 0;
  A[o + 8] = sn; A[o + 9] = 0; A[o + 10] = cs; A[o + 11] = 0;
  A[o + 12] = x; A[o + 13] = y; A[o + 14] = z; A[o + 15] = 1;
}
