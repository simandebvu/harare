// js/audio/mixer.js — the WebAudio graph: master + limiter, a shared street-canyon reverb send, looping ambient beds,
// a fixed pool of positional vehicle voices, a fixed pool of positional one-shot strips, and the player's own engine.
// Everything is created once; per frame only AudioParams change. Sources are only created when a sound starts.
import * as S from './synth.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const VEHICLE_VOICES = 8;
export const EVENT_STRIPS = 12;

function kRate(...ps) {
  for (const p of ps) if (p && p.automationRate !== undefined) p.automationRate = 'k-rate';
}
// Glide a param toward v (cancel first so automation events never pile up)
export function glide(p, v, now, tc = 0.08) {
  p.cancelScheduledValues(now);
  p.setTargetAtTime(v, now, tc);
}

// Generate every buffer as Float32Arrays, a few per task, so the page never stalls for long. Resolves with a map.
export function synthesizeAll() {
  const jobs = [];
  const out = {};
  const add = (k, f) => jobs.push(() => (out[k] = f()));
  add('pink', () => S.pinkLoop(4, 1));
  add('pink2', () => S.pinkLoop(5, 7));
  add('brown', () => S.brownLoop(4, 2));
  for (const k in S.ENGINES) add('eng_' + k, () => S.engineLoop(S.ENGINES[k]));
  add('toot2', () => S.horn(410, 515, [[0, 0.1], [0.16, 0.1]], 1));
  add('toot3', () => S.horn(420, 530, [[0, 0.07], [0.11, 0.07], [0.24, 0.22]], 2));
  add('tootLong', () => S.horn(405, 510, [[0, 0.45]], 3));
  add('hornBus', () => S.horn(290, 350, [[0, 0.55]], 4, 0.8));
  add('hornFit', () => S.horn(470, 585, [[0, 0.16]], 5, 0.6));
  add('hornFit2', () => S.horn(480, 600, [[0, 0.09], [0.14, 0.09]], 6, 0.6));
  add('hornHilux', () => S.horn(395, 495, [[0, 0.28]], 7));
  add('hooter', () => S.horn(410, 515, [[0, 0.32]], 8, 0.8));
  add('hooter2', () => S.horn(410, 515, [[0, 0.1], [0.15, 0.2]], 9, 0.8));
  add('alarm', () => S.carAlarm(5));
  for (let i = 0; i < 3; i++) add('hadeda' + i, () => S.hadeda(100 + i));
  for (let i = 0; i < 4; i++) add('bulbul' + i, () => S.bulbul(200 + i));
  for (let i = 0; i < 2; i++) add('dove' + i, () => S.dove(300 + i));
  for (let i = 0; i < 2; i++) add('ldove' + i, () => S.dove(310 + i, true));
  add('crickets', () => S.cricketsLoop(4, 9));
  for (let i = 0; i < 4; i++) add('frog' + i, () => S.frog(400 + i));
  for (let i = 0; i < 4; i++) add('dog' + i, () => S.dogBarks(500 + i, [1, 0.7, 1.3, 1][i]));
  for (let i = 0; i < 6; i++) add('step' + i, () => S.footstep(600 + i, i >= 4));
  add('crash0', () => S.crash(901));
  add('crash1', () => S.crash(902));
  add('airbrake', () => S.airBrake(1));
  add('squeal', () => S.brakeSqueal(1));
  S.CALL_NAMES.forEach((n, i) => {
    add('tout_' + n + '0', () => S.toutCall(n, 700 + i));
    add('tout_' + n + '1', () => S.toutCall(n, 750 + i));
  });
  add('babble', () => S.babbleLoop(6, 8, 77));
  add('ir', () => S.canyonIR());
  return new Promise((resolve) => {
    let i = 0;
    const step = () => {
      const t = performance.now();
      while (i < jobs.length && performance.now() - t < 12) jobs[i++]();
      if (i < jobs.length) setTimeout(step, 0);
      else resolve(out);
    };
    setTimeout(step, 0);
  });
}

