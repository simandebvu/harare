// js/clouds.js — scattered afternoon cumulus over the highveld: one big fbm-shaded plane that drifts and follows the sun
import * as THREE from 'three';

export function createClouds(scene) {
  const uniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    uShade: { value: new THREE.Color(0.62, 0.66, 0.74) },
    uCover: { value: 0.42 },
    uNight: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uCover, uNight;
      uniform vec3 uSunDir, uSunColor, uShade;
      varying vec3 vWorld;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
        return v;
      }
      void main() {
        vec2 p = vWorld.xz / 1400.0 + vec2(uTime * 0.004, uTime * 0.0015);
        float n = fbm(p);
        float d = smoothstep(1.0 - uCover, 1.0 - uCover + 0.22, n);
        if (d < 0.01) discard;
        // fake self-shadowing: sample toward the sun, denser there means darker here
        float n2 = fbm(p + uSunDir.xz * 0.06);
        float lit = clamp(0.55 + (n - n2) * 4.0, 0.0, 1.0);
        vec3 col = mix(uShade, uSunColor, lit);
        col = mix(col, vec3(0.05, 0.06, 0.09), uNight);
        float fade = 1.0 - smoothstep(6000.0, 14000.0, length(vWorld.xz - cameraPosition.xz));
        gl_FragColor = vec4(col, d * 0.92 * fade);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000).rotateX(Math.PI / 2), mat);
  mesh.position.y = 2400;
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  scene.add(mesh);

  return {
    update(dt, camera) {
      uniforms.uTime.value += dt;
      mesh.position.x = camera.position.x;
      mesh.position.z = camera.position.z;
    },
    setSun(dir, color, night) {
      uniforms.uSunDir.value.copy(dir);
      uniforms.uSunColor.value.copy(color).lerp(new THREE.Color(1, 1, 1), 0.4);
      uniforms.uNight.value = night;
    },
  };
}
