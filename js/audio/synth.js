// js/audio/synth.js — every sound in Slop Harare, synthesized into Float32Arrays at SR (no audio files, no WebAudio
// here). Loops are cross-faded so they wrap without clicks; one-shots are DC-free, edge-faded and peak-normalized.
// The caller wraps the arrays in AudioBuffers once an AudioContext exists.
export const SR = 32000;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (x) => ((x = clamp(x, 0, 1)), x * x * (3 - 2 * x));
const lpK = (f) => 1 - Math.exp((-TAU * f) / SR);

export function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Remove DC, fade the ends, scale to a peak (one-shots)
function finish(d, peak = 0.7, fadeOut = 0.012) {
  let mean = 0;
  for (let i = 0; i < d.length; i++) mean += d[i];
  mean /= d.length || 1;
  const fi = SR * 0.002, fo = SR * fadeOut;
  let max = 0;
  for (let i = 0; i < d.length; i++) {
    const f = Math.min(1, i / fi, (d.length - 1 - i) / fo);
    d[i] = (d[i] - mean) * f;
    const a = Math.abs(d[i]);
    if (a > max) max = a;
  }
  const k = max > 0 ? peak / max : 0;
  for (let i = 0; i < d.length; i++) d[i] *= k;
  return d;
}

// d holds L + X samples; blend the tail into the head and return a seamless loop of length L at a target RMS
function loopify(d, X, rms = 0.25, ceiling = 0.95) {
  const L = d.length - X;
  for (let i = 0; i < X; i++) {
    const t = i / X;
    d[i] = d[i] * Math.sqrt(t) + d[L + i] * Math.sqrt(1 - t);
  }
  const out = d.subarray(0, L);
  let mean = 0;
  for (let i = 0; i < L; i++) mean += out[i];
  mean /= L;
  let e = 0, pk = 0;
  for (let i = 0; i < L; i++) {
    out[i] -= mean;
    e += out[i] * out[i];
    pk = Math.max(pk, Math.abs(out[i]));
  }
  const k = Math.min(ceiling / Math.max(pk, 1e-6), rms / Math.max(Math.sqrt(e / L), 1e-6));
  for (let i = 0; i < L; i++) out[i] *= k;
  return out;
}

// Two-pole resonator (band-pass), updated in place
function reso(f, bw) {
  const r = Math.exp((-Math.PI * bw) / SR);
  return { r, a1: 2 * r * Math.cos((TAU * f) / SR), a2: -r * r, g: 1 - r, y1: 0, y2: 0 };
}
function resoSet(o, f) {
  o.a1 = 2 * o.r * Math.cos((TAU * Math.min(f, SR * 0.45)) / SR);
}
function resoTick(o, x) {
  const y = o.g * x + o.a1 * o.y1 + o.a2 * o.y2;
  o.y2 = o.y1;
  o.y1 = y;
  return y;
}

// --- noise beds ------------------------------------------------------------------------------------------------------
export function pinkLoop(sec = 4, seed = 1) {
  const r = rng(seed), X = Math.round(SR * 0.25), d = new Float32Array(Math.round(sec * SR) + X);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  return loopify(d, X, 0.22);
}
export function brownLoop(sec = 4, seed = 2) {
  const r = rng(seed), X = Math.round(SR * 0.3), d = new Float32Array(Math.round(sec * SR) + X);
  let y = 0, hp = 0;
  for (let i = 0; i < d.length; i++) {
    y = y * 0.997 + (r() * 2 - 1) * 0.06;
    hp += (y - hp) * 0.0015; // strip the slow wander
    d[i] = y - hp;
  }
  return loopify(d, X, 0.25);
}

