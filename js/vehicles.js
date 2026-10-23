// js/vehicles.js — low-poly vehicle models: Honda Fit, sedan, Hilux, Toyota HiAce kombi, ZUPCO bus.
// Built from tapered boxes (raked windscreens, tumblehome cabins), cylinder wheels with hubs and dark wheel arches.
// Local frame: forward = +z, up = +y, origin at ground centre. Body parts are white so instance colour paints them.
import * as THREE from 'three';
import { makeGeometry } from './util.js';
import { MeshKit } from './meshkit.js';

const WHITE = [1, 1, 1], GLASS = [0.07, 0.09, 0.11], TYRE = [0.05, 0.05, 0.05], TRIM = [0.16, 0.16, 0.17], HUB = [0.55, 0.56, 0.58];
const BLUE = [0.13, 0.33, 0.62], RACK = [0.3, 0.29, 0.27], PLATE = [0.85, 0.82, 0.55];

const _m = new THREE.Matrix4();
const WHEEL = new THREE.CylinderGeometry(1, 1, 1, 10).rotateZ(Math.PI / 2);
const HUBG = new THREE.CylinderGeometry(1, 1, 1, 8).rotateZ(Math.PI / 2);

// Four wheels with hubs and an arch over each
function wheels(k, L, W, r, axle = 0.32, bodyY = r * 1.75) {
  for (const z of [L * axle, -L * axle]) {
    for (const s of [1, -1]) {
      const x = s * (W / 2 - 0.13);
      k.geo(WHEEL, { color: TYRE }, _m.makeScale(0.24, r, r).setPosition(x, r, z));
      k.geo(HUBG, { color: HUB }, _m.makeScale(0.03, r * 0.55, r * 0.55).setPosition(x + s * 0.12, r, z));
    }
    // arch: a dark band hugging the wheel top on both sides
    k.taper(0, bodyY - 0.1, z, W + 0.03, r * 2.3, W + 0.03, r * 1.5, 0.16, { color: TRIM });
  }
}

const C = (color) => ({ color });

