// tools/build-suburbs.mjs — greater Harare around the detailed CBD: tools/data/osm_suburbs.json (Overpass, see
// q_suburbs.overpassql) → js/suburbs-data.js. Same frame as tools/build-data.mjs (metres, x = east, z = south, origin
// Africa Unity Square). Everything inside the detailed CBD bbox is left to js/harare-data.js: roads are clipped at its
// edge, areas / buildings wholly inside are dropped.
// usage: node tools/build-suburbs.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('data/osm_suburbs.json', import.meta.url));
const OUT = fileURLToPath(new URL('../js/suburbs-data.js', import.meta.url));
const osm = JSON.parse(fs.readFileSync(SRC, 'utf8'));

const LAT0 = -17.8295, LON0 = 31.0518;
const A = 6378137.0, E2 = 6.69437999014e-3;
const PHI0 = (LAT0 * Math.PI) / 180, S0 = Math.sin(PHI0);
const KX = (Math.PI / 180) * (A / Math.sqrt(1 - E2 * S0 * S0)) * Math.cos(PHI0);
const KY = (Math.PI / 180) * ((A * (1 - E2)) / Math.pow(1 - E2 * S0 * S0, 1.5));
const ll = (lat, lon) => [(lon - LON0) * KX, -(lat - LAT0) * KY];
const toWorld = (n) => ll(n.lat, n.lon);

// Detailed CBD bbox (tools/data/q_cbd.overpassql) in world metres
const [BX0, BZ1] = ll(-17.842, 31.028), [BX1, BZ0] = ll(-17.813, 31.065);
const inBox = (x, z) => x > BX0 && x < BX1 && z > BZ0 && z < BZ1;

const nodes = new Map(), ways = new Map(), rels = [];
for (const e of osm.elements) {
  if (e.type === 'node') nodes.set(e.id, { ...e, ...nodes.get(e.id), tags: nodes.get(e.id)?.tags || e.tags });
  else if (e.type === 'way') ways.set(e.id, { ...e, tags: ways.get(e.id)?.tags || e.tags });
  else if (e.type === 'relation') rels.push(e);
}
const pts = (ids) => ids.map((id) => nodes.get(id)).filter(Boolean).map(toWorld);

function rdp(p, eps) {
  if (p.length < 3) return p;
  let dmax = 0, idx = 0;
  const [ax, az] = p[0], [bx, bz] = p[p.length - 1];
  const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
  for (let i = 1; i < p.length - 1; i++) {
    const d = len > 0.01 ? Math.abs((p[i][0] - ax) * dz - (p[i][1] - az) * dx) / len : Math.hypot(p[i][0] - ax, p[i][1] - az);
    if (d > dmax) (dmax = d), (idx = i);
  }
  if (dmax <= eps) return [p[0], p[p.length - 1]];
  return rdp(p.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(p.slice(idx), eps));
}
const ringArea = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return a / 2;
};
// Delta-encoded integer metres: [x0, z0, dx1, dz1, ...]
function enc(p) {
  const o = [];
  let px = 0, pz = 0;
  for (const [x, z] of p) {
    const ix = Math.round(x), iz = Math.round(z);
    o.push(ix - px, iz - pz);
    (px = ix), (pz = iz);
  }
  return o;
}

// Split a polyline into the runs that lie outside the CBD bbox, cutting exactly on its edge
function clipOutside(p) {
  const runs = [];
  let cur = [];
  const cut = (a, b) => {
    // parametric crossings of segment a→b with the box edges, sorted
    const ts = [];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    for (const [v, d, o, lo, hi] of [[BX0, dx, a[0], BZ0, BZ1], [BX1, dx, a[0], BZ0, BZ1]]) {
      if (d === 0) continue;
      const t = (v - o) / d, z = a[1] + dz * t;
      if (t > 0 && t < 1 && z >= lo && z <= hi) ts.push(t);
    }
    for (const v of [BZ0, BZ1]) {
      if (dz === 0) continue;
      const t = (v - a[1]) / dz, x = a[0] + dx * t;
      if (t > 0 && t < 1 && x >= BX0 && x <= BX1) ts.push(t);
    }
    return ts.sort((x, y) => x - y).map((t) => [a[0] + dx * t, a[1] + dz * t]);
  };
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    if (i > 0) {
      for (const c of cut(p[i - 1], a)) {
        cur.push(c);
        if (cur.length >= 2 && !inBox((cur[0][0] + cur[1][0]) / 2, (cur[0][1] + cur[1][1]) / 2)) runs.push(cur);
        cur = [c];
      }
    }
    cur.push(a);
  }
  if (cur.length >= 2) runs.push(cur);
  return runs.filter((r) => {
    if (r.length < 2) return false;
    const m = Math.floor((r.length - 1) / 2);
    return !inBox((r[m][0] + r[m + 1][0]) / 2, (r[m][1] + r[m + 1][1]) / 2);
  });
}

