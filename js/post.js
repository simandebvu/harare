// js/post.js — post-processing: ambient occlusion, bloom for night lights and sun glints, warm highveld colour grade.
// `quality` 0 renders straight to screen, 1 adds bloom + grade, 2 adds GTAO.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { aoHooks } from './ao-hooks.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSat: { value: 1.06 },
    uWarm: { value: 0.6 },
    uVignette: { value: 0.3 },
    uContrast: { value: 0.16 },
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
      float v = 1.0 - smoothstep(0.25, 0.9, length((vUv - 0.5) * vec2(1.25, 1.0)));
      c *= mix(1.0, v, uVignette);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

// samples: multisample anti-aliasing of the scene buffer (phones pass 0 and rely on the FXAA pass at the end)
export function createPost(renderer, scene, camera, { samples = 4 } = {}) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples });
  const composer = new EffectComposer(renderer, target);

  const renderPass = new RenderPass(scene, camera);
  const gtao = new GTAOPass(scene, camera, size.x, size.y);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = 1.0;
  gtao.updateGtaoMaterial({ radius: 5, distanceExponent: 1.6, thickness: 4, scale: 1.2, samples: 8, distanceFallOff: 1, screenSpaceRadius: false });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
  // after GTAO's override-material normal pass, let posed meshes (people) draw themselves into the same buffer
  const renderOverride = gtao.renderOverride.bind(gtao);
  gtao.renderOverride = (r, material, rt, clearColor, clearAlpha) => {
    renderOverride(r, material, rt, clearColor, clearAlpha);
    if (material !== gtao.normalMaterial || !aoHooks.length) return;
    const prevTarget = r.getRenderTarget(), prevAuto = r.autoClear;
    r.setRenderTarget(rt);
    r.autoClear = false;
    for (const h of aoHooks) h(r, camera);
    r.autoClear = prevAuto;
    r.setRenderTarget(prevTarget);
  };
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.2, 0.5, 1.0);
  const output = new OutputPass();
  const grade = new ShaderPass(GradeShader);
  // Resolve thin railings, foliage and distant signs after the colour grade.
  const fxaa = new ShaderPass(FXAAShader);
  fxaa.uniforms.resolution.value.set(1 / size.x, 1 / size.y);

  composer.addPass(renderPass);
  composer.addPass(gtao);
  composer.addPass(bloom);
  composer.addPass(output);
  composer.addPass(grade);
  composer.addPass(fxaa);

  let quality = 2, lite = false, night = 0;
  function setQuality(q) {
    quality = q;
    gtao.enabled = q >= 2;
  }
  // Phones in flight skip the bloom (a chain of blur passes) by day, when it only adds a faint glint. The rest of the
  // chain stays: dropping to quality 0 would draw straight to the screen, which needs different builds of every shader
  // (a long freeze on an iPhone) and loses the colour grade.
  const syncBloom = () => (bloom.enabled = !(lite && night < 0.3));

  return {
    get quality() {
      return quality;
    },
    setQuality,
    setLite(v) {
      lite = v;
      syncBloom();
    },
    render() {
      if (quality === 0) renderer.render(scene, camera);
      else composer.render();
    },
    setSize(w, h) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
      // AO re-renders the scene for its normals: do that (and the AO itself) at half resolution
      const pr = renderer.getPixelRatio();
      fxaa.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
      gtao.setSize(Math.round((w * pr) / 2), Math.round((h * pr) / 2));
    },
    setNight(n) {
      night = n;
      syncBloom();
      bloom.strength = 0.1 + n * 0.45;
      bloom.threshold = 1.0 - n * 0.25;
      grade.uniforms.uWarm.value = 0.32 * (1 - n) + 0.12;
      grade.uniforms.uVignette.value = 0.16 + n * 0.1;
      gtao.blendIntensity = 1.0 - n * 0.5;
    },
  };
}
