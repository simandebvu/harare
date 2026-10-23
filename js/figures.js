// js/figures.js — every person in the city as ONE instanced mesh, animated on the GPU.
// Each vertex knows which body part it belongs to (aPart → colour / optional accessory) and which limb (aLimb → pivot);
// each instance carries its colours, outfit flags and an animation vector (phase, stride frequency, walk amount,
// arm-gesture amount). The vertex shader swings legs and arms about hip / knee / shoulder with sin(time * freq + phase),
// so the CPU only moves the instance matrices.
import * as THREE from 'three';
import { MeshKit } from './meshkit.js';

// Part ids (match the shader)
const P = { SHADOW: 20, SHADOW_LOAD: 21, SKIN: 0, TOP: 1, HIPS: 2, LOWLEG: 3, SHOE: 4, SLEEVE: 5, HAIR: 6, SKIRT: 7, BASIN: 8, CONTENT: 9, BUNDLE: 10, SBAG: 11, HBAG: 12, UPLEG: 13 };
// Limb ids: 1/2 left/right thigh, 3/4 left/right shin, 5/6 left/right arm. A figure faces +z, so its left is +x.
const HIP_Y = 0.93, KNEE_Y = 0.5, SHOULDER_Y = 1.42, SHOULDER_X = 0.215;

function figureGeometry() {
  const k = new MeshKit({ aPart: 1, aLimb: 1 });
  const a = (part, limb = 0) => ({ aPart: part, aLimb: limb });
  for (const side of [1, -1]) {
    const x = 0.092 * side, L = side > 0 ? 0 : 1;
    k.taper(x, 0, 0.045, 0.1, 0.25, 0.095, 0.2, 0.075, a(P.SHOE, 3 + L)); // shoe
    k.taper(x, 0.07, 0, 0.085, 0.1, 0.11, 0.125, 0.45, a(P.LOWLEG, 3 + L)); // shin
    k.taper(x, 0.49, 0, 0.115, 0.13, 0.15, 0.165, 0.46, a(P.UPLEG, 1 + L)); // thigh
    const ax = SHOULDER_X * side;
    k.taper(ax, 1.12, 0, 0.085, 0.095, 0.095, 0.105, 0.32, a(P.SLEEVE, 5 + L)); // upper arm (sleeve)
    k.taper(ax, 0.8, 0.005, 0.07, 0.075, 0.072, 0.08, 0.33, a(P.SKIN, 5 + L)); // forearm + hand
  }
  k.taper(0, 0.86, 0, 0.33, 0.2, 0.34, 0.205, 0.16, a(P.HIPS)); // pelvis
  k.taper(0, 1.0, 0, 0.32, 0.2, 0.4, 0.22, 0.47, a(P.TOP)); // torso, broader at the shoulders
  k.taper(0, 1.46, 0, 0.09, 0.09, 0.085, 0.085, 0.08, a(P.SKIN)); // neck
  const M = new THREE.Matrix4();
  k.geo(new THREE.SphereGeometry(1, 7, 5), a(P.SKIN), M.makeScale(0.098, 0.118, 0.108).setPosition(0, 1.625, 0.005)); // head
  k.geo(new THREE.SphereGeometry(1, 7, 3, 0, Math.PI * 2, 0, Math.PI * 0.55), a(P.HAIR), M.makeScale(0.104, 0.09, 0.114).setPosition(0, 1.65, -0.006)); // hair / doek
  const core = k.idx.length; // everything before here is the plain body (always shown)
  k.taper(0, 0.46, 0, 0.5, 0.36, 0.35, 0.225, 0.58, a(P.SKIRT)); // skirt / dress
  // Head loads: a basin of produce, or a cloth bundle
  k.geo(new THREE.CylinderGeometry(0.27, 0.17, 0.13, 9, 1), a(P.BASIN), M.makeTranslation(0, 1.81, 0));
  k.geo(new THREE.SphereGeometry(1, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2), a(P.CONTENT), M.makeScale(0.24, 0.1, 0.24).setPosition(0, 1.865, 0));
  k.box(0, 1.86, 0, 0.46, 0.22, 0.36, a(P.BUNDLE));
  // Bags: shoulder bag at the right hip, or a carrier bag hanging from the left hand
  k.box(-0.25, 0.98, 0.02, 0.07, 0.24, 0.24, a(P.SBAG));
  k.box(0.07, 1.33, 0.115, 0.36, 0.035, 0.012, a(P.SBAG)); // strap across the chest
  k.box(0.235, 0.68, 0.02, 0.06, 0.26, 0.24, a(P.HBAG, 5));
  // Low-poly stand-in drawn only into the shadow map (aPart 20+, never shown in the colour pass)
  const main = k.idx.length;
  for (const side of [1, -1]) {
    const L = side > 0 ? 0 : 1;
    k.taper(0.092 * side, 0, 0.02, 0.11, 0.2, 0.14, 0.16, HIP_Y, a(P.SHADOW, 1 + L));
    k.taper(SHOULDER_X * side, 0.8, 0, 0.075, 0.09, 0.09, 0.1, 0.64, a(P.SHADOW, 5 + L));
  }
  k.taper(0, 0.86, 0, 0.33, 0.2, 0.4, 0.22, 0.62, a(P.SHADOW));
  k.box(0, 1.62, 0, 0.19, 0.26, 0.2, a(P.SHADOW));
  k.box(0, 1.84, 0, 0.46, 0.16, 0.4, a(P.SHADOW_LOAD));
  const g = k.build();
  g.userData.ranges = { core, main, shadow: k.idx.length - main };
  return g;
}