// --- engines ---------------------------------------------------------------------------------------------------------
// Firing pulses for `cycles` four-stroke cycles at the reference rpm: a short exhaust thump that rings at the pipe
// resonance, filtered blow-by noise, and for diesels an injector clatter tick. Loops exactly (pulses wrap around).
export const ENGINES = {
  kombi: { cyl: 4, rpm: 820, res: 92, decay: 0.017, clatter: 0.55, noise: 0.5, seed: 11, lp: 2600 },
  zupco: { cyl: 6, rpm: 640, res: 58, decay: 0.024, clatter: 0.4, noise: 0.55, seed: 23, lp: 1800 },
  hilux: { cyl: 4, rpm: 780, res: 104, decay: 0.015, clatter: 0.45, noise: 0.45, seed: 37, lp: 2400 },
  fit: { cyl: 4, rpm: 900, res: 150, decay: 0.009, clatter: 0.04, noise: 0.25, seed: 41, lp: 3200 },
  sedan: { cyl: 4, rpm: 850, res: 128, decay: 0.011, clatter: 0.06, noise: 0.28, seed: 53, lp: 3000 },
  player: { cyl: 4, rpm: 820, res: 88, decay: 0.018, clatter: 0.5, noise: 0.5, seed: 67, lp: 2800 },
};
export function engineLoop(spec, cycles = 16) {
  const r = rng(spec.seed);
  const L = Math.round(((cycles * 120) / spec.rpm) * SR);
  const d = new Float32Array(L);
  const n = cycles * spec.cyl, interval = L / n;
  const strength = Array.from({ length: spec.cyl }, () => 0.82 + r() * 0.36);
  const skew = Array.from({ length: spec.cyl }, () => (r() - 0.5) * 0.04);
  const dur = Math.round(SR * spec.decay * 4.5);
  const kn = lpK(1400), kc = lpK(5200);
  for (let f = 0; f < n; f++) {
    const c = f % spec.cyl;
    let idx = (Math.round((f + skew[c] + (r() - 0.5) * 0.015) * interval) + L) % L;
    const s = strength[c] * (0.92 + r() * 0.16);
    const res = spec.res * (0.97 + r() * 0.06);
    let ln = 0, hn = 0;
    for (let i = 0; i < dur; i++) {
      const t = i / SR, w = r() * 2 - 1;
      ln += (w - ln) * kn;
      hn += (w - hn) * kc;
      const att = 1 - Math.exp(-t / 0.0007), tail = Math.exp(-t / spec.decay);
      let v = att * (Math.exp(-t / 0.0025) - 0.35 * Math.exp(-t / 0.009) + Math.sin(TAU * res * t) * tail * 0.4 + ln * tail * spec.noise);
      if (spec.clatter) {
        const tv = t - 0.008;
        v += spec.clatter * ((w - hn) * Math.exp(-t / 0.003) * 0.9 + (tv > 0 ? Math.exp(-tv / 0.0015) * (w - hn) * 0.5 : 0));
      }
      d[idx] += s * v;
      if (++idx === L) idx = 0;
    }
  }
  // tame the top end (two passes, wrapping so the loop stays seamless)
  const k = lpK(spec.lp);
  let y = 0;
  for (let p = 0; p < 2; p++) for (let i = 0; i < L; i++) (y += (d[i] - y) * k), p && (d[i] = y);
  return loopify(d, 0, 0.28, 0.9); // pulses already wrap, so the loop is exactly periodic
}

// --- horns -----------------------------------------------------------------------------------------------------------
const HARM = [0.6, 1, 0.7, 0.45, 0.3, 0.2, 0.12, 0.08];
export function horn(f1, f2, pattern, seed = 1, peak = 0.7) {
  const r = rng(seed);
  const end = pattern.reduce((m, [s, l]) => Math.max(m, s + l), 0) + 0.04;
  const d = new Float32Array(Math.ceil(end * SR));
  const ph = [r(), r()];
  for (const [st, len] of pattern) {
    const i0 = Math.round(st * SR), i1 = Math.round((st + len) * SR);
    for (let i = i0; i < i1 + SR * 0.03 && i < d.length; i++) {
      const t = (i - i0) / SR;
      const env = (1 - Math.exp(-t * 260)) * (i < i1 ? 1 : Math.exp(-(i - i1) / (SR * 0.008)));
      const droop = 1 - 0.05 * Math.exp(-t * 40);
      let v = 0;
      for (let k = 0; k < 2; k++) {
        ph[k] += ((k ? f2 : f1) * droop * (1 + Math.sin(t * 60 + k) * 0.002)) / SR;
        let b = 0;
        for (let h = 0; h < HARM.length; h++) b += Math.sin(TAU * ph[k] * (h + 1)) * HARM[h];
        v += b * (k ? 0.85 : 1);
      }
      d[i] += Math.tanh(v * 0.6) * env;
    }
  }
  return finish(d, peak);
}

