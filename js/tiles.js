// js/tiles.js — static instanced sets (street furniture, poles, parked cars…) split into tiles a few hundred metres
// across. An InstancedMesh is only culled as a whole, so one set spread over the city is drawn in full from anywhere,
// even behind the camera or 2 km off. Tiles let the camera and shadow frusta skip what is out of view, and each tile
// drops out beyond a view distance, much shorter on phones, where those far, tiny triangles were most of the frame.
import * as THREE from 'three';

const tiles = [];
export const PHONE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

// View distances in metres, [desktop, phone]
export const FAR = {
  prop: [900, 380], // bins, signs, posts, kerb clutter
  pole: [1300, 520], // lamp and traffic-light poles
  car: [1500, 560], // parked cars in lots
};

export function farFor(kind) {
  const f = FAR[kind] || FAR.prop;
  return PHONE ? f[1] : f[0];
}

function register(mesh, far) {
  if (!mesh.boundingSphere) mesh.computeBoundingSphere();
  const s = mesh.boundingSphere.clone().applyMatrix4(mesh.matrixWorld);
  tiles.push({ mesh, x: s.center.x, y: s.center.y, z: s.center.z, r: s.radius, far });
}

// Split a filled, static InstancedMesh into tiles in place (same parent, geometry, material and flags) and register
// them for distance culling. Instances must not move afterwards. Sets with per-instance geometry attributes, or too few
// instances to be worth splitting, are only registered whole.
export function tileStatic(mesh, { size = 300, kind = 'prop' } = {}) {
  const far = farFor(kind);
  const parent = mesh.parent;
  parent?.updateWorldMatrix(true, false);
  mesh.updateMatrixWorld();
  const perInstance = Object.values(mesh.geometry.attributes).some((a) => a.isInstancedBufferAttribute);
  if (!parent || perInstance || mesh.count < 12) return register(mesh, far), [mesh];
  const n = mesh.count, M = mesh.instanceMatrix.array, C = mesh.instanceColor?.array, W = mesh.matrixWorld.elements;
  const buckets = new Map();
  for (let i = 0; i < n; i++) {
    const lx = M[i * 16 + 12], ly = M[i * 16 + 13], lz = M[i * 16 + 14];
    const x = W[0] * lx + W[4] * ly + W[8] * lz + W[12], z = W[2] * lx + W[6] * ly + W[10] * lz + W[14];
    const k = Math.floor(x / size) * 100000 + Math.floor(z / size);
    (buckets.get(k) || buckets.set(k, []).get(k)).push(i);
  }
  if (buckets.size < 2) return register(mesh, far), [mesh];
  const out = [];
  for (const list of buckets.values()) {
    const t = new mesh.constructor(mesh.geometry, mesh.material, list.length);
    if (C) t.instanceColor = new mesh.instanceColor.constructor(new Float32Array(list.length * 3), 3);
    list.forEach((i, j) => {
      t.instanceMatrix.array.set(M.subarray(i * 16, i * 16 + 16), j * 16);
      if (C) t.instanceColor.array.set(C.subarray(i * 3, i * 3 + 3), j * 3);
    });
    for (const k of ['name', 'castShadow', 'receiveShadow', 'renderOrder', 'frustumCulled', 'customDepthMaterial', 'customDistanceMaterial', 'onBeforeRender', 'onAfterRender']) t[k] = mesh[k];
    t.layers.mask = mesh.layers.mask;
    t.userData = { ...mesh.userData, tile: 1 };
    t.matrixAutoUpdate = mesh.matrixAutoUpdate;
    t.position.copy(mesh.position), t.quaternion.copy(mesh.quaternion), t.scale.copy(mesh.scale);
    t.updateMatrix();
    parent.add(t);
    t.updateMatrixWorld();
    t.computeBoundingSphere();
    register(t, far);
    out.push(t);
  }
  parent.remove(mesh);
  return out;
}

// Split one big static mesh (a city-wide road ribbon or ground layer, say) into chunks by triangle position, so the camera
// can skip the chunks out of view. No distance limit: these are the far view. Returns the chunks.
export function chunkMesh(mesh, size = 1500) {
  const g = mesh.geometry, parent = mesh.parent;
  if (!parent || g.groups.length > 1 || mesh.isSkinnedMesh || g.morphAttributes.position || g.isInstancedBufferGeometry) return [mesh];
  if (Object.values(g.attributes).some((a) => a.isInterleavedBufferAttribute)) return [mesh];
  const P = g.attributes.position.array, buckets = new Map();
  const idx = g.index ? g.index.array : { length: g.attributes.position.count }, vi = g.index ? (i) => idx[i] : (i) => i;
  for (let t = 0; t < idx.length; t += 3) {
    const a = vi(t) * 3, b = vi(t + 1) * 3, c = vi(t + 2) * 3;
    const x = (P[a] + P[b] + P[c]) / 3, z = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
    const k = Math.floor(x / size) * 100000 + Math.floor(z / size);
    (buckets.get(k) || buckets.set(k, []).get(k)).push(t);
  }
  if (buckets.size < 2) return [mesh];
  const names = Object.keys(g.attributes), out = [];
  for (const tris of buckets.values()) {
    const remap = new Map(), newIdx = new Uint32Array(tris.length * 3);
    let nv = 0;
    tris.forEach((t, j) => {
      for (let v = 0; v < 3; v++) {
        const o = vi(t + v);
        let n = remap.get(o);
        if (n === undefined) remap.set(o, (n = nv++));
        newIdx[j * 3 + v] = n;
      }
    });
    const ng = new g.constructor();
    for (const name of names) {
      const A = g.attributes[name], s = A.itemSize, src = A.array, dst = new src.constructor(nv * s);
      for (const [o, n] of remap) for (let i = 0; i < s; i++) dst[n * s + i] = src[o * s + i];
      ng.setAttribute(name, new A.constructor(dst, s, A.normalized));
    }
    ng.setIndex(new THREE.BufferAttribute(nv > 65535 ? newIdx : Uint16Array.from(newIdx), 1));
    ng.computeBoundingSphere();
    ng.computeBoundingBox();
    const m = new mesh.constructor(ng, mesh.material);
    for (const k of ['name', 'castShadow', 'receiveShadow', 'renderOrder', 'frustumCulled', 'customDepthMaterial', 'customDistanceMaterial', 'onBeforeRender', 'onAfterRender']) m[k] = mesh[k];
    m.layers.mask = mesh.layers.mask;
    m.userData = { ...mesh.userData };
    m.position.copy(mesh.position), m.quaternion.copy(mesh.quaternion), m.scale.copy(mesh.scale);
    parent.add(m);
    out.push(m);
  }
  parent.remove(mesh);
  g.dispose();
  return out;
}

// Once a frame: hide tiles beyond their view distance (times `k`, which phones shorten in flight)
let frame = 0;
export function updateTiles(camera, k = 1) {
  if ((frame++ & 3) !== 0) return; // a few times a second is plenty
  const p = camera.position;
  for (const t of tiles) {
    const dx = t.x - p.x, dy = t.y - p.y, dz = t.z - p.z, lim = t.far * k + t.r;
    t.mesh.visible = dx * dx + dy * dy + dz * dz < lim * lim;
  }
}

export const tileCount = () => tiles.length;
