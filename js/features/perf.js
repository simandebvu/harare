// js/features/perf.js — a test panel for finding what makes a phone stutter. Only with ?perf=1 in the address.
// It shows frame rate and where each frame's time goes (game update, drawing, labels), lets you switch suspects off
// live (frosted-glass panels, landmark labels, ambient occlusion and bloom, render resolution), and "Run test" steps
// through them for a few seconds each, then offers a report to copy and paste back.
const CONFIGS = [
  { name: 'as shipped', set: {} },
  { name: 'no frosted glass', set: { blur: false } },
  { name: 'no labels', set: { labels: false } },
  { name: 'no ambient occlusion', set: { quality: 1 } },
  { name: 'no effects at all', set: { quality: 0 } },
  { name: 'resolution 1x', set: { res: 1 } },
  { name: 'resolution 0.75x', set: { res: 0.75 } },
  { name: 'everything light', set: { blur: false, labels: false, quality: 0, res: 0.75 } },
];

// Fly test: hover in the air and keep still while each suspect is switched off on its own. `each` runs every frame
// while the step is on (the game would otherwise switch some of these back), `undo` puts it back.
const byName = (ctx, n) => ctx.scene.getObjectByName(n);
const OFF = {
  shadows: { each: (c) => ((c.renderer.shadowMap.autoUpdate = false), (c.renderer.shadowMap.needsUpdate = false)), undo: (c) => (c.renderer.shadowMap.autoUpdate = true) },
  suburbs: { each: (c) => (byName(c, 'suburbs').visible = false), undo: (c) => (byName(c, 'suburbs').visible = true) },
  trees: { each: (c) => (byName(c, 'trees').visible = false), undo: (c) => (byName(c, 'trees').visible = true) },
  clouds: { each: (c) => (c.clouds.mesh.visible = false), undo: (c) => (c.clouds.mesh.visible = true) },
  buildings: { each: (c) => (c.buildings.mesh.visible = false), undo: (c) => (c.buildings.mesh.visible = true) },
  ground: { each: (c) => (c.world.group.visible = false), undo: (c) => (c.world.group.visible = true) },
  // street props, poles and parked cars (tiles), plus the traffic
  props: {
    each(c) {
      c.scene.traverse((o) => o.userData.tile && (o.visible = false));
      for (const o of c.scene.children) if (/^detailed-traffic/.test(o.name)) o.visible = false;
    },
    undo: (c) => c.scene.children.forEach((o) => /^detailed-traffic/.test(o.name) && (o.visible = true)),
  },
  everything: { each: (c) => c.camera.layers.disableAll(), undo: (c) => c.camera.layers.set(0) },
};
// One step that switches several things off at once
const off = (name, keys, set) => ({ name, set, each: (c) => keys.forEach((k) => OFF[k].each(c)), undo: (c) => keys.forEach((k) => OFF[k].undo(c)) });
// A phone frame that misses the display's 16.7 ms beat waits for the next one, so 17 ms and 33 ms both show as 30 fps:
// single suspects barely move the number, and the steps below stack them to find what gets back under the line.
// Is a phone in flight held back by the number of draw requests, or by the pixels they fill? '0.1x' keeps every
// request (and every triangle) but leaves almost no pixels to fill. If it is still slow, the requests are the cost.
const LITE = { res: 1, quality: 0 };
const FLY = [
  { name: 'in the air, as is' },
  off('1x, no bloom, no shadow', ['shadows'], LITE),
  off('0.1x, no bloom, no shadow', ['shadows'], { res: 0.1, quality: 0 }),
  off('0.1x, no bloom', [], { res: 0.1, quality: 0 }),
  off('1x, no buildings', ['shadows', 'buildings'], LITE),
  off('1x, no props or cars', ['shadows', 'props'], LITE),
  off('nothing drawn (fx only)', ['everything']),
];