// Car alarm: whoops, warble, chirps, two-tone — one full cycle (~6 s)
export function carAlarm(seed = 5) {
  const r = rng(seed);
  const d = new Float32Array(Math.round(6.2 * SR));
  const ph0 = r();
  let ph = ph0;
  for (let i = 0; i < d.length; i++) {
    const t = i / SR;
    let f, on = 1;
    if (t < 1.6) f = 700 + 900 * ((t % 0.4) / 0.4);
    else if (t < 3.2) f = Math.floor(t * 12) % 2 ? 1000 : 1400;
    else if (t < 4.8) (f = 1800), (on = (t * 10) % 1 < 0.55 ? 1 : 0);
    else f = Math.floor(t * 4) % 2 ? 800 : 1100;
    ph += f / SR;
    const x = Math.sin(TAU * ph) + Math.sin(TAU * ph * 3) / 3 + Math.sin(TAU * ph * 5) / 6;
    d[i] = x * on;
  }
  // soften gating clicks with a short smoother
  let y = 0;
  const k = lpK(4000);
  for (let i = 0; i < d.length; i++) d[i] = y += (d[i] - y) * k;
  return finish(d, 0.55, 0.05);
}

// --- birds -----------------------------------------------------------------------------------------------------------
// Hadeda ibis: the raucous, descending "HAA-haa-ha-haaa" that wakes the Avenues
export function hadeda(seed) {
  const r = rng(seed);
  const n = 3 + Math.floor(r() * 3);
  const sylls = [];
  let t = 0;
  for (let k = 0; k < n; k++) {
    const len = (k === 0 ? 0.42 : 0.26 + r() * 0.12) * (k === n - 1 ? 1.4 : 1);
    sylls.push({ t, len, f: (820 - k * 45) * (0.95 + r() * 0.1) });
    t += len + 0.07 + r() * 0.08;
  }
  const d = new Float32Array(Math.ceil((t + 0.05) * SR));
  const F1 = reso(1250, 300), F2 = reso(2500, 500);
  let ph = 0, nz = 0;
  for (const s of sylls) {
    const i0 = Math.round(s.t * SR), L = Math.round(s.len * SR);
    for (let i = 0; i < L; i++) {
      const u = i / L, tt = i / SR;
      const f = s.f * (1 + 0.12 * Math.sin(Math.PI * Math.min(1, u * 1.6)) - 0.22 * u);
      ph += f / SR;
      let saw = 0;
      for (let h = 1; h <= 9; h++) saw += Math.sin(TAU * ph * h) / Math.pow(h, 0.7);
      nz += (r() * 2 - 1 - nz) * 0.3;
      const rough = 1 - 0.45 * (0.5 + 0.5 * Math.sin(TAU * 72 * tt));
      const env = sstep(u / 0.08) * sstep((1 - u) / 0.3);
      const x = (saw * rough + nz * 0.8) * env;
      d[i0 + i] += resoTick(F1, x) * 1.2 + resoTick(F2, x) * 0.8 + x * 0.02;
    }
  }
  return finish(d, 0.8);
}

// Dark-capped bulbul: a cheerful, liquid "chit-chit-chirrup-cheery"
export function bulbul(seed) {
  const r = rng(seed);
  const n = 4 + Math.floor(r() * 4);
  const notes = [];
  let t = 0;
  for (let k = 0; k < n; k++) {
    const len = 0.06 + r() * 0.11;
    notes.push({ t, len, f0: 1500 + r() * 1300, f1: 1500 + r() * 1400, trill: r() < 0.3 });
    t += len + 0.02 + r() * 0.06;
  }
  const d = new Float32Array(Math.ceil((t + 0.05) * SR));
  for (const nt of notes) {
    const i0 = Math.round(nt.t * SR), L = Math.round(nt.len * SR);
    let ph = 0;
    for (let i = 0; i < L; i++) {
      const u = i / L;
      let f = nt.f0 + (nt.f1 - nt.f0) * sstep(u) + Math.sin(Math.PI * u) * 250;
      if (nt.trill) f += Math.sin((TAU * 32 * i) / SR) * 260;
      ph += f / SR;
      const env = Math.sin(Math.PI * u) ** 1.5;
      d[i0 + i] += (Math.sin(TAU * ph) + 0.12 * Math.sin(TAU * ph * 2)) * env;
    }
  }
  return finish(d, 0.6);
}