// --- roads ------------------------------------------------------------------------------------------------------------
// class: 0 trunk/motorway · 1 primary · 2 secondary · 3 tertiary · 4 link · 5 residential/unclassified
const RCLASS = { motorway: 0, trunk: 0, primary: 1, secondary: 2, tertiary: 3, motorway_link: 4, trunk_link: 4, primary_link: 4, secondary_link: 4, tertiary_link: 4, residential: 5, unclassified: 5, living_street: 5 };
const RWIDTH = [15, 13, 11, 9, 7, 6.5];
const roads = [];
for (const w of ways.values()) {
  const t = w.tags || {};
  const c = RCLASS[t.highway];
  if (c === undefined || t.area === 'yes') continue;
  let wd = RWIDTH[c];
  if (t.lanes && c < 4) wd = Math.max(wd * 0.7, parseFloat(t.lanes) * 3.4);
  if (t.oneway === 'yes' && c < 4) wd = Math.min(wd, 9);
  if (t.highway === 'unclassified') wd = 6;
  const dirt = /unpaved|dirt|gravel|ground|earth|compacted/.test(t.surface || '') ? 1 : 0;
  for (const run of clipOutside(pts(w.nodes))) {
    const p = rdp(run, c < 5 ? 1.0 : 1.6);
    if (p.length < 2) continue;
    const r = [c, Math.round(wd * 2) / 2, dirt, enc(p)];
    if (t.name && c <= 3) r.push(t.name);
    roads.push(r);
  }
}

// --- areas ------------------------------------------------------------------------------------------------------------
// Land-cover classes (match js/features/suburbs.js CLS)
const C = { residential: 1, industrial: 2, commercial: 3, park: 4, golf: 5, wood: 6, water: 7, wetland: 8, farm: 9, cemetery: 10, aerodrome: 11, apron: 12, railway: 13, bare: 14, institution: 15, pitch: 16, military: 17 };
function classify(t) {
  if (t.natural === 'water' || t.landuse === 'reservoir' || t.landuse === 'basin' || t.water) return t.water === 'Borehole' ? null : C.water;
  if (t.aeroway === 'apron' || t.aeroway === 'terminal') return t.aeroway === 'apron' ? C.apron : null;
  if (t.aeroway === 'aerodrome') return C.aerodrome;
  if (t.leisure === 'golf_course') return C.golf;
  if (t.leisure === 'pitch' || t.leisure === 'stadium') return C.pitch;
  if (/park|garden|recreation_ground|sports_centre/.test(t.leisure || '')) return C.park;
  if (t.leisure === 'nature_reserve' || t.natural === 'wood' || t.landuse === 'forest') return C.wood;
  if (/wetland|grassland|heath/.test(t.natural || '') || /meadow|grass|greenfield|village_green/.test(t.landuse || '')) return C.wetland;
  if (t.natural === 'scrub') return C.wood;
  if (t.natural === 'bare_rock' || /quarry|landfill|construction|brownfield/.test(t.landuse || '')) return C.bare;
  const lu = t.landuse || '';
  if (lu === 'residential') return C.residential;
  if (/industrial|garages|depot|port/.test(lu)) return C.industrial;
  if (/commercial|retail/.test(lu)) return C.commercial;
  if (/farmland|farmyard|orchard|animal_keeping|plant_nursery|greenhouse/.test(lu)) return C.farm;
  if (lu === 'cemetery') return C.cemetery;
  if (lu === 'railway') return C.railway;
  if (lu === 'military' || t.amenity === 'prison') return C.military;
  if (/school|university|college|hospital/.test(t.amenity || '') || /education|religious|police/.test(lu)) return C.institution;
  if (lu === 'recreation_ground') return C.park;
  return null;
}

