// js/features/lighting.js — street lamps that actually light the city at night.
// Every lamp is splatted once into a top-down light map (colour = sodium orange or LED white, dead lamps from
// load-shedding left out). A shader patch, chained onto each standard material's own onBeforeCompile, adds that light
// to anything near street level (roads, pavements, walls, trees, people, vehicles), falling off with height.
// Runs last among the features so it can patch materials the others created.
import { coreWeight, hash2 } from '../util.js';

const LAMP_RADIUS = 16; // m: pool radius on the ground
const PX = 1.6; // m per light-map texel

export default {
  init(ctx) {
    const { THREE, scene, world } = ctx;
    const spots = world.lightSpots || [];
    if (!spots.length) return;

    // --- light map ------------------------------------------------------------------------------------------------
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of spots) (x0 = Math.min(x0, x)), (z0 = Math.min(z0, z)), (x1 = Math.max(x1, x)), (z1 = Math.max(z1, z));
    x0 -= 40; z0 -= 40; x1 += 40; z1 += 40;
    const W = Math.min(4096, Math.ceil((x1 - x0) / PX)), H = Math.min(4096, Math.ceil((z1 - z0) / PX));
    const sx = W / (x1 - x0), sz = H / (z1 - z0);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    for (const [x, z, dx, dz, on, led] of spots) {
      if (!on) continue;
      // the head overhangs the road by 1.5 m
      const px = (x + dx * 1.5 - x0) * sx, pz = (z + dz * 1.5 - z0) * sz, rad = LAMP_RADIUS * sx;
      const grd = g.createRadialGradient(px, pz, 0, px, pz, rad);
      const c = led ? [200, 214, 255] : [255, 150, 60];
      grd.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0.85)`);
      grd.addColorStop(0.35, `rgba(${c[0]},${c[1]},${c[2]},0.42)`);
      grd.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      g.fillStyle = grd;
      g.fillRect(px - rad, pz - rad, rad * 2, rad * 2);
    }
    // Shopfronts: lit windows and open shops spill warm light onto the pavement in front of them
    let shops = 0;
    for (const bd of ctx.DATA.buildings) {
      const p = bd.p, n = p.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 4) continue;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        if (coreWeight(mx, mz) < 0.2) continue;
        // outward side: whichever side of the edge is outside the footprint (test a step off the midpoint)
        let nx = (bz - az) / len, nz = -(bx - ax) / len;
        if (ctx.buildings.blocked(mx + nx * 1.5, mz + nz * 1.5)) (nx = -nx), (nz = -nz);
        if (ctx.buildings.blocked(mx + nx * 1.5, mz + nz * 1.5)) continue;
        for (let t = 2; t < len - 1; t += 4.5) {
          const x = ax + ((bx - ax) * t) / len + nx * 1.8, z = az + ((bz - az) * t) / len + nz * 1.8;
          if (hash2(Math.floor(x * 0.3), Math.floor(z * 0.3)) < 0.45) continue; // shuttered
          if (x < x0 || x > x1 || z < z0 || z > z1) continue;
          const px = (x - x0) * sx, pz = (z - z0) * sz, rad = 5.5 * sx;
          const grd = g.createRadialGradient(px, pz, 0, px, pz, rad);
          grd.addColorStop(0, 'rgba(255,190,110,0.55)');
          grd.addColorStop(1, 'rgba(255,196,120,0)');
          g.fillStyle = grd;
          g.fillRect(px - rad, pz - rad, rad * 2, rad * 2);
          shops++;
        }
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;

    const uniforms = {
      uLampMap: { value: tex },
      uLampRect: { value: new THREE.Vector4(x0, z0, x1 - x0, z1 - z0) },
      uLampNight: { value: 0 },
    };
    this.uniforms = uniforms;

    // --- material patch ----------------------------------------------------------------------------------------------
    const patch = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLampW;')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          {
            vec4 lw = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
              lw = instanceMatrix * lw;
            #endif
            vLampW = (modelMatrix * lw).xyz;
          }`
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLampW;\nuniform sampler2D uLampMap;\nuniform vec4 uLampRect;\nuniform float uLampNight;')
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
          if (uLampNight > 0.001) {
            vec2 luv = (vLampW.xz - uLampRect.xy) / uLampRect.zw;
            if (luv.x > 0.0 && luv.x < 1.0 && luv.y > 0.0 && luv.y < 1.0) {
              vec3 lamp = texture2D(uLampMap, luv).rgb;
              // lamps hang at ~8 m: ground and lower walls get the pool, upper floors fade out
              float hf = 1.0 - smoothstep(5.0, 16.0, vLampW.y);
              // surfaces facing up catch more than walls
              float up = 0.55 + 0.45 * clamp(dot(normal, (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz), 0.0, 1.0);
              reflectedLight.indirectDiffuse += diffuseColor.rgb * lamp * hf * up * uLampNight * 5.0;
            }
          }`
        );
    };

    const done = new Set();
    // Also handed to late-built geometry (the suburbs) through ctx
    const patchTree = (root) => root.traverse((o) => {
      const mats = o.isMesh ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        if (!m || done.has(m) || !(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.isMeshLambertMaterial)) continue;
        done.add(m);
        const prev = m.onBeforeCompile;
        // three caches programs by onBeforeCompile.toString(); every wrapper has the same source, so key on the
        // original hook (or the material's own key function) or unrelated materials would share one program
        const ownKey = Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey') ? m.customProgramCacheKey.bind(m) : null;
        const prevStr = prev ? prev.toString() : '';
        m.onBeforeCompile = function (sh, r) {
          if (prev) prev.call(this, sh, r);
          patch(sh);
        };
        m.customProgramCacheKey = function () {
          return (ownKey ? ownKey() : prevStr) + '|lamps';
        };
        m.needsUpdate = true;
      }
    });
    patchTree(scene);
    ctx.patchLampMaterials = patchTree;
    this.patched = done.size;
    console.log(`[harare] lighting: ${spots.filter((s) => s[4]).length}/${spots.length} street lamps lit, ${done.size} materials patched, ${W}×${H} light map, ${shops} lit shopfronts`);
  },

  update(dt, ctx) {
    if (this.uniforms) this.uniforms.uLampNight.value = ctx.getNightness();
  },
};
