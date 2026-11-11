// js/trees.js — jacarandas (in bloom: it's October), flamboyants, msasas, gums and plain street trees along the
// avenues and in the parks. Procedural branching skeletons with alpha-tested leaf / blossom spray cards (tree-grow.js,
// tree-atlas.js), three variants per species, three levels of detail picked per tree from the camera and regrouped
// into one instanced mesh per species / variant / level, plus card-shell stand-ins that only draw into the shadow map.
import * as THREE from 'three';
import { groundY, rng, coreWeight, Grid, segDist, pointInPoly, polyBounds } from './util.js';
import { createLeafAtlas, createBarkTextures } from './tree-atlas.js';
import { SPECIES, VARIANTS, buildTreeGeometries } from './tree-grow.js';

// Species mix (SPECIES order: jacaranda, flamboyant, msasa, gum, street) and scale ranges (1 = mature park tree)
const WEIGHTS = [0.42, 0.1, 0.2, 0.13, 0.15];
const SCALE = [[0.9, 1.3], [0.9, 1.2], [0.85, 1.25], [0.8, 1.2], [0.8, 1.12]];
const LOD_NEAR = 75; // full detail within (m, to mid-crown)
const LOD_MID = 280; // coarse cards and branches within; crown shell beyond
const HYST = 5;
const FAR_LOW = 1300; // at street level everything further is behind buildings
const FAR_HIGH = 4200;
// shadow stand-ins within this of the camera: the sun's frustum spans ±130 m on the ground (plus a long low-sun shadow), up to ±700 m in flight
const SHADOW_R_GROUND = 300, SHADOW_R_AIR = 850;