export default {
  init(ctx) {
    if (!ctx.perf) return;
    this.ctx = ctx;
    this.base = { blur: true, labels: true, quality: ctx.post.quality, res: ctx.renderer.getPixelRatio() };
    this.cur = { ...this.base };
    const st = document.createElement('style');
    st.textContent = `
.perf{position:fixed;left:8px;top:calc(env(safe-area-inset-top) + 64px);z-index:60;width:min(300px,calc(100vw - 16px));padding:8px 10px;border-radius:10px;background:rgba(0,0,0,.82);color:#e8f0ea;font:11px/1.35 ui-monospace,Menlo,monospace;pointer-events:auto}
.perf pre{margin:0 0 6px;white-space:pre-wrap}
.perf .row{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.perf button{font:600 11px system-ui;padding:6px 8px;border-radius:6px;border:1px solid #ffffff40;background:#2a3b35;color:#fff}
.perf button.on{background:#f5d453;color:#111}
.perf.min pre,.perf.min .row:not(.keep){display:none}
body.perf-noblur *{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}`;
    document.head.appendChild(st);
    const el = (this.el = document.createElement('div'));
    el.className = 'perf';
    el.innerHTML = `<pre></pre>
<div class="row"><button data-t="blur">Glass</button><button data-t="labels">Labels</button><button data-q="2">AO+bloom</button><button data-q="1">Bloom</button><button data-q="0">No fx</button></div>
<div class="row"><button data-r="${this.base.res}">Res ${this.base.res}x</button><button data-r="1">1x</button><button data-r="0.75">0.75x</button></div>
<div class="row keep"><button data-a="play">Record play</button><button data-a="test">Run test</button><button data-a="fly">Fly test</button><button data-a="copy">Copy report</button><button data-a="min">Hide</button></div>`;
    this.out = el.querySelector('pre');
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.t) this.apply({ [b.dataset.t]: !this.cur[b.dataset.t] });
      else if (b.dataset.q) this.apply({ quality: +b.dataset.q });
      else if (b.dataset.r) this.apply({ res: +b.dataset.r });
      else if (b.dataset.a === 'test') this.runTest();
      else if (b.dataset.a === 'play') this.recordPlay();
      else if (b.dataset.a === 'fly') this.runTest(FLY, 'hover in the air');
      else if (b.dataset.a === 'copy') this.copy();
      else if (b.dataset.a === 'min') el.classList.toggle('min');
    });
    const gl = ctx.renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.device = `${navigator.userAgent}\nGPU ${dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?'} · dpr ${devicePixelRatio} · screen ${innerWidth}x${innerHeight}`;
    this.results = [];
    this.t = 0;
    // Browsers and phones slow a page down once nobody has touched it for a while, so every result notes how long it
    // had been since the last touch or key press.
    this.lastInput = performance.now();
    for (const ev of ['pointerdown', 'pointermove', 'touchstart', 'touchmove', 'keydown']) addEventListener(ev, () => (this.lastInput = performance.now()), { capture: true, passive: true });
    this.paint();
  },

  idle() {
    return (performance.now() - this.lastInput) / 1000;
  },

  // 30 seconds of normal play, measured in 5-second slices
  async recordPlay() {
    if (this.testing) return;
    this.testing = true;
    this.results = [];
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let k = 0; k < 6; k++) {
      this.status = `recording: play normally (${30 - k * 5}s left)`;
      this.ctx.perf.log.length = 0;
      let maxIdle = 0;
      for (let i = 0; i < 10; i++) await wait(500), (maxIdle = Math.max(maxIdle, this.idle()));
      this.results.push([`play ${k * 5}-${k * 5 + 5}s`, this.stats(5), maxIdle]);
    }
    this.testing = false;
    this.status = 'done: tap Copy report';
  },

  apply(s) {
    const ctx = this.ctx;
    Object.assign(this.cur, s);
    document.body.classList.toggle('perf-noblur', !this.cur.blur);
    ctx.perf.noLabels = !this.cur.labels;
    document.querySelectorAll('#app > :not(canvas)').forEach((n) => (n.style.visibility = this.cur.labels ? '' : 'hidden'));
    ctx.userQuality = true; // stop the automatic downgrade while testing
    if (ctx.post.quality !== this.cur.quality) ctx.post.setQuality(this.cur.quality);
    if (ctx.renderer.getPixelRatio() !== this.cur.res) ctx.setPixelRatio(this.cur.res);
    this.paint();
  },

  // Frame stats over the last `secs` seconds
  stats(secs = 3) {
    const L = this.ctx.perf.log, frames = [];
    let acc = 0;
    for (let i = L.length - 4; i >= 0 && acc < secs * 1000; i -= 4) frames.push([L[i], L[i + 1], L[i + 2], L[i + 3]]), (acc += L[i]);
    if (!frames.length) return null;
    const ft = frames.map((f) => f[0]).sort((a, b) => a - b), avg = (k) => frames.reduce((s, f) => s + f[k], 0) / frames.length;
    return {
      fps: (1000 * frames.length) / acc,
      p50: ft[Math.floor(ft.length * 0.5)],
      p95: ft[Math.floor(ft.length * 0.95)],
      hitches: ft.filter((t) => t > 50).length,
      upd: avg(1),
      ren: avg(2),
      lab: avg(3),
    };
  },

  line(s) {
    return `${s.fps.toFixed(0).padStart(3)} fps · frame ${s.p50.toFixed(1)}/${s.p95.toFixed(1)} ms (median/95%) · ${s.hitches} hitches\n    update ${s.upd.toFixed(1)} · draw ${s.ren.toFixed(1)} · labels ${s.lab.toFixed(1)} ms`;
  },

  paint() {
    for (const b of this.el.querySelectorAll('button')) {
      b.classList.toggle('on', (b.dataset.t && this.cur[b.dataset.t]) || (b.dataset.q && +b.dataset.q === this.cur.quality) || (b.dataset.r && +b.dataset.r === this.cur.res) || false);
    }
  },

  async runTest(list = CONFIGS, hint = 'keep still') {
    if (this.testing) return;
    this.testing = true;
    this.results = [];
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const c of list) {
      this.apply({ ...this.base, ...c.set });
      this.each = c.each;
      this.status = `testing: ${c.name}… ${hint}`;
      await wait(1200);
      this.ctx.perf.log.length = 0;
      await wait(3500);
      this.results.push([c.name, this.stats(3.5), this.idle()]);
      this.each = null;
      c.undo?.(this.ctx);
    }
    this.apply(this.base);
    this.ctx.userQuality = false; // back to the game's own settings (phones change some in flight)
    this.testing = false;
    this.status = 'done: tap Copy report';
  },

  report() {
    const now = this.stats(3);
    return `Harare3D perf report\n${this.device}\nnow (${JSON.stringify(this.cur)}): ${now ? this.line(now) : '-'}\n` + this.results.map(([n, s, idle]) => `${n.padEnd(22)} ${s ? this.line(s) : '-'} · ${idle.toFixed(0)}s since last touch`).join('\n');
  },

  async copy() {
    const text = this.report();
    try {
      await navigator.clipboard.writeText(text);
      this.status = 'report copied';
    } catch {
      this.status = 'copy blocked: screenshot this instead';
    }
  },

  update(dt) {
    if (!this.el) return;
    this.each?.(this.ctx);
    if ((this.t -= dt) > 0) return;
    this.t = 0.5;
    const s = this.stats(2);
    this.out.textContent =
      (this.status ? this.status + '\n' : '') +
      (s ? this.line(s) : 'measuring…') +
      (this.results.length ? '\n' + this.results.map(([n, r, idle]) => `${n}: ${r ? r.fps.toFixed(0) + ' fps, 95% ' + r.p95.toFixed(0) + ' ms' : '-'} (${idle.toFixed(0)}s idle)`).join('\n') : '');
  },
};
