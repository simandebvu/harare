// js/robots.js — how the robots (traffic lights) look: Zimbabwe-style black three-aspect heads with tunnel visors and
// white-bordered backplates on grey poles at every corner, a primary on the near-side left of each approach and a
// secondary on the far-side right, cantilever mast arms reaching over the wide roads, and red / green man pedestrian
// heads at the CBD crossings. Purely visual: the phases come from traffic.js's signal() clock.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { groundY, coreWeight } from './util.js';

const PAVE = 0.14;
const LENS_Y = [0.3, 0, -0.3]; // red top, amber middle, green bottom
const ON = [new THREE.Color(3.2, 0.12, 0.05), new THREE.Color(3.0, 1.45, 0.04), new THREE.Color(0.12, 2.6, 1.0)];
const OFF = [new THREE.Color(0.11, 0.012, 0.01), new THREE.Color(0.1, 0.06, 0.006), new THREE.Color(0.01, 0.07, 0.04)];
const MAN_ON = [new THREE.Color(3.0, 0.15, 0.08), new THREE.Color(0.2, 2.6, 1.1)];
const MAN_OFF = [new THREE.Color(0.1, 0.02, 0.015), new THREE.Color(0.015, 0.07, 0.04)];

// Several coloured parts → one geometry with baked vertex colours
function parts(list) {
  return mergeGeometries(
    list.map(([g, col, m]) => {
      const geo = g.index ? g.toNonIndexed() : g.clone();
      if (m) geo.applyMatrix4(m);
      for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
      const c = new THREE.Color(col), n = geo.attributes.position.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) (a[i * 3] = c.r), (a[i * 3 + 1] = c.g), (a[i * 3 + 2] = c.b);
      geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
      return geo;
    })
  );
}
const T = (x, y, z, rx = 0) => new THREE.Matrix4().makeRotationX(rx).setPosition(x, y, z);

