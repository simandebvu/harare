// js/features/audio.js — procedural soundscape. Everything is synthesized (js/audio/synth.js) into a fixed WebAudio
// graph (js/audio/mixer.js); this file decides what you should hear where you are and when:
//   beds    traffic rumble from the cars around you, the distant city, wind (stronger up high), crowd murmur, crickets
//   voices  the nearest vehicles get an engine (by type), tyre noise, Doppler, air brakes and squeals, muffled behind
//           buildings (buildings.blocked sampled along the line of sight, round-robin)
//   events  kombi toots and other horns, the odd car alarm, birds by day near trees and parks (hadedas, bulbuls,
//           doves), frogs and Avenues dogs at night, touts calling destinations at the ranks
//   player  your kombi's engine follows your speed; hooter on 'harare:hoot', footsteps on 'harare:step' (or our own
//           cadence when nobody dispatches them)
// Audio starts on the first click / key / touch. N toggles mute (persisted); window.__harareAudio for the HUD.
import { synthesizeAll, Mixer, glide, VEHICLE_VOICES } from '../audio/mixer.js';
import { CALL_NAMES } from '../audio/synth.js';
import { rankLayout } from '../ranks.js';
import { coreWeight, groundY, pointInPoly, polyBounds, polyCentroid } from '../util.js';

const STORE = 'harare.audio.muted';
const MASTER = 0.8;
const RANGE = 170; // m: vehicles beyond this get no voice of their own (the rumble bed covers them)
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const R = Math.random;

let C = null; // feature ctx
let M = null; // Mixer
let raw = null; // promise of synthesized buffers
let starting = false;
let muted = false;
let time = 0;
const stats = { local: {}, frameMs: 0, peakMs: 0, voices: 0, strips: 0, events: {}, density: 0, started: false };

// listener + environment (written in place; no per-frame allocation)
const L = { x: 0, y: 0, z: 0, alt: 0, vx: 0, vz: 0, px: 0, pz: 0 };
const env = { core: 0, green: 0, park: 0, avenue: 0, night: 0, hour: 12, rank: null, rankD: 1e9, act: 1, birds: 0 };

// --- static maps: green cover, parks, the Avenues ------------------------------------------------------------------
const GC = 50, GX0 = -5400, GZ0 = -2700, GW = 200, GH = 92;
let greenG = null, parkG = null, aveG = null;
function buildMaps(DATA) {
  parkG = new Float32Array(GW * GH);
  aveG = new Float32Array(GW * GH);
  for (const a of DATA.areas) {
    const w = /park|garden|golf|grass|cemetery/.test(a.k) ? 1 : /pitch|recreation|sports/.test(a.k) ? 0.35 : 0;
    if (!w) continue;
    const [x0, z0, x1, z1] = polyBounds(a.p);
    for (let i = Math.floor((x0 - GX0) / GC); i <= Math.floor((x1 - GX0) / GC); i++)
      for (let j = Math.floor((z0 - GZ0) / GC); j <= Math.floor((z1 - GZ0) / GC); j++) {
        if (i < 0 || j < 0 || i >= GW || j >= GH) continue;
        if (pointInPoly(GX0 + (i + 0.5) * GC, GZ0 + (j + 0.5) * GC, a.p)) parkG[j * GW + i] = Math.max(parkG[j * GW + i], w);
      }
  }
  for (const r of DATA.roads) {
    if (!/Avenue|Ave\b/.test(r.n || '')) continue;
    for (let k = 2; k < r.p.length; k += 2) {
      const ax = r.p[k - 2], az = r.p[k - 1], bx = r.p[k], bz = r.p[k + 1];
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 20);
      for (let s = 0; s <= n; s++) {
        const i = Math.floor((ax + ((bx - ax) * s) / n - GX0) / GC), j = Math.floor((az + ((bz - az) * s) / n - GZ0) / GC);
        if (i >= 0 && j >= 0 && i < GW && j < GH) aveG[j * GW + i] = 1;
      }
    }
  }
  // blur both a cell so the edges of a park fade in
  const blur = (G) => {
    const o = new Float32Array(G.length);
    for (let j = 0; j < GH; j++)
      for (let i = 0; i < GW; i++) {
        let s = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const ii = i + di, jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= GW || jj >= GH) continue;
            s += G[jj * GW + ii] * (di || dj ? 0.6 : 1);
            n += di || dj ? 0.6 : 1;
          }
        o[j * GW + i] = s / n;
      }
    return o;
  };
  parkG = blur(parkG);
  aveG = blur(blur(aveG));
  greenG = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++)
    for (let i = 0; i < GW; i++) {
      const k = j * GW + i;
      const core = coreWeight(GX0 + (i + 0.5) * GC, GZ0 + (j + 0.5) * GC);
      greenG[k] = clamp(parkG[k] + aveG[k] * 0.5 + (1 - core) * 0.35);
    }
}
const cell = (G, x, z) => {
  const i = Math.floor((x - GX0) / GC), j = Math.floor((z - GZ0) / GC);
  return i < 0 || j < 0 || i >= GW || j >= GH ? 0.3 : G[j * GW + i];
};