const HEADER = /* glsl */ `
attribute float aPart;
attribute float aLimb;
attribute vec3 iTop;
attribute vec3 iBot;
attribute vec3 iSkin;
attribute vec3 iAcc;
attribute vec4 iFlag; // dress, load (0 none, 1 tomatoes, 2 bananas, 3 bundle), bag (0, 1 shoulder, 2 hand), doek
attribute vec4 iAnim; // phase, stride freq (rad/s), walk amount, gesture amount
uniform float uTime;
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
float figHidden() {
  float p = aPart, load = iFlag.y, bag = iFlag.z;
  if (p == 7.0) return 1.0 - step(0.5, iFlag.x);
  if (p == 13.0) return step(0.5, iFlag.x);
  if (p == 8.0 || p == 9.0) return (load > 0.5 && load < 2.5) ? 0.0 : 1.0;
  if (p == 10.0) return step(load, 2.5);
  if (p == 11.0) return abs(bag - 1.0) < 0.1 ? 0.0 : 1.0;
  if (p == 12.0) return abs(bag - 2.0) < 0.1 ? 0.0 : 1.0;
  if (p == 21.0) return step(load, 0.5);
  return 0.0;
}
void figPose(inout vec3 p, inout vec3 n) {
  float arg = uTime * iAnim.y + iAnim.x;
  float amp = iAnim.z, g = iAnim.w;
  float s = sin(arg), c = cos(arg);
  float li = aLimb;
  if (li > 0.5 && li < 4.5) {
    float side = (li == 1.0 || li == 3.0) ? 1.0 : -1.0;
    if (li > 2.5) { // knee bends during the forward swing
      float kb = amp * 0.85 * max(0.0, -c * side);
      mat3 K = rotX(kb);
      vec3 kp = vec3(0.0, ${KNEE_Y.toFixed(2)}, 0.0);
      p = K * (p - kp) + kp; n = K * n;
    }
    mat3 R = rotX(0.42 * amp * s * side);
    vec3 hp = vec3(0.0, ${HIP_Y.toFixed(2)}, 0.0);
    p = R * (p - hp) + hp; n = R * n;
  } else if (li > 4.5) {
    float side = li == 5.0 ? 1.0 : -1.0;
    float idle = 1.0 - amp;
    float th = -0.45 * amp * s * side + idle * 0.05 * sin(uTime * 1.3 + iAnim.x * 2.0 + side);
    float ab = 0.07;
    float load = iFlag.y;
    if (side < 0.0 && load > 0.5 && load < 2.5) { th = -2.78; ab = -0.08; } // right hand steadies the basin
    else if (side < 0.0 && g > 0.01) { // waving / holding goods up to a car window
      float w = sin(uTime * 6.5 + iAnim.x * 3.0);
      th = mix(th, -2.35 - 0.25 * w, g);
      ab = mix(ab, 0.35 + 0.25 * w, g);
    }
    mat3 R = rotZ(ab * side) * rotX(th);
    vec3 sp = vec3(${SHOULDER_X} * side, ${SHOULDER_Y}, 0.0);
    p = R * (p - sp) + sp; n = R * n;
  }
  // bob while walking, a slow weight shift while standing
  p.y += amp * 0.035 * (1.0 - abs(s));
  float sway = (1.0 - amp) * 0.03 * sin(uTime * 0.8 + iAnim.x * 5.0);
  mat3 S = rotZ(sway) * rotX(amp * 0.06);
  p = S * p; n = S * n;
}
`;

