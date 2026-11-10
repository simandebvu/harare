// js/features/monuments.js — landmarks newer than the OpenStreetMap data or too small to come from it.
// Mbuya Nehanda (unveiled 25 May 2021, sculptor David Mutasa): a 3 m bronze on a 1.5 m pedestal at the corner of
// Samora Machel Avenue and Julius Nyerere Way. Modelled on the unveiling photographs: close-cropped hair, a full-length
// cloak over both shoulders with pleats fanning from a clasp at the collarbone, both hands holding a small gourd at the
// waist, on a plinth atop a raised platform with ramps and arched steel-and-glass railings. Sources don't give the corner,
// so she stands on whichever one is open pavement.
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { groundY } from '../util.js';

let THREE;

function junction(DATA, a, b) {
  let best = null;
  for (const ra of DATA.roads) if (ra.n === a)
    for (const rb of DATA.roads) if (rb.n === b)
      for (let i = 0; i < ra.p.length; i += 2) for (let j = 0; j < rb.p.length; j += 2) {
        const d = Math.hypot(ra.p[i] - rb.p[j], ra.p[i + 1] - rb.p[j + 1]);
        if (!best || d < best.d) best = { d, x: (ra.p[i] + rb.p[j]) / 2, z: (ra.p[i + 1] + rb.p[j + 1]) / 2, w: Math.max(ra.w, rb.w) };
      }
  return best && best.d < 3 ? best : null;
}

// Distance from (x, z) to the nearest road centreline, minus its half width (negative = on the carriageway)
function kerbGap(roads, x, z) {
  let g = Infinity;
  for (const r of roads) for (let i = 2; i < r.p.length; i += 2) {
    const ax = r.p[i - 2], az = r.p[i - 1], dx = r.p[i] - ax, dz = r.p[i + 1] - az, L = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L));
    g = Math.min(g, Math.hypot(x - ax - dx * t, z - az - dz * t) - r.w / 2);
  }
  return g;
}

// Local layout: the statue faces +z; ramps run front and back along z; arched railings line both sides (x = ±RAIL_X)
const DECK = 2.2, DECK_H = 0.8, RAMP = 2.8, RAMP_W = 1.25, RAIL_X = 1.3;
const surfaceY = (z) => (Math.abs(z) < DECK ? DECK_H : Math.max(0, DECK_H * (1 - (Math.abs(z) - DECK) / RAMP)));