export class Mixer {
  constructor(raw) {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = (this.ac = new AC({ latencyHint: 'balanced' }));
    this.B = {};
    for (const k in raw) {
      const v = raw[k];
      let chans = Array.isArray(v) ? v : [v], rate = S.SR;
      if (k === 'ir' && ac.sampleRate !== S.SR) {
        // a ConvolverNode needs its impulse at the context rate: resample linearly
        rate = ac.sampleRate;
        chans = chans.map((c) => {
          const n = Math.floor((c.length * rate) / S.SR), o = new Float32Array(n), q = S.SR / rate;
          for (let i = 0; i < n; i++) {
            const f = i * q, j = Math.floor(f), t = f - j;
            o[i] = c[j] * (1 - t) + (c[j + 1] || 0) * t;
          }
          return o;
        });
      }
      const b = ac.createBuffer(chans.length, chans[0].length, rate);
      chans.forEach((c, i) => b.copyToChannel(c, i));
      this.B[k] = b;
    }
    const L = ac.listener;
    this.lis = L.positionX ? [L.positionX, L.positionY, L.positionZ, L.forwardX, L.forwardY, L.forwardZ, L.upX, L.upY, L.upZ] : null;

    // master -> limiter -> out
    this.limiter = ac.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 10;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;
    this.master = ac.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.limiter).connect(ac.destination);
    this.bed = ac.createGain();
    this.bed.connect(this.master);
    this.sfx = ac.createGain();
    this.sfx.connect(this.master);
    this.verbSend = ac.createGain();
    this.verbSend.gain.value = 0.25;
    this.verb = ac.createConvolver();
    this.verb.buffer = this.B.ir;
    this.sfx.connect(this.verbSend).connect(this.verb).connect(this.master);
    this.player = ac.createGain();
    this.player.connect(this.master);
    this.player.connect(this.verbSend);

    // --- beds ---
    const loop = (buf, rate = 1) => {
      const s = ac.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.playbackRate.value = rate;
      s.start(0, Math.random() * buf.duration);
      return s;
    };
    const filt = (type, f, q = 0.7) => {
      const b = ac.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      kRate(b.frequency, b.Q, b.gain, b.detune);
      return b;
    };
    const gain = (v = 0) => {
      const g = ac.createGain();
      g.gain.value = v;
      return g;
    };
    this.beds = {};
    const bed = (name, src, ...chain) => {
      const g = gain();
      let n = src;
      for (const c of chain) n = n.connect(c);
      n.connect(g).connect(this.bed);
      this.beds[name] = { g, chain };
    };
    bed('rumble', loop(this.B.brown), filt('lowpass', 160));
    bed('hum', loop(this.B.pink, 0.9), filt('lowpass', 420), filt('highpass', 55));
    bed('wash', loop(this.B.pink2), filt('bandpass', 900, 0.5));
    bed('wind', loop(this.B.pink, 1.13), filt('bandpass', 500, 0.9));
    bed('gust', loop(this.B.pink2, 0.87), filt('highpass', 2400));
    bed('murmur', loop(this.B.babble), filt('lowpass', 2200));
    // crickets in two offset, slightly detuned copies panned apart for width
    const cg = gain();
    for (const [pan, rate] of [[-0.7, 1], [0.7, 0.973]]) {
      const p = ac.createStereoPanner();
      p.pan.value = pan;
      loop(this.B.crickets, rate).connect(p).connect(cg);
    }
    cg.connect(this.bed);
    this.beds.crickets = { g: cg, chain: [] };

    // --- positional strips ---
    const strip = (hrtf, ref) => {
      const s = { gain: gain(), filter: filt('lowpass', 16000, 0.5), panner: ac.createPanner() };
      const P = s.panner;
      P.panningModel = hrtf ? 'HRTF' : 'equalpower';
      P.distanceModel = 'inverse';
      P.refDistance = ref;
      P.rolloffFactor = 1;
      P.maxDistance = 10000;
      kRate(P.positionX, P.positionY, P.positionZ, P.orientationX, P.orientationY, P.orientationZ);
      s.gain.connect(s.filter).connect(P).connect(this.sfx);
      return s;
    };
    this.voices = [];
    for (let i = 0; i < VEHICLE_VOICES; i++) {
      const v = strip(true, 7);
      v.eng = gain();
      v.eng.connect(v.gain);
      v.tyreF = filt('bandpass', 700, 0.6);
      v.tyre = gain();
      loop(this.B.pink, 0.8 + Math.random() * 0.4).connect(v.tyreF).connect(v.tyre).connect(v.gain);
      v.src = null;
      v.kind = null;
      v.car = null;
      v.occ = 0;
      v.prevV = 0;
      v.loadS = 0;
      v.swapAt = 0;
      v.brakeT = 0;
      this.voices.push(v);
    }
    this.strips = [];
    for (let i = 0; i < EVENT_STRIPS; i++) {
      const s = strip(false, 10);
      s.busyUntil = 0;
      s.src = null;
      s.prio = 0;
      s.kind = '';
      s.x = s.y = s.z = 0;
      this.strips.push(s);
    }
    this.rank = strip(true, 18); // murmur at the nearest kombi rank
    loop(this.B.babble, 1.07).connect(this.rank.gain);
    this.rank.gain.gain.value = 0;