// --- time-of-day curves --------------------------------------------------------------------------------------------
const bump = (h, a, b, fade) => clamp((h - a) / fade) * clamp((b - h) / fade);
const cityActivity = (h) => 0.25 + 0.75 * bump(h, 5, 22, 1.5) + 0.15 * bump(h, 6.5, 8.5, 0.7) + 0.15 * bump(h, 16.5, 18.5, 0.7);
const birdActivity = (h) => 1.0 * bump(h, 5, 8.5, 0.6) + 0.35 * bump(h, 8, 17, 0.8) + 0.8 * bump(h, 16.5, 18.8, 0.5);
const dawnDusk = (h) => bump(h, 5, 7.5, 0.5) + bump(h, 17, 18.7, 0.4);

// --- occlusion: fraction of a few points along the line of sight that sit inside a building taller than the ray ---
function occlusion(sx, sy, sz) {
  const blocked = C.buildings.blocked;
  const gl = groundY(L.x, L.z);
  let n = 0;
  for (let k = 1; k <= 4; k++) {
    const t = k / 5;
    const x = L.x + (sx - L.x) * t, z = L.z + (sz - L.z) * t;
    const y = L.y + (sy - L.y) * t - gl;
    if (blocked(x, z, y)) n++;
  }
  return n / 4;
}

// --- vehicle selection (nearest N by 3D distance), traffic density, distant horn and alarm candidates -------------
const bestI = new Int32Array(VEHICLE_VOICES).fill(-1);
const bestD = new Float64Array(VEHICLE_VOICES).fill(1e18);
const taken = new Uint8Array(VEHICLE_VOICES);
let farKombi = -1, farParked = -1, nKombi = 0;
const TYPE_GAIN = { kombi: 1.15, zupco: 1.45, hilux: 1.0, fit: 0.7, sedan: 0.78 };
const HORNS = { kombi: ['toot2', 'toot3', 'tootLong'], zupco: ['hornBus'], hilux: ['hornHilux'], fit: ['hornFit', 'hornFit2'], sedan: ['hornFit', 'hornHilux'] };