// Cape turtle dove ("work-HAR-der", repeated) and laughing dove (soft bubbling coos)
export function dove(seed, laughing = false) {
  const r = rng(seed);
  const parts = [];
  let t = 0;
  if (laughing) {
    const n = 5 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const len = 0.09 + r() * 0.05;
      parts.push({ t, len, f: 400 + 70 * Math.sin((Math.PI * (k + 0.5)) / n) + r() * 10, rr: 0 });
      t += len + 0.04 + r() * 0.03;
    }
  } else {
    const reps = 3 + Math.floor(r() * 3), base = 500 + r() * 60;
    for (let k = 0; k < reps; k++) {
      parts.push({ t, len: 0.1, f: base * 0.96, rr: 0 });
      parts.push({ t: t + 0.15, len: 0.3, f: base * 1.06, rr: 1 });
      parts.push({ t: t + 0.5, len: 0.14, f: base * 0.92, rr: 0 });
      t += 0.95 + r() * 0.1;
    }
  }
  const d = new Float32Array(Math.ceil((t + 0.1) * SR));
  let nz = 0;
  for (const p of parts) {
    const i0 = Math.round(p.t * SR), L = Math.round(p.len * SR);
    let ph = 0;
    for (let i = 0; i < L; i++) {
      const u = i / L;
      ph += (p.f * (1 + 0.04 * Math.sin(Math.PI * u) - 0.05 * u)) / SR;
      nz += (r() * 2 - 1 - nz) * 0.05;
      const am = p.rr ? 1 - 0.35 * (0.5 + 0.5 * Math.sin((TAU * 34 * i) / SR)) : 1;
      const env = sstep(u / 0.25) * sstep((1 - u) / 0.45);
      d[i0 + i] += (Math.sin(TAU * ph) + 0.22 * Math.sin(TAU * ph * 2) + nz * 0.5) * env * am;
    }
  }
  return finish(d, 0.55, 0.04);
}

// --- night -----------------------------------------------------------------------------------------------------------
// Several crickets of two kinds (pulsed chirpers and a continuous trill), each periodic within the loop
export function cricketsLoop(sec = 4, seed = 9) {
  const r = rng(seed);
  const L = Math.round(sec * SR), d = new Float32Array(L);
  for (let c = 0; c < 6; c++) {
    const trill = c >= 4;
    const carrier = Math.round((4300 + r() * 1100) * (trill ? 1.4 : 1) * sec) / sec, amp = 0.4 + r() * 0.6; // whole cycles per loop
    const per = sec / (trill ? 2 + Math.floor(r() * 2) : 8 + Math.floor(r() * 4)); // chirp period, divides the loop
    const off = r() * per;
    for (let i = 0; i < L; i++) {
      const t = i / SR;
      const u = ((t + off) % per) / per; // position within a chirp period
      let e;
      if (trill) e = u < 0.7 ? sstep(u / 0.05) * sstep((0.7 - u) / 0.05) * (0.5 + 0.5 * Math.sin(TAU * 48 * t)) : 0;
      else {
        const pt = (u * per) / 0.028; // three pulses of ~14 ms, 28 ms apart
        e = pt < 3 ? Math.sin(Math.PI * Math.min(1, (pt % 1) / 0.55)) ** 2 * (pt % 1 < 0.55 ? 1 : 0) : 0;
      }
      if (e) d[i] += Math.sin(TAU * carrier * t) * e * amp * (trill ? 0.35 : 1);
    }
  }
  return loopify(d, 0, 0.2);
}

