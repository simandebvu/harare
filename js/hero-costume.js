// js/hero-costume.js — the hero's outfits. 'viltrumite' is an original white-and-red flight suit in the spirit of the
// Viltrumites (no emblem copied): white suit, red gloves and boots, and a simulated red cape. 'street' restores the
// character's own clothes. The cape is a small verlet cloth in world space, pinned between the shoulders, with drag
// against still air (so it streams behind in flight) and a torso capsule it cannot pass through.
import * as THREE from 'three';

const WHITE = new THREE.Color('#f1f0ea'), RED = new THREE.Color('#b8141c');
// Per character: which materials change, to what, and how much of the original texture's light/dark survives
const SUIT = {
  male: { Wolf3D_Outfit_Top: [WHITE, 1.6], Wolf3D_Outfit_Bottom: [WHITE, 1.6], Wolf3D_Outfit_Footwear: [RED, 1.2], Wolf3D_Body: [RED, 0] },
  female: { Topmat: [WHITE, 0.25] },
};

// Keep the texture's folds and seams but move it to a new colour: luminance around its mean, scaled by `contrast`
function recolour(tex, color, contrast) {
  const img = tex?.image;
  if (!img || !img.width) return null;
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, cv.width, cv.height), px = d.data;
  let mean = 0;
  for (let i = 0; i < px.length; i += 4) mean += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  mean /= px.length / 4;
  const c = color.clone().convertLinearToSRGB();
  for (let i = 0; i < px.length; i += 4) {
    const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const k = Math.min(1.06, Math.max(0.5, 0.86 + ((l - mean) / 255) * contrast));
    px[i] = c.r * 255 * k; px[i + 1] = c.g * 255 * k; px[i + 2] = c.b * 255 * k;
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  for (const k of ['flipY', 'colorSpace', 'wrapS', 'wrapT', 'channel', 'anisotropy']) t[k] = tex[k];
  return t;
}

const BONES = {
  neck: /^(neck_01|mixamorig:?Neck(_\d+)?)$/,
  armL: /^(upperarm_l|mixamorig:?LeftArm(_\d+)?)$/,
  armR: /^(upperarm_r|mixamorig:?RightArm(_\d+)?)$/,
  hips: /^(pelvis|mixamorig:?Hips(_\d+)?)$/,
};

