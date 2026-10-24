// js/features/shadows.js — cascaded sun shadows: sharp near the camera, still present out to 2.5 km.
// Replaces the sun's single follow-the-camera shadow map with three CSM cascades. The original sun light stays in the
// scene as the source of direction, colour and intensity (main.js animates it) but no longer lights anything itself.
// Runs after every other feature so it can chain onto the shader hooks they installed (see lighting.js).
import { CSM } from 'three/addons/csm/CSM.js';

export default {
  init(ctx) {
    const { scene, camera, sun } = ctx;
    if (!/[?&]csm=1/.test(location.search)) return; // opt-in until verified: costs ~20 fps
    const csm = new CSM({
      camera,
      parent: scene,
      cascades: 3,
      maxFar: 2500,
      mode: 'practical',
      shadowMapSize: 2048,
      lightDirection: ctx.getSunDir().clone().negate(),
      lightIntensity: sun.intensity,
      lightNear: 1,
      lightFar: 8000,
      lightMargin: 1200,
      shadowBias: -0.0002,
    });
    csm.fade = true;
    for (const l of csm.lights) {
      l.shadow.normalBias = 0.35;
      l.color.copy(sun.color);
    }
    // the original sun keeps its job as the time-of-day source but no longer renders light or shadow
    sun.castShadow = false;
    sun.visible = false; // invisible lights are skipped by the renderer; main.js still updates its intensity/colour
    this.sunRef = sun;
    this.csm = csm;
    addEventListener('resize', () => csm.updateFrustums());

    const done = new Set();
    scene.traverse((o) => {
      const mats = o.isMesh ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        if (!m || done.has(m) || !(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) continue;
        done.add(m);
        const prev = m.onBeforeCompile;
        const prevKey = m.customProgramCacheKey;
        const prevStr = prev ? prev.toString() : '';
        csm.setupMaterial(m); // sets USE_CSM defines and its own onBeforeCompile for the cascade uniforms
        const csmHook = m.onBeforeCompile;
        m.onBeforeCompile = function (sh, r) {
          if (prev) prev.call(this, sh, r);
          csmHook.call(this, sh, r);
        };
        m.customProgramCacheKey = function () {
          return (prevKey ? prevKey.call(this) : prevStr) + '|csm';
        };
        m.needsUpdate = true;
      }
    });
    console.log(`[harare] shadows: CSM ${csm.cascades} cascades to ${csm.maxFar} m, ${done.size} materials`);
  },

  update(dt, ctx) {
    const csm = this.csm;
    if (!csm) return;
    const sun = this.sunRef;
    const I = sun.intensity;
    csm.lightDirection.copy(ctx.getSunDir()).negate();
    for (const l of csm.lights) {
      l.intensity = I;
      l.color.copy(sun.color);
      l.castShadow = I > 0.01;
    }
    csm.update();
  },
};