// Join a multipolygon's outer member ways into closed rings
function assembleRings(memberWays) {
  const segs = memberWays.map((w) => w.nodes.slice()).filter((s) => s.length >= 2);
  const rings = [];
  while (segs.length) {
    let ring = segs.shift();
    let grew = true;
    while (ring[0] !== ring[ring.length - 1] && grew) {
      grew = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i], end = ring[ring.length - 1];
        if (s[0] === end) ring = ring.concat(s.slice(1));
        else if (s[s.length - 1] === end) ring = ring.concat(s.slice().reverse().slice(1));
        else continue;
        segs.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring[0] === ring[ring.length - 1]) rings.push(ring);
  }
  return rings;
}

const areas = [];
function addArea(cls, ids, t) {
  let ring = pts(ids);
  if (ring.length < 4) return;
  ring = ring.slice(0, -1);
  const area = Math.abs(ringArea(ring));
  if (area < 300) return;
  if (ring.every(([x, z]) => inBox(x, z))) return;
  const half = ring.length >> 1;
  ring = rdp(ring.slice(0, half + 1), 2).slice(0, -1).concat(rdp(ring.slice(half).concat([ring[0]]), 2).slice(0, -1));
  if (ring.length < 3) return;
  const a = [cls, enc(ring)];
  if (t.name && (cls === C.golf || cls === C.water || cls === C.wood || cls === C.aerodrome)) a.push(t.name);
  areas.push({ a, area });
}
const relWays = new Set();
for (const r of rels) {
  const t = r.tags || {};
  const cls = classify(t);
  if (!cls) continue;
  const outers = r.members.filter((m) => m.type === 'way' && m.role !== 'inner').map((m) => ways.get(m.ref)).filter(Boolean);
  outers.forEach((w) => relWays.add(w.id));
  for (const ring of assembleRings(outers)) addArea(cls, ring, t);
}
for (const w of ways.values()) {
  const t = w.tags || {};
  if (t.highway || t.building && !t.aeroway) continue;
  const cls = classify(t);
  if (!cls || w.nodes[0] !== w.nodes[w.nodes.length - 1]) continue;
  addArea(cls, w.nodes, t);
}
// Paint big areas first so small ones (pitches inside parks, ponds inside golf courses) land on top
areas.sort((a, b) => b.area - a.area);

// --- lines: rivers & streams, runways & taxiways, rail ---------------------------------------------------------------
const lines = [];
for (const w of ways.values()) {
  const t = w.tags || {};
  let k = null, wd = 0;
  if (t.waterway === 'river') (k = 0), (wd = 9);
  else if (t.waterway === 'stream') (k = 1), (wd = 3);
  else if (t.aeroway === 'runway') (k = t.surface === 'grass' ? 3 : 2), (wd = parseFloat(t.width) || 45);
  else if (t.aeroway === 'taxiway') (k = 4), (wd = parseFloat(t.width) || 18);
  else if (t.railway === 'rail') (k = 5), (wd = 3.6);
  if (k === null) continue;
  for (const run of clipOutside(pts(w.nodes))) {
    const p = rdp(run, k <= 1 ? 3 : 1.5);
    if (p.length >= 2) lines.push([k, wd, enc(p)]);
  }
}

