// js/buildings.js — extrudes OSM footprints into one merged mesh with procedural facades (shader windows, lit at night)
import * as THREE from 'three';
import { groundY, rng, coreWeight, Grid, polyBounds, pointInPoly, polyCentroid, makeGeometry } from './util.js';

// Facade styles: 0 punched windows (colonial / 50s), 1 ribbon windows (60s–70s modernist), 2 curtain glass, 3 house
const WALLS_CBD = ['#d9d2c3', '#c8c0ae', '#e9e3d6', '#b8b3a8', '#d5c5a6', '#a9a399', '#c6b198', '#dfd5bf', '#a2aaa5', '#cdd2cf', '#c49a7c', '#e3d9c4'];
const WALLS_HOUSE = ['#efe7d6', '#e8dcc2', '#f2d3b3', '#d8c3a5', '#ffffff', '#e4c9a8', '#c9b49a'];
const ROOFS_HOUSE = ['#8e3b2a', '#7a4a3a', '#5e6266', '#9a5a3c', '#6d3527', '#8a8f91'];

// Named landmarks get hand-picked looks
const LANDMARKS = [
  { re: /Reserve Bank/i, wall: '#e6e4de', style: 2, glass: 1 },
  { re: /Joina City/i, wall: '#5f87a6', style: 2, spire: 26 },
  { re: /Old Mutual Centre/i, wall: '#7a6550', style: 2 },
  { re: /Eastgate Shopping/i, wall: '#9a5d43', style: 1, chimneys: true },
  { re: /ZB Life/i, wall: '#bfc5c4', style: 1 },
  { re: /Meikles/i, wall: '#efe9dc', style: 0 },
  { re: /Rainbow Towers/i, wall: '#d8b48a', style: 1 },
  { re: /^Parliament/i, wall: '#efe8d8', style: 0 },
  { re: /Town House/i, wall: '#f0e6cf', style: 0 },
  { re: /Karigamombe/i, wall: '#c9c3b5', style: 1 },
];

