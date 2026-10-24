// js/building-textures.js — procedural wall & roof materials for the building shader, packed in one texture array.
// Each layer is 512² RGBA: RGB = albedo detail (sRGB), A = height (for a cheap bump in the shader). The shader tints
// a layer by the vertex colour relative to the layer's mean, so one brick layer serves red, brown and buff brick.
import * as THREE from 'three';
import { rng } from './util.js';
import { canvas, noise, speckle } from './textures.js';

const S = 512;
// Layer order is the shader's material code - 1 (see MAT in buildings.js)
export const LAYERS = ['render', 'brick', 'precast', 'granite', 'mosaic', 'tin', 'roof', 'concrete', 'streaks'];
// Metres covered by one tile of each layer (x, y)
export const LAYER_SCALE = [
  [4, 4], [1.856, 1.826], [3, 3], [2.4, 2.4], [1, 1], [1.52, 1.52], [14, 14], [3, 3], [6, 9],
];

// Each painter draws albedo into `g` and height into `h` (both 512² canvases)
function render(g, h, r) {
  g.fillStyle = '#b4b4b4';
  g.fillRect(0, 0, S, S);
  noise(g, S, r, [[14, 140], [60, 50], [220, 14]], 0.07, 255, 40);
  // patched, repainted squares of slightly different tone
  for (let i = 0; i < 6; i++) {
    const v = 160 + Math.floor(r() * 60);
    g.fillStyle = `rgba(${v},${v},${v - 4},0.22)`;
    g.fillRect(r() * S, r() * S, 30 + r() * 120, 20 + r() * 90);
  }
  // hairline cracks
  g.strokeStyle = 'rgba(60,58,55,0.28)';
  g.lineWidth = 0.8;
  for (let i = 0; i < 9; i++) {
    let x = r() * S, y = r() * S;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) g.lineTo((x += (r() - 0.5) * 30), (y += r() * 22));
    g.stroke();
  }
  speckle(g, S, r, 30000, 230, 120);
  // roughcast: dense fine bumps
  h.fillStyle = '#808080';
  h.fillRect(0, 0, S, S);
  noise(h, S, r, [[400, 6], [1400, 2.5]], 0.35, 255, 0);
}

function brick(g, h, r) {
  const cols = 8, rows = 22, bw = S / cols, bh = S / rows, m = 3;
  g.fillStyle = '#b8ad9b'; // mortar
  g.fillRect(0, 0, S, S);
  h.fillStyle = '#303030';
  h.fillRect(0, 0, S, S);
  const tones = [[150, 78, 52], [138, 70, 48], [162, 92, 62], [120, 62, 44], [170, 104, 72], [104, 56, 44], [146, 84, 60]];
  for (let j = 0; j < rows; j++) {
    const off = j % 2 ? bw / 2 : 0;
    for (let i = -1; i < cols + 1; i++) {
      const x = i * bw + off, y = j * bh;
      let [cr, cg, cb] = tones[Math.floor(r() * tones.length)];
      const k = 0.85 + r() * 0.3;
      if (r() < 0.08) (cr *= 0.6), (cg *= 0.55), (cb *= 0.6); // over-burnt clinker
      g.fillStyle = `rgb(${(cr * k) | 0},${(cg * k) | 0},${(cb * k) | 0})`;
      g.fillRect(x + m / 2, y + m / 2, bw - m, bh - m);
      // face texture: darker flashed end
      const grd = g.createLinearGradient(x, y, x + bw, y);
      const a = r() * 0.25;
      grd.addColorStop(0, `rgba(40,20,15,${a})`);
      grd.addColorStop(0.5, 'rgba(40,20,15,0)');
      grd.addColorStop(1, `rgba(40,20,15,${r() * 0.2})`);
      g.fillStyle = grd;
      g.fillRect(x + m / 2, y + m / 2, bw - m, bh - m);
      const hv = 200 + ((r() * 30) | 0);
      h.fillStyle = `rgb(${hv},${hv},${hv})`;
      h.fillRect(x + m / 2, y + m / 2, bw - m, bh - m);
    }
  }
  noise(g, S, r, [[40, 60]], 0.06, 255, 0);
  speckle(g, S, r, 26000, 210, 40);
  noise(h, S, r, [[900, 2]], 0.3, 255, 0);
}

function precast(g, h, r) {
  g.fillStyle = '#a9a7a2';
  g.fillRect(0, 0, S, S);
  noise(g, S, r, [[10, 160], [50, 50]], 0.09, 255, 30);
  // faint lift lines and form-tie holes on a 0.6 m grid
  g.fillStyle = 'rgba(70,70,70,0.12)';
  for (let y = 0; y < S; y += S / 5) g.fillRect(0, y, S, 2);
  for (let x = S / 10; x < S; x += S / 5)
    for (let y = S / 10; y < S; y += S / 5) {
      g.fillStyle = 'rgba(40,40,40,0.55)';
      g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill();
      h.fillStyle = '#202020';
      h.beginPath(); h.arc(x, y, 4, 0, Math.PI * 2); h.fill();
    }
  speckle(g, S, r, 60000, 235, 70); // exposed aggregate
  h.globalCompositeOperation = 'destination-over';
  h.fillStyle = '#909090';
  h.fillRect(0, 0, S, S);
  h.globalCompositeOperation = 'source-over';
  noise(h, S, r, [[2000, 2]], 0.4, 255, 0);
}