function nehanda({ bronze, stone, paving, steel, glass }) {
  const g = new THREE.Group();
  g.name = 'mbuya-nehanda-statue';
  const add = (geo, mat, x, y, z, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow; m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
  const rod = (a, b, r, mat, seg = 6) => {
    dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const L = dir.length();
    const m = add(new THREE.CylinderGeometry(r, r, L, seg), mat, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    m.quaternion.setFromUnitVectors(up, dir.normalize());
    return m;
  };

  // --- the raised platform, ramps and plinth ---
  add(new THREE.BoxGeometry(DECK * 2, DECK_H, DECK * 2), paving, 0, DECK_H / 2, 0);
  const wedge = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(RAMP, 0), new THREE.Vector2(0, DECK_H)]);
  const rampGeo = new THREE.ExtrudeGeometry(wedge, { depth: RAMP_W * 2, bevelEnabled: false });
  rampGeo.rotateY(-Math.PI / 2); rampGeo.translate(RAMP_W, 0, DECK); // profile along +z from the deck edge, width along x
  add(rampGeo, paving, 0, 0, 0);
  add(rampGeo, paving, 0, 0, 0).rotation.y = Math.PI;
  add(new THREE.BoxGeometry(1.3, 1.3, 1.3), stone, 0, DECK_H + 0.65, 0);
  add(new THREE.BoxGeometry(1.5, 0.12, 1.5), stone, 0, DECK_H + 1.36, 0);
  const P = DECK_H + 1.42; // where her feet stand

  // --- arched railings: steel posts and top rail over glass, rising from each ramp foot to a crest over the deck ---
  const Z0 = DECK + RAMP;
  const topY = (z) => surfaceY(z) + 1.0 + 1.7 * Math.sin((Math.PI * (z + Z0)) / (2 * Z0));
  for (const sx of [-1, 1]) {
    const x = sx * RAIL_X, pts = [], pos = [];
    const N = 40;
    for (let i = 0; i <= N; i++) {
      const z = -Z0 + (2 * Z0 * i) / N;
      pts.push(new THREE.Vector3(x, topY(z), z));
      pos.push(x, surfaceY(z) + 0.08, z, x, topY(z) - 0.06, z);
    }
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.045, 6), steel, 0, 0, 0);
    for (let z = -Z0 + 0.3; z <= Z0 - 0.3; z += 0.55) rod([x, surfaceY(z), z], [x, topY(z), z], 0.028, steel);
    const idx = [];
    for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const glassGeo = new THREE.BufferGeometry();
    glassGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    glassGeo.setIndex(idx); glassGeo.computeVertexNormals();
    add(glassGeo, glass, 0, 0, 0, false);
  }

  // --- the figure, 3 m: a full-length cloak over both shoulders, its pleats fanning from a clasp at the collarbone ---
  const DEPTH = 0.72; // the cloak is flatter front to back than side to side
  const cloak = [[0, 0], [0.44, 0], [0.42, 0.12], [0.38, 0.6], [0.35, 1.2], [0.35, 1.7], [0.38, 2.05], [0.39, 2.2], [0.34, 2.34], [0.2, 2.43], [0.09, 2.46], [0, 2.46]];
  const cloakR = (y) => {
    for (let i = 1; i < cloak.length; i++) if (y <= cloak[i][1]) {
      const [r0, y0] = cloak[i - 1], [r1, y1] = cloak[i];
      return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0 || 1);
    }
    return 0;
  };
  const on = (theta, y, out = 0.02) => { const r = cloakR(y) + out; return [Math.sin(theta) * r, P + y, Math.cos(theta) * r * DEPTH]; };
  const body = add(new THREE.LatheGeometry(cloak.map(([r, y]) => new THREE.Vector2(r, y)), 32, Math.PI), bronze, 0, P, 0);
  body.scale.z = DEPTH;
  const clasp = on(0, 2.24, 0.03);
  add(new THREE.SphereGeometry(0.045, 10, 8), bronze, ...clasp);
  for (const s of [-1, 1]) {
    for (let i = 1; i <= 6; i++) { // pleats: low ones run down the front, high ones over the shoulder
      const th = s * (0.25 + 0.17 * i), y = 2.18 - 0.75 * (1 - i / 6);
      const mid = on(th * 0.5, (2.22 + y) / 2, 0.008), end = on(th, y, -0.004);
      rod(clasp, mid, 0.014, bronze, 5); rod(mid, end, 0.012, bronze, 5);
    }
    // the cloak's front edges, parting slightly towards the hem
    let prev = clasp;
    for (const [th, y] of [[0.1, 1.7], [0.16, 0.9], [0.22, 0.06]]) { const p = on(s * th, y, 0.004); rod(prev, p, 0.016, bronze, 5); prev = p; }
    // the arms stay under the cloak: a fold where each forearm crosses to the front, hands together at the waist
    rod(on(s * 0.8, 1.6, -0.035), on(s * 0.22, 1.43, -0.01), 0.045, bronze, 8);
    add(new THREE.SphereGeometry(0.05, 10, 8), bronze, s * 0.05, P + 1.39, 0.285).scale.set(1, 0.8, 1);
    // bare toes at the hem
    add(new THREE.SphereGeometry(0.07, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), bronze, s * 0.11, P, 0.35).scale.set(1, 0.6, 1.5);
  }
  // the small gourd she holds
  add(new THREE.SphereGeometry(0.07, 12, 10), bronze, 0, P + 1.31, 0.34);
  add(new THREE.CylinderGeometry(0.02, 0.028, 0.08, 8), bronze, 0, P + 1.39, 0.35);
  // neck, necklace, head with close-cropped hair
  add(new THREE.CylinderGeometry(0.068, 0.08, 0.2, 12), bronze, 0, P + 2.52, 0.01);
  add(new THREE.TorusGeometry(0.085, 0.012, 6, 20), bronze, 0, P + 2.47, 0.02).rotation.x = Math.PI / 2 - 0.35;
  const head = add(new THREE.SphereGeometry(0.15, 20, 16), bronze, 0, P + 2.74, 0.02);
  head.scale.set(0.86, 1.1, 0.96);
  add(new THREE.SphereGeometry(0.152, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), bronze, 0, P + 2.77, 0.0).scale.set(0.88, 1.08, 0.98);
  return g;
}

