// tools/build-data.mjs — turns tools/data/osm_cbd.json (Overpass, see q_cbd.overpassql) into js/harare-data.js
// Frame: 1 unit = 1 m, x = east, z = south (north = -z), origin at the centre of Africa Unity Square.
// usage: node tools/build-data.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildInfill } from './infill.mjs';

const SRC = fileURLToPath(new URL('data/osm_cbd.json', import.meta.url));
const OUT = fileURLToPath(new URL('../js/harare-data.js', import.meta.url));
const osm = JSON.parse(fs.readFileSync(SRC, 'utf8'));

// --- frame: local tangent plane around Africa Unity Square ------------------------------------------------------
const LAT0 = -17.8295, LON0 = 31.0518;
const A = 6378137.0, E2 = 6.69437999014e-3;
const PHI0 = (LAT0 * Math.PI) / 180, S0 = Math.sin(PHI0);
const KX = (Math.PI / 180) * (A / Math.sqrt(1 - E2 * S0 * S0)) * Math.cos(PHI0);
const KY = (Math.PI / 180) * ((A * (1 - E2)) / Math.pow(1 - E2 * S0 * S0, 1.5));
const toWorld = (n) => [(n.lon - LON0) * KX, -(n.lat - LAT0) * KY];
const q = (v) => Math.round(v * 10) / 10;

const nodes = new Map();
const ways = new Map();
for (const e of osm.elements) {
  // The recurse step (`>; out skel`) repeats some elements without tags: never let those replace the tagged copy
  if (e.type === 'node') nodes.set(e.id, { ...e, ...nodes.get(e.id), tags: nodes.get(e.id)?.tags || e.tags });
  else if (e.type === 'way') ways.set(e.id, { ...e, tags: ways.get(e.id)?.tags || e.tags });
}
const pts = (ids) => ids.map((id) => nodes.get(id)).filter(Boolean).map(toWorld);

// Deterministic per-feature random so heights don't change between builds
function rng(seed) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 48271) % 2147483647) / 2147483647;
}

function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return a / 2;
}
const centroid = (r) => r.reduce((c, p) => [c[0] + p[0] / r.length, c[1] + p[1] / r.length], [0, 0]);

// Douglas-Peucker to keep footprints light
function rdp(p, eps) {
  if (p.length < 3) return p;
  let dmax = 0, idx = 0;
  const [ax, az] = p[0], [bx, bz] = p[p.length - 1];
  const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
  for (let i = 1; i < p.length - 1; i++) {
    const d = Math.abs((p[i][0] - ax) * dz - (p[i][1] - az) * dx) / len;
    if (d > dmax) (dmax = d), (idx = i);
  }
  if (dmax <= eps) return [p[0], p[p.length - 1]];
  return rdp(p.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(p.slice(idx), eps));
}

// --- buildings ------------------------------------------------------------------------------------------------------
// Known heights (m) for landmarks OSM leaves untagged; matched against the building name
const LANDMARK_HEIGHTS = [
  [/Joina City/i, 105],
  [/Eastgate Shopping/i, 34],
  [/Karigamombe/i, 92],
  [/Rainbow Towers/i, 62],
  [/Meikles/i, 43],
  [/Old Mutual Centre/i, 72],
  [/Reserve Bank/i, 120],
  [/Construction House/i, 44],
  [/Livingstone House/i, 80],
  [/Kopje Plaza/i, 70],
  [/Charter House/i, 50],
  [/Pearl House/i, 58],
  [/Zimre Centre|ZIMRE/i, 58],
  [/Social Security|NSSA/i, 56],
  [/Mukwati/i, 52],
  [/Parliament/i, 22],
  [/Town House/i, 18],
  [/Main Post/i, 16],
  [/Hurudza/i, 56],
  [/Meikles/i, 46],
];

// The CBD grid core: towers cluster between Julius Nyerere Way and Fourth Street, Kenneth Kaunda and Samora Machel
const coreWeight = (x, z) => {
  const dx = Math.max(0, Math.abs(x + 150) - 650) / 400;
  const dz = Math.max(0, Math.abs(z - 80) - 350) / 300;
  return Math.max(0, 1 - Math.hypot(dx, dz));
};