function granite(g, h, r) {
  const sw = S / 2, sh = S / 4;
  h.fillStyle = '#202020';
  h.fillRect(0, 0, S, S);
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 2; i++) {
      const v = 150 + Math.floor(r() * 30);
      g.fillStyle = `rgb(${v + 6},${v},${v - 4})`;
      g.fillRect(i * sw, j * sh, sw, sh);
      h.fillStyle = '#c0c0c0';
      h.fillRect(i * sw + 2, j * sh + 2, sw - 4, sh - 4);
    }
  // crystals: black mica, white feldspar, pink orthoclase
  const img = g.getImageData(0, 0, S, S), d = img.data;
  for (let i = 0; i < 70000; i++) {
    const p = (Math.floor(r() * S) + Math.floor(r() * S) * S) * 4, t = r();
    const c = t < 0.4 ? [40, 38, 40] : t < 0.75 ? [225, 222, 215] : [196, 150, 140];
    for (let k = 0; k < 3; k++) d[p + k] = d[p + k] * 0.3 + c[k] * 0.7;
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = 'rgba(30,30,30,0.9)';
  for (let j = 0; j <= 4; j++) g.fillRect(0, j * sh - 1, S, 2);
  for (let j = 0; j < 4; j++) for (let i = 0; i <= 2; i++) g.fillRect(i * sw - 1, j * sh, 2, sh);
}

function mosaic(g, h, r) {
  const n = 40, t = S / n;
  g.fillStyle = '#c8c6c0';
  g.fillRect(0, 0, S, S);
  h.fillStyle = '#202020';
  h.fillRect(0, 0, S, S);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      if (r() < 0.006) continue; // a missing tile shows the grout bed
      let v = 140 + Math.floor(r() * 40), cr = v, cg = v, cb = v;
      if (r() < 0.12) (cr += 18), (cb -= 14);
      else if (r() < 0.1) (cb += 18), (cr -= 10);
      g.fillStyle = `rgb(${cr},${cg},${cb})`;
      g.fillRect(i * t + 1, j * t + 1, t - 2, t - 2);
      h.fillStyle = '#d0d0d0';
      h.fillRect(i * t + 1.5, j * t + 1.5, t - 3, t - 3);
    }
  noise(g, S, r, [[20, 90]], 0.06, 255, 0);
}

