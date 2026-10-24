// js/hud/render.js — 2D map layers (Path2D in world metres) shared by the minimap pre-render and the Street Atlas.
// x east, z south: canvas x = world x, canvas y = world z, so north is up.

export const ROAD_STYLE = {
  trunk: { c: '#e7a34b', w: 13, z: 9, min: 2.2 },
  trunk_link: { c: '#cf9245', w: 7, z: 8, min: 1.4 },
  primary: { c: '#e2c46a', w: 11, z: 7, min: 1.9 },
  primary_link: { c: '#c9ad5e', w: 6, z: 6, min: 1.2 },
  secondary: { c: '#d8d2c3', w: 9, z: 5, min: 1.6 },
  secondary_link: { c: '#bdb7aa', w: 6, z: 5, min: 1.1 },
  tertiary: { c: '#b7b2a6', w: 8, z: 4, min: 1.3 },
  unclassified: { c: '#8e8a82', w: 7, z: 3, min: 1 },
  residential: { c: '#8e8a82', w: 7, z: 3, min: 1 },
  pedestrian: { c: '#a98bd6', w: 5, z: 2, min: 1, dash: true },
  service: { c: '#4c4d52', w: 4, z: 1, min: 0.6 },
};
const AREA_FILL = { park: '#1f3b2a', golf_course: '#1d3626', pitch: '#22402c', grass: '#1c3326', sports_centre: '#1f3a2b' };

export function buildLayers(DATA) {
  const roads = {};
  for (const r of DATA.roads) {
    const k = ROAD_STYLE[r.k] ? r.k : 'residential';
    const p = (roads[k] ||= { path: new Path2D(), w: 0, n: 0 });
    p.path.moveTo(r.p[0], r.p[1]);
    for (let i = 2; i < r.p.length; i += 2) p.path.lineTo(r.p[i], r.p[i + 1]);
    p.w += r.w || ROAD_STYLE[k].w;
    p.n++;
  }
  for (const k in roads) roads[k].w /= roads[k].n;
  const order = Object.keys(roads).sort((a, b) => ROAD_STYLE[a].z - ROAD_STYLE[b].z);
  const areas = {};
  for (const a of DATA.areas) {
    const p = (areas[a.k] ||= new Path2D());
    p.moveTo(a.p[0], a.p[1]);
    for (let i = 2; i < a.p.length; i += 2) p.lineTo(a.p[i], a.p[i + 1]);
    p.closePath();
  }
  // Harare Gardens is untagged in the extract: the unnamed park beside the National Gallery
  const bld = new Path2D(), bldTall = new Path2D();
  for (const b of DATA.buildings) {
    const t = b.h > 40 ? bldTall : bld;
    t.moveTo(b.p[0], b.p[1]);
    for (let i = 2; i < b.p.length; i += 2) t.lineTo(b.p[i], b.p[i + 1]);
    t.closePath();
  }
  const rail = new Path2D();
  for (const r of DATA.rail) {
    rail.moveTo(r[0], r[1]);
    for (let i = 2; i < r.length; i += 2) rail.lineTo(r[i], r[i + 1]);
  }
  return { roads, order, areas, bld, bldTall, rail };
}

// Draw the base map. `s` = px per metre (already applied to the context transform by the caller).
export function drawLayers(g, L, s, o = {}) {
  const bright = o.bright || 1;
  for (const k in L.areas) {
    g.fillStyle = AREA_FILL[k] || '#1d3526';
    g.fill(L.areas[k]);
  }
  if (o.buildings !== false) {
    g.fillStyle = o.bldColor || '#252a32';
    g.fill(L.bld);
    g.fillStyle = o.bldTallColor || '#2e3440';
    g.fill(L.bldTall);
  }
  // Rail: dark bed + dashed sleepers
  g.lineCap = 'butt';
  g.strokeStyle = '#3b3630';
  g.lineWidth = Math.max(5, 2.5 / s);
  g.stroke(L.rail);
  g.strokeStyle = '#9a8f7c';
  g.lineWidth = Math.max(1.4, 0.9 / s);
  g.setLineDash([Math.max(6, 4 / s), Math.max(6, 4 / s)]);
  g.stroke(L.rail);
  g.setLineDash([]);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // Casings first (all classes), then fills, so junctions read cleanly
  for (const k of L.order) {
    const st = ROAD_STYLE[k], r = L.roads[k];
    if (k === 'service' || k === 'pedestrian') continue;
    g.strokeStyle = '#0b0d10';
    g.lineWidth = Math.max(r.w + 3, (st.min + 1.4) / s);
    g.stroke(r.path);
  }
  for (const k of L.order) {
    const st = ROAD_STYLE[k], r = L.roads[k];
    g.strokeStyle = st.c;
    g.globalAlpha = (k === 'service' ? 0.85 : 1) * Math.min(1, bright);
    g.lineWidth = Math.max(r.w, st.min / s);
    if (st.dash) g.setLineDash([Math.max(4, 3 / s), Math.max(3, 2 / s)]);
    g.stroke(r.path);
    if (st.dash) g.setLineDash([]);
  }
  g.globalAlpha = 1;
}

// Text label with a dark halo
export function haloText(g, text, x, y, fill = '#f3efe6', halo = 'rgba(8,10,13,0.9)', hw = 3) {
  g.lineWidth = hw;
  g.strokeStyle = halo;
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
}

const ICON_COL = { park: '#5fcf86', mall: '#ffcf3a', tower: '#ffcf3a', civic: '#ffcf3a', hotel: '#d9a6ff', bus: '#ff8a5c', rail: '#c9b79a', hill: '#c7a77a' };
export const iconColor = (k) => ICON_COL[k] || '#ffcf3a';

// Map pin in screen space
export function drawPin(g, x, y, col, r = 5) {
  g.beginPath();
  g.arc(x, y, r + 2, 0, Math.PI * 2);
  g.fillStyle = 'rgba(8,10,13,0.85)';
  g.fill();
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = col;
  g.fill();
  g.beginPath();
  g.arc(x, y, r * 0.38, 0, Math.PI * 2);
  g.fillStyle = 'rgba(8,10,13,0.8)';
  g.fill();
}

// Player arrow at (x,y) pointing along screen angle `a` (0 = up)
export function drawArrow(g, x, y, a, size = 9, col = '#ffcf3a') {
  g.save();
  g.translate(x, y);
  g.rotate(a);
  g.beginPath();
  g.arc(0, 0, size * 2.1, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,207,58,0.16)';
  g.fill();
  g.beginPath();
  g.moveTo(0, -size * 1.25);
  g.lineTo(size * 0.9, size * 0.95);
  g.lineTo(0, size * 0.45);
  g.lineTo(-size * 0.9, size * 0.95);
  g.closePath();
  g.lineJoin = 'round';
  g.lineWidth = 3;
  g.strokeStyle = '#0b0d10';
  g.stroke();
  g.fillStyle = col;
  g.fill();
  g.restore();
}