function scan() {
  const cars = C.traffic.cars;
  bestI.fill(-1);
  bestD.fill(1e18);
  let density = 0, nk = 0, np = 0;
  farKombi = farParked = -1;
  const R2 = RANGE * RANGE;
  for (let i = 0; i < cars.length; i++) {
    const c = cars[i];
    const dx = c.x - L.x, dz = c.z - L.z, dy = L.y - 1;
    const h2 = dx * dx + dz * dz, d2 = h2 + dy * dy;
    if (d2 < 400 * 400) {
      density += (0.35 + Math.min(1, c.v / 10)) / (1 + d2 / 1600);
      // reservoir picks for distant hoots and alarms
      if (c.kombi && d2 > 900) (nk++, R() * nk < 1 && (farKombi = i));
      if (c.v < 0.3 && d2 > 900 && d2 < 200 * 200) (np++, R() * np < 1 && (farParked = i));
    }
    if (d2 > R2 || d2 >= bestD[VEHICLE_VOICES - 1]) continue;
    let k = VEHICLE_VOICES - 1;
    while (k > 0 && bestD[k - 1] > d2) (bestD[k] = bestD[k - 1]), (bestI[k] = bestI[k - 1]), k--;
    bestD[k] = d2;
    bestI[k] = i;
  }
  nKombi = nk;
  stats.density = density;

  // keep voices whose car is still among the nearest; hand the rest the new arrivals
  const now = M.ac.currentTime;
  taken.fill(0);
  for (const v of M.voices) {
    if (!v.car) continue;
    let keep = false;
    for (let k = 0; k < VEHICLE_VOICES; k++) if (bestI[k] >= 0 && cars[bestI[k]] === v.car) (taken[k] = 1), (keep = true);
    if (!keep) v.car = null;
  }
  for (const v of M.voices) {
    if (v.car) continue;
    let k = 0;
    while (k < VEHICLE_VOICES && (bestI[k] < 0 || taken[k])) k++;
    if (k === VEHICLE_VOICES) {
      if (v.kind) M.release(v, now);
      continue;
    }
    taken[k] = 1;
    const car = cars[bestI[k]];
    if (v.kind !== car.type || !v.src) M.assign(v, car.type, now);
    else glide(v.gain.gain, 0, now, 0.03), (v.swapAt = now + 0.1); // same engine, new car: dip while it jumps
    v.car = car;
    v.prevV = car.v;
    v.fastT = car.v > 4 ? 0 : 99;
    v.occ = 0.25; // refined by the round-robin within a few ticks (keeps a teleport from costing 32 ray tests at once)
    v.rateS = 1;
  }
}

// Engine playback rate from speed: a crude gearbox so the note climbs, drops at the change, and climbs again
function engineRate(v, load, bus) {
  const g = bus ? 3.6 : 4.5;
  if (v < 0.3) return 1;
  const gear = Math.min(4, Math.floor(v / g));
  const f = Math.min(1.3, (v - gear * g) / g);
  return (gear === 0 ? 1 + 1.15 * f : 1.3 + 0.85 * f) * (bus ? 0.9 : 1) + load * 0.12;
}

let rr = 0, voiceTick = 0, slowAcc = 0;
function updateVoices(dt, now) {
  voiceTick += dt;
  if (voiceTick < 1 / 30) return;
  const tdt = voiceTick;
  voiceTick = 0;
  // occlusion: two voices per tick, round-robin
  for (let n = 0; n < 2; n++) {
    const v = M.voices[(rr = (rr + 1) % VEHICLE_VOICES)];
    if (v.car) v.occ += (occlusion(v.car.x, groundY(v.car.x, v.car.z) + 0.8, v.car.z) - v.occ) * 0.6;
  }
  let active = 0;
  for (const v of M.voices) {
    const c = v.car;
    if (!c) continue;
    active++;
    const y = groundY(c.x, c.z) + 0.8;
    const dx = c.x - L.x, dy = y - L.y, dz = c.z - L.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const acc = (c.v - v.prevV) / tdt;
    v.loadS += ((acc > 0.4 ? 1 : acc < -1 ? -0.3 : 0.3) - v.loadS) * Math.min(1, tdt * 4);
    const load = clamp(v.loadS);
    // Doppler from the car's own motion toward us (heading h: forward = (sin h, cos h))
    const toward = -(Math.sin(c.h) * c.v * dx + Math.cos(c.h) * c.v * dz) / d;
    const dop = clamp(343 / (343 - toward), 0.85, 1.18);
    const bus = c.type === 'zupco';
    v.rateS += (engineRate(c.v, load, bus) - v.rateS) * Math.min(1, tdt * 6);
    const tg = TYPE_GAIN[c.type] || 1;
    const P = v.panner;
    glide(P.positionX, c.x, now, 0.04);
    glide(P.positionY, y, now, 0.04);
    glide(P.positionZ, c.z, now, 0.04);
    if (v.src) glide(v.src.playbackRate, v.rateS * dop, now, 0.06);
    glide(v.eng.gain, tg * (0.42 + 0.45 * load + 0.12 * Math.min(1, c.v / 10)), now, 0.1);
    const roll = Math.min(1, c.v / 15);
    glide(v.tyre.gain, roll * roll * 0.55 * (bus ? 1.3 : 1), now, 0.1);
    glide(v.tyreF.frequency, 450 + c.v * 45, now, 0.1);
    // distance (air) and occlusion lowpass; occluded sources also lose some level
    const cut = Math.min(14000 / (1 + d / 120), 16000 - 15200 * Math.sqrt(v.occ)) * (0.6 + 0.4 * Math.min(1.6, v.rateS));
    glide(v.filter.frequency, Math.max(300, cut), now, 0.1);
    if (now >= v.swapAt) glide(v.gain.gain, 1 - 0.5 * v.occ, now, 0.12);

    // brakes: ZUPCOs sigh on air brakes when they stop; the odd squeal from everyone else
    if (c.v > 4) v.fastT = 0;
    else v.fastT += tdt;
    if (c.v < 0.25 && v.prevV >= 0.25 && v.fastT < 4 && now > v.brakeT) {
      v.brakeT = now + 6;
      if (bus) event('airbrake', c.x, y + 0.5, c.z, { gain: 0.9, ref: 9, prio: 2, rate: 0.95 + R() * 0.1 });
      else if (R() < 0.15) event('squeal', c.x, y - 0.4, c.z, { gain: 0.35, ref: 6, rate: 0.9 + R() * 0.2 });
    }
    v.prevV = c.v;
  }
  stats.voices = active;
}

