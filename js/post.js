// js/post.js — post-processing: ambient occlusion, bloom for night lights and sun glints, warm highveld colour grade.
// `quality` 0 renders straight to screen, 1 adds bloom + grade, 2 adds GTAO.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSat: { value: 1.16 },
    uWarm: { value: 0.6 },
    uVignette: { value: 0.3 },
    uContrast: { value: 0.32 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSat, uWarm, uVignette, uContrast;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      // warm highlights, slightly cool shadows: dry-season sun through dust
      c *= mix(vec3(1.0), mix(vec3(0.97, 0.99, 1.04), vec3(1.05, 1.0, 0.9), smoothstep(0.1, 0.8, l)), uWarm);
      c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
      float v = smoothstep(1.0, 0.25, length((vUv - 0.5) * vec2(1.25, 1.0)));
      c *= mix(1.0, v, uVignette);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export function createPost(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);

  const renderPass = new RenderPass(scene, camera);
  const gtao = new GTAOPass(scene, camera, size.x, size.y);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = 1.0;
  gtao.updateGtaoMaterial({ radius: 5, distanceExponent: 1.6, thickness: 4, scale: 1.2, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.2, 0.5, 1.0);
  const output = new OutputPass();
  const grade = new ShaderPass(GradeShader);

  composer.addPass(renderPass);
  composer.addPass(gtao);
  composer.addPass(bloom);
  composer.addPass(output);
  composer.addPass(grade);

  let quality = 2;
  function setQuality(q) {
    quality = q;
    gtao.enabled = q >= 2;
  }

  return {
    get quality() {
      return quality;
    },
    setQuality,
    render() {
      if (quality === 0) renderer.render(scene, camera);
      else composer.render();
    },
    setSize(w, h) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
    },
    setNight(n) {
      bloom.strength = 0.12 + n * 0.75;
      bloom.threshold = 1.0 - n * 0.25;
      grade.uniforms.uWarm.value = 0.6 * (1 - n) + 0.15;
      grade.uniforms.uVignette.value = 0.3 + n * 0.15;
      gtao.blendIntensity = 1.0 - n * 0.5;
    },
  };
}