function createCape(model, root, { len = 1.05, legR = 0.2 } = {}) {
  const bones = {};
  model.traverse((o) => { for (const [k, re] of Object.entries(BONES)) if (!bones[k] && re.test(o.name)) bones[k] = o; });
  if (Object.keys(bones).length < 4) return null;
  const W = 7, H = 11, N = W * H, LEN = len, SEG = LEN / (H - 1);
  const pos = new Float32Array(N * 3), prev = new Float32Array(N * 3);
  const geo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', attr);
  const uv = [], idx = [];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) uv.push(i / (W - 1), 1 - j / (H - 1));
  for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) { const a = j * W + i; idx.push(a, a + W, a + 1, a + 1, a + W, a + W + 1); }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: RED, roughness: 0.72, side: THREE.DoubleSide }));
  mesh.name = 'hero-cape';
  mesh.castShadow = true; mesh.frustumCulled = false;
  // vertices are written in world space: keep the mesh's own matrix at identity whatever its parent does
  mesh.matrixAutoUpdate = false; mesh.matrixWorldAutoUpdate = false;
  root.add(mesh);

  const V = (o, v) => o.getWorldPosition(v);
  const neck = new THREE.Vector3(), aL = new THREE.Vector3(), aR = new THREE.Vector3(), hips = new THREE.Vector3();
  const right = new THREE.Vector3(), up = new THREE.Vector3(), back = new THREE.Vector3(), tmp = new THREE.Vector3();
  const top = new Float32Array(W * 3), topPrev = new Float32Array(W * 3);
  let hSeg = 0.1, ready = false, clock = 0;

  function anchors(out) {
    V(bones.neck, neck); V(bones.armL, aL); V(bones.armR, aR); V(bones.hips, hips);
    right.subVectors(aR, aL); up.subVectors(neck, hips).normalize();
    back.crossVectors(right, up).normalize();
    // pinned edge: across the upper back from shoulder to shoulder, a little below the neck, standing off the spine
    for (let i = 0; i < W; i++) {
      const t = -0.04 + (1.08 * i) / (W - 1);
      tmp.lerpVectors(aL, aR, t).lerp(neck, 0.35).addScaledVector(up, -0.06).addScaledVector(back, 0.11);
      out[i * 3] = tmp.x; out[i * 3 + 1] = tmp.y; out[i * 3 + 2] = tmp.z;
    }
    return right.length() * 1.08 / (W - 1);
  }
  function reset() {
    hSeg = anchors(top);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = (j * W + i) * 3;
      pos[k] = prev[k] = top[i * 3] + back.x * j * SEG * 0.25;
      pos[k + 1] = prev[k + 1] = top[i * 3 + 1] - j * SEG;
      pos[k + 2] = prev[k + 2] = top[i * 3 + 2] + back.z * j * SEG * 0.25;
    }
    topPrev.set(top);
    ready = true;
  }
  function link(a, b, len) {
    const ax = a * 3, bx = b * 3;
    const dx = pos[bx] - pos[ax], dy = pos[bx + 1] - pos[ax + 1], dz = pos[bx + 2] - pos[ax + 2];
    const d = Math.hypot(dx, dy, dz) || 1e-6, f = (d - len) / d;
    const wa = a < W ? 0 : 0.5, wb = b < W ? 0 : 0.5, s = wa + wb ? f / (wa + wb) * 0.5 : 0;
    pos[ax] += dx * s * wa * 2; pos[ax + 1] += dy * s * wa * 2; pos[ax + 2] += dz * s * wa * 2;
    pos[bx] -= dx * s * wb * 2; pos[bx + 1] -= dy * s * wb * 2; pos[bx + 2] -= dz * s * wb * 2;
  }
  // Body colliders: torso (hips → neck) and legs or skirt (hips → 0.65 m below): push cloth points out to the surface
  const legEnd = new THREE.Vector3();
  function capsule(k, a, b, R) {
    const bx = b.x - a.x, by = b.y - a.y, bz = b.z - a.z, L2 = bx * bx + by * by + bz * bz || 1;
    const t = Math.max(0, Math.min(1, ((pos[k] - a.x) * bx + (pos[k + 1] - a.y) * by + (pos[k + 2] - a.z) * bz) / L2));
    const cx = a.x + bx * t, cy = a.y + by * t, cz = a.z + bz * t;
    const dx = pos[k] - cx, dy = pos[k + 1] - cy, dz = pos[k + 2] - cz, d = Math.hypot(dx, dy, dz);
    if (d < R) {
      const nx = d > 1e-4 ? dx / d : back.x, ny = d > 1e-4 ? dy / d : back.y, nz = d > 1e-4 ? dz / d : back.z;
      pos[k] = cx + nx * R; pos[k + 1] = cy + ny * R; pos[k + 2] = cz + nz * R;
    }
  }
  function collide(k) {
    capsule(k, hips, neck, 0.19);
    capsule(k, hips, legEnd, legR);
  }

  return {
    mesh,
    reset() { ready = false; },
    update(dt) {
      if (!mesh.visible || !root.visible) { ready = false; return; }
      root.updateMatrixWorld(true);
      if (!ready) reset();
      topPrev.set(top);
      hSeg = anchors(top);
      legEnd.copy(hips).addScaledVector(up, -0.65);
      // a teleport, landing snap or character swap: start the cloth again rather than stretch it across the city
      if (Math.hypot(top[0] - topPrev[0], top[1] - topPrev[1], top[2] - topPrev[2]) > 3) reset();
      if (!(dt > 0)) return; // a zero-length frame would divide the velocities by zero
      dt = Math.min(dt, 0.05); clock += dt;
      const steps = Math.max(1, Math.min(4, Math.ceil(dt * 120))), h = dt / steps;
      for (let s = 1; s <= steps; s++) {
        const u = s / steps;
        for (let i = 0; i < W; i++) for (let c = 0; c < 3; c++) pos[i * 3 + c] = topPrev[i * 3 + c] + (top[i * 3 + c] - topPrev[i * 3 + c]) * u;
        for (let p = W; p < N; p++) {
          const k = p * 3, row = Math.floor(p / W), col = p % W;
          const vx = (pos[k] - prev[k]) / h, vy = (pos[k + 1] - prev[k + 1]) / h, vz = (pos[k + 2] - prev[k + 2]) / h;
          const sp = Math.hypot(vx, vy, vz);
          // still-air drag makes it trail; a speed-scaled flutter keeps it alive in flight
          const fl = Math.sin(clock * 14 + col * 1.1 + row * 0.8) * Math.min(6, sp * 0.35) * (row / H);
          const ax = -vx * 1.6 + right.x * fl * 0.15 + back.x * fl, ay = -9.8 - vy * 1.6 + back.y * fl, az = -vz * 1.6 + right.z * fl * 0.15 + back.z * fl;
          for (let c = 0; c < 3; c++) {
            const cur = pos[k + c], a = c === 0 ? ax : c === 1 ? ay : az;
            pos[k + c] = cur + (cur - prev[k + c]) * 0.985 + a * h * h;
            prev[k + c] = cur;
          }
        }
        for (let it = 0; it < 4; it++) {
          for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
            const p = j * W + i;
            if (j < H - 1) link(p, p + W, SEG);
            if (i < W - 1) link(p, p + 1, hSeg * (1 + j * 0.06)); // flares toward the hem
          }
          for (let p = W; p < N; p++) collide(p * 3);
        }
      }
      if (!Number.isFinite(pos[pos.length - 1])) return reset();
      attr.array.set(pos);
      attr.needsUpdate = true;
      geo.computeVertexNormals();
    },
  };
}

// Wire the outfits onto a loaded hero. Returns { set(outfit), update(dt) }.
export function createCostume(model, root, character) {
  const spec = SUIT[character] || {};
  const mats = [];
  model.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (spec[m.name] && !mats.includes(m)) mats.push(m);
  });
  const street = new Map(mats.map((m) => [m, { map: m.map, color: m.color.clone() }]));
  const suit = new Map(mats.map((m) => {
    const [color, contrast] = spec[m.name];
    const map = contrast > 0 ? recolour(m.map, color, contrast) : null;
    return [m, { map, color: map ? new THREE.Color(1, 1, 1) : color.clone() }];
  }));
  const cape = createCape(model, root, character === 'female' ? { len: 0.98, legR: 0.34 } : { len: 1.05, legR: 0.2 });
  let outfit = 'street';
  return {
    get outfit() { return outfit; },
    set(name) {
      outfit = name === 'viltrumite' ? 'viltrumite' : 'street';
      const look = outfit === 'viltrumite' ? suit : street;
      for (const m of mats) { const s = look.get(m); m.map = s.map; m.color.copy(s.color); m.needsUpdate = true; }
      if (cape) { cape.mesh.visible = outfit === 'viltrumite'; cape.reset(); }
    },
    update(dt) { cape?.update(dt); },
  };
}