function event(name, x, y, z, o) {
  o.occ = o.occ ?? occlusion(x, y, z);
  o.kind = name;
  const s = M.play(name, x, y, z, o);
  if (s) stats.events[name.replace(/\d+$/, '')] = (stats.events[name.replace(/\d+$/, '')] || 0) + 1;
  return s;
}
const pick = (arr) => arr[Math.floor(R() * arr.length)];
// Poisson trigger: true with the right probability for a rate (per second) over dt
const chance = (rate, dt) => R() < rate * dt;
// A point around the listener at ground level, distance in [a, b]
const around = (a, b, out) => {
  const ang = R() * Math.PI * 2, d = a + R() * (b - a);
  out.x = L.x + Math.cos(ang) * d;
  out.z = L.z + Math.sin(ang) * d;
  out.y = groundY(out.x, out.z);
  return out;
};
const P0 = { x: 0, y: 0, z: 0 };

// --- the slow tick: environment, beds and the random events (5 Hz) --------------------------------------------------
const RANK_CALLS = {
  'Fourth Street': ['Chitungwiza', 'Budiriro', 'Kuwadzana', 'Mbare', 'Town'],
  'Road Port': ['Mutare', 'Masvingo', 'Bulawayo', 'Mbare'],
  'Market Square': ['Mbare', 'Mbare', 'Budiriro', 'Town'],
  'Charge Office': ['Kuwadzana', 'Budiriro', 'Mbare', 'Chitungwiza'],
  Copacabana: ['Copa', 'Copa', 'Chitungwiza', 'Town'],
};
let ranks = [], fountain = null;
let gust = 0, gustT = 0;
function slowTick(dt, now) {
  const h = (env.hour = C.getHour());
  const night = (env.night = C.getNightness());
  env.core = coreWeight(L.x, L.z);
  env.green = cell(greenG, L.x, L.z);
  env.park = cell(parkG, L.x, L.z);
  env.avenue = clamp(cell(aveG, L.x, L.z) * 2.5) * clamp(1.4 - env.core * 2);
  env.act = cityActivity(h);
  const ground = 1 - L.alt; // how much of the street-level detail reaches us
  // nearest rank
  env.rank = null;
  env.rankD = 1e9;
  for (const r of ranks) {
    const d = Math.hypot(r.x - L.x, r.z - L.z) - r.r;
    if (d < env.rankD) (env.rankD = d), (env.rank = r);
  }
  const rankNear = clamp(1 - env.rankD / 220);
  const day = 1 - night;
  const B = M.beds;
  const cabin=C.controls.mode==='drive'&&C.controls.rig.current.id==='pov';
  glide(M.exterior.frequency,cabin?1800:18000,now,.35);
  glide(M.exteriorLevel.gain,cabin?.48:1,now,.35);
  let crowd=0;
  for(const p of C.people.walkers){if(p.hidden)continue;const d2=(p.x-L.x)**2+(p.z-L.z)**2;if(d2<2500)crowd+=1/(1+d2/64);}
  for(const p of C.people.loiter){const d2=(p.x-L.x)**2+(p.z-L.z)**2;if(d2<2500)crowd+=1/(1+d2/64);}
  const crowdNear=clamp(crowd/14);
  let enclosure=0;
  for(const [dx,dz] of [[18,0],[-18,0],[0,18],[0,-18]])if(C.buildings.blocked(L.x+dx,L.z+dz,6))enclosure+=.25;
  stats.cabin=cabin;stats.crowdNear=crowdNear;stats.enclosure=enclosure;
  if(fountain){
    M.fountain.panner.positionX.value=fountain[0];M.fountain.panner.positionY.value=groundY(...fountain)+1;M.fountain.panner.positionZ.value=fountain[1];
    const d=Math.hypot(fountain[0]-L.x,fountain[1]-L.z);
    glide(M.fountain.gain.gain,d<140?.28*(1-.65*occlusion(fountain[0],1,fountain[1])):0,now,.7);
  }

  // beds
  const dens = clamp(stats.density / 7);
  glide(B.rumble.g.gain, (0.05 + 0.5 * dens) * (0.5 + 0.5 * ground) * (0.55 + 0.45 * env.act), now, 0.5);
  const city = Math.max(env.core, 0.25 + 0.55 * L.alt);
  glide(B.hum.g.gain, (0.05 + 0.16 * city) * env.act, now, 0.8);
  glide(B.wash.g.gain, (0.015 + 0.06 * city + 0.05 * dens) * env.act, now, 0.8);
  gustT -= dt;
  if (gustT < 0) (gustT = 1 + R() * 4), (gust = R() * R());
  const windy = 0.035 + 0.22 * L.alt + 0.06 * (1 - env.core) * ground;
  glide(B.wind.g.gain, windy * (0.6 + 0.8 * gust) * (1 - 0.35 * night), now, 1.2);
  glide(B.wind.chain[0].frequency, 320 + 450 * gust + 300 * L.alt, now, 1.5);
  glide(B.gust.g.gain, (0.004 + 0.035 * L.alt) * gust, now, 1.2);
  glide(B.murmur.g.gain, (0.012 + 0.3 * crowdNear + 0.16 * rankNear) * env.act * ground * (1 - 0.6 * night), now, 0.8);
  glide(B.crickets.g.gain, 0.28 * clamp((night - 0.35) * 2) * (0.2 + 0.8 * env.green) * (1 - 0.65 * env.core) * ground, now, 1.5);
  glide(M.verbSend.gain, 0.05 + 0.26 * enclosure * ground, now, 1);
  if (env.rank) {
    const r = env.rank;
    glide(M.rank.panner.positionX, r.x, now, 0.3);
    glide(M.rank.panner.positionY, groundY(r.x, r.z) + 1.6, now, 0.3);
    glide(M.rank.panner.positionZ, r.z, now, 0.3);
    glide(M.rank.gain.gain, (rankNear > 0 ? 1.1 : 0) * clamp(env.act * 1.1 - 0.15) * (1 - 0.5 * night), now, 0.8);
  }

  // horns: kombis with voices toot for passengers (more while loading), stuck cars get impatient
  for (const v of M.voices) {
    const c = v.car;
    if (!c) continue;
    const rate = c.kombi ? (c.wait > 0 ? 0.09 : 0.035) : c.v < 0.5 ? 0.012 : 0.004;
    if (chance(rate * (0.4 + 0.6 * env.act), dt)) {
      const y = groundY(c.x, c.z) + 1;
      event(pick(HORNS[c.type] || HORNS.fit), c.x, y, c.z, { gain: 0.8, ref: 9, prio: 2, occ: v.occ, rate: 0.97 + R() * 0.06 });
    }
  }
  if (farKombi >= 0 && chance(Math.min(0.5, nKombi * 0.012) * env.act, dt)) {
    const c = C.traffic.cars[farKombi];
    event(pick(HORNS.kombi), c.x, groundY(c.x, c.z) + 1, c.z, { gain: 0.8, ref: 9, prio: 1, rate: 0.97 + R() * 0.06 });
  }
  // the occasional car alarm somebody's bumped
  if (chance((1 / 140) * (0.3 + env.core) * ground, dt)) {
    const c = farParked >= 0 ? C.traffic.cars[farParked] : null;
    const p = c ? ((P0.x = c.x), (P0.z = c.z), (P0.y = groundY(c.x, c.z)), P0) : around(40, 160, P0);
    event('alarm', p.x, p.y + 1, p.z, { gain: 0.45, ref: 8, prio: 2 });
  }

  // birds by day, near trees and parks; hadedas around dawn and dusk, often flying over
  const birds = birdActivity(h) * (0.06 + 0.55 * env.green) * (1 - 0.7 * L.alt);
  stats.birdRate = birds;
  if (chance(birds * 0.55, dt)) {
    const u = R();
    const pHad = 0.07 + 0.3 * dawnDusk(h);
    if (u < pHad) {
      around(20, 90, P0);
      const ang = R() * Math.PI * 2, sp = 9 + R() * 5;
      event('hadeda' + Math.floor(R() * 3), P0.x, P0.y + 22 + R() * 20, P0.z, { gain: 0.9, ref: 22, prio: 1, occ: 0, vx: Math.cos(ang) * sp, vz: Math.sin(ang) * sp });
    } else if (u < pHad + (1 - pHad) * 0.55) {
      around(10, 70, P0);
      event('bulbul' + Math.floor(R() * 4), P0.x, P0.y + 5 + R() * 7, P0.z, { gain: 0.5, ref: 7, prio: 0, rate: 0.95 + R() * 0.1 });
    } else {
      around(12, 80, P0);
      event((R() < 0.4 ? 'ldove' : 'dove') + Math.floor(R() * 2), P0.x, P0.y + 6 + R() * 6, P0.z, { gain: 0.45, ref: 7, prio: 0, rate: 0.96 + R() * 0.08 });
    }
  }
  // night: frogs in the parks, dogs in the Avenues (with a neighbour answering)
  if (night > 0.5) {
    if (chance(night * (0.01 + 0.18 * env.park) * ground, dt)) {
      around(15, 80, P0);
      event('frog' + Math.floor(R() * 4), P0.x, P0.y + 0.3, P0.z, { gain: 0.35, ref: 6, prio: 0, rate: 0.9 + R() * 0.2 });
    }
    if (chance(night * (0.004 + 0.07 * env.avenue + 0.02 * (1 - env.core)) * (1 - 0.5 * L.alt), dt)) {
      around(60, 320, P0);
      const dg = Math.floor(R() * 4);
      event('dog' + dg, P0.x, P0.y + 0.6, P0.z, { gain: 0.9, ref: 14, prio: 1, rate: 0.95 + R() * 0.1 });
      if (R() < 0.4) {
        around(80, 360, P0);
        event('dog' + ((dg + 1 + Math.floor(R() * 3)) % 4), P0.x, P0.y + 0.6, P0.z, { gain: 0.8, ref: 14, prio: 1, when: 1 + R() * 1.5 });
      }
    }
  }
  // touts calling destinations at the nearest rank
  if (env.rank && env.rankD < 160) {
    const r = env.rank;
    const rate = 0.45 * clamp(1 - Math.max(0, env.rankD) / 160) * clamp(env.act * 1.2 - 0.2) * (1 - 0.7 * night);
    if (chance(rate, dt)) {
      const a = R() * Math.PI * 2, rr2 = Math.sqrt(R()) * r.r * 0.8;
      const x = r.x + Math.cos(a) * rr2, z = r.z + Math.sin(a) * rr2;
      const name = pick(RANK_CALLS[r.n] || CALL_NAMES);
      event('tout_' + name + Math.floor(R() * 2), x, groundY(x, z) + 1.7, z, { gain: 0.55, ref: 6, prio: 1, rate: 0.96 + R() * 0.08 });
    }
  }
}