export default {
  init(ctx) {
    THREE = ctx.THREE;
    const { DATA, scene, buildings } = ctx;
    const j = junction(DATA, 'Samora Machel Avenue', 'Julius Nyerere Way');
    if (!j) return;
    // the most open corner: platform and ramps clear of buildings and the carriageway, fewest trees, near the junction
    const fits = (x, z, yaw) => {
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      for (let lx = -DECK; lx <= DECK + 0.01; lx += DECK / 2) for (let lz = -(DECK + RAMP); lz <= DECK + RAMP + 0.01; lz += (DECK + RAMP) / 4) {
        const wx = x + lx * c + lz * sn, wz = z - lx * sn + lz * c;
        if (buildings.blocked(wx, wz) || buildings.blocked.circle?.(wx, wz, 0.6) || kerbGap(near, wx, wz) < 0.3) return false;
        // nor on a vendor's stall, a robot pole, a bin or a bench
        for (const st of stalls) if ((st.x - wx) ** 2 + (st.z - wz) ** 2 < 2.4 * 2.4) return false;
        if (ctx.contacts?.personBlocked(wx, wz, 0.75, null, 0, true, false)) return false;
      }
      return true;
    };
    // search a grid round the junction in eight orientations; prefer near, facing the junction, away from trees
    const t0 = performance.now();
    // only the roads near the junction can touch the plaza
    const stalls = (ctx.people?.stallSpots || []).filter((st) => Math.hypot(st.x - j.x, st.z - j.z) < 60);
    const near = DATA.roads.filter((r) => { for (let i = 0; i < r.p.length; i += 2) if (Math.hypot(r.p[i] - j.x, r.p[i + 1] - j.z) < 150) return true; return false; });
    let spot = null;
    for (let gx = -36; gx <= 36; gx += 2) for (let gz = -36; gz <= 36; gz += 2) {
      const x = j.x + gx, z = j.z + gz, d = Math.hypot(gx, gz);
      if (d < 8 || d > 36) continue;
      const face = Math.atan2(j.x - x, j.z - z);
      for (let k = 0; k < 8; k++) {
        const yaw = (k * Math.PI) / 4;
        if (!fits(x, z, yaw)) continue;
        const off = Math.abs(Math.atan2(Math.sin(yaw - face), Math.cos(yaw - face)));
        const score = (ctx.trees?.near?.(x, z, 9) || 0) * 3 + d * 0.15 + off * 1.5;
        if (!spot || score < spot.score) spot = { x, z, yaw, score };
      }
    }
    if (!spot) { console.warn('[harare] monuments: no room for Mbuya Nehanda'); return; }
    // a small plaza: the street trees standing where the statue now is make way
    const cleared = ctx.trees?.clearAround?.(spot.x, spot.z, 8) || 0;
    const statue = nehanda({
      bronze: new THREE.MeshStandardMaterial({ color: '#6b4a30', metalness: 0.6, roughness: 0.45 }),
      stone: new THREE.MeshStandardMaterial({ color: '#7d7872', roughness: 0.9 }),
      paving: new THREE.MeshStandardMaterial({ color: '#b8b1a5', roughness: 0.95 }),
      steel: new THREE.MeshStandardMaterial({ color: '#d4d8dc', metalness: 0.9, roughness: 0.22 }),
      glass: new THREE.MeshStandardMaterial({ color: '#a8cbd6', metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
    });
    const gy = groundY(spot.x, spot.z) + 0.02;
    statue.position.set(spot.x, gy, spot.z);
    statue.rotation.y = spot.yaw;
    scene.add(statue);
    // the platform is a low roof you can stand on; the ramps and the plinth are solid
    const c = Math.cos(spot.yaw), sn = Math.sin(spot.yaw);
    buildings.addRoofDeck?.(spot.x, spot.z, DECK / (Math.abs(c) + Math.abs(sn)), gy + DECK_H);
    ctx.contacts?.addStaticBox(spot.x, spot.z, spot.yaw, 0.75, 0.75, DECK_H + 4.5);
    for (const s of [-1, 1]) ctx.contacts?.addStaticBox(spot.x + s * (DECK + RAMP / 2) * sn, spot.z + s * (DECK + RAMP / 2) * c, spot.yaw, RAMP_W, RAMP / 2, 0.45);
    // a landmark label alongside the buildings' (shown in flight like the others)
    const el = document.createElement('div');
    el.className = 'label';
    el.textContent = 'Mbuya Nehanda';
    const label = new CSS2DObject(el);
    label.position.set(spot.x, statue.position.y + 7, spot.z);
    ctx.labels?.add(label);
    this.spot = spot;
    window.__harare?.nav?.addSpot({ n: 'Mbuya Nehanda statue', d: 'CBD', icon: 'civic', x: spot.x, z: spot.z }, 'nehanda monument heroine');
    console.log(`[harare] monuments: Mbuya Nehanda at ${spot.x.toFixed(0)}, ${spot.z.toFixed(0)} (${cleared} trees cleared, placed in ${(performance.now() - t0).toFixed(0)} ms)`);
  },
};