    // --- player engine (non-positional) ---
    this.pEng = gain();
    this.pFilter = filt('lowpass', 1200, 0.6);
    this.pSrc = loop(this.B.eng_player);
    this.pSrc.connect(this.pEng).connect(this.pFilter).connect(this.player);
    this.pTyre = gain();
    loop(this.B.pink2, 0.9).connect(filt('bandpass', 600, 0.5)).connect(this.pTyre).connect(this.player);
  }

  setListener(x, y, z, fx, fy, fz, ux, uy, uz) {
    if (this.lis) {
      const a = this.lis;
      a[0].value = x; a[1].value = y; a[2].value = z;
      a[3].value = fx; a[4].value = fy; a[5].value = fz;
      a[6].value = ux; a[7].value = uy; a[8].value = uz;
    } else {
      this.ac.listener.setPosition(x, y, z);
      this.ac.listener.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  // Play a buffer at a world position on a free strip (or steal the lowest-priority one). Returns the strip or null.
  play(bufName, x, y, z, { gain = 1, rate = 1, ref = 10, prio = 1, occ = 0, kind = '', when = 0, vx = 0, vz = 0 } = {}) {
    const buf = this.B[bufName];
    if (!buf) return null;
    const now = this.ac.currentTime;
    let s = null;
    for (const t of this.strips) if (t.busyUntil <= now) { s = t; break; }
    if (!s) {
      let lo = null;
      for (const t of this.strips) if (t.prio < prio && (!lo || t.prio < lo.prio)) lo = t;
      if (!lo) return null;
      s = lo;
      try { s.src.stop(); } catch {}
    }
    const src = this.ac.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.connect(s.gain);
    const t0 = now + when;
    s.gain.gain.cancelScheduledValues(now);
    s.gain.gain.setValueAtTime(gain * (1 - 0.45 * occ), t0);
    s.filter.frequency.setValueAtTime(16000 - 15000 * Math.sqrt(occ), t0);
    s.panner.refDistance = ref;
    s.panner.positionX.cancelScheduledValues(now);
    s.panner.positionY.cancelScheduledValues(now);
    s.panner.positionZ.cancelScheduledValues(now);
    s.panner.positionX.setValueAtTime(x, t0);
    s.panner.positionY.setValueAtTime(y, t0);
    s.panner.positionZ.setValueAtTime(z, t0);
    const dur = buf.duration / rate;
    if (vx || vz) {
      // a moving source (a hadeda flying over): ramp straight across
      s.panner.positionX.linearRampToValueAtTime(x + vx * dur, t0 + dur);
      s.panner.positionZ.linearRampToValueAtTime(z + vz * dur, t0 + dur);
    }
    src.start(t0);
    s.src = src;
    s.prio = prio;
    s.kind = kind;
    s.x = x; s.y = y; s.z = z;
    s.busyUntil = t0 + dur + 0.05;
    return s;
  }

  // Non-positional one-shot for the player's own sounds (hooter, footsteps)
  playLocal(bufName, gain = 1, rate = 1) {
    const buf = this.B[bufName];
    if (!buf) return;
    const src = this.ac.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ac.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.player);
    src.onended = () => g.disconnect();
    src.start();
  }

  // Point a vehicle voice at a new engine type: fade, swap the looping source, fade back in
  assign(v, kind, now) {
    const old = v.src;
    glide(v.gain.gain, 0, now, 0.03);
    const src = this.ac.createBufferSource();
    src.buffer = this.B['eng_' + kind] || this.B.eng_fit;
    src.loop = true;
    src.connect(v.eng);
    const at = now + 0.12;
    src.start(at, Math.random() * src.buffer.duration);
    if (old) old.stop(at);
    v.src = src;
    v.kind = kind;
    v.swapAt = at;
  }
  release(v, now) {
    glide(v.gain.gain, 0, now, 0.05);
    if (v.src) v.src.stop(now + 0.3);
    v.src = null;
    v.kind = null;
    v.car = null;
  }

  activeStrips(now) {
    let n = 0;
    for (const s of this.strips) if (s.busyUntil > now) n++;
    return n;
  }
}
