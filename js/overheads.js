// js/overheads.js — roofs over the pavement that nothing collides with: shop verandahs and canopies (buildings.js),
// rank shelters (people.js) and street bus shelters (features/furniture.js). Walkers pass under them freely, but a car
// held overhead (features/powers.js) must not, so they are kept here as oriented rectangles with an underside height.
const CELL = 16, grid = new Map();
const key = (i, j) => i * 100003 + j;

// Centre (x, z), unit axis (ax, az) along the length with half length hl, half width hw across it, underside y
export function addOverhead(x, z, ax, az, hl, hw, y) {
  const o = { x, z, ax, az, hl, hw, y };
  const r = Math.hypot(hl, hw);
  for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++)
    for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
      const k = key(i, j);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(o);
    }
}

// The lowest roof underside over (x, z) between heights lo and hi, or null
export function overheadAt(x, z, lo, hi) {
  const list = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!list) return null;
  let best = null;
  for (const o of list) {
    if (o.y < lo || o.y > hi || (best !== null && o.y >= best)) continue;
    const dx = x - o.x, dz = z - o.z, along = dx * o.ax + dz * o.az, across = -dx * o.az + dz * o.ax;
    if (Math.abs(along) <= o.hl && Math.abs(across) <= o.hw) best = o.y;
  }
  return best;
}