// --- the player's own sounds --------------------------------------------------------------------------------------
let lastStepEvt = -1e9, stepPhase = 0, stepIdx = 0, pRate = 1, pPrevV = 0, pLoad = 0, pTick = 0;
function local(name, gain, rate) {
  M.playLocal(name, gain, rate);
  const k = name.replace(/\d+$/, '');
  stats.local[k] = (stats.local[k] || 0) + 1;
}
function playerStep(run, land = false) {
  stepIdx = (stepIdx + 1 + Math.floor(R() * 2)) % 4;
  local('step' + (run ? 4 + (stepIdx % 2) : stepIdx), land ? 0.8 : run ? 0.55 : 0.38, (land ? 0.8 : 0.92) + R() * 0.16);
}
function updatePlayer(dt, now) {
  const ctl = C.controls;
  const mode = ctl.mode;
  pTick += dt;
  if (pTick < 1 / 30) return;
  const tdt = pTick;
  pTick = 0;
  const electric=mode==='drive'&&ctl.vehicleType==='roadster';
  glide(M.electricGain.gain,electric?.1+Math.min(.08,ctl.speed*.003):0,now,.1);
  glide(M.electric.frequency,85+ctl.speed*9,now,.08);
  glide(M.thrustGain.gain,electric?ctl.flight.thrust*.25:0,now,.1);
  if (mode === 'drive') {
    const v = Math.abs(ctl.speed ?? ctl.car?.v ?? Math.hypot(L.vx, L.vz));
    const acc = (v - pPrevV) / tdt;
    pPrevV = v;
    const throttle = ctl.keys?.has?.('KeyW') || ctl.keys?.has?.('ArrowUp') || acc > 0.5;
    pLoad += ((throttle ? 1 : 0.15) - pLoad) * Math.min(1, tdt * 5);
    pRate += (engineRate(v, pLoad, false) - pRate) * Math.min(1, tdt * 8);
    glide(M.pSrc.playbackRate, pRate, now, 0.04);
    glide(M.pEng.gain, electric?0:0.45 + 0.35 * pLoad, now, 0.08);
    glide(M.pFilter.frequency, 700 + pRate * 700 + pLoad * 900, now, 0.08);
    glide(M.pTyre.gain, Math.min(1, v / 18) ** 2 * 0.3, now, 0.1);
  } else {
    glide(M.pEng.gain, 0, now, 0.15);
    glide(M.pTyre.gain, 0, now, 0.15);
    pPrevV = 0;
  }
  // our own footsteps when nobody else dispatches 'harare:step'
  if (mode === 'walk' && time - lastStepEvt > 3) {
    const sp = ctl.speed ?? Math.hypot(L.vx, L.vz);
    if (sp > 0.6 && sp < 12) {
      const run = sp > 3.2;
      stepPhase += tdt * (run ? 2.9 : 1.85);
      if (stepPhase >= 1) (stepPhase -= 1), playerStep(run);
    } else stepPhase = 0.7;
  }
}