// Frog croaks ("rrrk rrrk") and reed-frog "tinks"
export function frog(seed) {
  const r = rng(seed);
  if (r() < 0.4) {
    const n = 3 + Math.floor(r() * 5), f = 2400 + r() * 700;
    const d = new Float32Array(Math.round((n * 0.3 + 0.1) * SR));
    for (let k = 0; k < n; k++) {
      const i0 = Math.round((k * 0.28 + r() * 0.04) * SR);
      for (let i = 0; i < SR * 0.06; i++) d[i0 + i] += Math.sin((TAU * f * i) / SR) * Math.exp(-i / (SR * 0.012));
    }
    return finish(d, 0.5);
  }
  const n = 2 + Math.floor(r() * 3), rate = 45 + r() * 30, fr = 500 + r() * 400;
  const d = new Float32Array(Math.round((n * 0.55 + 0.1) * SR));
  const R = reso(fr, 180);
  for (let k = 0; k < n; k++) {
    const t0 = k * 0.5 + r() * 0.05, len = 0.22 + r() * 0.15;
    for (let p = 0; p < len * rate; p++) {
      const i0 = Math.round((t0 + p / rate) * SR);
      const amp = Math.sin((Math.PI * p) / (len * rate));
      for (let i = 0; i < SR * 0.012; i++) d[i0 + i] += amp * Math.exp(-i / (SR * 0.003)) * (r() * 2 - 1);
    }
  }
  for (let i = 0; i < d.length; i++) d[i] = resoTick(R, d[i]);
  return finish(d, 0.6);
}

// A dog barking a few times; size picks pitch and length
export function dogBarks(seed, size = 1) {
  const r = rng(seed);
  const n = 2 + Math.floor(r() * 4);
  const barks = [];
  let t = 0;
  for (let k = 0; k < n; k++) {
    const len = (0.13 + r() * 0.08) * size;
    barks.push({ t, len, f: (560 / size) * (0.9 + r() * 0.2) });
    t += len + (r() < 0.3 ? 0.12 : 0.3 + r() * 0.5);
  }
  const d = new Float32Array(Math.ceil((t + 0.1) * SR));
  const F1 = reso(900 / Math.sqrt(size), 350), F2 = reso(1900 / Math.sqrt(size), 600);
  let ph = 0, nz = 0;
  for (const b of barks) {
    const i0 = Math.round(b.t * SR), L = Math.round(b.len * SR);
    for (let i = 0; i < L; i++) {
      const u = i / L;
      ph += (b.f * (1.15 - 0.4 * u)) / SR;
      let s = 0;
      for (let h = 1; h <= 8; h++) s += Math.sin(TAU * ph * h) / h;
      nz += (r() * 2 - 1 - nz) * 0.4;
      const env = (1 - Math.exp(-u * 40)) * Math.exp(-u * 3.2);
      const x = (s + nz * 1.1 * (1 - u * 0.5)) * env;
      d[i0 + i] += resoTick(F1, x) + resoTick(F2, x) * 0.7;
    }
  }
  return finish(d, 0.8);
}

// --- street details --------------------------------------------------------------------------------------------------
export function footstep(seed, run = false) {
  const r = rng(seed);
  const L = Math.round(0.22 * SR), d = new Float32Array(L);
  const k0 = lpK(180), k1 = lpK(run ? 1400 : 1000), k2 = lpK(4800);
  let b0 = 0, b1 = 0, b2 = 0;
  const sole = 0.025 + r() * 0.03;
  for (let i = 0; i < L; i++) {
    const t = i / SR, w = r() * 2 - 1;
    b0 += (w - b0) * k0; b1 += (w - b1) * k1; b2 += (w - b2) * k2;
    const body = b1 - b0, grit = b2 - b1;
    const heel = (1 - Math.exp(-t * 2000)) * Math.exp(-t * (run ? 80 : 110));
    const st = Math.max(0, t - sole);
    const roll = (1 - Math.exp(-st * 1100)) * Math.exp(-st * 60);
    d[i] = (b0 * 0.3 + body + grit * 0.5) * heel + (b0 * 0.3 + body * 0.6 + grit * 0.2) * roll * 0.8;
  }
  return finish(d, 0.6);
}
export function airBrake(seed) {
  const r = rng(seed);
  const L = Math.round(0.9 * SR), d = new Float32Array(L);
  let lp = 0;
  const k = lpK(2500);
  for (let i = 0; i < L; i++) {
    const t = i / SR, w = r() * 2 - 1;
    lp += (w - lp) * k;
    d[i] = (w - lp) * (1 - Math.exp(-t * 80)) * (t < 0.12 ? 1 : Math.exp(-(t - 0.12) * 5));
  }
  return finish(d, 0.5, 0.05);
}
export function brakeSqueal(seed) {
  const r = rng(seed);
  const L = Math.round(0.7 * SR), d = new Float32Array(L), f = 2600 + r() * 900;
  let ph = 0;
  for (let i = 0; i < L; i++) {
    const t = i / SR;
    ph += (f + Math.sin(t * 44) * 18) / SR;
    d[i] = (Math.sin(TAU * ph) + 0.25 * Math.sin(TAU * ph * 2.01)) * sstep(t / 0.08) * sstep((0.7 - t) / 0.3);
  }
  return finish(d, 0.35, 0.05);
}