function buildingHeight(t, ring, id) {
  if (t.name) for (const [re, h] of LANDMARK_HEIGHTS) if (re.test(t.name)) return Math.max(h, parseFloat(t.height) || 0);
  if (t.height) return parseFloat(t.height);
  if (t['building:levels']) return Math.max(1, parseFloat(t['building:levels'])) * 3.5 + 1;
  const r = rng(id);
  const area = Math.abs(ringArea(ring));
  const [cx, cz] = centroid(ring);
  const w = coreWeight(cx, cz);
  if (/^(house|detached|garage|shed|roof|hut|kiosk)$/.test(t.building)) return 3.5 + r() * 2.5;
  if (w <= 0) return 3.5 + Math.floor(r() * r() * 3) * 3.5 + (area > 1500 ? 3.5 : 0);
  // Core: mostly 3–8 floors, the occasional slab tower on a larger plot
  let floors = 2 + Math.floor(r() * 5 * w);
  if (area > 600 && r() < 0.25 * w) floors += 4 + Math.floor(r() * 12 * w);
  return floors * 3.5 + 1;
}

// Closed rings: simplify each half separately (start == end would make every point look collinear)
function rdpRing(ring) {
  const open = ring.slice(0, -1);
  const mid = open.length >> 1;
  if (mid < 2) return open;
  return rdp(open.slice(0, mid + 1), 0.4).slice(0, -1).concat(rdp(open.slice(mid).concat([open[0]]), 0.4).slice(0, -1));
}

const buildings = [];
function addBuilding(t, ring, id) {
  if (ring.length < 4) return;
  ring = rdpRing(ring);
  if (ring.length < 3 || Math.abs(ringArea(ring)) < 12) return;
  if (ringArea(ring) < 0) ring.reverse(); // consistent winding
  const h = Math.min(160, buildingHeight(t, ring, id));
  const b = { h: q(h), p: ring.flatMap(([x, z]) => [q(x), q(z)]) };
  if (t.name) b.n = t.name;
  const kind = t.building === 'yes' ? (t.amenity || t.shop || t.office || t.tourism ? 'commercial' : '') : t.building;
  if (kind) b.k = kind;
  if (t['building:min_level']) b.m = parseFloat(t['building:min_level']) * 3.5;
  buildings.push(b);
}

for (const w of ways.values()) {
  const t = w.tags || {};
  if (!t.building || t.building === 'no') continue;
  if (w.nodes[0] !== w.nodes[w.nodes.length - 1]) continue;
  addBuilding(t, pts(w.nodes), w.id);
}
for (const e of osm.elements) {
  if (e.type !== 'relation' || !e.tags?.building) continue;
  for (const m of e.members) {
    if (m.type !== 'way' || m.role !== 'outer') continue;
    const w = ways.get(m.ref);
    if (w && w.nodes[0] === w.nodes[w.nodes.length - 1]) addBuilding({ ...e.tags, ...(w.tags || {}) }, pts(w.nodes), w.id);
  }
}

// --- roads ----------------------------------------------------------------------------------------------------------
const WIDTH = {
  trunk: 16, primary: 14, secondary: 12, tertiary: 10, residential: 8, unclassified: 7, service: 4.5,
  trunk_link: 7, primary_link: 7, secondary_link: 7, tertiary_link: 7, pedestrian: 10, living_street: 6,
};
const DRIVABLE = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'living_street']);

const roadWays = [...ways.values()].filter((w) => WIDTH[w.tags?.highway] && w.tags.area !== 'yes');
const roads = roadWays.map((w) => {
  const t = w.tags;
  let wd = WIDTH[t.highway];
  if (t.lanes) wd = Math.max(wd * 0.6, parseFloat(t.lanes) * 3.4);
  if (t.oneway === 'yes' && DRIVABLE.has(t.highway)) wd = Math.min(wd, 11);
  const r = { k: t.highway, w: q(wd), p: pts(w.nodes).flatMap(([x, z]) => [q(x), q(z)]) };
  if (t.name) r.n = t.name;
  if (t.oneway === 'yes') r.o = 1;
  return r;
});

