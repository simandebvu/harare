// js/nightglow.js — cheap fake floodlighting for the kombi ranks at night. Up to 16 floodlights (x, y, z, radius) are
// shared as uniforms; people and vehicle shaders add albedo * colour * falloff as emission, so things standing under a
// flood read as lit without any real three.js lights (which would cost every material in the scene).
import * as THREE from 'three';

export const MAX_FLOODS = 16;
export const nightUniforms = {
  uFloods: { value: Array.from({ length: MAX_FLOODS }, () => new THREE.Vector4(0, -1e5, 0, 0)) },
  uFloodCol: { value: new THREE.Color(1.0, 0.86, 0.62) },
  uFloodOn: { value: 0 },
};

export const NIGHT_GLSL = /* glsl */ `
uniform vec4 uFloods[${MAX_FLOODS}];
uniform vec3 uFloodCol;
uniform float uFloodOn;
varying vec3 vNgWorld;
vec3 nightGlow(vec3 wp) {
  if (uFloodOn < 0.01) return vec3(0.0);
  float a = 0.0;
  for (int i = 0; i < ${MAX_FLOODS}; i++) {
    vec4 f = uFloods[i];
    if (f.w <= 0.0) continue;
    vec3 d = wp - f.xyz;
    float q = max(0.0, 1.0 - dot(d.xz, d.xz) / (f.w * f.w));
    a += q * q * smoothstep(-2.0, 1.0, f.y - wp.y);
  }
  return uFloodCol * a * uFloodOn;
}
`;