// A kombi meeting a wall: a low body thump, crumpling sheet metal (inharmonic partials) and grit
export function crash(seed) {
  const r = rng(seed);
  const L = Math.round(1.1 * SR), d = new Float32Array(L);
  const parts = Array.from({ length: 9 }, () => ({ f: 300 + r() * 2600, a: 0.2 + r() * 0.5, dec: 4 + r() * 10, ph: r() }));
  let lp = 0, lp2 = 0;
  const k = lpK(300), k2 = lpK(3500);
  for (let i = 0; i < L; i++) {
    const t = i / SR, w = r() * 2 - 1;
    lp += (w - lp) * k;
    lp2 += (w - lp2) * k2;
    let m = 0;
    for (const p of parts) m += Math.sin(TAU * (p.f * t + p.ph)) * p.a * Math.exp(-t * p.dec);
    const crumple = (0.6 + 0.4 * Math.sin(t * 90 + r())) * Math.exp(-t * 7);
    d[i] = Math.sin(TAU * 62 * t) * Math.exp(-t * 14) * 1.4 + lp * 5 * Math.exp(-t * 18) + m * 0.35 * crumple + (w - lp2) * 0.5 * Math.exp(-t * 10) + lp2 * 0.6 * Math.exp(-t * 4) * (r() < 0.02 ? 3 : 0.3);
  }
  return finish(d, 0.85, 0.1);
}

// --- voices ----------------------------------------------------------------------------------------------------------
// A small formant synthesizer: glottal pulses (and breath) through three parallel formants, plus noise bands for the
// fricatives and plosive bursts. Good enough for shouted destination calls at a kombi rank and for crowd babble.
const V = { a: [750, 1250, 2500], e: [500, 1850, 2550], i: [320, 2250, 2950], o: [520, 900, 2450], u: [350, 850, 2300] };
const PH = {
  a: { F: V.a, v: 1, d: 0.11 }, e: { F: V.e, v: 1, d: 0.1 }, i: { F: V.i, v: 0.9, d: 0.09 }, o: { F: V.o, v: 1, d: 0.11 }, u: { F: V.u, v: 0.9, d: 0.1 },
  m: { F: [280, 1000, 2300], v: 0.35, d: 0.07 }, n: { F: [280, 1650, 2600], v: 0.35, d: 0.06 }, N: { F: [280, 2100, 2700], v: 0.35, d: 0.06 },
  b: { F: [250, 900, 2300], v: 0.12, d: 0.05, burst: 900 }, d: { F: [280, 1700, 2600], v: 0.12, d: 0.045, burst: 3200 },
  g: { F: [280, 2000, 2500], v: 0.12, d: 0.05, burst: 2000 },
  p: { F: [400, 1000, 2400], v: 0, d: 0.06, burst: 1100, asp: 0.04 }, t: { F: [400, 1700, 2600], v: 0, d: 0.055, burst: 4200, asp: 0.035 },
  k: { F: [400, 1900, 2500], v: 0, d: 0.06, burst: 2300, asp: 0.04 },
  s: { F: V.e, v: 0, d: 0.1, fric: 6000, fa: 0.5 }, z: { F: V.e, v: 0.25, d: 0.07, fric: 5000, fa: 0.3 },
  S: { F: V.i, v: 0, d: 0.09, fric: 3000, fa: 0.55 }, // "ch" frication (after a t closure)
  r: { F: [450, 1300, 1700], v: 0.55, d: 0.03 }, w: { F: V.u, v: 0.6, d: 0.05 }, y: { F: V.i, v: 0.6, d: 0.04 },
  h: { F: V.a, v: 0, d: 0.06, asp: 0.06 }, l: { F: [360, 1150, 2700], v: 0.6, d: 0.05 },
  v: { F: [300, 1100, 2300], v: 0.4, d: 0.05, fric: 4200, fa: 0.15 }, _: { F: V.a, v: 0, d: 0.1 },
};