// Road graph for traffic: split drivable ways wherever they share a node with another drivable way
const use = new Map();
const driveWays = roadWays.filter((w) => DRIVABLE.has(w.tags.highway));
for (const w of driveWays) w.nodes.forEach((id, i) => use.set(id, (use.get(id) || 0) + (i === 0 || i === w.nodes.length - 1 ? 2 : 1)));
const gIndex = new Map();
const gNodes = [];
const gid = (id) => {
  if (!gIndex.has(id)) {
    const [x, z] = toWorld(nodes.get(id));
    gIndex.set(id, gNodes.length);
    gNodes.push(q(x), q(z));
  }
  return gIndex.get(id);
};
const edges = [];
for (const w of driveWays) {
  const t = w.tags;
  const ids = w.nodes.filter((id) => nodes.has(id));
  let start = 0;
  for (let i = 1; i < ids.length; i++) {
    if (i < ids.length - 1 && use.get(ids[i]) < 2) continue;
    const seg = ids.slice(start, i + 1);
    const e = { a: gid(seg[0]), b: gid(seg[seg.length - 1]), p: pts(seg).flatMap(([x, z]) => [q(x), q(z)]), k: t.highway };
    if (t.oneway === 'yes') e.o = 1;
    else if (t.oneway === '-1') e.o = -1;
    if (t.name) e.n = t.name;
    let lanes = parseInt(t.lanes || '0', 10);
    if (!lanes) lanes = ['trunk', 'primary'].includes(t.highway) ? (e.o ? 3 : 4) : e.o ? 2 : 2;
    e.l = lanes;
    e.w = q(t.lanes ? Math.max(WIDTH[t.highway] * 0.6, lanes * 3.4) : e.o ? Math.min(WIDTH[t.highway], 11) : WIDTH[t.highway]);
    edges.push(e);
    start = i;
  }
}

// --- areas, rail, points --------------------------------------------------------------------------------------------
const areas = [];
for (const w of ways.values()) {
  const t = w.tags || {};
  const k = t.leisure || (/grass|recreation_ground|cemetery|railway/.test(t.landuse || '') ? t.landuse : null);
  if (!k || w.nodes[0] !== w.nodes[w.nodes.length - 1]) continue;
  const ring = rdpRing(pts(w.nodes));
  if (ring.length < 3) continue;
  const a = { k, p: ring.flatMap(([x, z]) => [q(x), q(z)]) };
  if (t.name) a.n = t.name;
  areas.push(a);
}

const rail = [...ways.values()]
  .filter((w) => w.tags?.railway === 'rail')
  .map((w) => pts(w.nodes).flatMap(([x, z]) => [q(x), q(z)]));

const trees = osm.elements.filter((e) => e.type === 'node' && e.tags?.natural === 'tree').flatMap((n) => toWorld(n).map(q));

const places = [];
const seen = new Set();
for (const e of osm.elements) {
  const t = e.tags || {};
  if (!t.name || seen.has(t.name)) continue;
  if (!(t.tourism || /place_of_worship|townhall|bus_station|marketplace/.test(t.amenity || '') || /Unity Square|Harare Gardens/.test(t.name))) continue;
  let p;
  if (e.type === 'node') p = toWorld(e);
  else if (e.type === 'way') p = centroid(pts(e.nodes));
  else continue;
  seen.add(t.name);
  places.push({ n: t.name, x: q(p[0]), z: q(p[1]), k: t.tourism || t.amenity || t.leisure || '' });
}

// --- infill: built-to-the-pavement frontage where OSM has no footprint (see tools/infill.mjs) ----------------------
// Kombi ranks (mirrors js/ranks.js RANKS) stay open
const RANKS = [
  { place: 'Fourth Street Bus Terminus', x: 422, z: 57, r: 64 },
  { place: 'Road Port', x: 546, z: 76, r: 40 },
  { place: 'Market Square', x: -1049, z: 803, r: 52 },
  { place: 'Charge Office Taxi Rank', x: -319, z: 502, r: 36 },
  { x: -330, z: 380, r: 50 },
].map((R) => {
  const pl = R.place && places.find((p) => p.n === R.place);
  return pl ? { ...R, x: pl.x, z: pl.z } : R;
});
const ROAD_RANK = { trunk: 6, primary: 5, secondary: 4, tertiary: 3, trunk_link: 3, primary_link: 3, secondary_link: 3, tertiary_link: 3, residential: 2, unclassified: 2, living_street: 2, pedestrian: 1, service: 0 };
const { infill, lots, stats } = buildInfill({ buildings, roads, areas, rail, trees, ranks: RANKS, rankOf: (k) => ROAD_RANK[k] || 0 });
buildings.push(...infill);
console.log(`[infill] ${stats.infill} buildings, ${stats.parking} parking, ${stats.forecourt} forecourts, ${stats.yard} yards over ${(stats.frontage / 1000).toFixed(1)} km of frontage`);

const data = { buildings, roads, graph: { nodes: gNodes, edges }, areas, rail, trees, places, lots };
fs.writeFileSync(OUT, `// Generated by tools/build-data.mjs from OpenStreetMap (© OpenStreetMap contributors, ODbL). Do not edit.\nexport const DATA = ${JSON.stringify(data)};\n`);
console.log(`[data] ${buildings.length} buildings, ${roads.length} roads, ${edges.length} graph edges / ${gNodes.length / 2} nodes, ${areas.length} areas, ${rail.length} rail, ${trees.length / 2} trees, ${places.length} places → ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