export function buildTrees(scene, DATA, blocked) {
  const t0 = performance.now();
  const r = rng(2026);
  const spots = [];

  const segs = new Grid(30);
  for (const road of DATA.roads)
    for (let i = 2; i < road.p.length; i += 2) {
      const ax = road.p[i - 2], az = road.p[i - 1], bx = road.p[i], bz = road.p[i + 1];
      segs.insert({ ax, az, bx, bz, w: road.w }, Math.min(ax, bx) - 12, Math.min(az, bz) - 12, Math.max(ax, bx) + 12, Math.max(az, bz) + 12);
    }
  const clear = (x, z, pad) => {
    for (const s of segs.query(x, z)) if (segDist(x, z, s.ax, s.az, s.bx, s.bz)[0] < s.w / 2 + pad) return false;
    return !blocked(x, z) && !blocked(x + 2.5, z) && !blocked(x - 2.5, z) && !blocked(x, z + 2.5) && !blocked(x, z - 2.5);
  };

  // Street trees on the verges; the Avenues are lined with jacarandas
  for (const road of DATA.roads) {
    if (!/residential|tertiary|secondary|primary|unclassified/.test(road.k)) continue;
    const avenue = /Avenue|Ave/.test(road.n || '');
    let acc = r() * 10;
    for (let i = 2; i < road.p.length; i += 2) {
      const ax = road.p[i - 2], az = road.p[i - 1], bx = road.p[i], bz = road.p[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const nx = (bz - az) / (len || 1), nz = -(bx - ax) / (len || 1);
      for (; acc < len; acc += 11 + r() * 6) {
        const t = acc / len;
        const mx = ax + (bx - ax) * t, mz = az + (bz - az) * t;
        const core = coreWeight(mx, mz);
        if (r() < core * 0.75) continue; // sparser in the CBD core
        for (const side of [1, -1]) {
          if (r() < 0.25) continue;
          const off = road.w / 2 + 3 + r() * 1.5;
          const x = mx + nx * off * side, z = mz + nz * off * side;
          if (clear(x, z, 2)) spots.push([x, z, avenue && r() < 0.8 ? 0 : -1, 1]);
        }
      }
      acc -= len;
    }
  }

  // Parks: Harare Gardens and friends get dense mixed planting; pitches stay open
  for (const a of DATA.areas) {
    if (!/park|garden|grass|cemetery|recreation_ground/.test(a.k)) continue;
    const [x0, z0, x1, z1] = polyBounds(a.p);
    const area = (x1 - x0) * (z1 - z0);
    const n = Math.min(900, Math.floor(area / (a.k === 'park' || a.k === 'garden' ? 220 : 500)));
    for (let i = 0; i < n; i++) {
      const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
      if (pointInPoly(x, z, a.p) && clear(x, z, 3)) spots.push([x, z, -1, 0]);
    }
  }

  // Scattered yard trees in the low-density blocks around the core
  for (let i = 0; i < 9000; i++) {
    const x = -2700 + r() * 4300, z = -1700 + r() * 3300;
    if (coreWeight(x, z) > 0.3 || r() < 0.5) continue;
    if (clear(x, z, 4)) spots.push([x, z, -1, 0]);
  }

  // Stay inside the detailed map box: greater Harare outside it plants its own trees (features/suburbs.js)
  for (let i = spots.length - 1; i >= 0; i--) {
    const [x, z] = spots[i];
    if (x < -2500 || x > 1400 || z < -1800 || z > 1400) spots.splice(i, 1);
  }

  const pick = () => {
    let t = r();
    for (let k = 0; k < WEIGHTS.length; k++) if ((t -= WEIGHTS[k]) <= 0) return k;
    return 0;
  };

  // --- geometry and materials ----------------------------------------------------------------------------------------
  const atlas = createLeafAtlas();
  const barkTex = createBarkTextures();
  const geos = SPECIES.map((_, s) => Array.from({ length: VARIANTS }, (_, v) => buildTreeGeometries(s, v)));

  const uniforms = { uTime: { value: 0 }, uTrans: { value: 1 } };
  // Wind (whole-tree bend by height, branch sway by hierarchy weight, leaf flutter), interior occlusion, and for the
  // leaves: crown-shell normals on both faces plus light through the leaves (translucency) on the shaded side
  const patch = (mat) => {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uniforms.uTime;
      sh.uniforms.uTrans = uniforms.uTrans;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute vec4 aTree;\nvarying vec2 vTree;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vTree = aTree.xz;
          #ifdef USE_INSTANCING
            float ph = instanceMatrix[3].x * 0.043 + instanceMatrix[3].z * 0.061;
            float gust = 0.65 + 0.35 * sin(uTime * 0.31 + ph * 0.3);
            float hh = max(position.y, 0.0);
            transformed.xz += vec2(0.8, 0.6) * hh * hh * 0.0009 * gust * (0.6 + 0.4 * sin(uTime * 0.83 + ph));
            float w = aTree.y;
            transformed += vec3(sin(uTime * 1.7 + ph + w * 2.0), 0.35 * sin(uTime * 2.3 + ph * 1.7), cos(uTime * 1.45 + ph * 1.3 + w)) * w * 0.07 * gust;
            #ifdef TREE_LEAF
              transformed += objectNormal * sin(uTime * 6.0 + aTree.z * 40.0 + ph) * 0.03 * w;
            #endif
          #endif`
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTrans;\nvarying vec2 vTree;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          #ifdef TREE_LEAF
            diffuseColor.rgb *= vTree.x * (0.86 + 0.28 * vTree.y);
          #else
            diffuseColor.rgb *= vTree.x;
          #endif`
        )
        .replace(
          '#include <alphatest_fragment>',
          `#ifdef TREE_LEAF
            // Leaves right at the lens dissolve (screen-door) so a camera pushed into a crown still shows the hero
            float camD = length(vViewPosition);
            if (camD < 4.0) {
              const float B[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
              ivec2 q = ivec2(mod(gl_FragCoord.xy, 4.0));
              if ((B[q.x + q.y * 4] + 0.5) / 16.0 > (camD - 1.5) / 2.5) discard;
            }
          #endif
          #if defined(USE_ALPHATEST) && defined(ALPHA_TO_COVERAGE)
            // sharpened alpha for alpha-to-coverage: crisp at any distance, antialiased by the MSAA samples
            diffuseColor.a = saturate((diffuseColor.a - alphaTest) / max(fwidth(diffuseColor.a), 0.0001) + 0.5);
            if (diffuseColor.a < 0.02) discard;
          #else
            #include <alphatest_fragment>
          #endif`
        )
        .replace(
          '#include <opaque_fragment>',
          `#ifdef TREE_LEAF
            // foliage in shade and sky light goes greyer, not bluer
            vec3 shadeTint = mix(vec3(1.08, 1.0, 0.84), vec3(1.0), treeSun);
            outgoingLight = mix(vec3(dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722))), outgoingLight * shadeTint, mix(0.62, 0.9, treeSun));
          #endif
          #include <opaque_fragment>`
        )
        .replace(
          '#include <normal_fragment_begin>',
          `#include <normal_fragment_begin>
          #ifdef TREE_LEAF
            normal = normalize(vNormal);
          #endif`
        )
        .replace(
          '#include <lights_fragment_begin>',
          `#include <lights_fragment_begin>
          float treeSun = 1.0;
          #if defined(TREE_LEAF) && NUM_DIR_LIGHTS > 0
          treeSun = saturate(dot(directLight.color, vec3(1.0)) / max(dot(directionalLights[0].color, vec3(1.0)), 1e-4)) * smoothstep(-0.1, 0.5, dot(normal, directLight.direction));
          {
            vec3 Ld = directLight.direction;
            float back = pow(saturate(dot(-geometryViewDir, Ld)), 3.0);
            float thru = saturate(-dot(normal, Ld));
            float wrap = saturate(dot(normal, Ld) * 0.5 + 0.5) * 0.18;
            reflectedLight.directDiffuse += diffuseColor.rgb * directLight.color * RECIPROCAL_PI * uTrans *
              (vec3(1.0, 1.08, 0.7) * (0.3 * thru + 0.9 * back) + wrap);
            // light scattered into the crown: self-shadowed leaves are never as dark as a wall in shade
            vec3 lost = max(directionalLights[0].color - directLight.color, vec3(0.0));
            reflectedLight.directDiffuse += diffuseColor.rgb * lost * RECIPROCAL_PI * 0.3 * (saturate(dot(normal, Ld)) + 0.25 * back);
          }
          #endif`
        );
    };
    return mat;
  };
  const leafMat = patch(new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.82, metalness: 0, alphaToCoverage: true }));
  leafMat.defines = { TREE_LEAF: '' };
  const barkMats = SPECIES.map((sp) => patch(new THREE.MeshStandardMaterial({ color: sp.bark, map: barkTex[sp.barkTex], roughness: 0.92, metalness: 0 })));
  // Shadow stand-ins: never drawn in a colour pass (draw range 0 except while the shadow map renders)
  const proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
  const proxyDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas, alphaTest: 0.5, side: THREE.DoubleSide });

  // --- per-tree data --------------------------------------------------------------------------------------------------
  const N = spots.length;
  const mats = new Float32Array(N * 16), cols = new Float32Array(N * 3);
  const cx = new Float32Array(N), cy = new Float32Array(N), cz = new Float32Array(N), cr = new Float32Array(N);
  const kind = new Uint8Array(N), lod = new Uint8Array(N).fill(255);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const counts = SPECIES.map(() => new Array(VARIANTS).fill(0));
  const jacs = [];
  spots.forEach(([x, z, forced, street], i) => {
    const s = forced >= 0 ? forced : pick();
    const v = Math.floor(r() * VARIANTS);
    kind[i] = s * VARIANTS + v;
    counts[s][v]++;
    const [a, b] = SCALE[s];
    const k = (a + r() * (b - a)) * (street ? 0.9 : 1);
    const y = groundY(x, z);
    q.setFromEuler(e.set(0, r() * Math.PI * 2, 0));
    m.compose(pos.set(x, y, z), q, scl.set(k * (0.9 + r() * 0.2), k * (0.9 + r() * 0.2), k * (0.9 + r() * 0.2)));
    m.toArray(mats, i * 16);
    // per tree: a little brighter or darker, a touch warmer or cooler
    const br = 0.86 + r() * 0.26, hue = (r() - 0.5) * 0.1;
    c.setRGB(br * (1 + hue), br * (1 + hue * 0.3), br * (1 - hue));
    cols.set([c.r, c.g, c.b], i * 3);
    const cw = geos[s][v].crown;
    cx[i] = x;
    cy[i] = y + cw.cy * k;
    cz[i] = z;
    cr[i] = Math.max(cw.r, cw.ry) * k * 1.1;
    if (s === 0) jacs.push([x, z, k, forced === 0]);
  });

  // --- instanced meshes: [species][variant][lod] = { leaf, bark }, [species][variant] = proxy ---------------------------
  const group = new THREE.Group();
  group.name = 'trees';
  const all = [];
  const hideInOverride = (mesh) => {
    // GTAO's normal / depth pass renders the scene with an override material that ignores alpha: keep the cards out
    mesh.onBeforeRender = (rd, scn, cam, geo) => geo.setDrawRange(0, scn.overrideMaterial ? 0 : Infinity);
  };
  const meshes = SPECIES.map((sp, s) =>
    Array.from({ length: VARIANTS }, (_, v) => {
      const cap = Math.max(1, counts[s][v]);
      const G = geos[s][v];
      const lods = G.lods.map((L) => {
        const leaf = new THREE.InstancedMesh(L.leaf, leafMat, cap);
        leaf.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        const bark = new THREE.InstancedMesh(L.bark, barkMats[s], cap);
        bark.instanceMatrix = leaf.instanceMatrix; // one upload serves both
        for (const im of [leaf, bark]) {
          im.count = 0;
          im.visible = false;
          im.frustumCulled = false; // culled per tree in regroup()
          im.receiveShadow = true;
          im.castShadow = false;
          group.add(im);
        }
        hideInOverride(leaf);
        leaf.name = `tree-${sp.name}-v${v}-leaf`;
        bark.name = `tree-${sp.name}-v${v}-bark`;
        const o = { leaf, bark };
        all.push(o);
        return o;
      });
      const proxy = new THREE.InstancedMesh(G.proxy, proxyMat, cap);
      proxy.customDepthMaterial = proxyDepth;
      proxy.castShadow = true;
      proxy.frustumCulled = false;
      proxy.count = 0;
      proxy.visible = false;
      proxy.name = `tree-${sp.name}-v${v}-shadow`;
      G.proxy.setDrawRange(0, 0);
      proxy.onBeforeShadow = () => G.proxy.setDrawRange(0, Infinity);
      proxy.onAfterShadow = () => G.proxy.setDrawRange(0, 0);
      group.add(proxy);
      return { lods, proxy };
    })
  );
  scene.add(group);
  const tris = (l) => geos.map((row) => Math.round(row.reduce((a, G) => a + G.lods[l].leaf.userData.triangles + G.lods[l].bark.userData.triangles, 0) / row.length));
  console.log(`[harare] trees: ${N} (${counts.map((c, s) => `${SPECIES[s].name} ${c.reduce((a, b) => a + b, 0)}`).join(', ')}), triangles per tree lod0 ${tris(0).join('/')} · lod1 ${tris(1).join('/')} · lod2 ${tris(2).join('/')}, built in ${Math.round(performance.now() - t0)} ms`);

  // --- per-tree level of detail and culling ----------------------------------------------------------------------------
  const frustum = new THREE.Frustum(), pm = new THREE.Matrix4();
  const last = new THREE.Vector3(Infinity, 0, 0), lastDir = new THREE.Vector3(), camDir = new THREE.Vector3(), lastShadow = new THREE.Vector3(Infinity, 0, 0);
  let lastShadowR = 0;
  let lastFov = NaN, lastAspect = NaN;
  const fill = new Array(SPECIES.length * VARIANTS * 3).fill(0);
  const gone = new Uint8Array(N); // trees cleared for a plaza (js/features/monuments.js)
  function regroup(cam) {
    fill.fill(0);
    pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pm);
    const planes = frustum.planes;
    const p = cam.position;
    const far = p.y < 40 ? FAR_LOW : FAR_HIGH;
    for (let i = 0; i < N; i++) {
      if (gone[i]) { lod[i] = 255; continue; }
      const dx = cx[i] - p.x, dy = cy[i] - p.y, dz = cz[i] - p.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let next = d < LOD_NEAR ? 0 : d < LOD_MID ? 1 : d < far ? 2 : 255;
      const cur = lod[i];
      if (cur !== 255 && next !== 255 && Math.abs(next - cur) === 1 && Math.abs(d - (Math.min(next, cur) === 0 ? LOD_NEAR : LOD_MID)) < HYST) next = cur;
      lod[i] = next;
      if (next === 255) continue;
      // view frustum with a margin for the camera turning or moving a little before the next regroup
      const rad = cr[i] + 4 + d * 0.1;
      let inside = true;
      for (let k = 0; k < 6; k++) {
        const pl = planes[k];
        if (pl.normal.x * cx[i] + pl.normal.y * cy[i] + pl.normal.z * cz[i] + pl.constant < -rad) {
          inside = false;
          break;
        }
      }
      if (!inside) continue;
      const slot = kind[i] * 3 + next;
      const o = all[slot];
      const n = fill[slot]++;
      o.leaf.instanceMatrix.array.set(mats.subarray(i * 16, i * 16 + 16), n * 16);
      o.leaf.instanceColor.array.set(cols.subarray(i * 3, i * 3 + 3), n * 3);
    }
    all.forEach((o, slot) => {
      const n = fill[slot];
      if (n > 0)
        for (const at of [o.leaf.instanceMatrix, o.leaf.instanceColor]) {
          at.clearUpdateRanges();
          at.addUpdateRange(0, n * at.itemSize);
          at.needsUpdate = true;
        }
      o.leaf.count = o.bark.count = n;
      o.leaf.visible = o.bark.visible = n > 0;
    });
  }
  const pfill = new Array(SPECIES.length * VARIANTS).fill(0);
  const proxies = meshes.flatMap((row) => row.map((x) => x.proxy));
  function regroupShadows(p, R) {
    pfill.fill(0);
    const R2 = R * R;
    for (let i = 0; i < N; i++) {
      if (gone[i]) continue;
      const dx = cx[i] - p.x, dz = cz[i] - p.z;
      if (dx * dx + dz * dz > R2) continue;
      const pr = proxies[kind[i]];
      pr.instanceMatrix.array.set(mats.subarray(i * 16, i * 16 + 16), pfill[kind[i]]++ * 16);
    }
    proxies.forEach((pr, k) => {
      const n = pfill[k];
      if (n > 0) {
        pr.instanceMatrix.clearUpdateRanges();
        pr.instanceMatrix.addUpdateRange(0, n * 16);
        pr.instanceMatrix.needsUpdate = true;
      }
      pr.count = n;
      pr.visible = n > 0;
    });
  }

  // --- fallen jacaranda blossom: thin lilac drifts under the trees ------------------------------------------------------
  const petalTex = (() => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const g = cv.getContext('2d');
    const pr = rng(77);
    // a faint wash where the drift is thickest, then the petals themselves
    const wash = g.createRadialGradient(128, 128, 0, 128, 128, 126);
    wash.addColorStop(0, 'rgba(188,176,200,0.2)');
    wash.addColorStop(0.6, 'rgba(188,176,200,0.08)');
    wash.addColorStop(1, 'rgba(188,176,200,0)');
    g.fillStyle = wash;
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 3200; i++) {
      // denser toward the middle, scattered toward the edge
      const a = pr() * Math.PI * 2, d = Math.pow(pr(), 0.75) * 120;
      const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d;
      const l = 0.78 + pr() * 0.3;
      g.fillStyle = `rgba(${Math.round(190 * l)},${Math.round(176 * l)},${Math.round(208 * l)},${(0.55 + pr() * 0.45) * (1 - d / 135)})`;
      g.beginPath();
      g.ellipse(x, y, 1.2 + pr() * 1.6, 0.8 + pr(), pr() * 3, 0, Math.PI * 2);
      g.fill();
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  })();
  const carpet = jacs.filter((j) => (j[3] ? r() < 0.75 : r() < 0.55));
  const petals = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: petalTex, roughness: 1, transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    Math.max(1, carpet.length)
  );
  carpet.forEach(([x, z, k], i) => {
    const s = (3 + r() * 2.5) * k;
    q.setFromEuler(e.set(0, r() * Math.PI * 2, 0));
    m.compose(pos.set(x + r() * 2 - 1, groundY(x, z) + 0.17, z + r() * 2 - 1), q, scl.set(s, 1, s * (0.7 + r() * 0.5)));
    petals.setMatrixAt(i, m);
  });
  petals.count = carpet.length;
  petals.receiveShadow = true;
  petals.renderOrder = 1;
  petals.name = 'tree-petals';
  group.add(petals);

  return {
    count: N,
    group,
    // crown centres and radii (heat vision aims at them)
    crowns: { cx, cy, cz, cr, gone, N },
    // Remove every tree within r of (x, z) from now on; returns how many went
    clearAround(x, z, r) {
      let n = 0;
      for (let i = 0; i < N; i++) if (!gone[i] && (cx[i] - x) ** 2 + (cz[i] - z) ** 2 < r * r) (gone[i] = 1), n++;
      if (n) last.set(Infinity, 0, 0), lastShadow.set(Infinity, 0, 0);
      return n;
    },
    near(x, z, r) {
      let n = 0;
      for (let i = 0; i < N; i++) if (!gone[i] && (cx[i] - x) ** 2 + (cz[i] - z) ** 2 < r * r) n++;
      return n;
    },
    update(dt, camera) {
      uniforms.uTime.value += dt;
      camera.updateMatrixWorld();
      camera.getWorldDirection(camDir);
      if (camera.position.distanceToSquared(last) > 9 || camDir.dot(lastDir) < 0.996 || !(Math.abs(camera.fov - lastFov) <= 1) || camera.aspect !== lastAspect) {
        last.copy(camera.position);
        lastDir.copy(camDir);
        lastFov = camera.fov;
        lastAspect = camera.aspect;
        regroup(camera);
      }
      const shadowR = camera.position.y - groundY(camera.position.x, camera.position.z) > 60 ? SHADOW_R_AIR : SHADOW_R_GROUND;
      if (shadowR !== lastShadowR || camera.position.distanceToSquared(lastShadow) > 625) {
        lastShadow.copy(camera.position);
        lastShadowR = shadowR;
        regroupShadows(camera.position, shadowR);
      }
    },
  };
}