// Pedestrian aspect icons: a standing red man and a walking green man, white on near-black (instance colour tints)
function manTexture(walking) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#060606';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = g.strokeStyle = '#ffffff';
  g.lineCap = 'round';
  g.beginPath();
  g.arc(32, 11, 6, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 9;
  const line = (pts) => {
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.stroke();
  };
  if (walking) {
    line([33, 22, 31, 38]); // torso
    g.lineWidth = 6;
    line([32, 25, 22, 33, 18, 40]); // back arm
    line([33, 25, 42, 32, 46, 38]); // front arm
    line([31, 38, 23, 48, 17, 57]); // back leg
    line([31, 38, 39, 47, 44, 57]); // front leg
  } else {
    line([32, 22, 32, 40]);
    g.lineWidth = 6;
    line([26, 24, 23, 40]);
    line([38, 24, 41, 40]);
    line([29, 40, 28, 58]);
    line([35, 40, 36, 58]);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Where the robot poles stand, for js/features/furniture.js to keep its clutter clear
export const ROBOT_POLES = [];

export function createRobots(scene, { G, edges, lights, signal }) {
  const inc = new Map();
  edges.forEach((e) => {
    if (e.a === e.b) return;
    for (const n of [e.a, e.b]) if (lights.has(n)) (inc.get(n) || inc.set(n, []).get(n)).push(e);
  });

  const poles = []; // {x, z, tall}
  const vHeads = []; // {x, y, z, yaw, L, axis, s}
  const pHeads = []; // {x, y, z, yaw, L, axis}
  const arms = []; // {x, y, z, yaw, len}
  const poleAt = (x, z) => {
    for (const p of poles) if (Math.hypot(p.x - x, p.z - z) < 1.3) return p;
    const p = { x, z, tall: false, faces: [] };
    poles.push(p);
    return p;
  };
  // one head per facing per pole
  const claim = (p, kind, fx, fz) => {
    for (const f of p.faces) if (f.kind === kind && f.fx * fx + f.fz * fz > 0.85) return false;
    p.faces.push({ kind, fx, fz });
    return true;
  };

  for (const [n, L] of lights) {
    const nx = G.nodes[n], nz = G.nodes[n + 1];
    const es = inc.get(n);
    if (!es) continue;
    const armsHere = es
      .filter((e) => e.k !== 'service' && e.L > 4)
      .map((e) => {
        const atA = e.a === n, p = e.p;
        const px = atA ? p[2] : p[p.length - 4], pz = atA ? p[3] : p[p.length - 3];
        const l = Math.hypot(px - nx, pz - nz) || 1;
        const dx = (px - nx) / l, dz = (pz - nz) / l;
        return { dx, dz, w: e.w, o: e.o, incoming: e.o === 1 ? !atA : e.o === -1 ? atA : true, axis: Math.abs(dx) > Math.abs(dz) ? 0 : 1 };
      });
    if (armsHere.length < 2) continue;
    // a spot on the carriageway of any arm?
    const onRoad = (x, z) =>
      armsHere.some((a) => {
        const t = Math.max(0, (x - nx) * a.dx + (z - nz) * a.dz);
        return Math.hypot(x - nx - a.dx * t, z - nz - a.dz * t) < a.w / 2 + 0.35;
      });
    const corner = (a, S, side, off) => {
      // side +1 = the left of a driver approaching along a, -1 = their right
      const lx = -a.dz * side, lz = a.dx * side;
      for (let s = S; s < S + 8; s += 1) {
        const x = nx + a.dx * s + lx * (a.w / 2 + off), z = nz + a.dz * s + lz * (a.w / 2 + off);
        if (!onRoad(x, z)) return [x, z];
      }
      return null;
    };
    const S = L.w / 2 + 1.6;
    const ped = coreWeight(nx, nz) > 0.2;
    for (const a of armsHere) {
      const lx = -a.dz, lz = a.dx; // driver's left when approaching along a (heading -d)
      const near = corner(a, S, 1, 0.6);
      if (a.incoming && near) {
        const p = poleAt(near[0], near[1]);
        if (claim(p, 'v', a.dx, a.dz)) vHeads.push({ x: p.x + a.dx * 0.2, y: 3.0, z: p.z + a.dz * 0.2, yaw: Math.atan2(a.dx, a.dz), L, axis: a.axis, s: 1.25, gx: p.x, gz: p.z });
        // Cantilever over the wide approaches, the head hung above the middle of the incoming lanes
        const wide = a.o ? a.w >= 10 : a.w >= 13;
        if (wide && !p.tall) {
          p.tall = true;
          const len = (a.o ? a.w / 2 : a.w / 4) + 0.6 + 0.4;
          arms.push({ x: p.x, z: p.z, len, rx: -lx, rz: -lz });
          vHeads.push({ x: p.x - lx * len + a.dx * 0.05, y: 5.05, z: p.z - lz * len + a.dz * 0.05, yaw: Math.atan2(a.dx, a.dz), L, axis: a.axis, s: 1.4, gx: p.x, gz: p.z });
        }
      }
      // Far-side secondary, across the junction on the driver's right
      if (a.incoming) {
        let opp = null;
        for (const b of armsHere) if (b.dx * a.dx + b.dz * a.dz < -0.8) opp = b;
        if (opp) {
          const far = corner(opp, S, 1, 0.6); // opp's left side == our right
          if (far) {
            const p = poleAt(far[0], far[1]);
            if (claim(p, 'v', a.dx, a.dz)) vHeads.push({ x: p.x + a.dx * 0.2, y: 3.0, z: p.z + a.dz * 0.2, yaw: Math.atan2(a.dx, a.dz), L, axis: a.axis, s: 1.25, gx: p.x, gz: p.z });
          }
        }
      }
      // Red / green man at the crossings: on the corner pole, facing walkers on the far kerb of this arm and of the
      // arm round the corner
      if (ped && near && a.w >= 7) {
        const p = poleAt(near[0], near[1]);
        if (claim(p, 'p', -lx, -lz)) pHeads.push({ x: p.x - lx * 0.17, y: 2.25, z: p.z - lz * 0.17, yaw: Math.atan2(-lx, -lz), L, axis: a.axis });
        let side = null, bd = 0.55;
        for (const b of armsHere) if (b !== a && b.dx * lx + b.dz * lz > bd) (bd = b.dx * lx + b.dz * lz), (side = b);
        if (side && side.w >= 7 && claim(p, 'p', -a.dx, -a.dz)) pHeads.push({ x: p.x - a.dx * 0.17, y: 2.25, z: p.z - a.dz * 0.17, yaw: Math.atan2(-a.dx, -a.dz), L, axis: side.axis });
      }
    }
  }

  ROBOT_POLES.length = 0;
  for (const p of poles) if (p.faces.length) ROBOT_POLES.push({ x: p.x, z: p.z });
  const group = new THREE.Group();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

  // Poles: galvanised grey with a black-and-white banded foot (instance colour unused)
  const bands = [];
  for (let i = 0; i < 4; i++) bands.push([new THREE.CylinderGeometry(0.085, 0.085, 0.25, 10), i % 2 ? '#f2f2ee' : '#111111', T(0, 0.125 + i * 0.25, 0)]);
  const poleGeo = (h) =>
    parts([
      [new THREE.CylinderGeometry(0.075, 0.08, h, 10), '#8e9193', T(0, h / 2, 0)],
      [new THREE.CylinderGeometry(0.09, 0.09, 0.06, 10), '#8e9193', T(0, h, 0)],
      ...bands,
    ]);
  const poleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.55 });
  for (const tall of [false, true]) {
    const list = poles.filter((p) => p.tall === tall && p.faces.length);
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(poleGeo(tall ? 6.05 : 3.6), poleMat, list.length);
    list.forEach((p, i) => mesh.setMatrixAt(i, m.makeTranslation(p.x, groundY(p.x, p.z) + PAVE, p.z)));
    mesh.castShadow = true;
    mesh.userData.static = 'pole';
    group.add(mesh);
  }
  if (arms.length) {
    const armGeo = parts([
      [new THREE.CylinderGeometry(0.06, 0.07, 1, 8).rotateZ(Math.PI / 2), '#8e9193', T(0.5, 0, 0)],
      [new THREE.BoxGeometry(0.06, 0.6, 0.06), '#8e9193', T(0.04, -0.3, 0)], // gusset stub down the pole
    ]);
    const mesh = new THREE.InstancedMesh(armGeo, poleMat, arms.length);
    arms.forEach((a, i) => {
      q.setFromAxisAngle(up, Math.atan2(-a.rz, a.rx));
      mesh.setMatrixAt(i, m.compose(p3.set(a.x, groundY(a.x, a.z) + PAVE + 5.95, a.z), q, s3.set(a.len, 1, 1)));
    });
    mesh.castShadow = true;
    mesh.userData.static = 'pole';
    group.add(mesh);
  }

  // Vehicle head: black housing, a tunnel visor over each lens, backplate with a white retro-reflective border
  const visor = (y) => [new THREE.CylinderGeometry(0.14, 0.14, 0.2, 10, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2), '#121314', T(0, y + 0.005, 0.22)];
  const headGeo = parts([
    [new THREE.BoxGeometry(0.34, 0.96, 0.24), '#151618', T(0, 0, 0)],
    // black plate, white retro-reflective border on the face only (the back reads black)
    [new THREE.BoxGeometry(0.6, 1.2, 0.012), '#0d0d0e', T(0, 0, -0.124)],
    [new THREE.BoxGeometry(0.68, 1.28, 0.006), '#f4f4ef', T(0, 0, -0.133)],
    [new THREE.BoxGeometry(0.7, 1.3, 0.014), '#0d0d0e', T(0, 0, -0.143)],
    [new THREE.BoxGeometry(0.1, 0.1, 0.14), '#2a2b2d', T(0, 0, -0.2)],
    ...LENS_Y.map(visor),
  ]);
  const headMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15, side: THREE.DoubleSide });
  const housings = new THREE.InstancedMesh(headGeo, headMat, Math.max(1, vHeads.length));
  const lensGeo = new THREE.CircleGeometry(0.118, 16).translate(0, 0, 0.122);
  const lenses = new THREE.InstancedMesh(lensGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), Math.max(1, vHeads.length * 3));
  // Hangers from the mast arm down to the overhead heads
  const hangers = [];
  vHeads.forEach((h, i) => {
    const y = groundY(h.gx, h.gz) + PAVE + h.y;
    q.setFromAxisAngle(up, h.yaw);
    s3.setScalar(h.s);
    housings.setMatrixAt(i, m.compose(p3.set(h.x, y, h.z), q, s3));
    for (let k = 0; k < 3; k++) {
      lenses.setMatrixAt(i * 3 + k, m.compose(p3.set(h.x, y + LENS_Y[k] * h.s, h.z), q, s3));
      lenses.setColorAt(i * 3 + k, OFF[k]);
    }
    if (h.s > 1.3) hangers.push([h.x, y + 0.48 * h.s, h.z]);
  });
  // A soft additive halo in front of whichever lens is lit, so the aspect carries down the street (and blooms at night)
  const haloTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'), gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'), gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const haloMat = new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const halos = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.75, 0.75).translate(0, 0, 0.36), haloMat, Math.max(1, vHeads.length));
  halos.count = vHeads.length;
  halos.renderOrder = 3;
  const headBase = new Float32Array(vHeads.length * 4); // x, y, z, yaw
  vHeads.forEach((h, i) => headBase.set([h.x, groundY(h.gx, h.gz) + PAVE + h.y, h.z, h.yaw], i * 4));
  group.add(halos);
  housings.count = vHeads.length;
  lenses.count = vHeads.length * 3;
  housings.castShadow = true;
  housings.userData.static = 'pole';
  group.add(housings, lenses);
  if (hangers.length) {
    const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 6), poleMat, hangers.length);
    hangers.forEach(([x, y, z], i) => mesh.setMatrixAt(i, m.makeTranslation(x, y + 0.15, z)));
    mesh.userData.static = 'prop';
    group.add(mesh);
  }

  // Pedestrian head: squat black box, red man over green man
  const pedGeo = parts([
    [new THREE.BoxGeometry(0.34, 0.66, 0.2), '#151618', T(0, 0, 0)],
    [new THREE.BoxGeometry(0.38, 0.03, 0.16), '#121314', T(0, 0.17, 0.17)],
    [new THREE.BoxGeometry(0.38, 0.03, 0.16), '#121314', T(0, -0.15, 0.17)],
    [new THREE.BoxGeometry(0.08, 0.08, 0.1), '#2a2b2d', T(0, 0, -0.14)],
  ]);
  const pedBox = new THREE.InstancedMesh(pedGeo, headMat, Math.max(1, pHeads.length));
  const faceGeo = (y) => new THREE.PlaneGeometry(0.27, 0.27).translate(0, y, 0.102);
  const men = [false, true].map((walk, k) => new THREE.InstancedMesh(faceGeo(k ? -0.155 : 0.155), new THREE.MeshBasicMaterial({ map: manTexture(walk), toneMapped: false }), Math.max(1, pHeads.length)));
  pHeads.forEach((h, i) => {
    q.setFromAxisAngle(up, h.yaw);
    m.compose(p3.set(h.x, groundY(h.x, h.z) + PAVE + h.y, h.z), q, s3.setScalar(1));
    pedBox.setMatrixAt(i, m);
    pedBox.userData.static = 'prop';
    men.forEach((mm, k) => (mm.setMatrixAt(i, m), mm.setColorAt(i, MAN_OFF[k])));
  });
  pedBox.count = men[0].count = men[1].count = pHeads.length;
  group.add(pedBox, ...men);
  group.userData.fur = 2;
  scene.add(group);

  const lastV = new Int8Array(vHeads.length).fill(-1), lastP = new Int8Array(pHeads.length).fill(-1);
  const HALO = [new THREE.Color(1.0, 0.06, 0.03), new THREE.Color(1.0, 0.5, 0.03), new THREE.Color(0.05, 0.9, 0.4)];
  const hc = new THREE.Color();
  let lastNight = -1;
  function update(time, nightness = 0) {
    let dv = false, dp = false;
    const night = Math.round(nightness * 20) / 20, glow = 0.22 + night * 0.9;
    const relight = night !== lastNight;
    lastNight = night;
    for (let i = 0; i < vHeads.length; i++) {
      const h = vHeads[i], s = signal(h.L, h.axis, time);
      if (s === lastV[i] && !relight) continue;
      const k = s === 0 ? 2 : s === 1 ? 1 : 0; // lens slot: green bottom, amber middle, red top
      for (let j = 0; j < 3; j++) lenses.setColorAt(i * 3 + j, j === k ? ON[j] : OFF[j]);
      q.setFromAxisAngle(up, headBase[i * 4 + 3]);
      halos.setMatrixAt(i, m.compose(p3.set(headBase[i * 4], headBase[i * 4 + 1] + LENS_Y[k] * h.s, headBase[i * 4 + 2]), q, s3.setScalar(h.s)));
      halos.setColorAt(i, hc.copy(HALO[k]).multiplyScalar(glow));
      lastV[i] = s;
      dv = true;
    }
    for (let i = 0; i < pHeads.length; i++) {
      const h = pHeads[i];
      // walkers crossing this arm go while the traffic running alongside them has green (same rule as people.js)
      const s = signal(h.L, 1 - h.axis, time) === 0 && signal(h.L, h.axis, time) === 2 ? 1 : 0;
      if (s === lastP[i]) continue;
      men[0].setColorAt(i, s ? MAN_OFF[0] : MAN_ON[0]);
      men[1].setColorAt(i, s ? MAN_ON[1] : MAN_OFF[1]);
      lastP[i] = s;
      dp = true;
    }
    if (dv) {
      lenses.instanceColor.needsUpdate = true;
      halos.instanceMatrix.needsUpdate = true;
      halos.instanceColor.needsUpdate = true;
    }
    if (dp) for (const mm of men) if (mm.instanceColor) mm.instanceColor.needsUpdate = true;
  }

  console.log(`[harare] robots: ${lights.size} junctions, ${poles.filter((p) => p.faces.length).length} poles (${arms.length} mast arms), ${vHeads.length} signal heads, ${pHeads.length} pedestrian heads`);
  return { update, group, heads: vHeads.length };
}
