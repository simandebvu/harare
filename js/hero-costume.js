// js/hero-costume.js — the hero's outfits. 'viltrumite' is an original white-and-red flight suit in the spirit of the
// Viltrumites (nothing copied): white suit with a red collar, a dark-red belt with a gold buckle, a chevron chest
// emblem, red gloves and boots, gold clasps and a simulated red cape. 'street' restores the
// character's own clothes. The cape is a small verlet cloth in world space, pinned between the shoulders, with drag
// against still air (so it streams behind in flight) and a torso capsule it cannot pass through.
import * as THREE from 'three';

const WHITE = new THREE.Color('#f1f0ea'), RED = new THREE.Color('#b8141c');
const GOLD = new THREE.Color('#d6a536'), BELT = new THREE.Color('#4b0c10');

// The chest emblem (original): a red disc in a gold ring, crossed by stacked gold chevrons after the chevron frieze on
// the walls of Great Zimbabwe. Body space: metres, y up, +z = the front, at the rest pose.
function emblem(x, y, z, cy, r) {
  if (z < 0.04) return null;
  const u = x / r, v = (y - cy) / r, d = Math.hypot(u, v);
  if (d > 1) return null;
  if (d > 0.84) return GOLD;
  const c = (v + Math.abs(u) * 0.85) * 2.4;
  return Math.abs(u) < 0.62 && v > -0.72 && v < 0.5 && c - Math.floor(c) < 0.42 ? GOLD : RED;
}
const belt = (lo, hi) => (x, y, z) => (y > lo && y < hi ? (z > 0.08 && Math.abs(x) < 0.035 ? GOLD : BELT) : null);

// Per character and material: base colour, how much of the texture's light/dark survives, blur (px) to soften small
// print such as shirt buttons, and painted details by body position
const SUIT = {
  male: {
    Wolf3D_Outfit_Top: { color: WHITE, contrast: 1.5, blur: 4, paint: (x, y, z) => (y > 1.56 && Math.abs(x) < 0.15 ? RED : emblem(x, y, z, 1.38, 0.075)) },
    Wolf3D_Outfit_Bottom: { color: WHITE, contrast: 1.5, blur: 4, paint: belt(1.035, 2) },
    Wolf3D_Outfit_Footwear: { color: RED, contrast: 1.2 },
    Wolf3D_Body: { color: RED, contrast: 0 },
  },
  female: {
    Topmat: { color: WHITE, contrast: 0.25, blur: 3, paint: (x, y, z) => belt(1.0, 1.06)(x, y, z) || emblem(x, y, z, 1.3, 0.065) },
  },
};

// Rasterise each triangle of `meshes` in texture space and ask paint(x, y, z) for its colour at that body point
function paintMap(meshes, W, H, paint) {
  const out = new Float32Array(W * H * 3).fill(-1);
  const v = new THREE.Vector3();
  for (const mesh of meshes) {
    const P = mesh.geometry.attributes.position, UV = mesh.geometry.attributes.uv, I = mesh.geometry.index;
    if (!UV) continue;
    const rest = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      if (mesh.isSkinnedMesh) mesh.applyBoneTransform(i, v);
      v.applyMatrix4(mesh.matrixWorld);
      rest[i * 3] = v.x; rest[i * 3 + 1] = v.y; rest[i * 3 + 2] = v.z;
    }
    const n = I ? I.count : P.count;
    for (let t = 0; t < n; t += 3) {
      const ia = I ? I.getX(t) : t, ib = I ? I.getX(t + 1) : t + 1, ic = I ? I.getX(t + 2) : t + 2;
      const ax = UV.getX(ia) * W, ay = UV.getY(ia) * H, bx = UV.getX(ib) * W, by = UV.getY(ib) * H, cx = UV.getX(ic) * W, cy = UV.getY(ic) * H;
      const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(den) < 1e-9) continue;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)) - 1), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)) + 1);
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)) - 1), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)) + 1);
      for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
        const sx = px + 0.5, sy = py + 0.5;
        const wa = ((by - cy) * (sx - cx) + (cx - bx) * (sy - cy)) / den, wb = ((cy - ay) * (sx - cx) + (ax - cx) * (sy - cy)) / den, wc = 1 - wa - wb;
        if (wa < -0.06 || wb < -0.06 || wc < -0.06) continue; // a little past each edge, so UV seams don't show a hairline
        const c = paint(rest[ia * 3] * wa + rest[ib * 3] * wb + rest[ic * 3] * wc, rest[ia * 3 + 1] * wa + rest[ib * 3 + 1] * wb + rest[ic * 3 + 1] * wc, rest[ia * 3 + 2] * wa + rest[ib * 3 + 2] * wb + rest[ic * 3 + 2] * wc);
        if (c) { const o = (py * W + px) * 3; out[o] = c.r; out[o + 1] = c.g; out[o + 2] = c.b; }
      }
    }
  }
  return out;
}

