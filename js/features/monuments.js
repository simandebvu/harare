// js/features/monuments.js — landmarks newer than the OpenStreetMap data or too small to come from it.
// Mbuya Nehanda (unveiled 25 May 2021, sculptor David Mutasa): a 3 m bronze on a 1.5 m pedestal at the corner of
// Samora Machel Avenue and Julius Nyerere Way. Sources give the size and the site but not the corner or the pose, so
// she stands upright in a draped wrap and headwrap on a round stone pedestal, on whichever corner is open pavement.
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
function kerbGap(DATA, x, z) {
  let g = Infinity;
  for (const r of DATA.roads) for (let i = 2; i < r.p.length; i += 2) {
    const ax = r.p[i - 2], az = r.p[i - 1], dx = r.p[i] - ax, dz = r.p[i + 1] - az, L = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L));
    g = Math.min(g, Math.hypot(x - ax - dx * t, z - az - dz * t) - r.w / 2);
  }
  return g;
}

function nehanda(bronze, stone) {
  const g = new THREE.Group();
  g.name = 'mbuya-nehanda-statue';
  const add = (geo, mat, x, y, z, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, 0, rz);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  // step and round pedestal, 1.5 m to the top
  add(new THREE.CylinderGeometry(1.45, 1.55, 0.3, 28), stone, 0, 0.15, 0);
  add(new THREE.CylinderGeometry(0.95, 1.05, 1.2, 24), stone, 0, 0.9, 0);
  const P = 1.5;
  // the figure, 3 m: a wrap from ankle to shoulder (lathe), arms, neck, head and headwrap
  const robe = [[0, 0], [0.42, 0], [0.4, 0.25], [0.37, 0.8], [0.34, 1.35], [0.3, 1.75], [0.25, 2.0], [0.28, 2.25], [0.31, 2.45], [0.27, 2.55], [0.1, 2.6], [0, 2.6]];
  add(new THREE.LatheGeometry(robe.map(([r, y]) => new THREE.Vector2(r, y)), 28), bronze, 0, P, 0);
  // the cloth gathered over the left shoulder and falling diagonally across the chest
  add(new THREE.TorusGeometry(0.29, 0.045, 8, 24, Math.PI * 1.1), bronze, 0.02, P + 2.2, 0.02, 0.35, 0.9);
  for (const s of [-1, 1]) {
    const arm = add(new THREE.CapsuleGeometry(0.075, 0.82, 4, 10), bronze, s * 0.33, P + 2.03, 0.06);
    arm.rotation.set(-0.18, 0, s * 0.1);
    add(new THREE.SphereGeometry(0.08, 10, 8), bronze, s * 0.37, P + 1.55, 0.14);
  }
  add(new THREE.CylinderGeometry(0.07, 0.085, 0.16, 12), bronze, 0, P + 2.64, 0);
  const head = add(new THREE.SphereGeometry(0.15, 18, 14), bronze, 0, P + 2.82, 0.02);
  head.scale.set(0.9, 1.08, 0.95);
  add(new THREE.SphereGeometry(0.155, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), bronze, 0, P + 2.88, -0.01).scale.set(1, 1.1, 1.05); // headwrap
  // bare feet showing under the hem
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.075, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), bronze, s * 0.13, P, 0.36).scale.set(1, 0.6, 1.6);
  return g;
}

export default {
  init(ctx) {
    THREE = ctx.THREE;
    const { DATA, scene, buildings } = ctx;
    const j = junction(DATA, 'Samora Machel Avenue', 'Julius Nyerere Way');
    if (!j) return;
    // the most open corner: clear of buildings and the carriageway, fewest street trees, near the junction
    let spot = null;
    for (const d of [10, 12, 14, 16, 18]) for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = j.x + sx * d * 0.7071, z = j.z + sz * d * 0.7071;
      if (buildings.blocked(x, z) || buildings.blocked.circle?.(x, z, 1.8) || kerbGap(DATA, x, z) < 2.2) continue;
      const score = (ctx.trees?.near?.(x, z, 7) || 0) * 3 + d * 0.15;
      if (!spot || score < spot.score) spot = { x, z, score };
    }
    if (!spot) return;
    // a small plaza: the street trees standing where the statue now is make way
    const cleared = ctx.trees?.clearAround?.(spot.x, spot.z, 6) || 0;
    const bronze = new THREE.MeshStandardMaterial({ color: '#5a3d24', metalness: 0.7, roughness: 0.42 });
    const stone = new THREE.MeshStandardMaterial({ color: '#8e8880', roughness: 0.95 });
    const statue = nehanda(bronze, stone);
    statue.position.set(spot.x, groundY(spot.x, spot.z) + 0.16, spot.z);
    statue.rotation.y = Math.atan2(j.x - spot.x, j.z - spot.z); // facing the junction
    scene.add(statue);
    ctx.contacts?.addStaticBox(spot.x, spot.z, 0, 1.5, 1.5, 4.6);
    // a landmark label alongside the buildings' (shown in flight like the others)
    const el = document.createElement('div');
    el.className = 'label';
    el.textContent = 'Mbuya Nehanda';
    const label = new CSS2DObject(el);
    label.position.set(spot.x, statue.position.y + 6, spot.z);
    ctx.labels?.add(label);
    this.spot = spot;
    console.log(`[harare] monuments: Mbuya Nehanda at ${spot.x.toFixed(0)}, ${spot.z.toFixed(0)} (${cleared} trees cleared)`);
  },
};
