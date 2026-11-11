// js/people.js — pedestrians on the pavements, street vendors under umbrellas, crowds and touts at the kombi ranks, and
// hawkers who walk out between the cars while the robots are red. Everyone is one GPU-animated instanced mesh
// (figures.js); this file only decides where they stand and whether they're walking.
import * as THREE from 'three';
import { addOverhead } from './overheads.js';
import { movePedestrian } from './pedestrian-motion.js';
import { groundY, rng, coreWeight } from './util.js';
import { createFigures } from './figures.js';
import { STREET } from './street.js';
import { rankLayout } from './ranks.js';
import { MeshKit } from './meshkit.js';

const TOPS = ['#2d3e66', '#8a2222', '#e8e2d2', '#f4f4f0', '#3f6f3a', '#d9a521', '#6b4c8a', '#c2562c', '#4a6d8c', '#7c7f84', '#f0c9d0', '#2e7f7a', '#e0d34a', '#b8322f', '#1f6fb3', '#ffffff', '#ef8a2a'];
const TROUSERS = ['#2a3550', '#1e2a44', '#3b4f73', '#1c1c1e', '#34302b', '#6e6250', '#8a7d62', '#4a4d52', '#5a3d2b'];
const DRESSES = ['#c0283a', '#e3a01b', '#2f5fa8', '#6d2f8a', '#e2557a', '#1f7a5a', '#d9632b', '#f2e6c9', '#1d1d1f', '#8fc0e8', '#a33d16'];
const SUITS = ['#1d2230', '#2a2c30', '#3a3d44', '#232a3a'];
const DOEKS = ['#d33a2c', '#f0b52a', '#1f6fb3', '#2c8a4b', '#7c2f9a', '#f2f2ee', '#e2557a', '#e8752a'];
const SKIN = ['#5a3826', '#6b4430', '#7a4e34', '#4a2e20', '#8a5a3c', '#5c3a28', '#6e4630', '#956446', '#64402c'];
const BASINS = ['#c9cdd2', '#d63a2a', '#2f6fb3', '#3d8d46', '#e3b31f'];
const BAGS = ['#3a2a1e', '#1c1c1e', '#6a4428', '#2f6fb3', '#b33a2a', '#d9cbb0'];
const UMBRELLAS = ['#d63a2a', '#f2c230', '#2f6fb3', '#3d8d46', '#e86d24', '#ffffff', '#7d3fb0'];
const PRODUCE = ['#c7271c', '#e8c22a', '#4c7a2a', '#e07b22', '#6e3b1f', '#f0e6c8'];
const TROUSERS_F = ['#1c1c1e', '#2a3550', '#3b4f73', '#6b2f3a', '#e8e2d2', '#4a4d52', '#8a7d62'];
const HAIRS = ['#120e0c', '#17110e', '#1d1511', '#0e0b0a'];
const HAIRS_F = ['#120e0c', '#17110e', '#2a1a12', '#3a2014', '#4a1a1e', '#0e0b0a', '#5a3218'];
const SHOES = ['#141414', '#141414', '#2b1c12', '#4a3020', '#e4e4e0', '#6a6a6a', '#1c2a44'];
const HIVIS = ['#cfee1c', '#ff6a12', '#e8f53a'];
const OVERALLS = ['#1f3b73', '#2f5fa8', '#d9541a', '#2c5a2f', '#1b2c55'];
const TIES = ['#7a1c22', '#1c2f6a', '#2f2f33', '#6a5418', '#3a1c4a'];
const CAPS = ['#1c1c1e', '#d63a2a', '#2f6fb3', '#f2f2ee', '#2c8a4b', '#e3b31f'];
const JERSEYS = ['#6a1b2a', '#1f4f30', '#1d2a4a', '#5a1a5e', '#8a1c1c'];
const GYMSLIPS = ['#2a3f7a', '#1f5a3a', '#6a1b2a', '#3a6fb0', '#7a7f86'];
const CRATES = ['#c4271f', '#e3b31f', '#2f6fb3', '#2c8a4b'];
const PAVE = 0.15; // pavement surface height above groundY