export function createFigures(scene, capacity) {
  const geo = figureGeometry();
  const mesh = new THREE.InstancedMesh(geo, null, capacity);
  const uTime = { value: 0 };
  const inst = (name, size) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
    geo.setAttribute(name, a);
    return a;
  };
  const top = inst('iTop', 3), bot = inst('iBot', 3), skin = inst('iSkin', 3), acc = inst('iAcc', 3), flag = inst('iFlag', 4), anim = inst('iAnim', 4);
  anim.setUsage(THREE.DynamicDrawUsage);

  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${HEADER}\nvarying vec3 vTint;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\nvec3 posePos = position;\nfigPose(posePos, objectNormal);`)
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = posePos * (1.0 - figHidden());
        float pp = aPart;
        vTint = iTop;
        if (pp == 0.0) vTint = iSkin;
        else if (pp == 2.0 || pp == 7.0 || pp == 13.0) vTint = iBot;
        else if (pp == 3.0) vTint = iFlag.x > 0.5 ? iSkin : iBot;
        else if (pp == 4.0) vTint = vec3(0.035, 0.03, 0.03);
        else if (pp == 6.0) vTint = iFlag.w > 0.5 ? iAcc : vec3(0.025, 0.02, 0.02);
        else if (pp == 8.0 || pp == 10.0) vTint = iAcc;
        else if (pp == 9.0) vTint = iFlag.y < 1.5 ? vec3(0.62, 0.06, 0.03) : vec3(0.75, 0.6, 0.08);
        else if (pp == 11.0 || pp == 12.0) vTint = iAcc * 0.55 + vec3(0.03, 0.02, 0.01);`
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTint;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vTint;');
  };
  mat.customProgramCacheKey = () => 'harare-figure';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${HEADER}`)
      .replace('#include <begin_vertex>', `vec3 posePos = position; vec3 fN = vec3(0.0, 1.0, 0.0);\nfigPose(posePos, fN);\nvec3 transformed = posePos * (1.0 - figHidden());`);
  };
  depth.customProgramCacheKey = () => 'harare-figure-depth';
  mesh.material = mat;
  mesh.customDepthMaterial = depth;
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  // Colour pass draws the detailed figure, the shadow pass only the stand-in
  const { core, main, shadow } = geo.userData.ranges;
  geo.setDrawRange(0, main);
  mesh.onBeforeShadow = () => geo.setDrawRange(main, shadow);
  mesh.onAfterShadow = () => geo.setDrawRange(0, main);
  // Override-material passes (e.g. the AO normal pass) can't pose or hide parts: give them just the plain body
  mesh.onBeforeRender = (renderer, scene, camera, geometry, material) => geo.setDrawRange(0, material === mat ? main : core);
  mesh.count = 0;
  scene.add(mesh);

  const M = mesh.instanceMatrix.array, A = anim.array;
  let n = 0;
  return {
    mesh,
    uTime,
    get count() {
      return n;
    },
    // Register a figure; colours are THREE.Color (linear). Returns its index.
    add(cTop, cBot, cSkin, cAcc, dress, load, bag, doek, phase, freq) {
      const i = n++;
      top.setXYZ(i, cTop.r, cTop.g, cTop.b);
      bot.setXYZ(i, cBot.r, cBot.g, cBot.b);
      skin.setXYZ(i, cSkin.r, cSkin.g, cSkin.b);
      acc.setXYZ(i, cAcc.r, cAcc.g, cAcc.b);
      flag.setXYZW(i, dress, load, bag, doek);
      anim.setXYZW(i, phase, freq, 0, 0);
      mesh.count = n;
      return i;
    },
    // Hot path: write the instance matrix directly (yaw about y, height scale s, build/width factor b)
    place(i, x, y, z, yaw, s, b) {
      const c = Math.cos(yaw), sn = Math.sin(yaw), o = i * 16, w = s * b;
      M[o] = c * w; M[o + 1] = 0; M[o + 2] = -sn * w; M[o + 3] = 0;
      M[o + 4] = 0; M[o + 5] = s; M[o + 6] = 0; M[o + 7] = 0;
      M[o + 8] = sn * w; M[o + 9] = 0; M[o + 10] = c * w; M[o + 11] = 0;
      M[o + 12] = x; M[o + 13] = y; M[o + 14] = z; M[o + 15] = 1;
    },
    animate(i, walk, gesture) {
      A[i * 4 + 2] = walk;
      A[i * 4 + 3] = gesture;
    },
    commit(time) {
      uTime.value = time;
      mesh.instanceMatrix.needsUpdate = true;
      anim.needsUpdate = true;
    },
  };
}