// Keep the texture's folds and seams but move it to new colours: luminance around its mean (optionally blurred),
// scaled by `contrast`, times the base colour or whatever paintMap put there
function recolour(tex, { color, contrast, blur = 0, paint }, meshes) {
  const img = tex?.image;
  if (!img || !img.width) return null;
  const W = img.width, H = img.height, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, W, H), px = d.data;
  let L = new Float32Array(W * H), mean = 0;
  for (let i = 0; i < W * H; i++) mean += L[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  mean /= W * H;
  if (blur > 0) {
    const tmp = new Float32Array(W * H), r = blur, k = 1 / (2 * r + 1);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0; for (let j = -r; j <= r; j++) s += L[y * W + Math.min(W - 1, Math.max(0, x + j))]; tmp[y * W + x] = s * k; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0; for (let j = -r; j <= r; j++) s += tmp[Math.min(H - 1, Math.max(0, y + j)) * W + x]; L[y * W + x] = s * k; }
  }
  const painted = paint ? paintMap(meshes, W, H, paint) : null;
  const base = color.clone().convertLinearToSRGB(), c = new THREE.Color();
  for (let i = 0; i < W * H; i++) {
    const k = Math.min(1.06, Math.max(0.5, 0.86 + ((L[i] - mean) / 255) * contrast));
    if (painted && painted[i * 3] >= 0) c.setRGB(painted[i * 3], painted[i * 3 + 1], painted[i * 3 + 2]).convertLinearToSRGB();
    else c.copy(base);
    px[i * 4] = c.r * 255 * k; px[i * 4 + 1] = c.g * 255 * k; px[i * 4 + 2] = c.b * 255 * k;
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
  // gold clasps where the cape meets the shoulders, at the front of the collarbones
  const claspGeo = new THREE.SphereGeometry(0.024, 14, 10), claspMat = new THREE.MeshStandardMaterial({ color: GOLD, metalness: 0.85, roughness: 0.3 });
  const clasps = [0, 1].map(() => {
    const c = new THREE.Mesh(claspGeo, claspMat);
    c.castShadow = true; c.matrixAutoUpdate = false; c.matrixWorldAutoUpdate = false;
    root.add(c);
    return c;
  });

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
    set visible(v) { mesh.visible = clasps[0].visible = clasps[1].visible = v; },
    reset() { ready = false; },
    update(dt) {
      // Keep simulating while the camera briefly hides the hero, so the cape doesn't snap back to hanging straight
      if (!mesh.visible) { ready = false; return; }
      root.updateMatrixWorld(true);
      if (!ready) reset();
      topPrev.set(top);
      hSeg = anchors(top);
      legEnd.copy(hips).addScaledVector(up, -0.65);
      // a teleport, landing snap or character swap: start the cloth again rather than stretch it across the city
      if (Math.hypot(top[0] - topPrev[0], top[1] - topPrev[1], top[2] - topPrev[2]) > 3) reset();
      if (!(dt > 0)) return; // a zero-length frame would divide the velocities by zero
      dt = Math.min(dt, 0.05); clock += dt;
      // Carry the cloth along with most of the hero's own motion so it never has to chase them across a metre a frame
      // (that is what stretched it off the shoulders in fast flight); air drag still acts on its true world speed.
      let mx = 0, my = 0, mz = 0;
      for (let i = 0; i < W; i++) (mx += top[i * 3] - topPrev[i * 3]), (my += top[i * 3 + 1] - topPrev[i * 3 + 1]), (mz += top[i * 3 + 2] - topPrev[i * 3 + 2]);
      mx /= W; my /= W; mz /= W;
      const CARRY = 0.85;
      for (let k = W * 3; k < N * 3; k += 3) {
        pos[k] += mx * CARRY; pos[k + 1] += my * CARRY; pos[k + 2] += mz * CARRY;
        prev[k] += mx * CARRY; prev[k + 1] += my * CARRY; prev[k + 2] += mz * CARRY;
      }
      const carriedX = (mx * CARRY) / dt, carriedY = (my * CARRY) / dt, carriedZ = (mz * CARRY) / dt;
      const steps = Math.max(1, Math.min(4, Math.ceil(dt * 120))), h = dt / steps;
      for (let s = 1; s <= steps; s++) {
        const u = s / steps;
        for (let i = 0; i < W; i++) for (let c = 0; c < 3; c++) pos[i * 3 + c] = topPrev[i * 3 + c] + (top[i * 3 + c] - topPrev[i * 3 + c]) * u;
        for (let p = W; p < N; p++) {
          const k = p * 3, row = Math.floor(p / W), col = p % W;
          const vx = (pos[k] - prev[k]) / h + carriedX, vy = (pos[k + 1] - prev[k + 1]) / h + carriedY, vz = (pos[k + 2] - prev[k + 2]) / h + carriedZ;
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
        for (let it = 0; it < 6; it++) {
          for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
            const p = j * W + i;
            if (j < H - 1) link(p, p + W, SEG);
            if (i < W - 1) link(p, p + 1, hSeg * (1 + j * 0.06)); // flares toward the hem
          }
          for (let p = W; p < N; p++) collide(p * 3);
        }
        // Long-range attachment: no point may drift further from its column's pinned top than its rest length down the
        // cloth, so however hard the hero turns or dives the cape cannot stretch away from the shoulders
        for (let j = 1; j < H; j++) for (let i = 0; i < W; i++) {
          const k = (j * W + i) * 3, t = i * 3, max = j * SEG * 1.02;
          const dx = pos[k] - pos[t], dy = pos[k + 1] - pos[t + 1], dz = pos[k + 2] - pos[t + 2], d = Math.hypot(dx, dy, dz);
          if (d > max) { const f = max / d; pos[k] = pos[t] + dx * f; pos[k + 1] = pos[t + 1] + dy * f; pos[k + 2] = pos[t + 2] + dz * f; }
        }
      }
      if (!Number.isFinite(pos[pos.length - 1])) return reset();
      attr.array.set(pos);
      attr.needsUpdate = true;
      // on each collarbone: halfway from the neck to the shoulder joint, a little down and out in front
      for (const [c, a] of [[clasps[0], aL], [clasps[1], aR]]) {
        tmp.lerpVectors(neck, a, 0.55).addScaledVector(up, -0.035).addScaledVector(back, -0.09);
        c.matrixWorld.makeTranslation(tmp.x, tmp.y, tmp.z);
      }
      geo.computeVertexNormals();
    },
  };
}