// phones: string of phoneme letters; ':' after a vowel lengthens it; '!' before a vowel stresses it
function speak(phones, voice, r) {
  const segs = [];
  for (let i = 0; i < phones.length; i++) {
    let c = phones[i], stress = 0;
    if (c === '!') (stress = 1), (c = phones[++i]);
    const P = PH[c];
    if (!P) continue;
    let d = P.d * voice.rate * (0.9 + r() * 0.2);
    if (phones[i + 1] === ':') (d *= 2), i++;
    if (stress) d *= 1.4;
    segs.push({ P, d, stress });
  }
  const total = segs.reduce((s, g) => s + g.d, 0);
  const d = new Float32Array(Math.ceil((total + 0.12) * SR));
  const F = [reso(500, 90), reso(1500, 120), reso(2500, 170)];
  const FN = reso(3000, 900);
  const fg = [1, 0.5, 0.22];
  let cur = segs[0].P.F.map((f) => f * voice.formant);
  let ph = r(), last = 0, br = 0, i = 0, pitch = voice.f0, jit = 1, vAmp = 0, t0 = 0;
  const ksm = 1 - Math.exp(-1 / (SR * 0.012));
  for (let s = 0; s < segs.length; s++) {
    const { P, d: dur, stress } = segs[s];
    const L = Math.round(dur * SR);
    const tgt = P.F.map((f) => f * voice.formant);
    if (P.fric) resoSet(FN, P.fric), (FN.r = Math.exp(-Math.PI * 1500 / SR)), (FN.a2 = -FN.r * FN.r), (FN.g = 1 - FN.r);
    if (P.burst) resoSet(FN, P.burst);
    for (let j = 0; j < L; j++, i++) {
      const u = j / L, t = i / SR;
      if ((i & 31) === 0) for (let k = 0; k < 3; k++) (cur[k] += (tgt[k] - cur[k]) * Math.min(1, ksm * 32)), resoSet(F[k], cur[k]);
      // Plosives: silent (or barely voiced) closure, then a burst and aspiration at the release
      let voicing = P.v, nz = 0;
      const w = r() * 2 - 1;
      br += (w - br) * 0.35;
      if (P.burst) {
        const rel = u - 0.7;
        if (rel > 0) nz = resoTick(FN, w) * 6 * Math.exp(-rel * dur * 250) + (P.asp ? br * 0.25 : 0);
      } else if (P.fric) nz = resoTick(FN, w) * P.fa * 3 * sstep(u / 0.2) * sstep((1 - u) / 0.2);
      if (P.asp && !P.burst) nz += br * 0.3;
      vAmp += (voicing * (stress ? 1.25 : 1) - vAmp) * 0.004;
      const contour = voice.contour(t / total) * (stress ? 1.12 : 1);
      pitch += (voice.f0 * contour - pitch) * 0.002;
      ph += (pitch * jit * (1 + 0.012 * Math.sin(t * 29))) / SR;
      if (ph >= 1) (ph -= 1), (jit = 0.985 + r() * 0.03);
      const open = 0.55;
      const flow = ph < open ? 0.5 - 0.5 * Math.cos((Math.PI * ph) / open) : ph < open + 0.18 ? Math.cos((Math.PI * 0.5 * (ph - open)) / 0.18) : 0;
      const ex = (flow - last) * voice.f0 * 0.08 * vAmp + br * voice.breath * vAmp;
      last = flow;
      let y = 0;
      for (let k = 0; k < 3; k++) y += resoTick(F[k], ex) * fg[k];
      d[i] = y * 6 + nz * 0.3;
    }
    t0 += dur;
  }
  if (voice.shout) {
    let pk = 0;
    for (let k = 0; k < d.length; k++) pk = Math.max(pk, Math.abs(d[k]));
    for (let k = 0; k < d.length; k++) d[k] = Math.tanh((d[k] / (pk || 1)) * 1.8); // a little strain, not a square wave
  }
  return d;
}

