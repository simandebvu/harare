// js/features/detail.js — after the city is built, splits every static instanced set (tagged userData.static by the
// module that made it: 'prop', 'pole' or 'car') into tiles, then hides tiles beyond their view distance as you move.
// See js/tiles.js.
import { tileStatic, chunkMesh, updateTiles, tileCount } from '../tiles.js';

export default {
  init(ctx) {
    const sets = [];
    ctx.scene.traverse((o) => o.isInstancedMesh && o.userData.static && sets.push(o));
    let n = 0;
    for (const m of sets) n += tileStatic(m, { kind: m.userData.static, size: m.userData.static === 'car' ? 400 : 300 }).length;
    // CBD ground and road layers (tagged userData.chunk in js/world.js), when big and spread out
    const big = [];
    ctx.scene.traverse((o) => {
      if (!o.userData.chunk || o.isInstancedMesh) return;
      const g = o.geometry, tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
      if (!g.boundingSphere) g.computeBoundingSphere();
      if (tris > 20000 && g.boundingSphere.radius > 1500) big.push(o);
    });
    let c = 0;
    for (const m of big) c += chunkMesh(m, 1200).length;
    if (ctx.perf) console.info(`[harare] ${sets.length} static sets → ${n} tiles (${tileCount()} culled by distance); ${big.length} ground layers → ${c} chunks`);
  },
  update(dt, ctx) {
    updateTiles(ctx.camera);
  },
};
