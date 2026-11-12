// js/features/suburbs.js — greater Harare beyond the detailed CBD, out to the horizon (~25 × 25 km of OSM in
// js/suburbs-data.js, built by tools/build-suburbs.mjs), modelled on the way Slop New York fills its boroughs cheaply:
// - a procedural "city carpet" ground (one shader over a land-cover class map rasterised at load from OSM landuse
//   plus "near a residential street" → suburb): leafy low-density north (lawns, pools, msasa and jacaranda canopy),
//   dusty high-density south-west, industrial yards, golf courses, vleis, farms, dams, the airport
// - every road outside the CBD as a ribbon, the Mukuvisi and its streams, the rail lines and the runway
// - ~100k+ instanced houses / flats / sheds laid along the real streets by neighbourhood character (plot spacing and
//   setback from a density map of named suburbs), one window-and-roof shader with lit rooms at night
// - suburban trees (jacarandas purple along the northern avenues), granite kopjes, distant hills on the horizon
// - night: sodium street lights, Apollo high-mast lights over the high-density suburbs, house security lights,
//   runway lights, distant Chitungwiza glow, headlight dots on the main roads — and ZESA load-shedding: a few
//   suburbs go dark, block by block, on a rotating two-hour schedule
// The CBD bbox (SUB.bbox) is a hole in all of it: js/world.js and friends own everything inside.
import { chunkMesh } from '../tiles.js';
import { groundY } from '../util.js';

let THREE;
const EXT = 12288; // carpet half-size (m)
const RES = 2048; // class-map texels per side (12 m)
const PX = (2 * EXT) / RES;
// SUB (js/suburbs-data.js, ~0.8 MB) is imported in the background once the CBD is on screen; see init()
let SUB, BX0, BZ0, BX1, BZ1;
const CLS = { none: 0, res: 1, ind: 2, com: 3, park: 4, golf: 5, wood: 6, water: 7, vlei: 8, farm: 9, cem: 10, aero: 11, apron: 12, rail: 13, bare: 14, inst: 15, pitch: 16, mil: 17 };
const RWIDTH = [16, 14, 12, 10, 7, 7.5]; // match js/world.js so the CBD's own ribbons line up where both exist

// --- frame helpers ----------------------------------------------------------------------------------------------------
const LAT0 = -17.8295, LON0 = 31.0518;
const KX = 105967.5, KY = 110653.1; // tools/build-data.mjs constants at LAT0
const ll = (lat, lon) => [(lon - LON0) * KX, -(lat - LAT0) * KY];

function dec(a) {
  const o = new Float32Array(a.length);
  let x = 0, z = 0;
  for (let i = 0; i < a.length; i += 2) (x += a[i]), (z += a[i + 1]), (o[i] = x), (o[i + 1] = z);
  return o;
}
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const boxDist = (x, z) => Math.hypot(Math.max(BX0 - x, 0, x - BX1), Math.max(BZ0 - z, 0, z - BZ1));
const inBox = (x, z, m = 0) => x > BX0 - m && x < BX1 + m && z > BZ0 - m && z < BZ1 + m;

// --- terrain: the CBD's ground (util.groundY, with the Kopje) plus gentle highveld swells and granite kopjes ---------
const HILLS = [
  [...ll(-17.8905, 31.146), 700, 34], // Epworth balancing rocks
  [1661, -4023, 320, 20], // Gun Hill
  [...ll(-17.745, 30.946), 1300, 55], // Mount Hampden
  [...ll(-17.846, 30.973), 650, 22], // Warren Hills
  [...ll(-17.803, 31.152), 900, 28], // Chikurubi ridge
  [...ll(-17.935, 31.07), 1100, 30], // ridge toward Seke
  [...ll(-17.73, 31.03), 900, 26], // Pomona / Hatcliffe rise
];
function extraY(x, z) {
  const f = smooth(250, 1600, boxDist(x, z));
  if (f <= 0) return 0;
  let y = 5 * (0.5 + 0.5 * Math.sin(x / 1900 + 1.3) * Math.cos(z / 2300 - 0.4)) + 3 * (0.5 + 0.5 * Math.sin((x + z) / 1300));
  for (const [hx, hz, r, h] of HILLS) {
    const d2 = ((x - hx) ** 2 + (z - hz) ** 2) / (r * r);
    if (d2 < 1) y += h * (1 - d2) * (1 - d2);
  }
  return y * f;
}
const terrainY = (x, z) => groundY(x, z) + extraY(x, z);

// Graded grid lines: fine along the CBD edge (the Kopje straddles it), coarse toward the horizon
function axisLines(b0, b1) {
  const out = [];
  const step = (v) => Math.min(160, 32 + 0.045 * Math.max(0, b0 - v, v - b1));
  for (let v = -EXT; v < b0 - 1; ) out.push(v), (v = Math.min(b0, v + step(v)));
  for (let v = b0; v < b1 - 1; v = Math.min(b1, v + 40)) out.push(v);
  for (let v = b1; v < EXT; v += step(v)) out.push(v);
  out.push(EXT);
  return Float64Array.from(out);
}

// --- GLSL shared bits --------------------------------------------------------------------------------------------------
const lin = (hex) => {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(4)},${c.g.toFixed(4)},${c.b.toFixed(4)})`;
};
const GLSL_COMMON = /* glsl */ `
  float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y); }
  uniform float uCut;
  // ZESA load-shedding: 900 m blocks, re-drawn every two hours; ~1 in 6 dark
  float powerCut(vec2 xz) { return step(h12(floor(xz / 900.) + uCut * 7.31), 0.17); }