// --- buildings: the OSM-mapped sheds, malls and flats beyond the CBD ---------------------------------------------------
const buildings = [];
for (const w of ways.values()) {
  const t = w.tags || {};
  if (!t.building || w.nodes[0] !== w.nodes[w.nodes.length - 1]) continue;
  let ring = pts(w.nodes).slice(0, -1);
  if (ring.length < 3 || ring.some(([x, z]) => inBox(x + Math.sign(x) * 30, z + Math.sign(z) * 30))) continue;
  const area = Math.abs(ringArea(ring));
  if (area < 25) continue;
  ring = rdp(ring.concat([ring[0]]), 0.7).slice(0, -1);
  if (ring.length < 3) continue;
  if (ringArea(ring) < 0) ring.reverse();
  const lv = parseFloat(t['building:levels']);
  const b = t.building;
  let h = lv ? lv * 3.3 + 1 : b === 'apartments' ? 13 : b === 'industrial' || b === 'warehouse' || b === 'hangar' ? 7 + Math.min(5, area / 900) : b === 'stadium' ? 16 : b === 'retail' || b === 'mall' ? 7 : b === 'commercial' ? 9 : 6;
  if (t.aeroway === 'terminal') h = 16;
  // kind: 0 shed · 1 shops/offices · 2 flats · 3 stadium stand · 4 terminal
  const kind = t.aeroway === 'terminal' ? 4 : b === 'stadium' ? 3 : b === 'apartments' || lv >= 4 ? 2 : /industrial|warehouse|hangar/.test(b) ? 0 : 1;
  buildings.push([kind, Math.round(h), enc(ring)]);
}

// --- neighbourhood character ---------------------------------------------------------------------------------------
// density 0 = leafy low-density (acre plots, pools, jacarandas) · 0.45 = medium (Eastlea, Milton Park) ·
// 0.9 = high-density (Mbare, Highfield, Glen Norah: tight grids of four-roomed houses) · 1 = informal (Epworth)
const DENSITY = [
  [/Borrowdale|Mandara|Chisipite|Greystone|Vainona|Glen Lorne|Highlands|Gunhill|Mount Pleasant|Northwood|Arundel|The Grange|Lewisam|Carrick Creagh|Ballantyne|Colne Valley|Pomona|Emerald Hill|Philadelphia|Alexandra Park|Kambanji/i, 0.06],
  [/Avondale|Belgravia|Marlborough|Strathaven|Monavale|Bluff Hill|Tynwald|Mabelreign|Greendale|Braeside|Hatfield|Prospect|Waterfalls|Eyestone|Cranborne|Hillside|Milton Park|Eastlea|Belvedere|Workington|Westgate|Meyrick/i, 0.42],
  [/Westlea|Warren Park D|Sunningdale|Southview|Ardbennie/i, 0.72],
  [/Mbare|Matapi|Highfield|Glen Norah|Glen View|Budiriro|Kambuzuma|Warren Park|Westwood|Mufakose|Cold Comfort|Hopley|Dzivarasekwa|Kuwadzana|Mabvuku|Tafara|Rugare|Lochinvar/i, 0.92],
  [/Epworth|Chinamano|Domboramwari|Jacha|Makomo|Muguta|Nyikavanhu|Overspill|Zinyengere|Stopover|Magada|Glenwood/i, 1.0],
];
const anchors = [];
for (const n of nodes.values()) {
  const t = n.tags || {};
  if (!t.place || !t.name) continue;
  const m = DENSITY.find(([re]) => re.test(t.name));
  if (!m) continue;
  const [x, z] = toWorld(n);
  anchors.push([Math.round(x), Math.round(z), m[1], t.name]);
}
// Hand-placed suburbs OSM leaves without a place node (lat, lon, density)
for (const [n, lat, lon, d] of [
  ['Belgravia', -17.8135, 31.0410, 0.3], ['Alexandra Park', -17.7920, 31.0570, 0.08], ['Emerald Hill', -17.7930, 31.0190, 0.12],
  ['Glen Lorne', -17.7570, 31.1260, 0.04], ['Colne Valley', -17.7770, 31.1250, 0.05], ['Pomona', -17.7520, 31.0720, 0.15],
  ['Mabvuku', -17.8350, 31.1650, 0.92], ['Tafara', -17.8250, 31.1520, 0.92], ['Mufakose', -17.8720, 30.9450, 0.92],
  ['Rugare', -17.8550, 30.9900, 0.9], ['Lochinvar', -17.8650, 31.0050, 0.8], ['Ardbennie', -17.8700, 31.0250, 0.7],
  ['Msasa', -17.8400, 31.1150, 0.5], ['Queensdale', -17.8580, 31.0780, 0.45], ['Logan Park', -17.7550, 31.0350, 0.3],
  ['Haig Park', -17.7900, 30.9700, 0.25], ['Ashdown Park', -17.7750, 30.9800, 0.15], ['Meyrick Park', -17.7900, 31.0000, 0.3],
  ['Hatcliffe', -17.7250, 31.1000, 0.95], ['Mainway Meadows', -17.8720, 31.0450, 0.6], ['Willowvale', -17.8650, 30.9850, 0.85],
  ['Houghton Park', -17.8780, 31.0300, 0.55], ['Parktown', -17.8840, 31.0510, 0.5], ['Hatfield East', -17.8700, 31.0900, 0.4],
  ['Kuwadzana', -17.8300, 30.9330, 0.92], ['Dzivarasekwa', -17.8000, 30.9350, 0.92], ['Marimba Park', -17.8650, 30.9650, 0.55],
  ['Ruwa road farms', -17.8300, 31.2000, 0.6],
]) {
  const [x, z] = ll(lat, lon);
  anchors.push([Math.round(x), Math.round(z), d, n]);
}