// Wire the outfits onto a loaded hero. Returns { set(outfit), update(dt) }.
export function createCostume(model, root, character) {
  const spec = SUIT[character] || {};
  const mats = [], meshesOf = new Map();
  model.updateMatrixWorld(true); // rest pose: paintMap reads body positions from it
  model.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!spec[m.name]) continue;
      if (!mats.includes(m)) mats.push(m);
      (meshesOf.get(m) || meshesOf.set(m, []).get(m)).push(o);
    }
  });
  const street = new Map(mats.map((m) => [m, { map: m.map, color: m.color.clone() }]));
  const suit = new Map(mats.map((m) => {
    const look = spec[m.name];
    const map = look.contrast > 0 ? recolour(m.map, look, meshesOf.get(m)) : null;
    return [m, { map, color: map ? new THREE.Color(1, 1, 1) : look.color.clone() }];
  }));
  const cape = createCape(model, root, character === 'female' ? { len: 0.98, legR: 0.34 } : { len: 1.05, legR: 0.2 });
  let outfit = 'street';
  return {
    get outfit() { return outfit; },
    set(name) {
      outfit = name === 'viltrumite' ? 'viltrumite' : 'street';
      const look = outfit === 'viltrumite' ? suit : street;
      for (const m of mats) { const s = look.get(m); m.map = s.map; m.color.copy(s.color); m.needsUpdate = true; }
      if (cape) { cape.visible = outfit === 'viltrumite'; cape.reset(); }
    },
    update(dt) { cape?.update(dt); },
  };
}
