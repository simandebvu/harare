// js/vehicle-render.js — draws every vehicle (moving or parked) from flat per-vehicle state: two instanced meshes per
// type (sculpted near model < NEAR m, light far model beyond), compacted each frame after a frustum test; one
// clearcoat material for all (paint mask, per-part roughness / metalness, number plates and route boards from the
// decal atlas, dust and rust on old cars, lamp emission driven by per-vehicle lamp state: headlights, tail / brake,
// blinking indicators, police light bars, lit kombi cabins). At night a single additive mesh adds lamp flares and
// headlight pools on the road ahead of each car (and a red wash behind) — no real lights.
import * as THREE from 'three';
import { createTrafficModels } from './traffic-models.js';
import { VEHICLE_TYPES, vehicleGeometry, decalAtlas, ATLAS } from './vehicles.js';
import { NIGHT_GLSL, nightUniforms } from './nightglow.js';

const VERT_HEAD = /* glsl */ `
attribute vec4 aMat;
attribute vec2 aDec;
attribute vec2 aUv;
attribute float aOpt;
attribute vec4 iVar;  // plate cell, option bits, dirt, route
attribute vec4 iLamp; // head, brake, indicator (-1 left, 1 right, 2 hazard), cabin light
varying vec4 vMat;
varying vec2 vDecUv;
flat varying vec2 vDec;
varying vec3 vLocal;
flat varying vec4 vVar;
flat varying vec4 vLampS;
varying vec3 vNgWorld;
float bitOn(float bits, float b) { return mod(floor(bits / b), 2.0); }
`;
const FRAG_HEAD = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uTime;
uniform float uDay;
varying vec4 vMat;
varying vec2 vDecUv;
flat varying vec2 vDec;
varying vec3 vLocal;
flat varying vec4 vVar;
flat varying vec4 vLampS;
float bitOn(float bits, float b) { return mod(floor(bits / b), 2.0); }
float vh(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(vh(i), vh(i + vec3(1, 0, 0)), f.x), mix(vh(i + vec3(0, 1, 0)), vh(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(vh(i + vec3(0, 0, 1)), vh(i + vec3(1, 0, 1)), f.x), mix(vh(i + vec3(0, 1, 1)), vh(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

export function vehicleMaterial() {
  const uTime = { value: 0 }, uDay = { value: 1 };
  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.2, clearcoat: 0.65, clearcoatRoughness: 0.16 });
  const atlas = decalAtlas();
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.uniforms.uDay = uDay;
    sh.uniforms.uAtlas = { value: atlas };
    Object.assign(sh.uniforms, nightUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace(
        '#include <color_vertex>',
        `vColor = color;
        #ifdef USE_INSTANCING_COLOR
          vColor *= mix(vec3(1.0), instanceColor.rgb, aMat.x);
        #endif
        vMat = aMat; vDec = aDec; vDecUv = aUv; vLocal = position; vVar = iVar; vLampS = iLamp;`
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
        if (aOpt > 0.5 && bitOn(iVar.y, aOpt < 1.5 ? 1.0 : aOpt < 2.5 ? 2.0 : 4.0) < 0.5) transformed = vec3(0.0);`
      )
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvNgWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}\n${NIGHT_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float dirt = vVar.z;
        if (vDec.x > 0.5) {
          float cell = vDec.x < 1.5 ? vVar.x : vDec.x < 2.5 ? ${ATLAS.plates}.0 + vVar.w : vDec.y;
          float cx = mod(cell, ${ATLAS.cols}.0), cy = floor(cell / ${ATLAS.cols}.0);
          vec2 auv = vec2((cx + clamp(vDecUv.x, 0.01, 0.99)) / ${ATLAS.cols}.0, 1.0 - (cy + 1.0 - clamp(vDecUv.y, 0.02, 0.98)) / ${ATLAS.rows}.0);
          vec3 t = texture2D(uAtlas, auv).rgb;
          if (vDec.x < 1.5 && vDec.y > 0.5) t *= vec3(1.0, 0.9, 0.42);
          diffuseColor.rgb = t * mix(1.0, 0.75, dirt);
        }
        if (vMat.x > 0.5) {
          // road dust up the lower body, rust blooms on old cars
          float low = 1.0 - smoothstep(0.25, 0.95, vLocal.y);
          float n = vnoise(vLocal * 6.0 + vVar.x);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.33, 0.24), clamp(dirt * (0.25 + low * 0.7) * (0.6 + 0.4 * n), 0.0, 0.85));
          if (vVar.y >= 8.0) {
            // rust: small blooms, mostly low on the body, round the arches and along the edges
            float rn = vnoise(vLocal * 4.3 + 7.0) * 0.55 + vnoise(vLocal * 13.0) * 0.45;
            float edge = smoothstep(0.55, 0.95, abs(vLocal.x) / 0.9);
            float rust = smoothstep(0.74, 0.8, rn + low * 0.2 + edge * 0.06 - 0.06);
            diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.33, 0.14, 0.06), vec3(0.5, 0.25, 0.1), n), rust);
          }
        }`
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(vMat.y, 0.85, vMat.x * dirt * 0.8);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vMat.z * (1.0 - dirt * 0.6);')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.clearcoat *= vMat.x * (1.0 - dirt);')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float lk = vMat.w;
          float head = vLampS.x, brake = vLampS.y, ind = vLampS.z, cab = vLampS.w;
          float blink = step(0.5, fract(uTime * 1.55 + vVar.x * 0.137));
          vec3 em = vec3(0.0);
          if (lk > 0.5 && lk < 1.5) em = vec3(1.0, 0.93, 0.8) * (head * 2.4);
          else if (lk > 1.5 && lk < 2.5) em = vec3(1.0, 0.035, 0.015) * (head * 0.9 + brake * 3.2);
          else if (lk > 2.5 && lk < 6.5) {
            float left = (lk < 3.5 || (lk > 4.5 && lk < 5.5)) ? 1.0 : 0.0;
            float on = ind > 1.5 ? 1.0 : ind < -0.5 ? left : ind > 0.5 ? 1.0 - left : 0.0;
            em = vec3(1.0, 0.42, 0.02) * on * blink * 4.0;
          } else if (lk > 6.5 && lk < 8.5) {
            float on = bitOn(vVar.y, 4.0);
            float ph = step(0.5, fract(uTime * 2.2 + (lk > 7.5 ? 0.5 : 0.0)));
            em = (lk < 7.5 ? vec3(1.0, 0.03, 0.03) : vec3(0.05, 0.2, 1.0)) * on * ph * 6.0;
          } else if (lk > 9.5) em = vec3(0.8, 0.86, 0.74) * cab * 0.3;
          // glass: fake sky / street reflection so windows read as glass, not holes
          if (vMat.x < 0.5 && vMat.y < 0.06) {
            vec3 V = -normalize(vViewPosition);
            vec3 Rv = reflect(V, normalize(normal));
            vec3 Rw = (vec4(Rv, 0.0) * viewMatrix).xyz;
            float fr = 0.04 + 0.96 * pow(1.0 - clamp(dot(-V, normalize(normal)), 0.0, 1.0), 4.0);
            vec3 sky = mix(vec3(0.42, 0.44, 0.45), vec3(0.55, 0.66, 0.8), smoothstep(-0.1, 0.5, Rw.y));
            sky = mix(sky, vec3(0.16, 0.15, 0.14), (1.0 - smoothstep(-0.3, 0.0, Rw.y)));
            // A darker cabin at normal incidence, brighter reflections at grazing angles.
            float horizon = 1.0 - smoothstep(0.0, 0.18, abs(Rw.y));
            sky *= 1.0 - 0.24 * horizon;
            em += sky * (0.08 + fr * 0.65) * uDay;
          }
          totalEmissiveRadiance += em + nightGlow(vNgWorld) * diffuseColor.rgb;
        }`
      );
  };
  mat.customProgramCacheKey = () => 'harare-vehicle-v1';
  mat.userData.uTime = uTime;
  mat.userData.uDay = uDay;
  return mat;
}

// --- glow: lamp flares + headlight pools -------------------------------------------------------------------------------
const GLOW_KINDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]; // pool, head L/R, tail L/R, ind front L/R, ind rear L/R, rear wash
function glowGeometry() {
  const pos = [], kind = [], corner = [], idx = [];
  for (const k of GLOW_KINDS) {
    const b = pos.length / 3;
    for (const [u, v] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) {
      pos.push(0, 0, 0);
      kind.push(k);
      corner.push(u, v);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(corner, 2));
  g.setIndex(idx);
  return g;
}
const GLOW_VERT = /* glsl */ `
attribute float aKind;
attribute vec2 aCorner;
attribute vec4 iM0; // x, y, z, yaw
attribute vec4 iDimA; // head half-spacing, head y, front z, tail y
attribute vec4 iDimB; // rear z, tail half-spacing, width, -
attribute vec4 iLamp;
uniform float uTime, uNight;
varying vec2 vC;
varying vec3 vCol;
varying float vPool;
void main() {
  float c = cos(iM0.w), s = sin(iM0.w);
  vec3 fwd = vec3(s, 0.0, c), left = vec3(c, 0.0, -s);
  vec3 base = iM0.xyz;
  float k = aKind;
  vec3 col = vec3(0.0);
  vec3 lp = vec3(0.0);
  float size = 0.0;
  vPool = 0.0;
  vC = aCorner * vec2(1.0, 2.0) - vec2(0.0, 1.0);
  float head = iLamp.x, brake = iLamp.y, ind = iLamp.z;
  float blink = step(0.5, fract(uTime * 1.55 + iDimB.w * 0.137));
  vec4 mv;
  if (k < 0.5 || k > 8.5) {
    // light on the road: ahead of the headlights (warm white) or a red wash behind the tail lamps
    bool rear = k > 8.5;
    float len = rear ? 3.2 : 15.0, w0 = rear ? 0.9 : 0.75, w1 = rear ? 1.5 : 3.6;
    float zz = rear ? iDimB.x - 0.2 - aCorner.y * len : iDimA.z + 0.3 + aCorner.y * len;
    vec3 p = base + fwd * zz + left * (aCorner.x * mix(w0, w1, aCorner.y)) + vec3(0.0, 0.06, 0.0);
    vC = aCorner;
    vPool = rear ? 2.0 : 1.0;
    col = rear ? vec3(1.0, 0.02, 0.01) * (head * 0.12 + brake * 0.5) : vec3(1.0, 0.86, 0.66) * head * 0.38;
    mv = viewMatrix * vec4(p, 1.0);
  } else {
    float side = (k == 1.0 || k == 3.0 || k == 5.0 || k == 7.0) ? 1.0 : -1.0;
    bool front = k < 2.5 || (k > 4.5 && k < 6.5);
    if (k < 2.5) { lp = vec3(side * iDimA.x, iDimA.y, iDimA.z); col = vec3(1.0, 0.92, 0.78) * head * 1.1; size = 0.2; }
    else if (k < 4.5) { lp = vec3(side * iDimB.y, iDimA.w, iDimB.x); col = vec3(1.0, 0.05, 0.02) * (head * 0.45 + brake * 1.2); size = 0.13 + brake * 0.07; }
    else {
      float on = ind > 1.5 ? 1.0 : ind < -0.5 ? step(0.0, side) : ind > 0.5 ? step(side, 0.0) : 0.0;
      lp = front ? vec3(side * (iDimA.x + 0.25), iDimA.y, iDimA.z) : vec3(side * (iDimB.y + 0.12), iDimA.w, iDimB.x);
      col = vec3(1.0, 0.45, 0.03) * on * blink * 1.2;
      size = 0.12;
    }
    vec3 wp = base + left * lp.x + vec3(0.0, lp.y, 0.0) + fwd * lp.z;
    vec3 toCam = normalize(cameraPosition - wp);
    float facing = dot(toCam, front ? fwd : -fwd);
    col *= smoothstep(-0.15, 0.55, facing);
    mv = viewMatrix * vec4(wp, 1.0);
    float d = -mv.z;
    size *= 1.0 + d * 0.006;
    mv.xyz += normalize(-mv.xyz) * 0.35;
    mv.xy += vec2(aCorner.x, aCorner.y * 2.0 - 1.0) * size;
    vC = aCorner * vec2(1.0, 2.0) - vec2(0.0, 1.0);
  }
  float dist = length(mv.xyz);
  col *= uNight * (1.0 - smoothstep(250.0, 420.0, dist));
  vCol = col;
  gl_Position = projectionMatrix * mv;
  if (dot(col, col) < 1e-6) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;
const GLOW_FRAG = /* glsl */ `
varying vec2 vC;
varying vec3 vCol;
varying float vPool;
void main() {
  float a;
  if (vPool > 0.5) {
    float u = vC.x, v = vC.y;
    if (vPool < 1.5) a = (1.0 - u * u) * smoothstep(0.0, 0.12, v) * pow(1.0 - v, 1.6) * (0.6 + 0.4 * smoothstep(0.5, 0.0, abs(v - 0.3)));
    else a = (1.0 - u * u) * pow(1.0 - v, 2.0);
  } else {
    float r2 = dot(vC, vC);
    a = exp(-r2 * 5.0) * 0.7 + exp(-r2 * 40.0) * 1.5;
  }
  gl_FragColor = vec4(vCol * a, 1.0);
}
`;

export function createVehicleRenderer(scene, opts = {}) {
  const NEAR = opts.near ?? 75, FAR = opts.far ?? 1400;
  const mat = vehicleMaterial();
  const types = Object.keys(VEHICLE_TYPES);
  const caps = opts.capacity; // {type: n}
  const T = {};
  const detailed=createTrafficModels(scene,caps);
  for (const type of types) {
    const cap = Math.max(1, caps[type] || 0);
    T[type] = [1, 0].map((detail) => {
      const geo = vehicleGeometry(type, detail, true);
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      const v = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      const l = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      v.setUsage(THREE.DynamicDrawUsage);
      l.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('iVar', v);
      geo.setAttribute('iLamp', l);
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
      return { mesh, v, l, n: 0, ups: [[mesh.instanceMatrix, 16], [mesh.instanceColor, 3], [v, 4], [l, 4]] };
    });
  }
  let cam = null;
  for (const type of types) for (const L of T[type]) L.mesh.onBeforeRender = (r, s, camera) => camera.isPerspectiveCamera && (cam = camera);

  // glow
  const total = types.reduce((s, t) => s + (caps[t] || 0), 0);
  const gGeo = glowGeometry();
  const gAttr = ['iM0', 'iDimA', 'iDimB', 'iLamp'].map((name) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, total) * 4), 4);
    a.setUsage(THREE.DynamicDrawUsage);
    gGeo.setAttribute(name, a);
    return a;
  });
  const gUni = { uTime: mat.userData.uTime, uNight: { value: 0 } };
  const gMat = new THREE.ShaderMaterial({ uniforms: gUni, vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const glow = new THREE.Mesh(gGeo, gMat);
  glow.frustumCulled = false;
  glow.renderOrder = 5;
  gGeo.instanceCount = 0;
  scene.add(glow);

  // per-vehicle state
  const n = { v: 0 };
  const TYPE = [], X = [], Y = [], Z = [], H = [], COL = [], VAR = [], LMP = [];
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), sph = new THREE.Sphere();
  const c = new THREE.Color();
  return {
    material: mat,
    ready: detailed.ready,
    detailed,
    add(type, color, plate, opts2 = 0, dirt = 0, route = 0) {
      const i = n.v++;
      TYPE[i] = type;
      X[i] = Y[i] = Z[i] = H[i] = 0;
      c.set(color);
      COL.push(c.r, c.g, c.b);
      VAR.push(plate, opts2, dirt, route);
      LMP.push(0, 0, 0, 0);
      return i;
    },
    set(i, x, y, z, h) {
      X[i] = x;
      Y[i] = y;
      Z[i] = z;
      H[i] = h;
    },
    // option bits (4: police light bar on)
    setOpt(i, bit, on) {
      const o = i * 4 + 1, has = Math.floor(VAR[o] / bit) % 2 === 1;
      if (on && !has) VAR[o] += bit;
      else if (!on && has) VAR[o] -= bit;
    },
    lamp(i, head, brake, ind, cab) {
      const o = i * 4;
      LMP[o] = head;
      LMP[o + 1] = brake;
      LMP[o + 2] = ind;
      LMP[o + 3] = cab;
    },
    commit(time, night) {
      mat.userData.uTime.value = time;
      mat.userData.uDay.value = 0.15 + 0.85 * (1 - night);
      gUni.uNight.value = night;
      let cx = 0, cy = 0, cz = 0;
      if (cam) {
        pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        frustum.setFromProjectionMatrix(pv);
        cx = cam.position.x;
        cy = cam.position.y;
        cz = cam.position.z;
      }
      for (const type of types) for (const L of T[type]) L.n = 0;
      const imported=detailed.update(cam,time,TYPE,X,Y,Z,H,COL,LMP,n.v,VAR);
      const near2 = NEAR * NEAR, far2 = FAR * FAR;
      const doGlow = night > 0.02;
      let g = 0;
      const G0 = gAttr[0].array, GA = gAttr[1].array, GB = gAttr[2].array, GL = gAttr[3].array;
      for (let i = 0; i < n.v; i++) {
        const type = TYPE[i], VT = VEHICLE_TYPES[type];
        let lod = 1;
        if (cam) {
          const dx = X[i] - cx, dy = Y[i] - cy, dz = Z[i] - cz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > far2) continue;
          sph.center.set(X[i], Y[i] + 1, Z[i]);
          sph.radius = VT.len * 0.6 + (doGlow ? 16 : 0);
          if (!frustum.intersectsSphere(sph)) continue;
          if (d2 < near2) lod = 0;
          if (doGlow) {
            const o = i * 4;
            if (LMP[o] > 0.01 || LMP[o + 1] > 0.01 || LMP[o + 2] !== 0) {
              const q = g * 4, D = VT.lampDims;
              G0[q] = X[i]; G0[q + 1] = Y[i]; G0[q + 2] = Z[i]; G0[q + 3] = H[i];
              GA[q] = D[0]; GA[q + 1] = D[1]; GA[q + 2] = D[2]; GA[q + 3] = D[3];
              GB[q] = D[4]; GB[q + 1] = D[5]; GB[q + 2] = VT.width; GB[q + 3] = VAR[o];
              GL[q] = LMP[o]; GL[q + 1] = LMP[o + 1]; GL[q + 2] = LMP[o + 2]; GL[q + 3] = LMP[o + 3];
              g++;
            }
          }
          sph.radius = VT.len * 0.6;
          if (doGlow && !frustum.intersectsSphere(sph)) continue;
        }
        if(imported.has(i))continue;
        const L = T[type][lod], k = L.n++;
        const M = L.mesh.instanceMatrix.array, o = k * 16;
        const cs = Math.cos(H[i]), sn = Math.sin(H[i]);
        M[o] = cs; M[o + 1] = 0; M[o + 2] = -sn; M[o + 3] = 0;
        M[o + 4] = 0; M[o + 5] = 1; M[o + 6] = 0; M[o + 7] = 0;
        M[o + 8] = sn; M[o + 9] = 0; M[o + 10] = cs; M[o + 11] = 0;
        M[o + 12] = X[i]; M[o + 13] = Y[i]; M[o + 14] = Z[i]; M[o + 15] = 1;
        const C = L.mesh.instanceColor.array, V = L.v.array, LA = L.l.array, j = i * 4;
        C[k * 3] = COL[i * 3]; C[k * 3 + 1] = COL[i * 3 + 1]; C[k * 3 + 2] = COL[i * 3 + 2];
        V[k * 4] = VAR[j]; V[k * 4 + 1] = VAR[j + 1]; V[k * 4 + 2] = VAR[j + 2]; V[k * 4 + 3] = VAR[j + 3];
        LA[k * 4] = LMP[j]; LA[k * 4 + 1] = LMP[j + 1]; LA[k * 4 + 2] = LMP[j + 2]; LA[k * 4 + 3] = LMP[j + 3];
      }
      for (const type of types)
        for (const L of T[type]) {
          const k = L.n;
          L.mesh.count = k;
          for (let u = 0; u < 4; u++) {
            const a = L.ups[u][0];
            a.clearUpdateRanges();
            a.addUpdateRange(0, Math.max(1, k) * L.ups[u][1]);
            a.needsUpdate = true;
          }
        }
      gGeo.instanceCount = g;
      glow.visible = g > 0;
      for (const a of gAttr) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, Math.max(1, g) * 4);
        a.needsUpdate = true;
      }
    },
  };
}