export const VEHICLE_TYPES = {
  fit: {
    len: 4.0, maxV: 1.0, weight: 0.32,
    colors: ['#c8ccd0', '#e8e8e6', '#2b3a55', '#8a1c1c', '#3c3f42', '#d9d2c0', '#5e7d9a'],
    build(k) {
      const W = 1.68, L = 3.95;
      k.taper(0, 0.28, 0, W, L, W - 0.04, L - 0.2, 0.52, C(WHITE)); // body
      k.taper(0, 0.8, 0.95, W - 0.06, 1.0, W - 0.12, 0.7, 0.1, C(WHITE), { zt0: -0.15 }); // short bonnet
      k.taper(0, 0.8, -0.3, W - 0.08, 3.0, W - 0.26, 2.0, 0.66, C(GLASS), { zt1: -0.3, zt0: 0.18 }); // glasshouse
      k.taper(0, 1.46, -0.42, W - 0.26, 1.82, W - 0.3, 1.7, 0.06, C(WHITE)); // roof
      k.box(0, 1.1, -0.42, W - 0.12, 0.5, 0.12, C(WHITE)); // B-pillar
      k.box(0, 0.36, L / 2, W - 0.1, 0.2, 0.1, C(TRIM));
      k.box(0, 0.4, -L / 2, W - 0.1, 0.22, 0.08, C(TRIM));
      wheels(k, L, W, 0.3);
    },
    lights: [[0.6, 0.72, 1.96], [-0.6, 0.72, 1.96]], tail: [[0.68, 0.9, -1.96], [-0.68, 0.9, -1.96]],
  },
  sedan: {
    len: 4.6, maxV: 1.05, weight: 0.25,
    colors: ['#f0f0ee', '#b9bcc0', '#1e1f22', '#22406a', '#6b6f73', '#7a2a24'],
    build(k) {
      const W = 1.78, L = 4.55;
      k.taper(0, 0.3, 0, W, L, W - 0.04, L - 0.12, 0.5, C(WHITE));
      k.taper(0, 0.8, -0.2, W - 0.08, 2.6, W - 0.3, 1.45, 0.5, C(GLASS), { zt1: -0.05, zt0: 0.1 });
      k.taper(0, 1.28, -0.22, W - 0.3, 1.5, W - 0.34, 1.36, 0.05, C(WHITE));
      k.box(0, 1.05, -0.25, W - 0.14, 0.45, 0.12, C(WHITE));
      k.box(0, 0.4, L / 2, W - 0.1, 0.18, 0.1, C(TRIM));
      k.box(0, 0.4, -L / 2, W - 0.1, 0.18, 0.1, C(TRIM));
      k.box(0, 0.52, -L / 2 - 0.02, 0.5, 0.12, 0.02, C(PLATE));
      wheels(k, L, W, 0.32, 0.31);
    },
    lights: [[0.65, 0.68, 2.28], [-0.65, 0.68, 2.28]], tail: [[0.7, 0.72, -2.28], [-0.7, 0.72, -2.28]],
  },
  hilux: {
    len: 5.3, maxV: 1.0, weight: 0.14,
    colors: ['#f2f2f0', '#a7aaae', '#3a3c3e', '#b33a2a', '#d4c7a8'],
    build(k) {
      const W = 1.85, L = 5.25;
      k.taper(0, 0.45, 0, W, L, W - 0.04, L - 0.1, 0.65, C(WHITE)); // chassis/body to the belt line
      k.taper(0, 1.1, 0.6, W - 0.1, 2.3, W - 0.3, 1.55, 0.72, C(GLASS), { zt1: -0.25 }); // cab
      k.taper(0, 1.8, 0.48, W - 0.3, 1.6, W - 0.34, 1.45, 0.06, C(WHITE));
      k.box(0, 1.45, 0.42, W - 0.16, 0.7, 0.14, C(WHITE));
      // open load bed: floor, sides, tailgate
      k.box(0, 1.12, -1.55, W - 0.16, 0.04, 2.1, C(TRIM));
      for (const s of [1, -1]) k.box(s * (W / 2 - 0.04), 1.33, -1.55, 0.07, 0.42, 2.15, C(WHITE));
      k.box(0, 1.33, -2.6, W, 0.42, 0.07, C(WHITE));
      k.box(0, 0.5, L / 2, W - 0.06, 0.24, 0.12, C(TRIM));
      wheels(k, L, W, 0.4, 0.31, 0.82);
    },
    lights: [[0.65, 0.98, 2.63], [-0.65, 0.98, 2.63]], tail: [[0.84, 1.2, -2.63], [-0.84, 1.2, -2.63]],
  },
  kombi: {
    len: 4.9, maxV: 1.15, weight: 0.24, kombi: true,
    colors: ['#f4f4f2', '#eeeeec', '#e9eae8', '#f1efe8'],
    build(k) {
      const W = 1.82, L = 4.85;
      k.taper(0, 0.34, -0.12, W, 4.6, W - 0.1, 4.5, 1.62, C(WHITE), { zt0: 0.02 }); // box body, slight tumblehome
      k.taper(0, 0.34, 2.24, W - 0.02, 0.4, W - 0.06, 0.22, 0.82, C(WHITE), { zt1: -0.09 }); // stubby nose
      k.taper(0, 1.15, 2.08, W - 0.08, 0.32, W - 0.16, 0.08, 0.74, C(GLASS), { zt1: -0.18 }); // raked windscreen
      k.box(0, 1.55, -0.3, W + 0.02, 0.48, 3.8, C(GLASS)); // side windows
      k.box(0, 0.74, 0.05, W + 0.02, 0.1, 4.7, C(BLUE)); // blue stripe
      k.box(W / 2 + 0.005, 0.95, 0.15, 0.01, 1.05, 0.03, C(TRIM)); // sliding-door seam (left side)
      k.box(0, 2.04, -0.35, 1.5, 0.1, 3.0, C(RACK)); // roof rack
      for (const z of [-1.7, -0.35, 1.0]) k.box(0, 2.0, z, 1.56, 0.06, 0.06, C(RACK));
      k.box(0, 0.42, L / 2 + 0.02, W - 0.06, 0.18, 0.1, C(TRIM));
      k.box(0, 0.45, -L / 2 + 0.02, W - 0.06, 0.2, 0.1, C(TRIM));
      wheels(k, 4.4, W, 0.33, 0.33);
    },
    lights: [[0.66, 0.82, 2.45], [-0.66, 0.82, 2.45]], tail: [[0.82, 0.95, -2.42], [-0.82, 0.95, -2.42]],
  },
  zupco: {
    len: 11.5, maxV: 0.85, weight: 0.05,
    colors: ['#f6f6f4'],
    build(k) {
      const W = 2.5, L = 11.5;
      k.taper(0, 0.4, 0, W, L, W - 0.12, L - 0.1, 2.95, C(WHITE));
      k.box(0, 2.3, -0.1, W + 0.02, 1.1, 10.2, C(GLASS));
      k.taper(0, 1.2, 5.7, W - 0.1, 0.12, W - 0.16, 0.06, 1.85, C(GLASS), { zt1: -0.08 });
      k.box(0, 0.95, 0, W + 0.02, 0.55, L + 0.02, C(BLUE));
      k.box(0, 3.4, -1, 1.6, 0.18, 2.4, C([0.82, 0.83, 0.84])); // roof aircon pod
      wheels(k, 9.0, W, 0.5, 0.36, 0.95);
    },
    lights: [[0.9, 1.0, 5.77], [-0.9, 1.0, 5.77]], tail: [[1.0, 1.2, -5.77], [-1.0, 1.2, -5.77]],
  },
};

export function vehicleGeometry(type) {
  const k = new MeshKit({ color: 3 });
  VEHICLE_TYPES[type].build(k);
  return k.build();
}

function boxes(list) {
  const pos = [], nrm = [], col = [];
  for (const [cx, cy, cz, w, h, d, color] of list) {
    const g = new THREE.BoxGeometry(w, h, d).translate(cx, cy, cz).toNonIndexed();
    pos.push(...g.attributes.position.array);
    nrm.push(...g.attributes.normal.array);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(...color);
  }
  return makeGeometry(THREE, { position: [pos, 3], normal: [nrm, 3], color: [col, 3] });
}

// Head and tail lamps as one geometry: white quads up front, red at the back (vertex colours)
export function lampGeometry(type) {
  const t = VEHICLE_TYPES[type];
  const list = [];
  for (const [x, y, z] of t.lights) list.push([x, y, z + 0.02, 0.28, 0.16, 0.04, [1, 0.95, 0.8]]);
  for (const [x, y, z] of t.tail) list.push([x, y, z - 0.02, 0.26, 0.14, 0.04, [1, 0.08, 0.04]]);
  return boxes(list);
}