`;

// Lambert material whose shader we patch: shares the scene's sun, hemisphere light and fog with everything else
function patched(opts, uniforms, patch) {
  const m = new THREE.MeshLambertMaterial(opts);
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    patch(s);
  };
  m.customProgramCacheKey = () => patch.toString().length + ':' + Object.keys(uniforms).join();
  return m;
}

// Skip far geometry in the ambient-occlusion normal pass (it renders the scene again with an override material)
function aoSkip(mesh, near = () => true) {
  let saved = -1;
  mesh.onBeforeRender = (r, scene) => {
    if (scene.overrideMaterial && !near()) {
      const g = mesh.geometry;
      if (g.isInstancedBufferGeometry) (saved = g.instanceCount), (g.instanceCount = 0);
      else (saved = g.drawRange.count), g.setDrawRange(0, 0);
    }
  };
  mesh.onAfterRender = () => {
    if (saved < 0) return;
    const g = mesh.geometry;
    if (g.isInstancedBufferGeometry) g.instanceCount = saved;
    else g.setDrawRange(0, saved);
    saved = -1;
  };
}

// --- growable typed arrays ---------------------------------------------------------------------------------------------
class F32 {
  constructor(n = 1 << 16) {
    this.a = new Float32Array(n);
    this.n = 0;
  }
  push(...v) {
    if (this.n + v.length > this.a.length) {
      const b = new Float32Array(Math.max(this.a.length * 2, this.n + v.length));
      b.set(this.a);
      this.a = b;
    }
    for (const x of v) this.a[this.n++] = x;
  }
  get() {
    return this.a.slice(0, this.n);
  }
}

// Spatial hash of items with a radius, for "is there room here?"
class Hash {
  constructor(cell) {
    this.c = cell;
    this.m = new Map();
  }
  k(i, j) {
    return (i + 4096) * 8192 + (j + 4096);
  }
  add(x, z, r, item) {
    const c = this.c;
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++)
      for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) {
        const k = this.k(i, j);
        let b = this.m.get(k);
        if (!b) this.m.set(k, (b = []));
        b.push(item);
      }
  }
  near(x, z) {
    return this.m.get(this.k(Math.floor(x / this.c), Math.floor(z / this.c))) || [];
  }
}

// =====================================================================================================================
export default {
  // Greater Harare builds after the CBD is playable: the data downloads in the background and the build yields between
  // its stages so the city keeps rendering (it used to hold the loading screen for ~3 s).
  init(ctx) {
    THREE = ctx.THREE;
    this.ready = this.build(ctx).catch((e) => console.warn('[harare] suburbs failed', e));
  },

  async build(ctx) {
    ({ SUB } = await import('../suburbs-data.js'));
    [BX0, BZ0, BX1, BZ1] = SUB.bbox;
    const pause = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    let busy = 0;
    const t0 = performance.now();
    const group = new THREE.Group();
    group.name = 'suburbs';
    ctx.scene.add(group);
    const U = { uNight: { value: 0 }, uTime: { value: 0 }, uCut: { value: 0 } };
    this.U = U;
    this.ctx = ctx;

    // ---------------------------------------------------------------------------------------------------------------
    // 1. Decode data, road segment index
    // ---------------------------------------------------------------------------------------------------------------
    const roads = SUB.roads.map(([c, w, dirt, p, n]) => ({ c, w: c === 5 ? RWIDTH[5] : Math.max(w, RWIDTH[c] * 0.8), dirt, p: dec(p), n }));
    const segs = new Hash(48);
    for (const r of roads)
      for (let i = 2; i < r.p.length; i += 2) {
        const ax = r.p[i - 2], az = r.p[i - 1], bx = r.p[i], bz = r.p[i + 1];
        const s = { ax, az, bx, bz, hw: r.w / 2, r };
        const L = Math.hypot(bx - ax, bz - az);
        // insert by sampling along so long segments land in every cell they cross
        for (let t = 0; t <= L; t += 24) segs.add(ax + ((bx - ax) * t) / (L || 1), az + ((bz - az) * t) / (L || 1), 30, s);
        segs.add(bx, bz, 30, s);
      }
    // clearance from (x, z) to the nearest road edge
    const roadClear = (x, z) => {
      let best = 1e9;
      for (const s of segs.near(x, z)) {
        const dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l2));
        const d = Math.hypot(x - s.ax - t * dx, z - s.az - t * dz) - s.hw;
        if (d < best) best = d;
      }
      return best;
    };
    const lines = SUB.lines.map(([k, w, p]) => ({ k, w, p: dec(p) }));

    busy += performance.now() - (this._t || t0);
    await pause();
    this._t = performance.now();
    // ---------------------------------------------------------------------------------------------------------------
    // 2. Land-cover class map + density map
    // ---------------------------------------------------------------------------------------------------------------
    const cls = new Uint8Array(RES * RES);
    const toPx = (v) => (v + EXT) / PX;
    function fillPoly(p, c) {
      let y0 = Infinity, y1 = -Infinity;
      for (let i = 1; i < p.length; i += 2) (y0 = Math.min(y0, p[i])), (y1 = Math.max(y1, p[i]));
      const r0 = Math.max(0, Math.floor(toPx(y0))), r1 = Math.min(RES - 1, Math.ceil(toPx(y1)));
      const xs = [];
      const n = p.length / 2;
      for (let row = r0; row <= r1; row++) {
        const yc = (row + 0.5) * PX - EXT;
        xs.length = 0;
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const yi = p[i * 2 + 1], yj = p[j * 2 + 1];
          if (yi > yc !== yj > yc) xs.push(p[i * 2] + ((yc - yi) / (yj - yi)) * (p[j * 2] - p[i * 2]));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const c0 = Math.max(0, Math.round(toPx(xs[k]))), c1 = Math.min(RES - 1, Math.round(toPx(xs[k + 1])) - 1);
          cls.fill(c, row * RES + c0, row * RES + c1 + 1);
        }
      }
    }
    for (const [c, p] of SUB.areas) fillPoly(dec(p), c);

    // Density: inverse-distance blend of named suburbs (0 leafy acre plots … 1 informal Epworth)
    const DN = 128, DC = (2 * EXT) / DN;
    const dgrid = new Float32Array(DN * DN);
    for (let j = 0; j < DN; j++)
      for (let i = 0; i < DN; i++) {
        const x = (i + 0.5) * DC - EXT, z = (j + 0.5) * DC - EXT;
        let sw = 0, sd = 0;
        for (const [ax, az, d] of SUB.anchors) {
          const q = (x - ax) ** 2 + (z - az) ** 2 + 400 * 400, w = 1 / (q * Math.sqrt(q));
          (sw += w), (sd += w * d);
        }
        dgrid[j * DN + i] = sd / sw;
      }
    const density = (x, z) => {
      const fx = Math.min(DN - 1.001, Math.max(0, (x + EXT) / DC - 0.5)), fz = Math.min(DN - 1.001, Math.max(0, (z + EXT) / DC - 0.5));
      const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
      const a = dgrid[j * DN + i], b = dgrid[j * DN + i + 1], c = dgrid[(j + 1) * DN + i], d = dgrid[(j + 1) * DN + i + 1];
      return lerp(lerp(a, b, u), lerp(c, d, u), v);
    };

    // Near a street (tertiary or smaller) and nothing else mapped → suburb. aux.R = closeness to a street, aux.G = density
    // Street proximity at half resolution (24 m): chamfer distance transform from the rasterised centrelines
    const AR = RES >> 1, APX = PX * 2;
    const aux = new Uint8Array(AR * AR);
    {
      const N = AR * AR, D = new Float32Array(N).fill(1e6);
      const toA = (v) => (v + EXT) / APX;
      for (const r of roads) {
        if (r.c < 3) continue;
        for (let i = 2; i < r.p.length; i += 2) {
          const ax = r.p[i - 2], az = r.p[i - 1], bx = r.p[i], bz = r.p[i + 1];
          const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (APX * 0.5)));
          for (let k = 0; k <= n; k++) {
            const ii = Math.floor(toA(ax + ((bx - ax) * k) / n)), jj = Math.floor(toA(az + ((bz - az) * k) / n));
            if (ii >= 0 && jj >= 0 && ii < AR && jj < AR) D[jj * AR + ii] = 0;
          }
        }
      }
      const o = APX, dg = APX * Math.SQRT2;
      let t;
      for (let j = 1; j < AR - 1; j++)
        for (let i = 1; i < AR - 1; i++) {
          const k = j * AR + i;
          let d = D[k];
          if ((t = D[k - 1] + o) < d) d = t;
          if ((t = D[k - AR] + o) < d) d = t;
          if ((t = D[k - AR - 1] + dg) < d) d = t;
          if ((t = D[k - AR + 1] + dg) < d) d = t;
          D[k] = d;
        }
      for (let j = AR - 2; j > 0; j--)
        for (let i = AR - 2; i > 0; i--) {
          const k = j * AR + i;
          let d = D[k];
          if ((t = D[k + 1] + o) < d) d = t;
          if ((t = D[k + AR] + o) < d) d = t;
          if ((t = D[k + AR + 1] + dg) < d) d = t;
          if ((t = D[k + AR - 1] + dg) < d) d = t;
          D[k] = d;
        }
      const sc = DN / AR;
      for (let j = 0; j < AR; j++) {
        const row = Math.min(DN - 1, Math.floor(j * sc)) * DN;
        for (let i = 0; i < AR; i++) {
          const k = j * AR + i, d = D[k];
          if (d >= 95) continue;
          const R = lerp(95, 42, smooth(0.1, 0.85, dgrid[row + Math.min(DN - 1, Math.floor(i * sc))]));
          if (d < R) aux[k] = 255 * (1 - d / R);
        }
      }
    }
    for (let j = 0; j < RES; j++)
      for (let i = 0; i < RES; i++) {
        const k = j * RES + i;
        if (cls[k] === 0 && aux[(j >> 1) * AR + (i >> 1)] > 0) cls[k] = CLS.res;
      }
    const clsAt = (x, z) => {
      const i = Math.floor(toPx(x)), j = Math.floor(toPx(z));
      return i < 0 || j < 0 || i >= RES || j >= RES ? 0 : cls[j * RES + i];
    };
    const nearAt = (x, z) => {
      const i = Math.floor(toPx(x) / 2), j = Math.floor(toPx(z) / 2);
      return i < 0 || j < 0 || i >= AR || j >= AR ? 0 : aux[j * AR + i] / 255;
    };
    const tCls = new THREE.DataTexture(cls, RES, RES, THREE.RedFormat, THREE.UnsignedByteType);
    tCls.magFilter = tCls.minFilter = THREE.NearestFilter;
    tCls.needsUpdate = true;
    const tAux = new THREE.DataTexture(aux, AR, AR, THREE.RedFormat, THREE.UnsignedByteType);
    const tDens = new THREE.DataTexture(Uint8Array.from(dgrid, (v) => Math.round(v * 255)), DN, DN, THREE.RedFormat, THREE.UnsignedByteType);
    tDens.magFilter = tDens.minFilter = THREE.LinearFilter;
    tDens.needsUpdate = true;
    tAux.magFilter = THREE.LinearFilter;
    tAux.minFilter = THREE.LinearMipmapLinearFilter;
    tAux.generateMipmaps = true;
    tAux.needsUpdate = true;

    busy += performance.now() - (this._t || t0);
    await pause();
    this._t = performance.now();
    // ---------------------------------------------------------------------------------------------------------------
    // 3. Carpet mesh: a graded grid with the CBD bbox cut out; surfY() = the triangulated surface, so ribbons and houses
    //    sit exactly on what's drawn
    // ---------------------------------------------------------------------------------------------------------------
    const xs = axisLines(BX0, BX1), zs = axisLines(BZ0, BZ1);
    const NX = xs.length, NZ = zs.length;
    const hgt = new Float32Array(NX * NZ);
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) hgt[j * NX + i] = terrainY(xs[i], zs[j]);
    const findCell = (arr, v) => {
      let lo = 0, hi = arr.length - 2;
      if (v <= arr[0]) return 0;
      if (v >= arr[hi + 1]) return hi;
      while (lo < hi) {
        const m = (lo + hi + 1) >> 1;
        if (arr[m] <= v) lo = m;
        else hi = m - 1;
      }
      return lo;
    };
    const surfY = (x, z) => {
      if (Math.abs(x) >= EXT || Math.abs(z) >= EXT) return terrainY(x, z);
      const i = findCell(xs, x), j = findCell(zs, z);
      const u = (x - xs[i]) / (xs[i + 1] - xs[i]), v = (z - zs[j]) / (zs[j + 1] - zs[j]);
      const a = hgt[j * NX + i], b = hgt[j * NX + i + 1], c = hgt[(j + 1) * NX + i], d = hgt[(j + 1) * NX + i + 1];
      // triangles (a, c, b) and (c, d, b): split on the a→d anti-diagonal (b–c)
      return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
    };
    this.surfY = surfY;
    {
      const pos = new Float32Array(NX * NZ * 3);
      for (let j = 0; j < NZ; j++)
        for (let i = 0; i < NX; i++) {
          const k = (j * NX + i) * 3;
          (pos[k] = xs[i]), (pos[k + 1] = hgt[j * NX + i]), (pos[k + 2] = zs[j]);
        }
      const idx = [];
      for (let j = 0; j < NZ - 1; j++)
        for (let i = 0; i < NX - 1; i++) {
          const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
          if (inBox(cx, cz)) continue;
          const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1;
          idx.push(a, c, b, c, d, b);
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const mat = patched(
        { color: '#ffffff', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 },
        { tCls: { value: tCls }, tAux: { value: tAux }, tDens: { value: tDens }, uExt: { value: EXT }, ...U },
        (s) => {
          s.vertexShader = s.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vW;')
            .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
          s.fragmentShader = s.fragmentShader
            .replace('#include <common>', `#include <common>\nvarying vec3 vW;\nuniform sampler2D tCls, tAux, tDens;\nuniform float uExt, uNight, uTime;\n${GLSL_COMMON}\n${CARPET_GLSL()}`)
            .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( carpet(vW.xz, length(vViewPosition)), 1.0 );');
        },
      );
      const carpet = new THREE.Mesh(g, mat);
      carpet.name = 'suburbs-carpet';
      group.add(carpet);
    }

    busy += performance.now() - (this._t || t0);
    await pause();
    this._t = performance.now();
    // ---------------------------------------------------------------------------------------------------------------
    // 4. Ribbons: roads (verge, asphalt), rivers, rail, runway
    // ---------------------------------------------------------------------------------------------------------------
    class Ribbons {
      constructor() {
        this.pos = new F32(1 << 20);
        this.col = [];
        this.idx = [];
        this.nv = 0;
      }
      add(p, half, y, color, side = 0, step = 45) {
        // densify so the ribbon follows the carpet
        const q = [p[0], p[1]];
        for (let i = 2; i < p.length; i += 2) {
          const ax = p[i - 2], az = p[i - 1], bx = p[i], bz = p[i + 1];
          const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
          for (let k = 1; k <= n; k++) q.push(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n);
        }
        const n = q.length / 2;
        if (n < 2) return;
        const base = this.nv;
        for (let i = 0; i < n; i++) {
          const x = q[i * 2], z = q[i * 2 + 1];
          let tx = 0, tz = 0;
          if (i > 0) {
            const dx = x - q[i * 2 - 2], dz = z - q[i * 2 - 1], l = Math.hypot(dx, dz) || 1;
            (tx += dx / l), (tz += dz / l);
          }
          if (i < n - 1) {
            const dx = q[i * 2 + 2] - x, dz = q[i * 2 + 3] - z, l = Math.hypot(dx, dz) || 1;
            (tx += dx / l), (tz += dz / l);
          }
          const tl = Math.hypot(tx, tz) || 1;
          (tx /= tl), (tz /= tl);
          let m = 1;
          if (i > 0 && i < n - 1) {
            const dx = x - q[i * 2 - 2], dz = z - q[i * 2 - 1], l = Math.hypot(dx, dz) || 1;
            m = 1 / Math.max(0.5, (dx / l) * tx + (dz / l) * tz);
          }
          const nx = tz, nz = -tx;
          const gy = surfY(x, z) + y;
          this.pos.push(x + nx * (side + half * m), gy, z + nz * (side + half * m), x + nx * (side - half * m), gy, z + nz * (side - half * m));
          this.col.push(color.r * 255, color.g * 255, color.b * 255, color.r * 255, color.g * 255, color.b * 255);
          this.nv += 2;
        }
        for (let i = 0; i < n - 1; i++) {
          const a = base + i * 2;
          this.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
        }
      }
      dashes(p, half, y, color, on, off) {
        let acc = 0;
        for (let i = 2; i < p.length; i += 2) {
          const ax = p[i - 2], az = p[i - 1], bx = p[i], bz = p[i + 1];
          const len = Math.hypot(bx - ax, bz - az);
          for (let s = (on + off - (acc % (on + off))) % (on + off); s < len; s += on + off) {
            const e = Math.min(len, s + on);
            this.add([ax + ((bx - ax) * s) / len, az + ((bz - az) * s) / len, ax + ((bx - ax) * e) / len, az + ((bz - az) * e) / len], half, y, color);
          }
          acc += len;
        }
      }
      mesh(offset) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(this.pos.get(), 3));
        g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(this.col), 3, true));
        g.setIndex(this.nv > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
        const mat = patched({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2 - offset, polygonOffsetUnits: -8 - offset * 4 }, {}, (s) => {
          s.vertexShader = s.vertexShader.replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);');
        });
        return new THREE.Mesh(g, mat);
      }
    }
    const C = (h) => new THREE.Color(h);
    const verge = new Ribbons(), minor = new Ribbons(), major = new Ribbons(), paint = new Ribbons();
    {
      const tar = C('#4b4b4c'), tarOld = C('#5d5954'), dirt = C('#9b6a49'), dust = C('#a98a6c'), dustRed = C('#9e7254'), white = C('#d9d6cc'), yellow = C('#cfa83a');
      const tmp = new THREE.Color();
      for (const r of roads) {
        const d = density(r.p[0], r.p[1]);
        const half = r.w / 2;
        if (r.c === 5) {
          verge.add(r.p, half + 2.2, 0.03, tmp.copy(dust).lerp(dustRed, d).clone());
          minor.add(r.p, half, 0.06, r.dirt || (d > 0.97 && r.n === undefined && (r.p[0] * 7 + r.p[1]) % 3 < 1) ? dirt : tarOld);
        } else {
          verge.add(r.p, half + 3, 0.03, dust);
          major.add(r.p, half, 0.09, tar);
          if (r.c <= 2) {
            paint.add(r.p, 0.12, 0.12, yellow, half - 0.6);
            paint.add(r.p, 0.12, 0.12, yellow, -(half - 0.6));
            if (r.c <= 1) paint.dashes(r.p, 0.1, 0.12, white, 3, 7);
          }
        }
      }
      const water = C('#40616a'), riparian = C('#667a42'), bed = C('#8c7a5c'), ballast = C('#6b5f56'), steel = C('#57524e');
      const runway = C('#3b3b3d'), taxi = C('#525258'), grassRw = C('#8f9258');
      for (const l of lines) {
        if (l.k === 0) verge.add(l.p, 26, 0.02, riparian), minor.add(l.p, l.w / 2, 0.05, water);
        else if (l.k === 1) verge.add(l.p, 12, 0.02, riparian), minor.add(l.p, 1.5, 0.05, bed);
        else if (l.k === 2) {
          major.add(l.p, l.w / 2, 0.1, runway);
          paint.dashes(l.p, 0.6, 0.14, white, 30, 20);
          paint.add(l.p, 0.5, 0.14, white, l.w / 2 - 1.5);
          paint.add(l.p, 0.5, 0.14, white, -(l.w / 2 - 1.5));
        } else if (l.k === 3) verge.add(l.p, l.w / 2, 0.03, grassRw);
        else if (l.k === 4) major.add(l.p, l.w / 2, 0.08, taxi), paint.add(l.p, 0.2, 0.12, yellow);
        else if (l.k === 5) verge.add(l.p, 2.6, 0.04, ballast), paint.add(l.p, 0.08, 0.13, steel, 0.55), paint.add(l.p, 0.08, 0.13, steel, -0.55);
      }
    }
    for (const [i, rb] of [verge, minor, major, paint].entries()) {
      const m = rb.mesh(i);
      m.name = 'sub-ribbons';
      group.add(m);
      // city-wide ribbons in 2.5 km chunks, so the camera can skip the ones behind it
      for (const c of chunkMesh(m, 2500)) aoSkip(c, () => false);
    }

    busy += performance.now() - (this._t || t0);
    await pause();
    this._t = performance.now();
    // ---------------------------------------------------------------------------------------------------------------
    // 5. Buildings: houses along the streets by neighbourhood, sheds in industrial zones, shops, flats, OSM footprints
    // ---------------------------------------------------------------------------------------------------------------
    const rnd = mulberry(1979);
    const B = { pos: new F32(1 << 20), size: new F32(1 << 20), wall: [], roof: [], info: new F32(1 << 19) };
    const occ = new Hash(24);
    // CBD buildings that spill over the bbox edge
    for (const b of ctx.DATA.buildings) {
      let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
      for (let i = 0; i < b.p.length; i += 2) (x0 = Math.min(x0, b.p[i])), (x1 = Math.max(x1, b.p[i])), (z0 = Math.min(z0, b.p[i + 1])), (z1 = Math.max(z1, b.p[i + 1]));
      if (inBox((x0 + x1) / 2, (z0 + z1) / 2, -80) && inBox(x0, z0, -80) && inBox(x1, z1, -80)) continue;
      const r = Math.hypot(x1 - x0, z1 - z0) / 2;
      occ.add((x0 + x1) / 2, (z0 + z1) / 2, r, { x: (x0 + x1) / 2, z: (z0 + z1) / 2, r: r * 0.9 });
    }
    const free = (x, z, r) => {
      for (const o of occ.near(x, z)) if (Math.hypot(o.x - x, o.z - z) < (o.r + r) * 0.82) return false;
      return true;
    };
    const tc = new THREE.Color();
    const WALLS = {
      high: ['#e9e1cf', '#d9c7a8', '#efd9c0', '#c9d5d8', '#e8c9b5', '#a65d3f', '#b3694a', '#d8d0bb', '#c2b59a', '#e4dcc4'],
      med: ['#efe8d8', '#e8dcc2', '#f2e2c6', '#ddd3c0', '#f4efe4', '#e6d2b0'],
      low: ['#f4f0e6', '#efe6d2', '#f6ead6', '#e9e2d4', '#ffffff', '#ded4c0'],
    };
    const ROOFS = {
      high: ['#7d7f7f', '#8e9090', '#6f5b4f', '#8a4a35', '#9a9c9a', '#7a3f30', '#a2795b', '#6c6e70'],
      med: ['#8a3f2e', '#6e3a2c', '#5a5c60', '#9a5638', '#7d4a3a', '#46494d', '#a06a4a'],
      low: ['#3e4146', '#8e4a33', '#9a5a3c', '#55585c', '#7a3d2d', '#9c8458', '#4a4d52', '#a3643f'],
      shed: ['#a9adb0', '#9ea3a6', '#c4c6c4', '#8b8f91', '#b46d43', '#7d8a8d'],
      flat: ['#a8a39a', '#9a958d', '#b4afa6', '#8f8b84'],
    };
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    // type: 0 house · 1 flats · 2 shed · 3 shops/offices
    function addB(x, z, ang, w, d, h, roofH, type, wallHex, roofHex) {
      if (d > w) ([w, d] = [d, w]), (ang += Math.PI / 2);
      const y = surfY(x, z);
      B.pos.push(x, y, z, ang);
      B.size.push(w, d, h, roofH);
      tc.set(wallHex).multiplyScalar(0.9 + rnd() * 0.15);
      B.wall.push(Math.min(255, tc.r * 255), Math.min(255, tc.g * 255), Math.min(255, tc.b * 255));
      tc.set(roofHex).multiplyScalar(0.85 + rnd() * 0.25);
      B.roof.push(Math.min(255, tc.r * 255), Math.min(255, tc.g * 255), Math.min(255, tc.b * 255));
      B.info.push(type, rnd());
      occ.add(x, z, Math.hypot(w, d) / 2, { x, z, r: Math.hypot(w, d) / 2 });
    }
    const okClass = (c) => c === CLS.res || c === CLS.none;
    const houses = [];
    const tryHouse = (x, z, ang, w, d, h, roofH, type, wallHex, roofHex) => {
      const r = Math.hypot(w, d) / 2;
      if (inBox(x, z, r + 25)) return false;
      if (roadClear(x, z) < r * 0.75 + 0.5) return false;
      if (!free(x, z, r)) return false;
      addB(x, z, ang, w, d, h, roofH, type, wallHex, roofHex);
      if (type === 0) houses.push([x, z, w, d, ang]);
      return true;
    };
    // OSM footprints first (real sheds, malls, flats, stands, terminals): oriented bounding rectangles
    for (const [kind, h, ep] of SUB.buildings) {
      const p = dec(ep);
      let best = null;
      for (let i = 0; i < p.length; i += 2) {
        const j = (i + 2) % p.length;
        const a = Math.atan2(p[j + 1] - p[i + 1], p[j] - p[i]), ca = Math.cos(a), sa = Math.sin(a);
        let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
        for (let k = 0; k < p.length; k += 2) {
          const u = p[k] * ca + p[k + 1] * sa, v = -p[k] * sa + p[k + 1] * ca;
          (u0 = Math.min(u0, u)), (u1 = Math.max(u1, u)), (v0 = Math.min(v0, v)), (v1 = Math.max(v1, v));
        }
        const area = (u1 - u0) * (v1 - v0);
        if (!best || area < best.area) best = { area, a, u: (u0 + u1) / 2, v: (v0 + v1) / 2, w: u1 - u0, d: v1 - v0 };
      }
      const cx = best.u * Math.cos(best.a) - best.v * Math.sin(best.a), cz = best.u * Math.sin(best.a) + best.v * Math.cos(best.a);
      const type = kind === 0 ? 2 : kind === 2 ? 1 : 3;
      const roofHex = type === 2 ? pick(ROOFS.shed) : pick(ROOFS.flat);
      const wallHex = type === 1 ? pick(['#e8e2d4', '#ddd5c4', '#d4c2a6', '#c9b8a0']) : type === 2 ? pick(['#c8c4bc', '#b9b5ad', '#d6d0c4']) : kind === 4 ? '#9fb2bf' : pick(['#e6e0d4', '#d8d2c8', '#c7c0b4']);
      addB(cx, cz, -best.a, best.w, best.d, h, type === 2 ? 0.8 : 0.3, type, wallHex, roofHex);
    }
    // Hand-placed clusters of flats / offices / sheds
    for (const [cx, cz, R, n, f0, f1, kind] of SUB.clusters) {
      // align with the nearest street
      let ang = 0, bd = 1e9;
      for (const s of segs.near(cx, cz)) {
        const d = Math.hypot((s.ax + s.bx) / 2 - cx, (s.az + s.bz) / 2 - cz);
        if (d < bd) (bd = d), (ang = -Math.atan2(s.bz - s.az, s.bx - s.ax));
      }
      for (let k = 0, tries = 0; k < n && tries < n * 12; tries++) {
        const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * R;
        const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
        const floors = f0 + Math.floor(rnd() * (f1 - f0 + 1));
        const [w, d] = kind === 2 ? [26 + rnd() * 20, 11 + rnd() * 3] : kind === 0 ? [30 + rnd() * 40, 22 + rnd() * 25] : [16 + rnd() * 22, 14 + rnd() * 12];
        const type = kind === 2 ? 1 : kind === 0 ? 2 : 3;
        const wallHex = type === 1 ? pick(['#e4dccb', '#d9cfba', '#cfc2a8', '#e8e2d6', '#c4b49c']) : type === 2 ? pick(['#c8c4bc', '#b9b5ad']) : pick(['#e6e0d4', '#d0cbc2', '#bfb6a8', '#8fa3ae', '#c9b79c']);
        if (tryHouse(x, z, ang + (rnd() < 0.3 ? Math.PI / 2 : 0), w, d, floors * 3.2 + 0.8, type === 2 ? 0.8 : 0.3, type, wallHex, type === 2 ? pick(ROOFS.shed) : pick(ROOFS.flat))) k++;
      }
    }
    // Along every street outside the CBD
    for (const r of roads) {
      if (r.c < 2) continue; // trunk & primary: set-back service roads, not frontage
      const p = r.p;
      let acc = rnd() * 10;
      for (let i = 2; i < p.length; i += 2) {
        const ax = p[i - 2], az = p[i - 1], bx = p[i], bz = p[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 1) continue;
        const tx = (bx - ax) / L, tz = (bz - az) / L, nx = tz, nz = -tx;
        const ang = -Math.atan2(tz, tx);
        while (acc < L) {
          const x0 = ax + tx * acc, z0 = az + tz * acc;
          const dd = density(x0, z0);
          const k = smooth(0.08, 0.9, dd); // 0 leafy … 1 high-density
          const spacing = lerp(48, 13.5, k) * (0.9 + rnd() * 0.25);
          for (const side of [1, -1]) {
            const c0 = clsAt(x0 + nx * side * 20, z0 + nz * side * 20);
            if (c0 === CLS.ind) {
              const w = 22 + rnd() * 30, d = 18 + rnd() * 22;
              const off = r.w / 2 + 7 + d / 2;
              tryHouse(x0 + nx * side * off, z0 + nz * side * off, ang, w, d, 6 + rnd() * 5, 0.9, 2, pick(['#c8c4bc', '#b9b5ad', '#d6d0c4', '#a9a49a']), pick(ROOFS.shed));
              continue;
            }
            if (c0 === CLS.com) {
              const w = 16 + rnd() * 20, d = 14 + rnd() * 12;
              const off = r.w / 2 + 10 + d / 2;
              tryHouse(x0 + nx * side * off, z0 + nz * side * off, ang, w, d, 4 + rnd() * (rnd() < 0.3 ? 12 : 4), 0.3, 3, pick(['#e6e0d4', '#d0cbc2', '#bfb6a8', '#c9b79c']), pick(ROOFS.flat));
              continue;
            }
            if (!okClass(c0) || rnd() < lerp(0.18, 0.06, k)) continue;
            const w = lerp(15 + rnd() * 8, 7 + rnd() * 1.5, k), d = lerp(11 + rnd() * 5, 6.5 + rnd() * 1.5, k);
            const setback = lerp(16 + rnd() * 14, 3 + rnd() * 1.5, k) + (r.c < 5 ? 4 : 0);
            const off = r.w / 2 + setback + d / 2;
            const x = x0 + nx * side * off, z = z0 + nz * side * off;
            const pal = k > 0.66 ? 'high' : k > 0.25 ? 'med' : 'low';
            const h = lerp(3.4, 2.9, k) + (k < 0.2 && rnd() < 0.15 ? 3 : 0);
            const roofH = k > 0.66 ? (rnd() < 0.5 ? 0.6 : 1.4) : 1.8 + rnd() * 1.4;
            if (!tryHouse(x, z, ang + (rnd() - 0.5) * 0.06 * (1 - k), w, d, h, roofH, 0, pick(WALLS[pal]), pick(ROOFS[pal]))) continue;
            // a cottage / garage behind the big houses, a backyard extension or second row in the high-density grids
            if (k < 0.5 && rnd() < 0.4) {
              const o2 = off + d / 2 + 9 + rnd() * 10;
              tryHouse(x0 + nx * side * o2 + tx * (rnd() - 0.5) * 8, z0 + nz * side * o2 + tz * (rnd() - 0.5) * 8, ang, 7 + rnd() * 3, 5 + rnd(), 2.8, 1.2, 0, pick(WALLS[pal]), pick(ROOFS[pal]));
            } else if (k > 0.8 && rnd() < 0.6) {
              const o2 = off + d / 2 + 2.5 + 3;
              tryHouse(x0 + nx * side * o2, z0 + nz * side * o2, ang, 5 + rnd() * 2, 4 + rnd() * 1.5, 2.7, 0.4, 0, pick(WALLS.high), pick(ROOFS.high));
            }
          }
          acc += spacing;
        }
        acc -= L;
      }
    }
    // Industrial interiors: sheds on a jittered grid wherever the map says industrial
    for (let z = -EXT + 30; z < EXT; z += 58)
      for (let x = -EXT + 30; x < EXT; x += 58) {
        const jx = x + (rnd() - 0.5) * 20, jz = z + (rnd() - 0.5) * 20;
        if (clsAt(jx, jz) !== CLS.ind || rnd() < 0.25) continue;
        tryHouse(jx, jz, rnd() < 0.5 ? 0 : 0.35, 22 + rnd() * 34, 16 + rnd() * 24, 6 + rnd() * 5, 0.9, 2, pick(['#c8c4bc', '#b9b5ad', '#d6d0c4']), pick(ROOFS.shed));
      }
    const nB = B.info.n / 2;

    // House geometry: walls (4 quads) + hip roof (2 trapezoids + 2 triangles). aR: x = ridge vertex, y = face id
    function houseGeometry(walls) {
      const P = [], R = [], N = [], I = [];
      const vert = (v, n, r = 0) => (P.push(...v), N.push(...n), R.push(r), P.length / 3 - 1);
      const quad = (a, b, c, d, n, r = [0, 0, 0, 0]) => {
        const [i, j, k, l] = [vert(a, n, r[0]), vert(b, n, r[1]), vert(c, n, r[2]), vert(d, n, r[3])];
        I.push(i, j, k, i, k, l);
      };
      if (walls) {
        quad([-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5], [0, 0, 1]);
        quad([0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1, -0.5], [0.5, 1, -0.5], [0, 0, -1]);
        quad([0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5], [1, 0, 0]);
        quad([-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 1, 0.5], [-0.5, 1, -0.5], [-1, 0, 0]);
      }
      // roof: eave corners y = 1 (wall top), ridge ends flagged (x sign kept)
      const e = (sx, sz) => [sx * 0.5, 1, sz * 0.5];
      const rg = (sx) => [sx, 2, 0];
      quad(e(-1, 1), e(1, 1), rg(1), rg(-1), [0, 1, 1], [0, 0, 1, 1]);
      quad(e(1, -1), e(-1, -1), rg(-1), rg(1), [0, 1, -1], [0, 0, 1, 1]);
      I.push(vert(e(1, 1), [1, 1, 0]), vert(e(1, -1), [1, 1, 0]), vert(rg(1), [1, 1, 0], 1));
      I.push(vert(e(-1, -1), [-1, 1, 0]), vert(e(-1, 1), [-1, 1, 0]), vert(rg(-1), [-1, 1, 0], 1));
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      g.setAttribute('aRidge', new THREE.Float32BufferAttribute(R, 1));
      g.setIndex(I);
      return g;
    }
    const houseVS = /* glsl */ `
      attribute vec4 iPos; attribute vec4 iSize; attribute vec3 iWall; attribute vec3 iRoof; attribute vec2 iInfo; attribute float aRidge;
      varying vec3 vWall; varying vec3 vRoof; varying vec4 vFace; varying vec3 vIP; varying vec2 vInfo;
      uniform float uShrinkFar;
    `;
    const houseBegin = /* glsl */ `
      float w = iSize.x, d = iSize.y, h = iSize.z, rh = iSize.w;
      vec3 lp; vec3 ln = normal;
      bool isRoof = position.y > 0.99;
      if (!isRoof) {
        lp = vec3(position.x * w, position.y * (h + 1.5) - 1.5, position.z * d); // walls run 1.5 m into the ground
      } else if (aRidge > 0.5) {
        lp = vec3(sign(position.x) * max(0.0, w * 0.5 - d * 0.5), h + rh, 0.0);
      } else {
        lp = vec3(position.x * (w + 0.8), h, position.z * (d + 0.8));
      }
      if (isRoof) {
        if (abs(normal.z) > 0.5) ln = normalize(vec3(0.0, d * 0.5, normal.z * rh));
        else ln = normalize(vec3(normal.x * rh, d * 0.5, 0.0));
      }
      // fade out toward the fog line instead of popping
      float fadeFar = smoothstep(uShrinkFar * 0.82, uShrinkFar, length(iPos.xz - cameraPosition.xz));
      lp.y = mix(lp.y, -2.0, fadeFar);
      float ca = cos(iPos.w), sa = sin(iPos.w);
      mat2 R = mat2(ca, -sa, sa, ca);
      vec2 rp = R * lp.xz; vec2 rn = R * ln.xz;
      vec3 hTransformed = vec3(iPos.x + rp.x, iPos.y + lp.y, iPos.z + rp.y);
      vec3 objectNormal = vec3(rn.x, ln.y, rn.y);
      vWall = iWall; vRoof = iRoof; vIP = iPos.xyz; vInfo = iInfo;
      // face coords: along-wall metres, height metres, roof flag, facing
      vFace = vec4(abs(normal.z) > 0.5 ? position.x * w : position.z * d, lp.y, isRoof ? 1.0 : 0.0, abs(normal.z) > 0.5 ? d : w);
    `;
    const houseFS = /* glsl */ `
      varying vec3 vWall; varying vec3 vRoof; varying vec4 vFace; varying vec3 vIP; varying vec2 vInfo;
      uniform float uNight, uTime;
      ${GLSL_COMMON}
    `;
    // windows: type 0 house · 1 flats · 2 shed · 3 shops/offices
    const houseColor = /* glsl */ `
      vec3 base; vec3 emis = vec3(0.0);
      int type = int(vInfo.x + 0.5);
      if (vFace.z > 0.5) {
        base = vRoof;
        // corrugated iron / tile courses
        float k = type == 0 ? 0.5 + 0.5 * sin(vFace.x * 9.0) : 0.5;
        base *= 0.92 + 0.08 * k;
      } else {
        base = vWall;
        float u = vFace.x, y = vFace.y;
        float fh = type == 0 ? 3.2 : 3.2;
        float floorI = floor(y / fh), fy = fract(y / fh) * fh;
        float spacing = type == 0 ? 3.4 : type == 1 ? 3.2 : type == 2 ? 9.0 : 3.6;
        float cell = floor(u / spacing), fu = fract(u / spacing) * spacing;
        float ww = type == 2 ? 2.0 : type == 3 ? 2.6 : 1.3;
        float wy0 = type == 2 ? 3.8 : 0.9, wy1 = type == 2 ? 4.6 : (type == 3 ? 2.6 : 2.1);
        float win = step(abs(fu - spacing * 0.5), ww * 0.5) * step(wy0, fy) * step(fy, wy1) * step(0.0, y);
        if (type == 2) win *= step(y, fh * 1.6) * step(0.6, h12(vec2(cell, vIP.x)));
        if (type == 0) win *= step(y, 3.0);
        // plinth, sills
        base *= 1.0 - 0.25 * step(y, 0.45);
        vec3 glass = type == 3 ? vec3(0.08, 0.11, 0.13) : vec3(0.05, 0.06, 0.07);
        base = mix(base, glass, win * 0.85);
        float lit = step(h12(vec2(cell + vIP.x * 0.13, floorI + vIP.z * 0.29)), type == 1 ? 0.55 : type == 0 ? 0.42 : 0.3);
        float cut = powerCut(vIP.xz);
        lit *= 1.0 - cut * step(0.06, h12(vIP.xz));
        emis = win * lit * uNight * mix(vec3(1.0, 0.62, 0.3), vec3(0.8, 0.85, 0.95), max(cut, step(0.88, h12(vec2(cell, vIP.z))))) * (type == 1 ? 1.1 : 1.6);
      }
    `;
    const houseUniforms = { ...U, uShrinkFar: { value: 4800 } };
    const houseMat = patched({ color: '#ffffff' }, houseUniforms, (s) => {
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\n' + houseVS)
        .replace('#include <beginnormal_vertex>', houseBegin)
        .replace('#include <begin_vertex>', 'vec3 transformed = hTransformed;');
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\n' + houseFS)
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', houseColor + '\nvec4 diffuseColor = vec4( base, 1.0 );')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += emis;');
    });
    const geoNear = houseGeometry(true), geoFar = houseGeometry(false);

    // Chunk instances into 1.5 km tiles: frustum culling, distance culling, near/far geometry
    const chunks = [];
    const CH = 1500;
    function chunkInstances(n, keyOf) {
      const m = new Map();
      for (let i = 0; i < n; i++) {
        const k = keyOf(i);
        (m.get(k) || m.set(k, []).get(k)).push(i);
      }
      return m;
    }
    {
      const P = B.pos.a, S = B.size.a, I = B.info.a, Wc = new Uint8Array(B.wall), Rc = new Uint8Array(B.roof);
      const m = chunkInstances(nB, (i) => Math.floor(P[i * 4] / CH) * 1000 + Math.floor(P[i * 4 + 2] / CH));
      for (const list of m.values()) {
        const n = list.length;
        const pos = new Float32Array(n * 4), size = new Float32Array(n * 4), info = new Float32Array(n * 2), wall = new Uint8Array(n * 3), roof = new Uint8Array(n * 3);
        let cx = 0, cz = 0;
        list.forEach((s, k) => {
          pos.set(P.subarray(s * 4, s * 4 + 4), k * 4);
          size.set(S.subarray(s * 4, s * 4 + 4), k * 4);
          info.set(I.subarray(s * 2, s * 2 + 2), k * 2);
          wall.set(Wc.subarray(s * 3, s * 3 + 3), k * 3);
          roof.set(Rc.subarray(s * 3, s * 3 + 3), k * 3);
          (cx += P[s * 4]), (cz += P[s * 4 + 2]);
        });
        (cx /= n), (cz /= n);
        let rad = 0, ymax = 0;
        for (let k = 0; k < n; k++) (rad = Math.max(rad, Math.hypot(pos[k * 4] - cx, pos[k * 4 + 2] - cz) + 40)), (ymax = Math.max(ymax, pos[k * 4 + 1] + size[k * 4 + 2]));
        const attrs = {
          iPos: new THREE.InstancedBufferAttribute(pos, 4),
          iSize: new THREE.InstancedBufferAttribute(size, 4),
          iInfo: new THREE.InstancedBufferAttribute(info, 2),
          iWall: new THREE.InstancedBufferAttribute(wall, 3, true),
          iRoof: new THREE.InstancedBufferAttribute(roof, 3, true),
        };
        const mk = (base) => {
          const g = new THREE.InstancedBufferGeometry();
          for (const k of ['position', 'normal', 'aRidge']) g.setAttribute(k, base.getAttribute(k));
          g.setIndex(base.index);
          for (const [k, a] of Object.entries(attrs)) g.setAttribute(k, a);
          g.instanceCount = n;
          g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, ymax / 2, cz), rad + ymax);
          return g;
        };
        const near = mk(geoNear), far = mk(geoFar);
        const mesh = new THREE.Mesh(near, houseMat);
        mesh.name = 'sub-houses';
        const ch = { mesh, near, far, x: cx, z: cz, r: rad, d: 0 };
        aoSkip(mesh, () => ch.d < 900);
        chunks.push(ch);
        group.add(mesh);
      }
    }

    busy += performance.now() - (this._t || t0);
    await pause();
    this._t = performance.now();
    // ---------------------------------------------------------------------------------------------------------------
    // 6. Trees: street trees on the leafy avenues (jacarandas in flower), garden trees, woodland, golf courses, veld
    // ---------------------------------------------------------------------------------------------------------------
    const T = { pos: new F32(1 << 19), shape: new F32(1 << 19), col: [] };
    const SPECIES = {
      jacaranda: { c: ['#a07fc8', '#ad8bd2', '#9273bb', '#b897d8'], r: [4, 6.5], h: [6, 9], flat: 0.55 },
      msasa: { c: ['#5b6a36', '#6c6a3a', '#7a5f3a', '#56643a'], r: [3.5, 6], h: [5, 9], flat: 0.5 },
      flamboyant: { c: ['#4f6b30', '#58722f', '#5f7a34'], r: [4.5, 7], h: [5, 7], flat: 0.42 },
      garden: { c: ['#3f5a2c', '#4b6630', '#36502a', '#567238'], r: [2.5, 4.5], h: [4, 7], flat: 0.8 },
      gum: { c: ['#7d8a68', '#6e7d5e', '#8a9473'], r: [3, 4.5], h: [14, 22], flat: 1.3 },
    };
    const treeHash = new Hash(20);
    function addTree(x, z, sp, scale = 1) {
      if (inBox(x, z, 10)) return;
      const s = SPECIES[sp];
      const r = lerp(s.r[0], s.r[1], rnd()) * scale, h = lerp(s.h[0], s.h[1], rnd()) * scale;
      T.pos.push(x, surfY(x, z), z, rnd() * 6.28);
      T.shape.push(r, r * s.flat * (0.8 + rnd() * 0.4), h, 0);
      tc.set(pick(s.c)).multiplyScalar(0.85 + rnd() * 0.3);
      T.col.push(tc.r * 255, tc.g * 255, tc.b * 255);
    }
    const treeFree = (x, z, r) => {
      if (roadClear(x, z) < 1.2) return false;
      for (const o of occ.near(x, z)) if (Math.hypot(o.x - x, o.z - z) < o.r + r * 0.4) return false;
      return true;
    };
    // street trees
    for (const r of roads) {
      if (r.c < 3) continue;
      const p = r.p;
      let acc = rnd() * 16;
      const avenue = r.c === 5;
      for (let i = 2; i < p.length; i += 2) {
        const ax = p[i - 2], az = p[i - 1], bx = p[i], bz = p[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 1) continue;
        const tx = (bx - ax) / L, tz = (bz - az) / L;
        for (; acc < L; acc += 15 + rnd() * 6) {
          const x0 = ax + tx * acc, z0 = az + tz * acc;
          const k = smooth(0.08, 0.9, density(x0, z0));
          if (k > 0.75 || rnd() > (1 - k) * 0.85) continue;
          const jac = avenue && k < 0.55 && (Math.abs(Math.round(r.p[0] * 13 + r.p[1] * 7)) % 3 === 0);
          for (const side of [1, -1]) {
            const off = r.w / 2 + 2.6 + rnd();
            const x = x0 + tz * side * off, z = z0 - tx * side * off;
            if (!okClass(clsAt(x, z)) || !treeFree(x, z, 3)) continue;
            addTree(x, z, jac ? 'jacaranda' : rnd() < 0.5 ? 'flamboyant' : 'msasa');
          }
        }
        acc -= L;
      }
    }
    // garden trees around houses
    for (const [hx, hz, w, d, ang] of houses) {
      const k = smooth(0.08, 0.9, density(hx, hz));
      const n = k > 0.66 ? (rnd() < 0.2 ? 1 : 0) : Math.round(lerp(2.6, 0.6, k) * rnd() + 0.2);
      for (let q = 0; q < n; q++) {
        const a = rnd() * Math.PI * 2, rr = Math.max(w, d) * 0.6 + 3 + rnd() * lerp(18, 4, k);
        const x = hx + Math.cos(a) * rr, z = hz + Math.sin(a) * rr;
        if (!okClass(clsAt(x, z)) || !treeFree(x, z, 2.5)) continue;
        const u = rnd();
        addTree(x, z, k < 0.4 && u < 0.18 ? 'jacaranda' : k < 0.3 && u < 0.3 ? 'gum' : u < 0.55 ? 'garden' : 'msasa', k > 0.6 ? 0.8 : 1);
      }
    }
    // area trees from the class map (one texel = 144 m²)
    {
      const per = { [CLS.wood]: 320, [CLS.park]: 600, [CLS.golf]: 900, [CLS.cem]: 600, [CLS.inst]: 1400, [CLS.none]: 12000, [CLS.vlei]: 20000, [CLS.farm]: 20000, [CLS.mil]: 8000 };
      for (let j = 0; j < RES; j++)
        for (let i = 0; i < RES; i++) {
          const c = cls[j * RES + i];
          const a = per[c];
          if (!a || rnd() > (PX * PX) / a) continue;
          const x = (i + rnd()) * PX - EXT, z = (j + rnd()) * PX - EXT;
          if (c === CLS.none && Math.hypot(x, z) > 9000) continue;
          if (!treeFree(x, z, 3)) continue;
          addTree(x, z, c === CLS.golf && rnd() < 0.4 ? 'gum' : c === CLS.park && rnd() < 0.25 ? 'jacaranda' : 'msasa', c === CLS.wood ? 1.1 : 1);
        }
    }
    const nT = T.pos.n / 4;
    {
      // crown: hexagonal bipyramid (8 verts, smooth normals); trunk: open 3-sided prism. aPart: 0 trunk, 1 crown
      const P = [], N = [], A = [], I = [];
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2, x = Math.cos(a), z = Math.sin(a);
        P.push(x * 0.12, 0, z * 0.12, x * 0.09, 1, z * 0.09);
        N.push(x, 0, z, x, 0, z);
        A.push(0, 0);
      }
      for (let k = 0; k < 3; k++) {
        const a = k * 2, b = ((k + 1) % 3) * 2;
        I.push(a, b, b + 1, a, b + 1, a + 1);
      }
      const c0 = P.length / 3;
      P.push(0, 1, 0, 0, -0.55, 0);
      N.push(0, 1, 0, 0, -1, 0);
      A.push(1, 1);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.3;
        P.push(Math.cos(a), 0, Math.sin(a));
        N.push(Math.cos(a), 0.15, Math.sin(a));
        A.push(1);
      }
      for (let k = 0; k < 6; k++) {
        const a = c0 + 2 + k, b = c0 + 2 + ((k + 1) % 6);
        I.push(c0, b, a, c0 + 1, a, b);
      }
      const treeMat = patched({ color: '#ffffff' }, { ...U, uShrinkFar: { value: 2700 } }, (s) => {
        s.vertexShader = s.vertexShader
          .replace('#include <common>', `#include <common>
            attribute vec4 iPos; attribute vec4 iShape; attribute vec3 iCol; attribute float aPart; varying vec3 vCol; uniform float uShrinkFar; uniform float uTime;`)
          .replace('#include <beginnormal_vertex>', `
            float ca = cos(iPos.w), sa = sin(iPos.w);
            vec3 objectNormal = normal;
            objectNormal.xz = mat2(ca, -sa, sa, ca) * objectNormal.xz;
            // light the crown like a soft blob: bias normals upward
            if (aPart > 0.5) objectNormal = normalize(objectNormal + vec3(0.0, 0.6, 0.0));`)
          .replace('#include <begin_vertex>', `
            float r = iShape.x, ch = iShape.y, th = iShape.z;
            float fadeFar = smoothstep(uShrinkFar * 0.8, uShrinkFar, length(iPos.xz - cameraPosition.xz));
            vec3 lp;
            if (aPart < 0.5) { lp = vec3(position.x * r * 0.9, position.y * th * 0.75 - 1.0, position.z * r * 0.9); vCol = vec3(0.32, 0.27, 0.22); }
            else { lp = vec3(position.x * r, th * 0.62 + position.y * ch + ch * 0.4, position.z * r); vCol = iCol; }
            lp.xz = mat2(ca, -sa, sa, ca) * lp.xz;
            lp *= 1.0 - fadeFar;
            vec3 transformed = iPos.xyz + lp;`);
        s.fragmentShader = s.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vCol;')
          .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( vCol, 1.0 );');
      });
      const tP = T.pos.a, tS = T.shape.a, tC = new Uint8Array(T.col);
      const m = chunkInstances(nT, (i) => Math.floor(tP[i * 4] / CH) * 1000 + Math.floor(tP[i * 4 + 2] / CH));
      for (const list of m.values()) {
        const n = list.length;
        const pos = new Float32Array(n * 4), shape = new Float32Array(n * 4), col = new Uint8Array(n * 3);
        let cx = 0, cz = 0;
        list.forEach((s, k) => {
          pos.set(tP.subarray(s * 4, s * 4 + 4), k * 4);
          shape.set(tS.subarray(s * 4, s * 4 + 4), k * 4);
          col.set(tC.subarray(s * 3, s * 3 + 3), k * 3);
          (cx += tP[s * 4]), (cz += tP[s * 4 + 2]);
        });
        (cx /= n), (cz /= n);
        let rad = 0;
        for (let k = 0; k < n; k++) rad = Math.max(rad, Math.hypot(pos[k * 4] - cx, pos[k * 4 + 2] - cz) + 12);
        const g = new THREE.InstancedBufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
        g.setAttribute('aPart', new THREE.Float32BufferAttribute(A, 1));
        g.setIndex(I);
        g.setAttribute('iPos', new THREE.InstancedBufferAttribute(pos, 4));
        g.setAttribute('iShape', new THREE.InstancedBufferAttribute(shape, 4));
        g.setAttribute('iCol', new THREE.InstancedBufferAttribute(col, 3, true));
        g.instanceCount = n;
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, 10, cz), rad + 25);
        const mesh = new THREE.Mesh(g, treeMat);
        mesh.name = 'sub-trees';
        const ch = { mesh, x: cx, z: cz, r: rad, d: 0, tree: true };
        aoSkip(mesh, () => ch.d < 700);
        chunks.push(ch);
        group.add(mesh);
      }
    }

    busy += performance.now() - (this._t || t0);
    await pause();
    this._t = performance.now();
    // ---------------------------------------------------------------------------------------------------------------
    // 7. National Sports Stadium bowl, kopje boulders
    // ---------------------------------------------------------------------------------------------------------------
    {
      const mat = new THREE.MeshLambertMaterial({ color: '#b9b2a6' });
      const [sx, sz] = [-6009, -894];
      const prof = [new THREE.Vector2(88, 0), new THREE.Vector2(92, 0), new THREE.Vector2(122, 22), new THREE.Vector2(124, 30), new THREE.Vector2(118, 30), new THREE.Vector2(86, 3)];
      const bowl = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), mat);
      bowl.scale.set(1, 1, 0.82);
      bowl.position.set(sx, surfY(sx, sz) - 0.5, sz);
      const roofMat = new THREE.MeshLambertMaterial({ color: '#d8d6d0', side: THREE.DoubleSide });
      const canopy = new THREE.Mesh(new THREE.CylinderGeometry(126, 112, 6, 48, 1, true, -0.9, 1.8), roofMat);
      canopy.position.set(sx, surfY(sx, sz) + 30, sz);
      canopy.scale.set(1, 1, 0.82);
      group.add(bowl, canopy);

      const r = mulberry(77);
      const geo = new THREE.DodecahedronGeometry(1, 0);
      const bm = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: '#9d948a', flatShading: true }), 900);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), eu = new THREE.Euler(), v = new THREE.Vector3();
      let k = 0;
      for (const [hx, hz, hr, hh] of HILLS) {
        const n = Math.round(hh * 4);
        for (let i = 0; i < n && k < 900; i++) {
          const a = r() * Math.PI * 2, d = Math.sqrt(r()) * hr * 0.7;
          const x = hx + Math.cos(a) * d, z = hz + Math.sin(a) * d;
          if (clsAt(x, z) === CLS.res && r() < 0.7) continue;
          const s = 2 + r() * r() * 9;
          sc.set(s * (1 + r()), s * (0.6 + r() * 0.6), s * (1 + r()));
          q.setFromEuler(eu.set(r() * 0.4, r() * 6, r() * 0.4));
          m4.compose(v.set(x, surfY(x, z) + s * 0.25, z), q, sc);
          bm.setMatrixAt(k++, m4);
          // balancing stacks at Epworth
          if (hh === 34 && r() < 0.3) {
            const s2 = s * (0.5 + r() * 0.4);
            m4.compose(v.set(x + r() * 2, surfY(x, z) + s * 0.25 + sc.y * 0.8 + s2 * 0.5, z), q.setFromEuler(eu.set(r() * 0.6, r() * 6, r() * 0.6)), sc.set(s2 * 1.3, s2, s2 * 1.2));
            if (k < 900) bm.setMatrixAt(k++, m4);
          }
        }
      }
      bm.count = k;
      bm.computeBoundingSphere();
      group.add(bm);
    }

    busy += performance.now() - (this._t || t0);
    await pause();
    this._t = performance.now();
    // ---------------------------------------------------------------------------------------------------------------
    // 8. Horizon: a ring of distant ground rising into granite domes and ridges (Domboshava, Ngomakurira, the Iron
    //    Mask range toward Mazowe, Seke), with its own thinner fog so the hill-tops stand out of the haze
    // ---------------------------------------------------------------------------------------------------------------
    {
      const DOMES = [
        [...ll(-17.617, 31.137), 1600, 150], // Domboshava
        [...ll(-17.65, 31.18), 1100, 110],
        [...ll(-17.536, 31.243), 2200, 190], // Ngomakurira
        [...ll(-17.58, 31.3), 1500, 140],
        [...ll(-17.77, 31.25), 2500, 80], // Chishawasha hills
        [...ll(-18.05, 31.11), 3500, 70], // Seke / Chitungwiza rise
        [...ll(-17.96, 30.82), 2600, 90], // hills around Lake Chivero
        [...ll(-17.62, 30.95), 2800, 70],
      ];
      // Iron Mask range: a ridge line north of Mazowe
      const RIDGE = [ll(-17.5, 30.85), ll(-17.47, 30.95), ll(-17.45, 31.05), ll(-17.47, 31.12)];
      const hillY = (x, z) => {
        const r = Math.hypot(x, z);
        let y = 0;
        for (const [hx, hz, hr, hh] of DOMES) {
          const d2 = ((x - hx) ** 2 + (z - hz) ** 2) / (hr * hr);
          if (d2 < 1) y += hh * Math.pow(1 - d2, 1.4);
        }
        for (let i = 1; i < RIDGE.length; i++) {
          const [ax, az] = RIDGE[i - 1], [bx, bz] = RIDGE[i];
          const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
          const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
          y = Math.max(y, 190 * Math.exp(-((d / 2600) ** 2)) * (0.75 + 0.25 * Math.sin(t * 9 + 1)));
        }
        // low ridges all round, so no direction has a ruler-flat horizon
        const a = Math.atan2(z, x);
        const n = 0.55 + 0.45 * Math.sin(a * 7 + 1.3) * Math.sin(a * 3 - 0.4) + 0.35 * Math.sin(x / 2300 + 2.1) * Math.cos(z / 2900 - 1.3);
        y += Math.max(0, n) * 70 * smooth(22000, 30000, r);
        // vertical exaggeration: real highveld kopjes are a few pixels at 25 km
        return 2.6 * y * smooth(17500, 21000, r) - 3;
      };
      const NA = 384, NR = 44, R0 = 11000, R1 = 44000;
      const pos = new Float32Array(NA * NR * 3);
      const hh = new Float32Array(NA * NR);
      for (let j = 0; j < NR; j++) {
        const t = j / (NR - 1), r = R0 * Math.pow(R1 / R0, t);
        for (let i = 0; i < NA; i++) {
          const a = (i / NA) * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
          const y = hillY(x, z);
          const k = (j * NA + i) * 3;
          (pos[k] = x), (pos[k + 1] = y), (pos[k + 2] = z), (hh[j * NA + i] = y);
        }
      }
      const idx = [];
      for (let j = 0; j < NR - 1; j++)
        for (let i = 0; i < NA; i++) {
          const a = j * NA + i, b = j * NA + ((i + 1) % NA), c = a + NA, d = b + NA;
          idx.push(a, c, b, b, c, d);
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const mat = patched({ color: '#ffffff' }, { ...U }, (s) => {
        s.vertexShader = s.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vW;')
          .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        s.fragmentShader = s.fragmentShader
          .replace('#include <common>', `#include <common>\nvarying vec3 vW;\nuniform float uNight;\n${GLSL_COMMON}`)
          .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
            float n = vn(vW.xz * 0.004) * 0.6 + vn(vW.xz * 0.02) * 0.4;
            vec3 granite = ${lin('#8e877d')}, bush = ${lin('#5e6340')}, veld = ${lin('#9b8a62')};
            vec3 wn = normalize(cross(dFdx(vW), dFdy(vW)));
            float steep = 1.0 - smoothstep(0.75, 0.95, abs(wn.y));
            vec3 c = mix(mix(veld, bush, n), granite, clamp(steep * 1.4 + smoothstep(90.0, 160.0, vW.y) * 0.6, 0.0, 1.0));
            vec4 diffuseColor = vec4(c, 1.0);`)
          .replace('#include <fog_fragment>', `
            #ifdef USE_FOG
              float hk = smoothstep(4.0, 260.0, vW.y);
              float fd = fogDensity * mix(1.0, 0.11, hk);
              float ff = 1.0 - exp(-fd * fd * vFogDepth * vFogDepth);
              gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor * mix(1.0, 0.92 + 0.1 * (1.0 - uNight), hk), ff);
            #endif`);
      });
      const ring = new THREE.Mesh(g, mat);
      ring.name = 'sub-horizon';
      ring.frustumCulled = false;
      ring.renderOrder = -1;
      aoSkip(ring, () => false);
      group.add(ring);
    }

    busy += performance.now() - (this._t || t0);
    await pause();
    this._t = performance.now();
    // ---------------------------------------------------------------------------------------------------------------
    // 9. Night lights: one additive point cloud. kind 0 street · 1 house · 2 high-mast · 3 airport (own supply) · 4 far
    // ---------------------------------------------------------------------------------------------------------------
    const L = { pos: new F32(1 << 19), col: [], info: new F32(1 << 19) };
    const SODIUM = new THREE.Color('#ff9238'), LED = new THREE.Color('#dfe8ff'), WARM = new THREE.Color('#ffc27a'), MAST = new THREE.Color('#ffa64a');
    const addL = (x, y, z, c, size, kind, k = 1) => {
      L.pos.push(x, y, z);
      L.col.push(Math.min(255, c.r * 255 * k), Math.min(255, c.g * 255 * k), Math.min(255, c.b * 255 * k));
      L.info.push(size, kind, rnd());
    };
    for (const r of roads) {
      const k = smooth(0.08, 0.9, density(r.p[0], r.p[1]));
      const majorRd = r.c < 4;
      const spacing = majorRd ? 42 : 55;
      const pLit = majorRd ? 0.8 : r.c === 4 ? 0.7 : k > 0.66 ? 0.12 : lerp(0.32, 0.22, k);
      if (!majorRd && rnd() > 0.65) continue; // whole streets with no working lights
      let acc = rnd() * spacing, side = 1;
      for (let i = 2; i < r.p.length; i += 2) {
        const ax = r.p[i - 2], az = r.p[i - 1], bx = r.p[i], bz = r.p[i + 1];
        const len = Math.hypot(bx - ax, bz - az) || 1;
        const nx = (bz - az) / len, nz = -(bx - ax) / len;
        for (; acc < len; acc += spacing) {
          side = majorRd ? -side : 1;
          if (rnd() > pLit) continue;
          const t = acc / len, off = r.w / 2 + 0.5;
          const x = ax + (bx - ax) * t + nx * off * side, z = az + (bz - az) * t + nz * off * side;
          if (inBox(x, z, 20)) continue;
          addL(x, surfY(x, z) + 8.5, z, r.c === 0 && rnd() < 0.3 ? LED : SODIUM, 26, 0);
        }
        acc -= len;
      }
    }
    // houses: security lights, kitchen windows
    for (let i = 0; i < nB; i++) {
      const x = B.pos.a[i * 4], y = B.pos.a[i * 4 + 1], z = B.pos.a[i * 4 + 2], type = B.info.a[i * 2];
      const k = smooth(0.08, 0.9, density(x, z));
      const p = type === 2 ? 0.45 : type === 1 ? 0.95 : lerp(0.75, 0.5, k);
      if (rnd() > p) continue;
      const c = type === 2 ? (rnd() < 0.5 ? LED : SODIUM) : rnd() < 0.2 ? LED : WARM;
      // at the front door / gate, outside the walls (the house faces its street along local z)
      const ang = B.pos.a[i * 4 + 3], hw = B.size.a[i * 4] / 2, hd = B.size.a[i * 4 + 1] / 2;
      const lx = (rnd() - 0.5) * hw * 1.6, lz = (rnd() < 0.5 ? -1 : 1) * (hd + 1.5);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const wx = x + ca * lx + sa * lz, wz = z - sa * lx + ca * lz;
      const hgt = type === 1 ? B.size.a[i * 4 + 2] * (0.2 + 0.7 * rnd()) : 2.6;
      addL(wx, y + hgt, wz, c, type === 2 ? 22 : type === 1 ? 14 : lerp(13, 9, k), 1, type === 1 ? 1.1 : lerp(0.95, 0.7, k));
    }
    // Apollo high-mast lights over the high-density suburbs
    for (let z = -EXT; z < EXT; z += 360)
      for (let x = -EXT; x < EXT; x += 360) {
        const jx = x + rnd() * 200, jz = z + rnd() * 200;
        if (clsAt(jx, jz) !== CLS.res || density(jx, jz) < 0.78 || nearAt(jx, jz) < 0.2 || inBox(jx, jz, 100)) continue;
        addL(jx, surfY(jx, jz) + 30, jz, MAST, 70, 2, 1.3);
      }
    // runway edge lights, taxiway blues
    for (const l of lines) {
      if (l.k !== 2 && l.k !== 4) continue;
      const c = l.k === 2 ? new THREE.Color('#fff4dc') : new THREE.Color('#5d8cff');
      const sp = l.k === 2 ? 60 : 45;
      let acc = 0;
      for (let i = 2; i < l.p.length; i += 2) {
        const ax = l.p[i - 2], az = l.p[i - 1], bx = l.p[i], bz = l.p[i + 1];
        const len = Math.hypot(bx - ax, bz - az) || 1, nx = (bz - az) / len, nz = -(bx - ax) / len;
        for (; acc < len; acc += sp)
          for (const s of [1, -1]) {
            const x = ax + ((bx - ax) * acc) / len + nx * s * (l.w / 2 + 1), z = az + ((bz - az) * acc) / len + nz * s * (l.w / 2 + 1);
            addL(x, surfY(x, z) + 0.6, z, c, 10, 3, 1.4);
          }
        acc -= len;
      }
    }
    // Chitungwiza and Ruwa: distant glows beyond the map
    for (const [lat, lon, rx, rz, n] of [[-18.0, 31.07, 4500, 3500, 5000], [-17.89, 31.24, 2500, 2000, 1300], [-17.62, 31.1, 2000, 1500, 500]]) {
      const [cx, cz] = ll(lat, lon);
      for (let i = 0; i < n; i++) {
        const a = rnd() * 6.28, d = Math.sqrt(rnd());
        const x = cx + Math.cos(a) * d * rx, z = cz + Math.sin(a) * d * rz;
        addL(x, 6, z, rnd() < 0.7 ? SODIUM : WARM, 40, 4, 0.8);
      }
    }
    {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(L.pos.get(), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(L.col), 3, true));
      g.setAttribute('aInfo', new THREE.BufferAttribute(L.info.get(), 3));
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...THREE.UniformsLib.fog, ...U, uScale: { value: 800 } },
        vertexShader: /* glsl */ `
          attribute vec3 aInfo; varying vec3 vCol; varying float vK; varying float vFogDepth; varying float vSz;
          uniform float uNight, uScale;
          ${GLSL_COMMON}
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            float kind = aInfo.y, rnd = aInfo.z;
            float on = step(0.12 + rnd * 0.35, uNight);
            float cut = kind == 3.0 ? 0.0 : powerCut(position.xz) * (kind == 4.0 ? 0.0 : 1.0);
            // in a cut, a few houses still glow on solar / generators
            float survive = kind == 1.0 ? step(rnd, 0.08) : 0.0;
            on *= 1.0 - cut * (1.0 - survive);
            float dist = -mv.z;
            float px = aInfo.x * uScale / dist;
            float sz = clamp(px, 2.0, kind == 2.0 ? 64.0 : 40.0);
            vK = on * min(1.0, px / 2.0 + 0.25) * (cut > 0.5 ? 0.7 : 1.0);
            vCol = color * (cut > 0.5 ? vec3(0.8, 0.9, 1.25) : vec3(1.0));
            gl_PointSize = on > 0.0 ? sz : 0.0;
            vSz = sz;
            vFogDepth = dist;
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vCol; varying float vK; varying float vFogDepth; varying float vSz;
          uniform vec3 fogColor; uniform float fogDensity;
          void main() {
            vec2 q = gl_PointCoord * 2.0 - 1.0;
            float r2 = dot(q, q);
            if (r2 > 1.0) discard;
            // small (distant) sprites are all core, big ones a bright point in a soft pool
            float core = exp(-r2 * mix(5.0, 40.0, smoothstep(3.0, 16.0, vSz))) * 2.4, halo = exp(-r2 * 5.0) * 0.32;
            float fog = exp(-pow(fogDensity * 0.55 * vFogDepth, 2.0));
            gl_FragColor = vec4(vCol * (core + halo) * vK * fog, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: true,
        vertexColors: true,
      });
      const pts = new THREE.Points(g, mat);
      pts.frustumCulled = false;
      pts.renderOrder = 3;
      aoSkip(pts, () => false);
      this.lights = pts;
      this.lightsMat = mat;
      group.add(pts);
    }

    busy += performance.now() - (this._t || t0);
    await pause();
    this._t = performance.now();
    // ---------------------------------------------------------------------------------------------------------------
    // 10. Traffic on the main roads: boxes by day, head- and tail-light dots by night; each car loops its own segment
    // ---------------------------------------------------------------------------------------------------------------
    {
      const seg = new F32(1 << 16), mv = new F32(1 << 16), cc = [];
      const CAR = ['#e8e8e6', '#c9ccd0', '#2c2f33', '#8c1d1d', '#1d3b6e', '#b8b9b4', '#f2f2ee', '#5a5f63', '#d9c9a0'];
      for (const r of roads) {
        if (r.c > 3) continue;
        for (let i = 2; i < r.p.length; i += 2) {
          const ax = r.p[i - 2], az = r.p[i - 1], bx = r.p[i], bz = r.p[i + 1];
          const len = Math.hypot(bx - ax, bz - az);
          if (len < 25) continue;
          const nCars = Math.floor((len / 130) * (r.c <= 1 ? 1.6 : 0.8) + rnd());
          for (let k = 0; k < nCars; k++) {
            const dir = rnd() < 0.5 ? 1 : -1;
            seg.push(ax, az, bx, bz);
            mv.push((9 + rnd() * 8) / len, rnd(), dir * (r.w / 4), surfY(ax, az), surfY(bx, bz));
            tc.set(rnd() < 0.15 ? '#f0f0ea' : pick(CAR)); // kombis are white
            cc.push(tc.r * 255, tc.g * 255, tc.b * 255);
          }
        }
      }
      const n = seg.n / 4;
      this.carCount = n;
      const sA = seg.get(), mA = mv.get();
      const motion = /* glsl */ `
        attribute vec4 iSeg; attribute vec4 iMv; attribute float iYb;
        uniform float uTime;
        vec3 carPos(out vec2 fwd) {
          float t = fract(iMv.y + uTime * iMv.x);
          float dir = sign(iMv.z);
          vec2 a = iSeg.xy, b = iSeg.zw;
          vec2 d = normalize(b - a) * dir;
          fwd = d;
          vec2 p = mix(dir > 0.0 ? a : b, dir > 0.0 ? b : a, t);
          vec2 left = vec2(d.y, -d.x);
          p += left * abs(iMv.z);
          float y = mix(dir > 0.0 ? iMv.w : iYb, dir > 0.0 ? iYb : iMv.w, t);
          return vec3(p.x, y, p.y);
        }`;
      // bodies
      const box = new THREE.BoxGeometry(4.3, 1.5, 1.8).translate(0, 0.95, 0);
      const g = new THREE.InstancedBufferGeometry();
      g.index = box.index;
      g.setAttribute('position', box.getAttribute('position'));
      g.setAttribute('normal', box.getAttribute('normal'));
      g.setAttribute('iSeg', new THREE.InstancedBufferAttribute(sA, 4));
      const iMv = new Float32Array(n * 4), iYb = new Float32Array(n);
      for (let i = 0; i < n; i++) iMv.set(mA.subarray(i * 5, i * 5 + 4), i * 4), (iYb[i] = mA[i * 5 + 4]);
      g.setAttribute('iMv', new THREE.InstancedBufferAttribute(iMv, 4));
      g.setAttribute('iYb', new THREE.InstancedBufferAttribute(iYb, 1));
      g.setAttribute('iCol', new THREE.InstancedBufferAttribute(new Uint8Array(cc), 3, true));
      g.instanceCount = n;
      const carMat = patched({ color: '#ffffff' }, { ...U }, (s) => {
        s.vertexShader = s.vertexShader
          .replace('#include <common>', `#include <common>\nattribute vec3 iCol; varying vec3 vCol; varying vec3 vLoc;\n${motion}`)
          .replace('#include <beginnormal_vertex>', 'vec2 fwd; vec3 cp = carPos(fwd); vec3 objectNormal = vec3(normal.x * fwd.x - normal.z * fwd.y, normal.y, normal.x * fwd.y + normal.z * fwd.x);')
          .replace('#include <begin_vertex>', `
            float fadeFar = smoothstep(2600.0, 3200.0, length(cp.xz - cameraPosition.xz));
            vec3 lp = position * (1.0 - fadeFar);
            vec3 transformed = cp + vec3(lp.x * fwd.x - lp.z * fwd.y, lp.y, lp.x * fwd.y + lp.z * fwd.x);
            vCol = iCol; vLoc = position;`);
        s.fragmentShader = s.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vCol; varying vec3 vLoc; uniform float uNight;')
          .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
            vec3 c = vCol;
            if (vLoc.y > 1.35 && abs(vLoc.x) < 1.6) c *= 0.35; // glasshouse
            vec4 diffuseColor = vec4(c, 1.0);`)
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            if (vLoc.x > 2.1 && vLoc.y < 1.2) totalEmissiveRadiance += vec3(1.6, 1.5, 1.2) * uNight * 2.0;
            if (vLoc.x < -2.1 && vLoc.y < 1.3) totalEmissiveRadiance += vec3(1.5, 0.05, 0.03) * uNight * 1.5;`);
      });
      const cars = new THREE.Mesh(g, carMat);
      cars.name = 'sub-cars';
      cars.frustumCulled = false;
      aoSkip(cars, () => false);
      group.add(cars);

      // light dots: two per car (head white, tail red)
      const lp = new Float32Array(n * 2 * 3), lseg = new Float32Array(n * 2 * 4), lmv = new Float32Array(n * 2 * 4), lyb = new Float32Array(n * 2), end = new Float32Array(n * 2);
      for (let i = 0; i < n; i++)
        for (let e = 0; e < 2; e++) {
          const k = i * 2 + e;
          lseg.set(sA.subarray(i * 4, i * 4 + 4), k * 4);
          lmv.set(iMv.subarray(i * 4, i * 4 + 4), k * 4);
          lyb[k] = iYb[i];
          end[k] = e ? -1 : 1;
        }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
      lg.setAttribute('iSeg', new THREE.BufferAttribute(lseg, 4));
      lg.setAttribute('iMv', new THREE.BufferAttribute(lmv, 4));
      lg.setAttribute('iYb', new THREE.BufferAttribute(lyb, 1));
      lg.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
      const lmat = new THREE.ShaderMaterial({
        uniforms: { ...THREE.UniformsLib.fog, ...U, uScale: { value: 800 } },
        vertexShader: /* glsl */ `
          ${motion}
          attribute float aEnd; varying vec3 vCol; varying float vK; varying float vFogDepth;
          uniform float uNight, uScale;
          void main() {
            vec2 fwd; vec3 p = carPos(fwd);
            p.xz += fwd * aEnd * 2.3; p.y += 0.8;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            float dist = -mv.z;
            float px = 9.0 * uScale / dist;
            gl_PointSize = uNight > 0.1 ? clamp(px, 1.5, 22.0) : 0.0;
            vK = smoothstep(0.1, 0.5, uNight) * min(1.0, px / 2.0 + 0.3);
            vCol = aEnd > 0.0 ? vec3(1.0, 0.92, 0.75) : vec3(1.0, 0.08, 0.04) * 0.9;
            vFogDepth = dist;
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vCol; varying float vK; varying float vFogDepth;
          uniform vec3 fogColor; uniform float fogDensity;
          void main() {
            vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q);
            if (r2 > 1.0) discard;
            float fog = exp(-pow(fogDensity * 0.6 * vFogDepth, 2.0));
            gl_FragColor = vec4(vCol * (exp(-r2 * 30.0) * 2.0 + exp(-r2 * 6.0) * 0.25) * vK * fog, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: true,
      });
      const lpts = new THREE.Points(lg, lmat);
      lpts.frustumCulled = false;
      lpts.renderOrder = 3;
      aoSkip(lpts, () => false);
      this.carLights = lpts;
      this.carLightsMat = lmat;
      group.add(lpts);
    }

    this.group = group;
    this.chunks = chunks;
    this.counts = { buildings: nB, trees: nT, lights: L.pos.n / 3 };
    this.acc = 1;
    ctx.patchLampMaterials?.(group);
    ctx.patchShadowMaterials?.(group);
    this.built = true;
    busy += performance.now() - (this._t || t0);
    console.log(`[harare] suburbs: ${roads.length} roads, ${nB} buildings, ${nT} trees, ${L.pos.n / 3} lights, ${this.carCount} cars, ${chunks.length} chunks in ${Math.round(busy)} ms of work over ${Math.round(performance.now() - t0)} ms`);
  },

  update(dt, ctx) {
    if (!this.built) return;
    const U = this.U;
    U.uTime.value += dt;
    // the sky box is only 10 km across: keep it centred on the camera so the suburbs never fly out of it
    if (ctx.sky) ctx.sky.position.copy(ctx.camera.position);
    U.uNight.value = ctx.getNightness();
    U.uCut.value = Math.floor(ctx.getHour() / 2);
    const night = U.uNight.value > 0.1;
    this.lights.visible = night;
    this.carLights.visible = night;
    const h = ctx.renderer.getDrawingBufferSize(this._v || (this._v = new THREE.Vector2())).y;
    const scale = h / (2 * Math.tan((ctx.camera.fov * Math.PI) / 360));
    this.lightsMat.uniforms.uScale.value = scale;
    this.carLightsMat.uniforms.uScale.value = scale;
    // chunk LOD every few frames
    if ((this.acc += dt) < 0.2) return;
    this.acc = 0;
    const c = ctx.camera.position;
    for (const ch of this.chunks) {
      ch.d = Math.max(0, Math.hypot(ch.x - c.x, ch.z - c.z, c.y * 0.3) - ch.r);
      if (ch.tree) ch.mesh.visible = ch.d < 2700;
      else {
        ch.mesh.visible = ch.d < 4700;
        const g = ch.d > 1400 ? ch.far : ch.near;
        if (ch.mesh.geometry !== g) ch.mesh.geometry = g;
      }
    }
  },
};

// --- the city carpet ----------------------------------------------------------------------------------------------------
function CARPET_GLSL() {
  return /* glsl */ `
  vec3 carpet(vec2 p, float dist) {
    float df = 1.0 - smoothstep(900.0, 5000.0, dist); // fine detail fades into the haze
    vec2 jit = (vec2(vn(p * 0.045), vn(p * 0.045 + 17.3)) - 0.5) * 18.0;
    vec2 uv = (p + jit + uExt) / (2.0 * uExt);
    int c = int(texture(tCls, uv).r * 255.0 + 0.5);
    vec2 uv0 = (p + uExt) / (2.0 * uExt);
    float nearRd = texture(tAux, uv0).r, dens = texture(tDens, uv0).r;
    float k = smoothstep(0.08, 0.9, dens);
    float n1 = vn(p * 0.11), n2 = vn(p * 0.021), n3 = vn(p * 0.7);
    float fine = mix(0.5, n3, df);
    vec3 grass = ${lin('#a8925f')}, earth = ${lin('#9a6b48')}, olive = ${lin('#7f8550')};
    vec3 veld = mix(grass, earth, n2 * 0.55 + (n1 - 0.5) * 0.3);
    veld = mix(veld, olive, smoothstep(0.55, 0.85, vn(p * 0.006 + 3.0)) * 0.6);
    vec3 col = veld;
    float trees = 0.12;
    vec3 canopy = ${lin('#4c5a31')};
    if (c == 1) {
      vec3 lawn = mix(${lin('#7a8a49')}, ${lin('#93905a')}, n2);
      vec3 yard = mix(${lin('#a8866a')}, ${lin('#9a7056')}, n1);
      col = mix(lawn, yard, smoothstep(0.2, 0.75, k));
      col = mix(col, veld, (1.0 - nearRd) * 0.5 * (1.0 - k));
      trees = mix(0.46, 0.05, k);
      // swimming pools in the leafy north
      vec2 cell = floor(p / 47.0), f = fract(p / 47.0);
      float hp = h12(cell + 3.1);
      if (hp < 0.4 * (1.0 - k * 1.6) && df > 0.0) {
        vec2 cc = vec2(0.25 + 0.5 * h12(cell + 7.0), 0.25 + 0.5 * h12(cell + 9.0));
        vec2 q = abs(f - cc) * 47.0;
        if (q.x < 4.5 && q.y < 2.2) col = mix(col, ${lin('#4aa3c4')}, df);
      }
      // swept-earth yards, cooking-fire soot and backyard shacks in the high-density grids
      col *= 1.0 - 0.12 * k * step(0.7, h12(floor(p / 6.0)));
    } else if (c == 2) {
      col = mix(${lin('#8f8a80')}, ${lin('#a69f92')}, n1);
      col = mix(col, ${lin('#5f5a52')}, step(0.82, vn(p * 0.05)) * 0.6);
      trees = 0.03;
    } else if (c == 3) {
      col = mix(${lin('#8d8a84')}, ${lin('#9d978c')}, n1);
      col *= 0.94 + 0.06 * step(0.5, fract(p.x / 5.0)) * df; // parking bays
      trees = 0.06;
    } else if (c == 4 || c == 10) {
      col = mix(${lin('#7c8a48')}, ${lin('#9a9058')}, n2);
      if (c == 10) col = mix(col, ${lin('#b4ada0')}, step(0.75, h12(floor(p / 2.5))) * df * 0.6);
      trees = c == 4 ? 0.32 : 0.22;
    } else if (c == 5) {
      float f = vn(p * 0.011);
      float fair = smoothstep(0.38, 0.42, f) * (1.0 - smoothstep(0.6, 0.64, f));
      col = mix(${lin('#7f8e4a')}, ${lin('#5c9a3c')}, fair);
      col = mix(col, ${lin('#d8c9a0')}, step(0.84, vn(p * 0.09)) * fair * 0.9);
      trees = 0.3 * (1.0 - fair);
    } else if (c == 6) {
      col = mix(${lin('#566238')}, ${lin('#7a5e3c')}, smoothstep(0.5, 0.8, vn(p * 0.02)) * 0.7);
      trees = 0.78;
    } else if (c == 7) {
      col = mix(${lin('#3a5f6c')}, ${lin('#4a6e72')}, n1 * 0.6) * (0.9 + 0.1 * fine);
      trees = 0.0;
    } else if (c == 8) {
      col = mix(${lin('#879955')}, ${lin('#a39a62')}, n2);
      trees = 0.03;
    } else if (c == 9) {
      vec2 cell = floor(p / vec2(150.0, 110.0));
      float h = h12(cell);
      col = h < 0.35 ? ${lin('#8a5d3f')} : h < 0.7 ? ${lin('#b49c6c')} : ${lin('#7f8c4a')};
      col *= 0.92 + 0.08 * sin(p.x * 1.4 + p.y * 0.3) * df;
      trees = 0.02;
    } else if (c == 11) {
      col = mix(${lin('#a39c66')}, ${lin('#958f5c')}, step(0.5, fract(p.x / 40.0)) * 0.6 + n1 * 0.4);
      trees = 0.0;
    } else if (c == 12) {
      col = ${lin('#a8a69f')} * (0.95 + 0.05 * step(0.5, fract(p.x / 7.5)) * df);
      trees = 0.0;
    } else if (c == 13) {
      col = ${lin('#786858')};
      trees = 0.0;
    } else if (c == 14) {
      col = mix(${lin('#b59c80')}, ${lin('#958a7e')}, n1);
      trees = 0.02;
    } else if (c == 15) {
      col = mix(${lin('#a98b6a')}, ${lin('#8b9050')}, step(0.5, n2));
      trees = 0.15;
    } else if (c == 16) {
      col = k > 0.5 ? ${lin('#b08c62')} : ${lin('#6f9a45')};
      trees = 0.0;
    } else if (c == 0) {
      // veld fires: October burn scars
      float burn = smoothstep(0.74, 0.78, vn(p * 0.0035 + 11.0));
      col = mix(col, ${lin('#4a4039')} * (0.8 + 0.4 * n1), burn * 0.85);
      trees = 0.1 * (1.0 - burn);
    } else if (c == 17) {
      trees = 0.08;
    }
    // tree crowns from the air: one per 10 m cell (probability = cover), with a sun-side shadow; fades to the average
    // tone in the haze (3D trees stand on top of these up close)
    vec3 avg = mix(col, canopy * 0.95, trees * 0.62);
    if (trees > 0.0 && df > 0.0) {
      vec2 g = p / 10.0, b = floor(g - 0.5);
      float cd = 9.0, sh = 0.0; vec2 id = vec2(0.0);
      for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
        vec2 cc = b + vec2(float(i), float(j));
        if (h12(cc * 1.37 + 0.5) > trees) continue;
        vec2 o = cc + 0.2 + 0.6 * vec2(h12(cc + 3.3), h12(cc + 7.7));
        float r = 0.27 + 0.31 * h12(cc + 9.1);
        vec2 dv = g - o;
        float d = length(dv) / r;
        sh = max(sh, 1.0 - smoothstep(0.75, 1.05, length(dv - vec2(0.16, 0.12)) / r));
        if (d < cd) { cd = d; id = cc; }
      }
      col *= 1.0 - sh * 0.45;
      float hj = h12(id + 21.0);
      vec3 crownC = mix(canopy, ${lin('#5f6b36')}, h12(id + 5.0)) * (1.12 - 0.4 * cd * cd);
      if (c == 1 && hj < 0.2 * (1.0 - k)) crownC = mix(${lin('#9a78c6')}, ${lin('#b293d6')}, h12(id)) * (1.1 - 0.35 * cd * cd); // jacarandas in flower
      if (c == 6 && hj < 0.3) crownC = mix(crownC, ${lin('#7d5f3e')}, 0.6); // msasa flush
      col = mix(col, crownC, 1.0 - smoothstep(0.85, 1.0, cd));
    }
    col = mix(avg, col, df);
    // dust along the streets
    col = mix(col, ${lin('#ab8f72')}, smoothstep(0.75, 1.0, nearRd) * 0.25);
    return col * (0.93 + 0.14 * fine);
  }`;
}