const CALLS = {
  Mbare: 'mb!a:re',
  Chitungwiza: 'tSit!uNgwiza',
  Copa: 'k!o:pa',
  Town: 't!a:un',
  Budiriro: 'budir!i:ro',
  Kuwadzana: 'kuwadz!a:na',
  Mutare: 'mut!a:re',
  Masvingo: 'masv!i:Ngo',
  Bulawayo: 'bulaw!a:yo',
};
export const CALL_NAMES = Object.keys(CALLS);

// A tout shouting a destination two or three times: "Mbare! Mbare!"
export function toutCall(name, seed) {
  const r = rng(seed);
  const female = r() < 0.25;
  const voice = {
    f0: female ? 300 + r() * 50 : 185 + r() * 45, formant: female ? 1.15 : 1 + r() * 0.06, rate: 1.05 + r() * 0.2,
    breath: 0.25, shout: true, contour: (u) => 1.05 + 0.18 * Math.sin(Math.PI * Math.min(1, u * 1.4)) - 0.25 * u * u,
  };
  const reps = name.length > 7 ? 1 + (r() < 0.4 ? 1 : 0) : 2 + (r() < 0.3 ? 1 : 0);
  const words = [];
  for (let k = 0; k < reps; k++) words.push(speak(CALLS[name], { ...voice, f0: voice.f0 * (1 - k * 0.04) }, r));
  const gap = Math.round(SR * (0.12 + r() * 0.1));
  const out = new Float32Array(words.reduce((s, w) => s + w.length + gap, 0));
  let o = 0;
  for (const w of words) out.set(w, o), (o += w.length + gap);
  return finish(out, 0.8, 0.03);
}

// Crowd babble: several people talking (random Shona-ish syllables) with pauses, summed into a seamless loop
export function babbleLoop(sec = 6, talkers = 9, seed = 77) {
  const r = rng(seed);
  const X = Math.round(SR * 0.4), L = Math.round(sec * SR);
  const d = new Float32Array(L + X);
  const C = 'mnbdgktswrhyz', VW = 'aeiou';
  for (let p = 0; p < talkers; p++) {
    const female = r() < 0.5;
    const voice = {
      f0: female ? 200 + r() * 40 : 110 + r() * 30, formant: female ? 1.14 : 1, rate: 0.9 + r() * 0.3, breath: 0.35, shout: false,
      contour: (u) => 1.06 - 0.12 * u + 0.05 * Math.sin(u * 9),
    };
    const amp = 0.4 + r() * 0.6;
    let t = r() * 1.5;
    while (t < sec) {
      let ph = '';
      const n = 2 + Math.floor(r() * 5);
      for (let k = 0; k < n; k++) ph += (r() < 0.85 ? C[Math.floor(r() * C.length)] : '') + (r() < 0.2 ? '!' : '') + VW[Math.floor(r() * 5)];
      const u = speak(ph, voice, r);
      const o = Math.round(t * SR);
      for (let i = 0; i < u.length && o + i < d.length; i++) d[o + i] += u[i] * amp;
      t += u.length / SR + 0.15 + r() * (r() < 0.25 ? 1.2 : 0.35);
    }
  }
  let y = 0;
  const k = lpK(2600);
  for (let i = 0; i < d.length; i++) d[i] = y += (d[i] - y) * k;
  return loopify(d, X, 0.2, 0.9);
}

// Stereo impulse response for the street-canyon reflections: early slaps then a short diffuse tail
export function canyonIR(sec = 1.3, seed = 3) {
  const out = [];
  for (let c = 0; c < 2; c++) {
    const r = rng(seed + c * 17);
    const L = Math.round(sec * SR), d = new Float32Array(L);
    for (let k = 0; k < 10; k++) {
      const i = Math.round((0.012 + r() * 0.09) * SR);
      d[i] += (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.5) * Math.exp(-i / (SR * 0.08));
    }
    let lp = 0;
    for (let i = 0; i < L; i++) {
      const t = i / SR;
      lp += (r() * 2 - 1 - lp) * (0.5 - 0.35 * (t / sec));
      d[i] += lp * 0.35 * sstep(t / 0.02) * Math.exp(-t * 4.2);
    }
    out.push(finish(d, 0.5, 0.1));
  }
  return out;
}
