// js/vehicles.js — low-poly vehicle models built from boxes: Honda Fit, sedan, Hilux, Toyota HiAce kombi, ZUPCO bus.
// Local frame: forward = +z, up = +y, origin at ground centre. Body parts are white so instance colour paints them.
import * as THREE from 'three';
import { makeGeometry } from './util.js';

const WHITE = [1, 1, 1], GLASS = [0.09, 0.11, 0.13], TYRE = [0.06, 0.06, 0.06], TRIM = [0.25, 0.25, 0.26];

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

function wheels(L, W, r = 0.33) {
  const out = [];
  for (const z of [L * 0.32, -L * 0.32]) for (const x of [W / 2 - 0.12, -W / 2 + 0.12]) out.push([x, r, z, 0.24, r * 2, r * 2, TYRE]);
  return out;
}

export const VEHICLE_TYPES = {
  fit: {
    len: 4.0, maxV: 1.0, weight: 0.32,
    colors: ['#c8ccd0', '#e8e8e6', '#2b3a55', '#8a1c1c', '#3c3f42', '#d9d2c0', '#5e7d9a'],
    parts: () => [
      [0, 0.62, 0, 1.68, 0.6, 3.95, WHITE], [0, 1.2, -0.25, 1.58, 0.62, 2.7, GLASS], [0, 1.53, -0.3, 1.5, 0.06, 2.4, WHITE],
      [0, 0.4, 2.0, 1.6, 0.25, 0.08, TRIM], ...wheels(3.9, 1.68, 0.3),
    ],
    lights: [[0.6, 0.75, 1.98], [-0.6, 0.75, 1.98]], tail: [[0.65, 0.85, -1.98], [-0.65, 0.85, -1.98]],
  },
  sedan: {
    len: 4.6, maxV: 1.05, weight: 0.25,
    colors: ['#f0f0ee', '#b9bcc0', '#1e1f22', '#22406a', '#6b6f73', '#7a2a24'],
    parts: () => [
      [0, 0.6, 0, 1.78, 0.56, 4.55, WHITE], [0, 1.12, -0.15, 1.64, 0.52, 2.3, GLASS], [0, 1.4, -0.15, 1.56, 0.06, 1.9, WHITE],
      ...wheels(4.4, 1.78, 0.32),
    ],
    lights: [[0.65, 0.7, 2.28], [-0.65, 0.7, 2.28]], tail: [[0.7, 0.75, -2.28], [-0.7, 0.75, -2.28]],
  },
  hilux: {
    len: 5.3, maxV: 1.0, weight: 0.14,
    colors: ['#f2f2f0', '#a7aaae', '#3a3c3e', '#b33a2a', '#d4c7a8'],
    parts: () => [
      [0, 0.85, 0, 1.85, 0.7, 5.25, WHITE], [0, 1.55, 0.7, 1.75, 0.7, 2.0, GLASS], [0, 1.93, 0.7, 1.7, 0.08, 1.8, WHITE],
      [0, 1.4, -1.55, 1.85, 0.4, 2.1, WHITE], [0, 1.2, -1.55, 1.6, 0.05, 1.9, TRIM], ...wheels(5.0, 1.85, 0.4),
    ],
    lights: [[0.65, 1.0, 2.63], [-0.65, 1.0, 2.63]], tail: [[0.8, 1.1, -2.63], [-0.8, 1.1, -2.63]],
  },
  kombi: {
    len: 4.9, maxV: 1.15, weight: 0.24, kombi: true,
    colors: ['#f4f4f2', '#eeeeec', '#e9eae8', '#f1efe8'],
    parts: () => [
      [0, 1.1, 0, 1.82, 1.6, 4.85, WHITE], [0, 1.52, 0.2, 1.84, 0.55, 4.0, GLASS], [0, 1.5, 2.38, 1.6, 0.6, 0.08, GLASS],
      [0, 0.72, 0, 1.84, 0.12, 4.86, [0.13, 0.33, 0.62]], // blue stripe
      [0, 1.95, -0.3, 1.5, 0.12, 3.2, [0.35, 0.33, 0.3]], // roof rack
      ...wheels(4.4, 1.82, 0.33),
    ],
    lights: [[0.65, 0.8, 2.43], [-0.65, 0.8, 2.43]], tail: [[0.8, 0.9, -2.43], [-0.8, 0.9, -2.43]],
  },
  zupco: {
    len: 11.5, maxV: 0.85, weight: 0.05,
    colors: ['#f6f6f4'],
    parts: () => [
      [0, 1.9, 0, 2.5, 2.9, 11.5, WHITE], [0, 2.35, 0.2, 2.52, 1.1, 10.4, GLASS], [0, 0.85, 0, 2.52, 0.6, 11.52, [0.12, 0.25, 0.6]],
      [0, 2.3, 5.76, 2.2, 1.4, 0.06, GLASS], ...wheels(9.0, 2.5, 0.5),
    ],
    lights: [[0.9, 1.0, 5.77], [-0.9, 1.0, 5.77]], tail: [[1.0, 1.2, -5.77], [-1.0, 1.2, -5.77]],
  },
};

export function vehicleGeometry(type) {
  return boxes(VEHICLE_TYPES[type].parts());
}

// Head and tail lamps as one geometry: white quads up front, red at the back (vertex colours)
export function lampGeometry(type) {
  const t = VEHICLE_TYPES[type];
  const list = [];
  for (const [x, y, z] of t.lights) list.push([x, y, z + 0.02, 0.28, 0.16, 0.04, [1, 0.95, 0.8]]);
  for (const [x, y, z] of t.tail) list.push([x, y, z - 0.02, 0.26, 0.14, 0.04, [1, 0.08, 0.04]]);
  return boxes(list);
}