export function createPeople(scene, DATA, blocked, count = 2600) {
  const r = rng(314);
  let contacts=null, deferCommit=false;
  const solid=(x,z)=>blocked.circle ? blocked.circle(x,z,.42) : blocked(x,z);
  function clearSpawn(p) {
    if(!solid(p.x,p.z))return;
    const ox=p.x,oz=p.z;
    for(let d=.4;d<20;d+=.4)for(let k=0;k<16;k++) {
      const x=ox+Math.cos(k*Math.PI/8)*d,z=oz+Math.sin(k*Math.PI/8)*d;
      if(!solid(x,z)){p.x=x;p.z=z;return;}
    }
  }
  // Street furniture only matters where it can be seen: beyond NEAR of the camera pedestrians skip it
  const NEAR2 = 120 * 120;
  let camX = 0, camZ = 0;
  let mpP=null,mpNear=true;
  // A walker stuck for a second squeezes: slim against cars and furniture (it slips through a gap in a queue but never
  // ends up inside a car body) and shuffles past other walkers, so a narrow pinch can't lock a crowd in place
  const mpBlocked=(a,b)=>{const sq=mpP.squeezeT>0;return solid(a,b)||!!contacts?.personBlocked(a,b,sq?.1:.32,mpP,0,mpNear,true,!sq);};
  function movePerson(p,x,z) {
    mpP=p;mpNear=(p.x-camX)**2+(p.z-camZ)**2<NEAR2;
    return movePedestrian(p,x,z,mpBlocked);
  }

  const G = DATA.graph;
  const edges = G.edges.map((e) => {
    const n = e.p.length / 2;
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(e.p[i * 2] - e.p[i * 2 - 2], e.p[i * 2 + 1] - e.p[i * 2 - 1]));
    const [mx, mz] = [e.p[Math.floor(n / 2) * 2], e.p[Math.floor(n / 2) * 2 + 1]];
    // signal axis of the approach at each end (0 = east-west, 1 = north-south), same rule as traffic.js
    const axA = Math.abs(e.p[2] - e.p[0]) > Math.abs(e.p[3] - e.p[1]) ? 0 : 1;
    const axB = Math.abs(e.p[n * 2 - 2] - e.p[n * 2 - 4]) > Math.abs(e.p[n * 2 - 1] - e.p[n * 2 - 3]) ? 0 : 1;
    return { ...e, cum, L: cum[n - 1], core: coreWeight(mx, mz), axA, axB };
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
  const pick = (arr) => arr[Math.floor(r() * arr.length)];

  // --- layout first (so we know how many figures to allocate) --------------------------------------------------------
  const stalls = [];
  for (let ei = 0; ei < edges.length; ei++) {
    const e = edges[ei];
    if (e.core < 0.2) continue;
    const n = Math.floor((e.L / 25) * e.core * (r() < 0.5 ? 1 : 0.5));
    for (let k = 0; k < n; k++) {
      const s = sample(ei, r() * e.L, {});
      const side = r() < 0.5 ? 1 : -1;
      const off = (e.w / 2 + 2.3) * side;
      const x = s.x + s.tz * off, z = s.z - s.tx * off;
      if (!blocked(x, z)) stalls.push({ x, z, y: PAVE, side, yaw: Math.atan2(s.tx, s.tz) });
    }
  }
  const ranks = rankLayout(DATA);
  for (const R of ranks) for (const s of R.stalls) stalls.push({ x: s.x, z: s.z, y: s.y, side: 1, yaw: s.yaw + Math.PI / 2 });
  const rankFolk = ranks.flatMap((R) => R.crowd.map((c) => ({ ...c, rank: R })));

  // Hawker beats: approaches into busy robot junctions, two-way or multi-lane, long enough to queue on
  const beats = [];
  if (STREET.lights && STREET.edges) {
    for (const [node, L] of STREET.lights) {
      if (coreWeight(L.x, L.z) < 0.5) continue;
      for (const ei of at.get(node) || []) {
        const E = edges[ei], T = STREET.edges[ei];
        if (!T || E.L < 45) continue;
        const dir = E.b === node ? 1 : -1; // travel direction that heads into the junction
        if (E.o && E.o !== dir) continue;
        if (E.o && T.lanesDir < 2) continue;
        const off = E.o ? (0.5 - (T.lanesDir - 1) / 2) * T.laneW : 0; // centre line, or the line between lanes
        beats.push({ node, L, e: ei, dir, axis: dir > 0 ? E.axB : E.axA, off, kerb: E.w / 2 + 1.1 });
      }
    }
    for (let i = beats.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [beats[i], beats[j]] = [beats[j], beats[i]];
    }
    beats.length = Math.min(beats.length, 34);
  }

  const capacity = count + stalls.length + rankFolk.length + beats.length;
  const F = createFigures(scene, capacity);

  // --- outfits ---------------------------------------------------------------------------------------------------------
  const col = (hex) => new THREE.Color(hex);
  // kind: 'walker' | 'vendor' | 'rank' | 'tout' | 'hawker'
  function dress(kind, core = 1) {
    const child = kind === 'walker' && r() < 0.06;
    const woman = kind === 'tout' ? r() < 0.12 : r() < 0.5;
    const L = { fem: woman ? 1 : 0, child: child ? 1 : 0, seed: r(), skin: col(pick(SKIN)), hair: col(pick(woman ? HAIRS_F : HAIRS)), shoe: col(pick(SHOES)), bag: col(pick(BAGS)), acc: col(pick(DOEKS)), sleeve: r() < 0.5 ? 0.16 : 0.53, hem: 0, load: 0, bagKind: 0, outfit: 0, hairStyle: 0, skirt: 0, wrap: 0 };
    L.top = col(pick(TOPS));
    L.bot = col(pick(TROUSERS));
    let school = false;
    if (child && r() < 0.65) {
      // school uniform: shirt, jersey or tunic, grey shorts or a gymslip, a backpack
      school = true;
      const jersey = r() < 0.4;
      L.top = col(jersey ? pick(JERSEYS) : r() < 0.6 ? '#f2f2ee' : '#cfdced');
      L.outfit = jersey ? 5 : 0;
      L.sleeve = jersey ? 0.53 : 0.16;
      if (woman) (L.bot = col(pick(GYMSLIPS))), (L.skirt = 0.5), r() < 0.5 && L.top.copy(L.bot);
      else (L.bot = col(r() < 0.7 ? '#5c5f63' : '#2a3550')), (L.hem = r() < 0.7 ? 0.55 : 0);
      L.shoe = col('#141414');
      L.bagKind = 3;
      L.bag = col(pick(BAGS));
      L.hairStyle = woman ? (r() < 0.5 ? 0 : 3) : 0;
    } else if (woman) {
      const dressed = r() < (kind === 'vendor' ? 0.8 : 0.6);
      if (dressed) {
        L.bot = col(pick(DRESSES));
        L.skirt = r() < 0.6 ? 0.18 + r() * 0.15 : 0.42 + r() * 0.12;
        if (r() < 0.45) L.top.copy(L.bot); // one-piece dress
        if (r() < (kind === 'vendor' ? 0.55 : 0.25)) (L.wrap = 1), (L.skirt = 0.2 + r() * 0.12); // zambia wrapper
      } else {
        L.bot = col(pick(TROUSERS_F));
        L.hem = r() < 0.15 ? 0.3 : 0;
      }
      const h = r();
      const doek = kind === 'vendor' ? 0.6 : kind === 'hawker' ? 0.5 : 0.28;
      L.hairStyle = h < doek ? 2 : h < doek + 0.3 ? 3 : h < doek + 0.48 ? 1 : 0;
      if (r() < 0.15 && kind !== 'vendor') (L.outfit = 4);
    } else if (kind === 'tout' && r() < 0.6) {
      L.outfit = 2; // marshal's hi-vis vest
      L.acc = col(pick(HIVIS));
      L.hairStyle = r() < 0.45 ? 4 : r() < 0.6 ? 0 : 5;
      if (L.hairStyle === 4) L.acc = col(pick(HIVIS)); // cap and vest
    } else {
      const u = r();
      if (kind === 'walker' && u < 0.2 * core) {
        L.outfit = 1; // office suit
        L.top = col(pick(SUITS));
        L.bot.copy(L.top);
        L.acc = col(pick(TIES));
        L.sleeve = 0.53;
        L.shoe = col(r() < 0.7 ? '#121212' : '#3a2414');
      } else if (u < 0.3) {
        L.outfit = 3; // work overalls
        L.top = col(pick(OVERALLS));
        L.bot.copy(L.top);
        L.sleeve = 0.53;
        L.shoe = col(r() < 0.5 ? '#141414' : '#5a3a1c');
      } else if (u < 0.45) {
        L.outfit = 4; // checked / striped shirt
        L.acc = col(pick(TOPS));
      }
      if (L.outfit !== 1 && r() < 0.06) L.hem = 0.55; // shorts
      const h = r();
      L.hairStyle = h < 0.62 ? 0 : h < 0.8 ? 5 : 4;
      if (L.hairStyle === 4 && L.outfit !== 1) L.acc = col(pick(CAPS));
      else if (L.hairStyle === 4) L.hairStyle = 0;
    }
    if (L.outfit === 4 && woman) L.acc = col(pick(TOPS));
    if (woman && L.hairStyle === 2 && L.wrap) L.acc = col(pick(DOEKS)); // doek and wrapper often match
    const carry = kind === 'walker' || kind === 'rank' || kind === 'hawker';
    if (carry && !child && r() < (kind === 'hawker' ? 0.45 : 0.1)) {
      L.load = woman ? (r() < 0.75 ? 1 + Math.floor(r() * 2) : 3) : r() < 0.7 ? 3 : 1;
      if (L.load < 3) L.acc = col(pick(BASINS));
      else L.acc = col(pick(DOEKS));
      if (L.hairStyle === 4) L.hairStyle = 0;
      if (L.hairStyle === 2 || L.hairStyle === 1) L.hairStyle = 3;
    }
    if (!L.load && !child && carry && r() < 0.28) L.bagKind = r() < 0.55 ? 1 : 2;
    if (kind === 'hawker' && !L.load) L.bagKind = 2;
    const h = child ? 1.1 + r() * 0.3 : woman ? 1.55 + r() * 0.17 : 1.63 + r() * 0.22;
    const b = child ? 0.86 : 0.92 + r() * 0.18 + (woman && r() < 0.3 ? 0.08 : 0);
    const sc = h / 1.72;
    const v = child ? 1.0 + r() * 0.4 : 1.0 + r() * 0.55;
    L.phase = r() * 6.283;
    L.freq = ((v * 4.4) / sc) * (L.skirt > 0 && L.skirt < 0.4 ? 1.12 : 1); // long skirts: shorter, quicker steps
    const i = F.add(L);
    const idle = r() < 0.45 ? 0 : 1 + Math.floor(r() * 3);
    F.pose(i, 0, idle, 0);
    return { i, s: sc, b, v, school, look: L };
  }

  // --- pedestrians ----------------------------------------------------------------------------------------------------
  const walkers = [];
  for (let k = 0; k < count; k++) {
    const e = pickEdge();
    const o = dress('walker', edges[e].core);
    walkers.push({ ...o, e, d: r() * edges[e].L, dir: r() < 0.5 ? 1 : -1, side: r() < 0.5 ? 1 : -1, lat: r() * 1.6, wq: r() * 1.4, x: 0, z: 0, yaw: 0, amp: 1, init: false });
  }

  // --- vendors: stalls on CBD pavements and around the ranks -------------------------------------------------------------
  const ns = stalls.length;
  const c = new THREE.Color();
  const table = new THREE.InstancedMesh(mergeBoxes([[0, 0.75, 0, 1.4, 0.06, 0.8], [0.6, 0.37, 0.3, 0.06, 0.74, 0.06], [-0.6, 0.37, 0.3, 0.06, 0.74, 0.06], [0.6, 0.37, -0.3, 0.06, 0.74, 0.06], [-0.6, 0.37, -0.3, 0.06, 0.74, 0.06]]), new THREE.MeshStandardMaterial({ color: '#7a5a3a', roughness: 0.9 }), ns);
  const produce = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 7, 5).scale(1.6, 0.5, 1).translate(0, 0.86, 0), new THREE.MeshStandardMaterial({ roughness: 0.6 }), ns);
  const umbrella = new THREE.InstancedMesh(new THREE.ConeGeometry(1.3, 0.5, 8).translate(0, 2.25, 0), new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide }), ns);
  const stick = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.025, 2.1, 4).translate(0, 1.05, 0), new THREE.MeshStandardMaterial({ color: '#cccccc' }), ns);
  const vendors = [];
  const crates = new THREE.InstancedMesh(crateGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), Math.max(1, ns));
  let nc = 0;
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3(), sc3 = new THREE.Vector3();
    stalls.forEach((s, i) => {
      const y = groundY(s.x, s.z) + s.y;
      q.setFromAxisAngle(up, s.yaw);
      m.compose(v.set(s.x, y, s.z), q, one);
      table.setMatrixAt(i, m);
      produce.setMatrixAt(i, m);
      stick.setMatrixAt(i, m);
      umbrella.setMatrixAt(i, m);
      produce.setColorAt(i, c.set(PRODUCE[Math.floor(r() * PRODUCE.length)]));
      umbrella.setColorAt(i, c.set(UMBRELLAS[Math.floor(r() * UMBRELLAS.length)]));
      // Seller standing behind the table, facing the street
      const o = dress('vendor');
      const sit = r() < 0.55;
      const back = sit ? 1.15 : 0.85;
      const bx = s.x + Math.cos(s.yaw) * back * s.side, bz = s.z - Math.sin(s.yaw) * back * s.side;
      const yaw = s.yaw - (Math.PI / 2) * s.side;
      F.place(o.i, bx, y, bz, yaw, o.s, o.b);
      if (sit) {
        // on an upturned crate, set just behind the hips
        F.pose(o.i, 1, 0, 0);
        const cx = bx - Math.sin(yaw) * 0.06 * o.s, cz = bz - Math.cos(yaw) * 0.06 * o.s;
        q.setFromAxisAngle(up, yaw + (r() - 0.5) * 0.3);
        m.compose(v.set(cx, y, cz), q, sc3.set(1, (0.47 * o.s - 0.03) / 0.4, 1));
        crates.setMatrixAt(nc, m);
        crates.setColorAt(nc++, c.set(CRATES[Math.floor(r() * CRATES.length)]));
      }
      vendors.push({ ...o, t: r() * 10, sit });
    });
  }
  crates.count = nc;
  for (const m of [table, umbrella, crates]) m.castShadow = true;
  if (ns) scene.add(table, produce, umbrella, stick);
  if (nc) scene.add(crates);

  // --- ranks: shelters, queues, touts, milling crowd --------------------------------------------------------------------
  const shelterList = ranks.flatMap((R) => R.shelters);
  if (shelterList.length) {
    const k = new MeshKit({ color: 3 });
    const roof = [0.55, 0.57, 0.58], post = [0.2, 0.2, 0.21], bench = [0.35, 0.24, 0.15];
    k.taper(0, 2.55, 0, 2.8, 1, 2.8, 1, 0.07, { color: roof }); // unit length, scaled per instance along z
    for (const [x, z] of [[-1.2, -0.45], [1.2, -0.45], [-1.2, 0.45], [1.2, 0.45]]) k.box(x, 1.28, z, 0.08, 2.56, 0.08 / 1, { color: post });
    k.box(-0.9, 0.42, 0, 0.4, 0.06, 0.96, { color: bench });
    const shelters = new THREE.InstancedMesh(k.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 }), shelterList.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3();
    shelterList.forEach((s, i) => {
      q.setFromAxisAngle(up, s.yaw);
      m.compose(v.set(s.x, groundY(s.x, s.z) + s.y, s.z), q, sc.set(1, 1, s.len));
      addOverhead(s.x, s.z, Math.sin(s.yaw), Math.cos(s.yaw), s.len / 2, 1.4, groundY(s.x, s.z) + s.y + 2.5);
      shelters.setMatrixAt(i, m);
    });
    shelters.castShadow = shelters.receiveShadow = true;
    scene.add(shelters);
  }
  const loiter = []; // rank crowd + touts: stand, chat, shuffle a few metres, wave at passing kombis
  for (const f of rankFolk) {
    const o = dress(f.kind === 'tout' ? 'tout' : 'rank');
    loiter.push({ ...o, kind: f.kind, rank: f.rank, ax: f.x, az: f.z, x: f.x, z: f.z, y: f.y, yaw: f.yaw, tx: f.x, tz: f.z, t: r() * 8, amp: 0, g: 0, moving: false });
  }

  // --- hawkers ------------------------------------------------------------------------------------------------------------
  const hawkers = beats.map((B) => {
    const o = dress('hawker');
    const u0 = B.L.w / 2 + 7 + r() * 10;
    const kerbLat = B.kerb; // left-hand kerb of the incoming lanes
    return { ...o, B, u: u0, lat: kerbLat, tu: u0, tlat: kerbLat, home: u0, out: false, t: 0, amp: 0, g: 0, yaw: 0 };
  });

  // --- simulation ---------------------------------------------------------------------------------------------------------
  const tmp = {};
  let time = 0;
  const ease = (cur, target, k) => cur + (target - cur) * k;

  let hourT = 0, kidsHome = false;
  function update(dt) {
    dt = Math.min(dt, 0.1);
    time += dt;
    const cam = globalThis.__harare?.ctx?.camera?.position;
    if (cam) (camX = cam.x), (camZ = cam.z);
    // School uniforms on the streets by day only
    if ((hourT -= dt) < 0) {
      hourT = 1;
      const h = globalThis.__harare?.ctx?.getHour?.();
      const home = h !== undefined && (h < 6 || h > 18.5);
      if (home !== kidsHome) {
        kidsHome = home;
        for (const p of walkers) if (p.school) {p.hidden=home; F.hide(p.i, home);}
      }
    }
    const lights = STREET.lights, st = STREET.time;
    const kA = Math.min(1, dt * 4);

    // Pavement walkers
    for (let wi = 0; wi < walkers.length; wi++) {
      const p = walkers[wi];
      if(p.hidden)continue;
      const oE=p.e,oD=p.d,oDir=p.dir;
      const oldX=p.x,oldZ=p.z;
      let E = edges[p.e];
      let go = 1;
      // Wait at the kerb of a robot junction until traffic going our way has green
      if (lights) {
        const L = lights.get(p.dir > 0 ? E.b : E.a);
        if (L) {
          const toEnd = p.dir > 0 ? E.L - p.d : p.d;
          const kerb = L.w / 2 + 0.5;
          if (toEnd > kerb && toEnd < kerb + 0.3 + p.wq && STREET.signal(L, p.dir > 0 ? E.axB : E.axA, st) !== 0) go = 0;
        }
      }
      // Scared by the hero (a slam, a car thrown nearby): run for it, hands up, ignoring the robots
      const pan = p.panic > 0 ? ((p.panic -= dt), 1) : 0;
      if (pan) go = 1;
      const pv = p.v * (1 + pan * 1.8);
      p.d += pv * dt * p.dir * go;
      if (p.d < 0 || p.d > E.L) {
        const node = p.d < 0 ? E.a : E.b;
        const opts = at.get(node);
        // Prefer the busier streets so the crowd stays in town
        let next = p.e, bw = -1;
        if (opts) for (let k = 0; k < opts.length; k++) {
          const o = opts[k];
          if (o === p.e) continue;
          const w = (0.15 + edges[o].core) * r();
          if (w > bw) (bw = w), (next = o);
        }
        const N = edges[next];
        if (next === p.e) (p.dir = -p.dir), (p.d = Math.max(0, Math.min(E.L, p.d)));
        else if (N.a === node) (p.e = next), (p.dir = 1), (p.d = 0);
        else (p.e = next), (p.dir = -1), (p.d = N.L);
        E = edges[p.e];
      }
      sample(p.e, p.d, tmp);
      let off = (E.w / 2 + 0.8 + p.lat) * p.side;
      let tx = tmp.x + tmp.tz * off, tz = tmp.z - tmp.tx * off;
      if(solid(tx,tz))for(const lateral of [0,.4,.8,1.2,1.8,2.4,3.2]) {
        const candidate=(E.w/2+.65+lateral)*p.side;
        const x=tmp.x+tmp.tz*candidate,z=tmp.z-tmp.tx*candidate;
        if(!solid(x,z)){p.lat=lateral-.15;tx=x;tz=z;break;}
      }
      if (!p.init) {p.x=tx;p.z=tz;p.init=true;clearSpawn(p);}
      const k = Math.min(1, dt * 3);
      const dx=tx-p.x,dz=tz-p.z,distance=Math.hypot(dx,dz);
      const step=Math.min(distance*k,pv*dt);
      const moved=movePerson(p,p.x+(distance?dx/distance*step:0),p.z+(distance?dz/distance*step:0));
      if(p.squeezeT!==undefined)p.squeezeT-=dt; // counts on below zero: a 3 s pause before the next squeeze
      if(!moved){p.e=oE;p.d=oD;p.dir=oDir;go=0;p.stuck=(p.stuck||0)+dt;
        if(p.stuck>1&&!(p.squeezeT>-3))p.squeezeT=1.5;
        if(p.stuck>1.2&&solid(tx,tz)||p.stuck>3){p.dir*=-1;p.stuck=0;} // a wall, or a car or crowd that won't clear
      }else p.stuck=0;
      p.actualSpeed=Math.min(p.v,Math.hypot(p.x-oldX,p.z-oldZ)/Math.max(dt,.001));
      if(p.actualSpeed>.08){
        const heading=Math.atan2(p.x-oldX,p.z-oldZ),delta=heading-p.yaw;
        p.yaw+=Math.atan2(Math.sin(delta),Math.cos(delta))*(1-Math.exp(-dt*10));
      }
      p.amp = ease(p.amp, go, kA);
      F.place(p.i, p.x, groundY(p.x, p.z) + PAVE, p.z, p.yaw, p.s, p.b);
      F.animate(p.i, p.actualSpeed, pan);
    }

    // Stall sellers: mostly still, now and then calling out with a raised hand
    for (let k = 0; k < vendors.length; k++) {
      const v = vendors[k];
      v.t -= dt;
      if (v.t < -2.5) v.t = 4 + r() * 14;
      F.animate(v.i, 0, v.t < 0 ? 0.7 : 0);
    }

    // Rank crowds and touts
    for (let k = 0; k < loiter.length; k++) {
      const p = loiter[k];
      const oldX=p.x,oldZ=p.z;
      p.t -= dt;
      if (p.moving) {
        const dx = p.tx - p.x, dz = p.tz - p.z, d = Math.hypot(dx, dz);
        if (d < 0.15) (p.moving = false), (p.t = 2 + r() * 8);
        else {
          const step = Math.min(d, p.v * (p.panic > 0 ? 2.6 : 0.75) * dt);
          if(!movePerson(p,p.x+(dx/d)*step,p.z+(dz/d)*step)){p.moving=false;p.t=1;}
          let dh = Math.atan2(dx, dz) - p.yaw;
          p.yaw += Math.atan2(Math.sin(dh), Math.cos(dh)) * Math.min(1, dt * 6);
        }
      } else if (p.t < 0) {
        const roam = p.kind === 'mill' ? 0.6 : p.kind === 'tout' ? 0.5 : 0.08;
        if (r() < roam) {
          const a = r() * 6.283, d = p.kind === 'queue' ? 0.6 : 1.5 + r() * 4;
          const tx = p.ax + Math.cos(a) * d, tz = p.az + Math.sin(a) * d;
          if (!solid(tx,tz) && p.rank.clear(tx, tz)) (p.tx = tx), (p.tz = tz), (p.moving = true);
          else p.t = 1;
        } else {
          p.t = 3 + r() * 9;
          p.yaw += (r() - 0.5) * 1.6;
        }
      }
      if (p.panic > 0) p.panic -= dt;
      const gestT = p.panic > 0 ? 1 : p.kind === 'tout' ? (Math.sin(time * 0.9 + p.ax) > 0.1 ? 1 : 0) : 0;
      p.actualSpeed=Math.hypot(p.x-oldX,p.z-oldZ)/Math.max(dt,.001);
      p.amp = ease(p.amp, p.moving ? 1 : 0, kA);
      p.g = ease(p.g, gestT, kA);
      F.place(p.i, p.x, groundY(p.x, p.z) + p.y, p.z, p.yaw, p.s, p.b);
      F.animate(p.i, p.actualSpeed, p.g);
    }

    // Hawkers: out between the queued cars while their approach is red, back to the kerb before it turns green
    for (let k = 0; k < hawkers.length; k++) {
      const h = hawkers[k], B = h.B, E = edges[B.e];
      const a = lights ? STREET.axisPhase(B.L, B.axis, st) : 0;
      const window = a > 21 && a < 35.5;
      const stopU = B.L.w / 2 + 6;
      if (window && !h.out) (h.out = true), (h.tlat = B.off), (h.tu = h.u), (h.t = 0);
      if (!window && h.out) (h.out = false), (h.tlat = B.kerb), (h.tu = h.home);
      const onLine = Math.abs(h.lat - h.tlat) < 0.05;
      let moving = false, gest = 0;
      if (!onLine) {
        // step out / back perpendicular to the traffic
        h.lat += Math.sign(h.tlat - h.lat) * Math.min(Math.abs(h.tlat - h.lat), h.v * dt);
        moving = true;
      } else if (Math.abs(h.u - h.tu) > 0.05) {
        h.u += Math.sign(h.tu - h.u) * Math.min(Math.abs(h.tu - h.u), h.v * 0.8 * dt);
        moving = true;
      } else if (h.out) {
        // pause beside a car window, goods held up, then move on along the queue
        h.t -= dt;
        gest = 1;
        if (h.t < 0) (h.t = 1.5 + r() * 3), (h.tu = stopU + r() * 22);
      } else gest = Math.sin(time * 0.7 + k) > 0.6 ? 0.6 : 0;
      const d = Math.max(0, Math.min(E.L, B.dir > 0 ? E.L - h.u : h.u));
      sample(B.e, d, tmp);
      const tx = tmp.tx * B.dir, tz = tmp.tz * B.dir; // travel direction into the junction
      const x = tmp.x + tz * h.lat, z = tmp.z - tx * h.lat; // left of travel
      let yaw;
      if (!onLine) yaw = Math.atan2(tz, -tx) + (h.tlat > h.lat ? 0 : Math.PI);
      else if (moving) yaw = Math.atan2(tx, tz) + (h.tu < h.u ? 0 : Math.PI);
      else yaw = h.out ? Math.atan2(tz, -tx) : Math.atan2(-tz, tx); // face the cars / face the road
      let dh = yaw - h.yaw;
      h.yaw += Math.atan2(Math.sin(dh), Math.cos(dh)) * Math.min(1, dt * 8);
      h.amp = ease(h.amp, moving ? 1 : 0, kA);
      h.g = ease(h.g, gest, kA);
      if(!Number.isFinite(h.x)){h.x=x;h.z=z;clearSpawn(h);}
      if(!movePerson(h,x,z)){h.out=false;h.tlat=B.kerb;h.tu=h.home;h.amp=0;}
      F.place(h.i, h.x, groundY(h.x, h.z) + (Math.abs(h.lat) < E.w / 2 ? 0.26 : PAVE), h.z, h.yaw, h.s, h.b);
      F.animate(h.i, h.v * h.amp, h.g);
    }

    if(!deferCommit)F.commit(time);
  }
  for(const p of loiter)clearSpawn(p);
  update(0);

  // Everyone on the pavement within r of (x, z) runs away from it for a few seconds, shoved back by the blast
  function scare(x, z, rad, shove = 0) {
    for (const p of walkers) {
      if (p.hidden || !p.init) continue;
      const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz);
      if (d > rad) continue;
      const k = 1 - d / rad;
      p.panic = Math.max(p.panic || 0, 2.5 + k * 3);
      sample(p.e, p.d, tmp);
      p.dir = tmp.tx * dx + tmp.tz * dz >= 0 ? 1 : -1;
      if (shove > 0 && d > 0.01) movePerson(p, p.x + (dx / d) * shove * k, p.z + (dz / d) * shove * k);
    }
    // The rank crowds scatter to a clear spot further from the blast; they drift back to their spot later
    for (const p of loiter) {
      const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz);
      if (d > rad || d < 0.01) continue;
      p.panic = 2 + (1 - d / rad) * 2.5;
      for (const run of [8, 5, 3]) {
        const a = Math.atan2(dx, dz) + (r() - 0.5) * 0.8, tx = p.x + Math.sin(a) * run, tz = p.z + Math.cos(a) * run;
        if (!solid(tx, tz)) { p.tx = tx; p.tz = tz; p.moving = true; p.t = 6 + r() * 6; break; }
      }
    }
  }
  return { scare, deferCommit(){deferCommit=true;}, get time(){return time;}, setContacts: value=>{contacts=value;}, update, walkers, loiter, hawkerList: hawkers, figures: F, stallSpots: stalls, count: walkers.length + loiter.length + hawkers.length, stalls: ns, crowd: loiter.length, hawkers: hawkers.length };
}

// Upturned plastic beer crate (0.4 m tall before scaling): slatted sides as dark bands
function crateGeometry() {
  const k = new MeshKit({ color: 3 });
  const W = [1, 1, 1], D = [0.55, 0.55, 0.55];
  k.box(0, 0.38, 0, 0.36, 0.04, 0.46, { color: W });
  for (const s of [1, -1]) {
    k.box(s * 0.175, 0.19, 0, 0.012, 0.36, 0.46, { color: W });
    k.box(0, 0.19, s * 0.225, 0.36, 0.36, 0.012, { color: W });
    for (const y of [0.1, 0.2, 0.29]) {
      k.box(s * 0.182, y, 0, 0.004, 0.04, 0.38, { color: D });
      k.box(0, y, s * 0.232, 0.3, 0.04, 0.004, { color: D });
    }
  }
  return k.build();
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