function tin(g, h, r) {
  const n = 20, p = S / n;
  g.fillStyle = '#b0b0b0';
  g.fillRect(0, 0, S, S);
  noise(g, S, r, [[16, 90], [80, 20]], 0.08, 255, 40);
  for (let x = 0; x < S; x++) {
    const s = Math.sin((x / p) * Math.PI * 2);
    const v = Math.round(128 + 110 * s);
    h.fillStyle = `rgb(${v},${v},${v})`;
    h.fillRect(x, 0, 1, S);
    // ridges catch the light a touch in albedo too (dust in the valleys)
    g.fillStyle = `rgba(${s > 0 ? 255 : 90},${s > 0 ? 255 : 80},${s > 0 ? 255 : 70},0.06)`;
    g.fillRect(x, 0, 1, S);
  }
  // rust: blooms around nail rows and long streaks down the valleys
  for (let i = 0; i < 26; i++) {
    const x = r() * S, y = r() * S, rr = 6 + r() * 28;
    const grd = g.createRadialGradient(x, y, 0, x, y, rr);
    grd.addColorStop(0, 'rgba(120,58,26,0.55)');
    grd.addColorStop(1, 'rgba(120,58,26,0)');
    g.fillStyle = grd;
    g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  for (let i = 0; i < 60; i++) {
    const x = Math.floor(r() * n) * p + p * 0.75, y = r() * S, l = 20 + r() * 140;
    const grd = g.createLinearGradient(0, y, 0, y + l);
    grd.addColorStop(0, `rgba(110,55,25,${0.2 + r() * 0.3})`);
    grd.addColorStop(1, 'rgba(110,55,25,0)');
    g.fillStyle = grd;
    g.fillRect(x - 2, y, 4, l);
  }
  // nail heads every 0.9 m on the ridges
  g.fillStyle = 'rgba(70,70,70,0.6)';
  for (let y = 40; y < S; y += S * 0.6) for (let i = 0; i < n; i += 2) g.fillRect(i * p + p / 4 - 1, y, 3, 3);
  speckle(g, S, r, 12000, 220, 90);
}

function roofConcrete(g, h, r) {
  g.fillStyle = '#a2a09b';
  g.fillRect(0, 0, S, S);
  noise(g, S, r, [[8, 200], [40, 60], [200, 15]], 0.1, 255, 20);
  // ponding stains: dark rings where water sits
  for (let i = 0; i < 7; i++) {
    const x = r() * S, y = r() * S, rr = 30 + r() * 90;
    g.strokeStyle = `rgba(40,38,34,${0.04 + r() * 0.06})`;
    g.lineWidth = 6 + r() * 10;
    g.beginPath(); g.ellipse(x, y, rr, rr * (0.6 + r() * 0.4), r() * 3, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(40,38,34,0.04)';
    g.fill();
  }
  // bitumen patch repairs and membrane seams
  for (let i = 0; i < 6; i++) {
    g.fillStyle = `rgba(35,34,33,${0.25 + r() * 0.3})`;
    g.fillRect(r() * S, r() * S, 20 + r() * 80, 10 + r() * 50);
  }
  g.fillStyle = 'rgba(50,50,50,0.15)';
  for (let y = 0; y < S; y += S / 8) g.fillRect(0, y, S, 3);
  speckle(g, S, r, 30000, 230, 60);
  h.fillStyle = '#808080';
  h.fillRect(0, 0, S, S);
  noise(h, S, r, [[600, 3]], 0.3, 255, 0);
}

function concrete(g, h, r) {
  g.fillStyle = '#b0aea9';
  g.fillRect(0, 0, S, S);
  noise(g, S, r, [[12, 120], [60, 40]], 0.07, 255, 30);
  // board-marked shuttering: horizontal planks 15 cm
  for (let y = 0; y < S; y += S / 20) {
    const v = 150 + Math.floor(r() * 50);
    g.fillStyle = `rgba(${v},${v},${v},0.15)`;
    g.fillRect(0, y, S, S / 20);
    g.fillStyle = 'rgba(60,60,60,0.12)';
    g.fillRect(0, y, S, 1.5);
  }
  speckle(g, S, r, 24000, 220, 80);
  h.fillStyle = '#808080';
  h.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += S / 20) (h.fillStyle = '#505050'), h.fillRect(0, y, S, 2);
  noise(h, S, r, [[800, 2]], 0.25, 255, 0);
}

// Rain and dust run-off: vertical dark streaks fading downward, on white (1 = clean)
function streaks(g, h, r) {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 260; i++) {
    const x = r() * S, y = r() * S, l = 30 + r() * 260, w = 1 + r() * r() * 9;
    const a = 0.04 + r() * 0.14;
    for (const oy of [-S, 0]) {
      const grd = g.createLinearGradient(0, y + oy, 0, y + oy + l);
      grd.addColorStop(0, `rgba(70,60,50,${a})`);
      grd.addColorStop(0.3, `rgba(70,60,50,${a * 0.8})`);
      grd.addColorStop(1, 'rgba(70,60,50,0)');
      g.fillStyle = grd;
      g.fillRect(x, y + oy, w, l);
    }
  }
  noise(g, S, r, [[20, 60]], 0.05, 255, 60);
  h.fillStyle = '#808080';
  h.fillRect(0, 0, S, S);
}

const PAINTERS = [render, brick, precast, granite, mosaic, tin, roofConcrete, concrete, streaks];

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

// Returns { texture: DataArrayTexture, means: Vector3[] (linear mean albedo per layer) }
export function buildingMaterials(renderer) {
  const n = PAINTERS.length;
  const data = new Uint8Array(S * S * 4 * n);
  const means = [];
  PAINTERS.forEach((paint, li) => {
    const r = rng(101 + li * 17);
    const [ca, g] = canvas(S);
    const [ch, h] = canvas(S);
    paint(g, h, r);
    const a = g.getImageData(0, 0, S, S).data, b = h.getImageData(0, 0, S, S).data;
    const off = li * S * S * 4;
    let mr = 0, mg = 0, mb = 0;
    for (let i = 0; i < S * S; i++) {
      data[off + i * 4] = a[i * 4];
      data[off + i * 4 + 1] = a[i * 4 + 1];
      data[off + i * 4 + 2] = a[i * 4 + 2];
      data[off + i * 4 + 3] = b[i * 4];
      if ((i & 15) === 0) (mr += srgbToLinear(a[i * 4] / 255)), (mg += srgbToLinear(a[i * 4 + 1] / 255)), (mb += srgbToLinear(a[i * 4 + 2] / 255));
    }
    const k = 16 / (S * S);
    means.push(new THREE.Vector3(mr * k, mg * k, mb * k));
  });
  const t = new THREE.DataArrayTexture(data, S, S, n);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = Math.min(8, renderer ? renderer.capabilities.getMaxAnisotropy() : 4);
  t.needsUpdate = true;
  return { texture: t, means };
}