// Mid-rise and low-rise clusters OSM doesn't map (lat, lon, radius m, count, minFloors, maxFloors, kind, name)
const clusters = [
  [-17.8560, 31.0390, 260, 46, 3, 4, 2, 'Mbare flats'],
  [-17.8540, 31.0300, 170, 22, 3, 4, 2, 'Matapi flats'],
  [-17.8290, 31.0120, 300, 34, 3, 5, 2, 'Belvedere flats'],
  [-17.8260, 31.0700, 380, 30, 3, 9, 1, 'Eastlea offices'],
  [-17.8195, 31.0720, 260, 22, 3, 6, 2, 'Eastlea flats'],
  [-17.7920, 31.0390, 220, 26, 2, 4, 1, 'Avondale shops'],
  [-17.7625, 31.0835, 200, 18, 2, 3, 1, 'Borrowdale Village'],
  [-17.7840, 31.0530, 380, 30, 3, 6, 1, 'University of Zimbabwe'],
  [-17.8110, 31.0750, 220, 14, 3, 6, 1, 'Newlands'],
  [-17.8030, 31.0280, 260, 20, 4, 8, 2, 'Milton Park flats'],
  [-17.8410, 31.1100, 450, 40, 1, 2, 0, 'Msasa'],
  [-17.8700, 30.9950, 420, 36, 1, 2, 0, 'Willowvale'],
  [-17.7925, 31.0855, 200, 12, 2, 4, 1, 'Highlands shops'],
  [-17.8780, 30.9890, 220, 12, 3, 4, 2, 'Highfield flats'],
  [-17.7710, 31.0040, 220, 14, 2, 3, 1, 'Westgate'],
];
const clus = clusters.map(([lat, lon, r, n, f0, f1, k, name]) => {
  const [x, z] = ll(lat, lon);
  return [Math.round(x), Math.round(z), r, n, f0, f1, k, name];
});

const data = {
  bbox: [Math.round(BX0), Math.round(BZ0), Math.round(BX1), Math.round(BZ1)],
  roads, areas: areas.map((a) => a.a), lines, buildings, anchors, clusters: clus,
};
const js = `// Generated by tools/build-suburbs.mjs from OpenStreetMap (© OpenStreetMap contributors, ODbL). Do not edit.\n// Coordinates are delta-encoded integer metres: [x0, z0, dx1, dz1, ...]\nexport const SUB = ${JSON.stringify(data)};\n`;
fs.writeFileSync(OUT, js);
const gz = (await import('node:zlib')).gzipSync(js).length;
console.log(`[suburbs] ${roads.length} roads, ${areas.length} areas, ${lines.length} lines, ${buildings.length} buildings, ${anchors.length} anchors → ${(js.length / 1024).toFixed(0)} KB (${(gz / 1024).toFixed(0)} KB gz) bbox ${data.bbox}`);
