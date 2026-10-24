// js/rank-lights.js — floodlight masts over the kombi ranks so they aren't pitch black at night: a few tall masts per
// rank with glowing lamp heads, a soft additive pool of light on the ground under each, and the same positions fed to
// nightglow.js so people and kombis standing under a flood are lit too.
import * as THREE from 'three';
import { groundY } from './util.js';
import { MeshKit } from './meshkit.js';
import { nightUniforms, MAX_FLOODS } from './nightglow.js';

const MAST_H = 11, POOL_R = 21;

export function createRankLights(scene, ranks) {
  const spots = [];
  for (const R of ranks) {
    const want = R.r > 45 ? 4 : R.r > 38 ? 3 : 2;
    const mine = [];
    for (let ring = 0.25; ring <= 0.9 && mine.length < want; ring += 0.15) {
      for (let a = 0; a < 16 && mine.length < want; a++) {
        const ang = (a / 16) * Math.PI * 2 + ring * 3;
        const x = R.x + Math.cos(ang) * R.r * ring, z = R.z + Math.sin(ang) * R.r * ring;
        if (!R.clear(x, z) || mine.some((s) => Math.hypot(s.x - x, s.z - z) < R.r * 0.7)) continue;
        mine.push({ x, z, y: groundY(x, z) + R.surfaceY(x, z) });
      }
    }
    spots.push(...mine);
  }
  spots.length = Math.min(spots.length, MAX_FLOODS);
  spots.forEach((s, i) => nightUniforms.uFloods.value[i].set(s.x, s.y + MAST_H, s.z, POOL_R));

  const n = Math.max(1, spots.length);
  const k = new MeshKit({ color: 3 });
  const G = [0.42, 0.43, 0.44];
  k.geo(new THREE.CylinderGeometry(0.09, 0.16, MAST_H, 8).translate(0, MAST_H / 2, 0), { color: G });
  k.box(0, MAST_H + 0.05, 0, 2.2, 0.1, 0.1, { color: G });
  for (const x of [-0.8, 0.8]) k.box(x, MAST_H - 0.12, 0, 0.62, 0.22, 0.42, { color: [0.2, 0.2, 0.21] });
  const masts = new THREE.InstancedMesh(k.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.6 }), n);
  const lampG = new THREE.BoxGeometry(0.56, 0.04, 0.36);
  const lk = new MeshKit({ color: 3 });
  for (const x of [-0.8, 0.8]) lk.geo(lampG, { color: [1, 1, 1] }, new THREE.Matrix4().makeTranslation(x, MAST_H - 0.245, 0));
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.9, 0.7), toneMapped: false });
  const lamps = new THREE.InstancedMesh(lk.build(), lampMat, n);
  // ground pools: additive discs with a soft falloff
  const poolMat = new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0 } },
    vertexShader: `varying vec2 vP; void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uI; varying vec2 vP; void main() { float r = length(vP); float a = pow(max(0.0, 1.0 - r), 2.2); gl_FragColor = vec4(vec3(1.0, 0.86, 0.62) * a * uI, 1.0); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const poolGeo = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  spots.forEach((s, i) => {
    q.setFromAxisAngle(up, (i * 1.7) % Math.PI);
    m.compose(v.set(s.x, s.y, s.z), q, one);
    masts.setMatrixAt(i, m);
    lamps.setMatrixAt(i, m);
    m.compose(v.set(s.x, s.y + 0.08, s.z), q, new THREE.Vector3(POOL_R, 1, POOL_R));
    pools.setMatrixAt(i, m);
  });
  masts.count = lamps.count = pools.count = spots.length;
  masts.castShadow = true;
  pools.renderOrder = 4;
  scene.add(masts, lamps, pools);
  let last = -1;
  return {
    count: spots.length,
    update(night) {
      if (Math.abs(night - last) < 0.005) return;
      last = night;
      const on = THREE.MathUtils.smoothstep(night, 0.25, 0.6);
      nightUniforms.uFloodOn.value = on * 0.55;
      poolMat.uniforms.uI.value = on * 0.32;
      pools.visible = on > 0.01;
      lampMat.color.setRGB(0.5 + on * 5, 0.45 + on * 4.4, 0.35 + on * 3.2);
    },
  };
}
