// js/textures.js — procedural canvas textures (tiling): asphalt, pavement slabs, dry ground. Greyscale-ish detail maps
// that multiply the vertex colours, so one texture serves every shade of road or verge.
import * as THREE from 'three';
import { rng } from './util.js';

export function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d', { willReadFrequently: true })];
}

// Tileable value noise painted as soft blobs at several scales
export function noise(g, size, r, octaves, alpha, light = 255, dark = 0) {
  for (const [count, rad] of octaves) {
    for (let i = 0; i < count; i++) {
      const x = r() * size, y = r() * size, rr = rad * (0.5 + r());
      const v = r() < 0.5 ? light : dark;
      for (const ox of [-size, 0, size])
        for (const oy of [-size, 0, size]) {
          const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rr);
          grd.addColorStop(0, `rgba(${v},${v},${v},${alpha})`);
          grd.addColorStop(1, `rgba(${v},${v},${v},0)`);
          g.fillStyle = grd;
          g.fillRect(x + ox - rr, y + oy - rr, rr * 2, rr * 2);
        }
    }
  }
}

export function speckle(g, size, r, n, light, dark) {
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < n; i++) {
    const p = (Math.floor(r() * size) + Math.floor(r() * size) * size) * 4;
    const v = r() < 0.5 ? light : dark;
    d[p] = d[p] * 0.4 + v * 0.6;
    d[p + 1] = d[p + 1] * 0.4 + v * 0.6;
    d[p + 2] = d[p + 2] * 0.4 + v * 0.6;
  }
  g.putImageData(img, 0, 0);
}

function finish(c, renderer) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 8;
  return t;
}

// Asphalt: aggregate speckle, tyre-polished bands, tar patches and cracks. Covers 16 m.
export function asphaltTexture(renderer) {
  const S = 1024, r = rng(5);
  const [c, g] = canvas(S);
  g.fillStyle = '#cecece';g.fillRect(0,0,S,S);
  noise(g,S,r,[[70,150],[180,35]],0.055);
  // Wrap each repair and crack across tile edges so intersections have no texture seams.
  const wrap=draw=>{for(const x of [-S,0,S])for(const y of [-S,0,S]){g.save();g.translate(x,y);draw();g.restore();}};
  for(let i=0;i<5;i++){
    const x=r()*S,y=r()*S,w=35+r()*130,h=25+r()*100;
    wrap(()=>{g.fillStyle='rgba(45,45,45,0.16)';g.fillRect(x,y,w,h);g.strokeStyle='rgba(35,35,35,0.12)';g.lineWidth=2;g.strokeRect(x,y,w,h);});
  }
  for(let i=0;i<18;i++){
    let x=r()*S,y=r()*S;const points=[[x,y]];
    for(let k=0;k<9;k++)points.push([x+=(r()-.5)*30,y+=(r()-.35)*22]);
    wrap(()=>{g.beginPath();points.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.strokeStyle='rgba(35,33,30,0.38)';g.lineWidth=.8;g.stroke();});
  }
  // Fine aggregate, without the oversized stones of the previous road surface.
  speckle(g,S,r,300000,235,125);
  return finish(c,renderer);
}

// Linear data maps: tiny aggregate relief and irregular matte/polished patches.
export function asphaltSurface(renderer) {
  const S=512,r=rng(905),[c,g]=canvas(S);
  g.fillStyle='#bcbcbc';g.fillRect(0,0,S,S);
  noise(g,S,r,[[65,70],[120,18]],.16,255,95);
  speckle(g,S,r,90000,220,145);
  const roughness=finish(c,renderer);roughness.colorSpace=THREE.NoColorSpace;
  const [h,hg]=canvas(S);hg.fillStyle='#808080';hg.fillRect(0,0,S,S);
  speckle(hg,S,r,170000,190,65);
  const bump=finish(h,renderer);bump.colorSpace=THREE.NoColorSpace;
  return {roughness,bump};
}

// Concrete pavement slabs (1.2 m) with stains and red dust. Covers 4.8 m.
export function pavementTexture(renderer) {
  const S = 256, r = rng(8);
  const [c, g] = canvas(S);
  g.fillStyle = '#e6e2dc';
  g.fillRect(0, 0, S, S);
  const n = 4, cell = S / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const v = 210 + Math.floor(r() * 40);
      g.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
      g.fillRect(i * cell + 1, j * cell + 1, cell - 2, cell - 2);
    }
  noise(g, S, r, [[30, 40], [60, 12]], 0.12, 255, 120);
  noise(g, S, r, [[10, 50]], 0.12, 170, 170); // reddish dust drifts are tinted by vertex colour
  g.strokeStyle = 'rgba(80,75,70,0.6)';
  g.lineWidth = 2;
  for (let i = 0; i <= n; i++) {
    g.beginPath(); g.moveTo(i * cell, 0); g.lineTo(i * cell, S); g.stroke();
    g.beginPath(); g.moveTo(0, i * cell); g.lineTo(S, i * cell); g.stroke();
  }
  speckle(g, S, r, 5000, 255, 110);
  return finish(c, renderer);
}

// Dry-season highveld ground: patchy grass, bare red earth, stones. Covers 24 m.
export function groundTexture(renderer) {
  const S = 512, r = rng(13);
  const [c, g] = canvas(S);
  g.fillStyle = '#cfcfcf';
  g.fillRect(0, 0, S, S);
  noise(g, S, r, [[30, 120], [120, 40], [400, 10]], 0.12, 255, 90);
  // grass strokes
  for (let i = 0; i < 5000; i++) {
    const x = r() * S, y = r() * S, v = 150 + Math.floor(r() * 105);
    g.strokeStyle = `rgba(${v},${v},${v},0.5)`;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 5);
    g.stroke();
  }
  speckle(g, S, r, 12000, 255, 60);
  return finish(c, renderer);
}