export function buildBuildings(scene, DATA) {
  const pos = [], nrm = [], col = [], uv = [], fac = [];
  const grid = new Grid(40);
  const footprints = [];
  const labels = [];
  const c = new THREE.Color(), roofC = new THREE.Color();

  const push = (p, n, color, u, v, f) => {
    pos.push(p[0], p[1], p[2]);
    nrm.push(n[0], n[1], n[2]);
    col.push(color.r, color.g, color.b);
    uv.push(u, v);
    fac.push(f[0], f[1], f[2]);
  };
  const quad = (a, b, cc, d, n, color, ua, ub, v0, v1, f) => {
    // a,b bottom; d,cc top — counter-clockwise from outside
    push(a, n, color, ua, v0, f); push(cc, n, color, ub, v1, f); push(b, n, color, ub, v0, f);
    push(a, n, color, ua, v0, f); push(d, n, color, ua, v1, f); push(cc, n, color, ub, v1, f);
  };
  const triUp = (a, b, cc, color, f, faceUp = true) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = cc[0] - a[0], vy = cc[1] - a[1], vz = cc[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if ((ny < 0) === faceUp) [b, cc] = [cc, b], (nx = -nx), (ny = -ny), (nz = -nz);
    const l = Math.hypot(nx, ny, nz) || 1;
    const n = [nx / l, ny / l, nz / l];
    push(a, n, color, -1, -1, f); push(b, n, color, -1, -1, f); push(cc, n, color, -1, -1, f);
  };

  // Box helper for roof clutter, spires, chimneys (no windows: fac.z = 0)
  const box = (x, z, y0, w, d, h, color, rot = 0) => {
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const P = (dx, dz, y) => [x + dx * cs - dz * sn, y, z + dx * sn + dz * cs];
    const hw = w / 2, hd = d / 2;
    const ring = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    const f = [0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % 4];
      const A = P(ax, az, y0), B = P(bx, bz, y0);
      // ring is counter-clockwise in (x, z) → outward normal is (dz, -dx)
      const ex = B[0] - A[0], ez = B[2] - A[2], l = Math.hypot(ex, ez);
      quad(A, B, P(bx, bz, y0 + h), P(ax, az, y0 + h), [ez / l, 0, -ex / l], color, 0, 0, 0, 0, f);
    }
    const t = [P(-hw, -hd, y0 + h), P(hw, -hd, y0 + h), P(hw, hd, y0 + h), P(-hw, hd, y0 + h)];
    triUp(t[0], t[1], t[2], color, f);
    triUp(t[0], t[2], t[3], color, f);
  };

  DATA.buildings.forEach((bd, idx) => {
    const p = bd.p;
    const n = p.length / 2;
    const [cx, cz] = polyCentroid(p);
    const r = rng(Math.floor(cx * 13.7 + cz * 7.3) + idx);
    const core = coreWeight(cx, cz);
    const bounds = polyBounds(p);
    const area = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]);
    const isHouse = /^(house|detached|residential|bungalow|garage|shed|hut)$/.test(bd.k || '') || (core < 0.15 && bd.h < 8 && area < 600);
    const lm = bd.n ? LANDMARKS.find((l) => l.re.test(bd.n)) : null;

    let style, wall;
    if (lm) (style = lm.style), (wall = lm.wall);
    else if (isHouse) (style = 3), (wall = WALLS_HOUSE[Math.floor(r() * WALLS_HOUSE.length)]);
    else if (bd.h > 45) (style = r() < 0.55 ? 2 : 1), (wall = WALLS_CBD[Math.floor(r() * WALLS_CBD.length)]);
    else (style = r() < 0.5 ? 0 : 1), (wall = WALLS_CBD[Math.floor(r() * WALLS_CBD.length)]);
    c.set(wall).multiplyScalar(0.92 + r() * 0.12);
    const seed = 1 + r() * 97;
    const shop = !isHouse && core > 0.2 ? 1 : 0;
    const f = [style + shop * 0.25, seed, 1];

    // Base sits on the lowest ground point so slopes don't float buildings
    let base = Infinity;
    for (let i = 0; i < n; i++) base = Math.min(base, groundY(p[i * 2], p[i * 2 + 1]));
    const y0 = base - 0.3 + (bd.m || 0);
    const top = base + bd.h;

    // Walls: pick the outward normal from the ring's winding
    let s = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      s += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
    }
    const sign = s > 0 ? 1 : -1;
    let u = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      const nx = (sign * (bz - az)) / len, nz = (-sign * (bx - ax)) / len;
      const A = [ax, y0, az], B = [bx, y0, bz], C = [bx, top, bz], D = [ax, top, az];
      if (sign > 0) quad(A, B, C, D, [nx, 0, nz], c, u, u + len, y0 - base, top - base, f);
      else quad(B, A, D, C, [nx, 0, nz], c, u + len, u, y0 - base, top - base, f);
      u += len;
    }

    // Roof
    const pts = [];
    for (let i = 0; i < n; i++) pts.push(new THREE.Vector2(p[i * 2], p[i * 2 + 1]));
    if (isHouse && n <= 8 && area < 500) {
      // Hipped tin roof up to the centroid
      roofC.set(ROOFS_HOUSE[Math.floor(r() * ROOFS_HOUSE.length)]);
      const apex = [cx, top + 1.6 + r() * 1.2, cz];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        triUp([p[i * 2], top, p[i * 2 + 1]], [p[j * 2], top, p[j * 2 + 1]], apex, roofC, [0, 0, 0]);
      }
    } else {
      roofC.set(isHouse ? ROOFS_HOUSE[Math.floor(r() * ROOFS_HOUSE.length)] : '#7d7b77').multiplyScalar(0.85 + r() * 0.2);
      for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(pts, []))
        triUp([pts[i].x, top, pts[i].y], [pts[j].x, top, pts[j].y], [pts[k].x, top, pts[k].y], roofC, [0, 0, 0]);
      // Roof clutter on bigger blocks: lift motor rooms, water tanks
      if (!isHouse && area > 300) {
        const k = 1 + Math.floor(r() * 3);
        for (let q = 0; q < k; q++) {
          const x = cx + (r() - 0.5) * (bounds[2] - bounds[0]) * 0.4, z = cz + (r() - 0.5) * (bounds[3] - bounds[1]) * 0.4;
          if (pointInPoly(x, z, p)) box(x, z, top, 2 + r() * 4, 2 + r() * 4, 1.5 + r() * 2.5, roofC.clone().multiplyScalar(1.15));
        }
      }
    }

    // Landmark extras
    if (lm?.spire) {
      box(cx, cz, top, 6, 6, 4, c);
      box(cx, cz, top + 4, 0.8, 0.8, lm.spire, new THREE.Color('#d0d4d8'));
    }
    if (lm?.chimneys) {
      // Eastgate's termite-mound ventilation stacks along the roof
      const ang = principalAngle(p);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      for (let a = -120; a <= 120; a += 9)
        for (const b of [-9, 9]) {
          const x = cx + a * ca - b * sa, z = cz + a * sa + b * ca;
          if (pointInPoly(x, z, p)) box(x, z, top, 2.4, 2.4, 6.5, new THREE.Color('#7f4a35'), ang);
        }
    }

    footprints.push({ p, h: top, bounds });
    grid.insert(footprints.length - 1, ...bounds);
    if (bd.n && lm && !labels.some((l) => lm.re.test(l.n))) labels.push({ n: bd.n, x: cx, y: top + 6, z: cz });
  });

  const geo = makeGeometry(THREE, { position: [pos, 3], normal: [nrm, 3], color: [col, 3], aWall: [uv, 2], aFac: [fac, 3] });
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0 });
  const uniforms = { uNight: { value: 0 } };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = uniforms.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aFac;\nattribute vec2 aWall;\nvarying vec3 vFac;\nvarying vec2 vWall;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFac = aFac;\nvWall = aWall;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uNight;
        varying vec3 vFac;
        varying vec2 vWall;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float winMask = 0.0;
        float litMask = 0.0;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (vFac.z > 0.5) {
          float style = floor(vFac.x);
          float shop = step(0.2, fract(vFac.x));
          vec2 cell = vec2(3.4, 3.5); vec2 lo = vec2(0.25, 0.3); vec2 hi = vec2(0.75, 0.82);
          if (style > 0.5 && style < 1.5) { cell = vec2(3.0, 3.5); lo = vec2(-1.0, 0.38); hi = vec2(2.0, 0.84); }
          else if (style > 1.5 && style < 2.5) { cell = vec2(1.7, 3.5); lo = vec2(0.05, 0.05); hi = vec2(0.95, 0.96); }
          else if (style > 2.5) { cell = vec2(4.2, 3.2); lo = vec2(0.32, 0.3); hi = vec2(0.68, 0.72); }
          vec2 g = vWall / cell;
          vec2 id = floor(g);
          vec2 f = fract(g);
          vec2 fw = clamp(fwidth(g), 0.0, 0.5);
          vec2 m = smoothstep(lo - fw, lo + fw, f) * (1.0 - smoothstep(hi - fw, hi + fw, f));
          winMask = m.x * m.y;
          // Shopfronts: one tall glazed band at street level in the CBD
          if (shop > 0.5 && vWall.y < 4.2) {
            float sf = fract(vWall.x / 5.0);
            winMask = smoothstep(0.05, 0.1, sf) * (1.0 - smoothstep(0.9, 0.95, sf)) * step(0.4, vWall.y) * (1.0 - step(3.5, vWall.y));
            id = vec2(floor(vWall.x / 5.0), -1.0);
          }
          // Fade the pattern to an average tone far away to avoid shimmer
          float fade = smoothstep(0.35, 0.6, max(fw.x, fw.y));
          winMask = mix(winMask, 0.3, fade);
          float rnd = h21(id + vFac.y);
          vec3 glass = mix(vec3(0.06, 0.065, 0.07), vec3(0.2, 0.21, 0.2), rnd);
          if (style > 1.5 && style < 2.5) glass = mix(vec3(0.12, 0.2, 0.24), vec3(0.3, 0.42, 0.45), rnd);
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, winMask);
          litMask = step(0.74 - 0.3 * step(id.y, -0.5), h21(id * 1.7 + vFac.y * 3.1)) * winMask * (1.0 - fade * 0.6);
        }`
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, winMask);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.35, winMask);')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec3 warm = mix(vec3(1.0, 0.62, 0.28), vec3(0.75, 0.85, 1.0), step(0.75, h21(floor(vWall / 3.0) + vFac.y)));
        totalEmissiveRadiance += litMask * uNight * warm * 0.9;`
      );
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);

  // Is (x, z) inside a building taller than y?
  function blocked(x, z, y = 0) {
    for (const i of grid.query(x, z)) {
      const fp = footprints[i];
      const b = fp.bounds;
      if (x < b[0] || x > b[2] || z < b[1] || z > b[3] || y > fp.h) continue;
      if (pointInPoly(x, z, fp.p)) return true;
    }
    return false;
  }

  return { mesh, blocked, labels, setNight: (v) => (uniforms.uNight.value = v) };
}

// Orientation of a footprint's longest edge
function principalAngle(p) {
  let best = 0, ang = 0;
  for (let i = 0; i < p.length; i += 2) {
    const j = (i + 2) % p.length;
    const dx = p[j] - p[i], dz = p[j + 1] - p[i + 1], l = Math.hypot(dx, dz);
    if (l > best) (best = l), (ang = Math.atan2(dz, dx));
  }
  return ang;
}
