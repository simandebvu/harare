// js/audio/debug.js — verification helpers (headless runs can't listen). Not used by the running soundscape.
//   selfTest(mixer)  renders every buffer through an OfflineAudioContext and reports RMS / peak / NaN
//   meter(mixer)     RMS and peak of what is actually leaving the master right now, plus bed and voice levels
export async function selfTest(M) {
  const out = {};
  for (const k in M.B) {
    if (k === 'ir') continue;
    const b = M.B[k];
    const oc = new OfflineAudioContext(1, Math.ceil(Math.min(b.duration, 3) * 48000), 48000);
    const s = oc.createBufferSource();
    s.buffer = b;
    s.loop = b.duration < 3;
    s.connect(oc.destination);
    s.start();
    const r = (await oc.startRendering()).getChannelData(0);
    let e = 0, pk = 0, nan = 0;
    for (const v of r) Number.isFinite(v) ? ((e += v * v), (pk = Math.max(pk, Math.abs(v)))) : nan++;
    out[k] = { s: +b.duration.toFixed(2), rms: +Math.sqrt(e / r.length).toFixed(3), peak: +pk.toFixed(3), nan };
  }
  return out;
}

let an = null, buf = null;
export function meter(M) {
  if (!an) {
    an = M.ac.createAnalyser();
    an.fftSize = 8192;
    buf = new Float32Array(an.fftSize);
    M.limiter.connect(an);
  }
  an.getFloatTimeDomainData(buf);
  let e = 0, pk = 0, nan = 0;
  for (const v of buf) Number.isFinite(v) ? ((e += v * v), (pk = Math.max(pk, Math.abs(v)))) : nan++;
  const beds = {};
  for (const k in M.beds) beds[k] = +M.beds[k].g.gain.value.toFixed(3);
  return {
    rms: +Math.sqrt(e / buf.length).toFixed(4),
    peak: +pk.toFixed(3),
    nan,
    master: +M.master.gain.value.toFixed(2),
    reduction: +M.limiter.reduction.toFixed(1),
    beds,
    rank: +M.rank.gain.gain.value.toFixed(3),
    player: +M.pEng.gain.value.toFixed(2),
    playerRate: +M.pSrc.playbackRate.value.toFixed(2),
    voices: M.voices.filter((v) => v.car).map((v) => `${v.kind}@${Math.hypot(v.car.x - M.ac.listener.positionX.value, v.car.z - M.ac.listener.positionZ.value).toFixed(0)}m r${v.src?.playbackRate.value.toFixed(2)} occ${v.occ.toFixed(2)} g${v.gain.gain.value.toFixed(2)}`),
    strips: M.strips.filter((s) => s.busyUntil > M.ac.currentTime).map((s) => s.kind),
  };
}