// --- start / mute ----------------------------------------------------------------------------------------------------
async function start() {
  if (M || starting || muted) return;
  starting = true;
  try {
    const buffers = await raw;
    M = new Mixer(buffers);
    window.__harareAudio.mixer = M;
    if (muted) M.ac.suspend(); // muted (N) while we were still starting up
    else await M.ac.resume(), glide(M.master.gain, MASTER, M.ac.currentTime, 0.6);
    stats.started = true;
  } catch (e) {
    console.warn('[harare] audio unavailable:', e.message);
  }
  starting = false;
}
function setMuted(m) {
  muted = !!m;
  try {
    localStorage.setItem(STORE, muted ? '1' : '0');
  } catch {}
  if (M) {
    const now = M.ac.currentTime;
    if (muted) {
      glide(M.master.gain, 0, now, 0.05);
      setTimeout(() => muted && M.ac.suspend(), 300);
    } else {
      M.ac.resume().then(() => glide(M.master.gain, MASTER, M.ac.currentTime, 0.15));
    }
  } else if (!muted) start();
  dispatchEvent(new CustomEvent('harare:audiomute', { detail: { muted } }));
}

const fwd = { x: 0, y: 0, z: 0 };
export default {
  init(ctx) {
    C = ctx;
    try {
      muted = localStorage.getItem(STORE) === '1';
    } catch {}
    buildMaps(ctx.DATA);
    const unity=ctx.DATA.areas.find(a=>/Africa Unity|Unity Square/i.test(a.n||''));
    if(unity)fountain=polyCentroid(unity.p);
    ranks = rankLayout(ctx.DATA).map((r) => ({ n: r.n, x: r.x, z: r.z, r: r.r }));
    raw = synthesizeAll(); // in small slices, in the background

    window.__harareAudio = {
      mute: (m = true) => setMuted(m),
      toggle: () => setMuted(!muted),
      get muted() {
        return muted;
      },
      get started() {
        return !!M;
      },
      start,
      // verification helpers, loaded on demand: await __harareAudio.selfTest() / await __harareAudio.meter()
      selfTest: async () => M && (await import('../audio/debug.js')).selfTest(M),
      meter: async () => M && (await import('../audio/debug.js')).meter(M),
      stats: () => ({
        ...stats,
        state: M?.ac.state,
        strips: M ? M.activeStrips(M.ac.currentTime) : 0,
        env: { ...env, rank: env.rank?.n },
        listener: { ...L },
      }),
    };
    const gesture = () => {
      if (!muted) start();
      if (M) {
        removeEventListener('pointerdown', gesture, true);
        removeEventListener('keydown', gesture, true);
        removeEventListener('touchstart', gesture, true);
      }
    };
    addEventListener('pointerdown', gesture, true);
    addEventListener('keydown', gesture, true);
    addEventListener('touchstart', gesture, { capture: true, passive: true });
    addEventListener('keydown', (e) => {
      if (e.code !== 'KeyN' || e.repeat || e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
      setMuted(!muted);
    });
    addEventListener('harare:hoot', () => {
      if (M && !muted) local(R() < 0.7 ? 'hooter' : 'hooter2', 0.5, 1);
    });
    addEventListener('harare:step', (e) => {
      lastStepEvt = time;
      if (M && !muted) playerStep(!!e.detail?.run, !!e.detail?.land);
    });
    addEventListener('harare:crash', (e) => {
      if (M && !muted) local('crash' + Math.floor(R() * 2), clamp((e.detail?.strength || 8) / 14, 0.25, 1) * 0.8, 0.9 + R() * 0.2);
    });
    document.addEventListener('visibilitychange', () => {
      if (!M || muted) return;
      if (document.hidden) M.ac.suspend();
      else M.ac.resume();
    });
  },

  update(dt, ctx) {
    time += dt;
    if (!M || muted || M.ac.state !== 'running') return;
    const t0 = performance.now();
    dt = Math.min(dt, 0.1);
    const now = M.ac.currentTime;
    // listener = the camera
    const e = ctx.camera.matrixWorld.elements;
    L.x = e[12];
    L.y = e[13];
    L.z = e[14];
    fwd.x = -e[8];
    fwd.y = -e[9];
    fwd.z = -e[10];
    M.setListener(L.x, L.y, L.z, fwd.x, fwd.y, fwd.z, e[4], e[5], e[6]);
    const p = ctx.controls.position;
    if (dt > 0) (L.vx = L.vx * 0.7 + ((p.x - L.px) / dt) * 0.3), (L.vz = L.vz * 0.7 + ((p.z - L.pz) / dt) * 0.3);
    L.px = p.x;
    L.pz = p.z;
    L.alt = clamp((L.y - groundY(L.x, L.z) - 12) / 250);

    slowAcc += dt;
    if (slowAcc >= 0.2) {
      scan();
      slowTick(slowAcc, now);
      slowAcc = 0;
    }
    updateVoices(dt, now);
    updatePlayer(dt, now);

    const ms = performance.now() - t0;
    stats.frameMs = stats.frameMs * 0.95 + ms * 0.05;
    stats.peakMs = Math.max(stats.peakMs * 0.995, ms);
  },
};
