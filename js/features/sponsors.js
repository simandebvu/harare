// js/features/sponsors.js — paid (or house) adverts on the city's billboards and painted wall ads, and the tip link,
// all from sponsors.json at the site root, so selling a slot is an edit to that file and a push, never code.
// Each sponsor takes one or more of the 8 billboard (or 8 wall-ad) designs in the sign atlas (js/signs.js); every
// building that drew that design shows the sponsor. Tapping a sponsored sign offers a "Visit" button, and the click is
// counted in GoatCounter (harare/sponsor-<id>): the number to show the sponsor.
import * as THREE from 'three';
import { track } from '../analytics.js';
import { ATLAS, cellRect, paintBillboard, paintWallAd } from '../signs.js';

const KINDS = { billboards: 'billboard', wallAds: 'wallad' };

export default {
  init(ctx) {
    this.ctx = ctx;
    this.owner = { billboard: [], wallad: [] }; // cell index → sponsor
    this.load(); // in the background: loading the city never waits for adverts
  },

  async load() {
    const ctx = this.ctx;
    let cfg;
    try {
      const res = await fetch(new URL('../../sponsors.json', import.meta.url), { cache: 'no-cache' });
      if (!res.ok) return;
      cfg = await res.json();
    } catch {
      return; // no file, or offline: the made-up brands stay
    }
    this.tip(cfg.tip);
    const mesh = ctx.buildings?.signs, tex = mesh?.material?.map, canvas = tex?.image;
    if (!canvas?.getContext) return;
    const g = canvas.getContext('2d');
    for (const [key, kind] of Object.entries(KINDS)) {
      let cell = 0;
      for (const s of cfg[key] || []) {
        for (let k = 0; k < Math.max(1, s.slots | 0) && cell < ATLAS.LAYOUT[kind][5]; k++, cell++) {
          this.owner[kind][cell] = s;
          await this.paint(g, kind, cell, s);
        }
      }
    }
    tex.needsUpdate = true;
    if (this.owner.billboard.length || this.owner.wallad.length) this.listen(mesh);
  },

  async paint(g, kind, cell, s) {
    const [x, y, w, h] = cellRect(kind, cell);
    if (s.image) {
      try {
        const img = new Image();
        img.src = new URL('../../' + s.image.replace(/^\//, ''), import.meta.url).href;
        await img.decode();
        // cover the cell, centred
        const k = Math.max(w / img.width, h / img.height), dw = img.width * k, dh = img.height * k;
        g.save();
        g.beginPath();
        g.rect(x, y, w, h);
        g.clip();
        g.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
        g.restore();
        return;
      } catch {
        console.warn('[harare] sponsors: could not load', s.image);
        if (!s.brand && !s.b) return;
      }
    }
    if (kind === 'billboard') paintBillboard(g, x, y, w, h, { mark: 'none', fg: '#ffffff', bg: ['#222', '#444'], ...s });
    else paintWallAd(g, x, y, w, h, { mark: 'none', fg: '#ffffff', bg: '#333', ...s, b: s.b || s.brand });
  },

  // Which sponsor, if any, owns this point of the sign atlas (from a hit's uv)
  sponsorAt(uv) {
    const px = uv.x * ATLAS.W, py = (1 - uv.y) * ATLAS.H;
    for (const kind of ['billboard', 'wallad']) {
      const [x0, y0, cw, ch, cols, count] = ATLAS.LAYOUT[kind];
      if (py < y0 || px < x0) continue;
      const col = Math.floor((px - x0) / cw), row = Math.floor((py - y0) / ch), i = row * cols + col;
      if (col < cols && i < count) return this.owner[kind][i] || null;
    }
    return null;
  },

  // A tap (or click) that is not a drag: did it land on a sponsored sign within reach?
  listen(mesh) {
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), canvas = this.ctx.renderer.domElement;
    ray.far = 400;
    let down = null;
    canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY, t: performance.now() }), { passive: true });
    canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8 || performance.now() - down.t > 350) return;
      const r = canvas.getBoundingClientRect(), locked = document.pointerLockElement === canvas;
      ndc.set(locked ? 0 : ((e.clientX - r.left) / r.width) * 2 - 1, locked ? 0 : -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.ctx.camera);
      const hit = ray.intersectObject(mesh, false)[0];
      if (!hit?.uv || !hit.face) return;
      // not through a building: the line from the camera to just in front of the sign must be clear
      const n = hit.face.normal, P = hit.point, cam = this.ctx.camera.position;
      if (this.ctx.controls.rig.clearance(cam.x, cam.y, cam.z, P.x + n.x * 0.8, P.y + n.y * 0.8, P.z + n.z * 0.8) < 0.98) return;
      const s = this.sponsorAt(hit.uv);
      if (s?.url) this.offer(s);
    }, { passive: true });
  },

  // A small "Visit …" button for a few seconds: one deliberate tap opens the sponsor, a stray tap while looking around doesn't
  offer(s) {
    if (!this.chip) {
      const st = document.createElement('style');
      st.textContent = `.sponsor-chip{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom) + 132px);transform:translateX(-50%);z-index:40;padding:10px 16px;border-radius:999px;border:0;background:#f5d453;color:#18201c;font:700 14px system-ui;box-shadow:0 6px 18px #0006;cursor:pointer;opacity:0;pointer-events:none;transition:opacity .2s}.sponsor-chip.on{opacity:1;pointer-events:auto}`;
      document.head.appendChild(st);
      this.chip = document.createElement('button');
      this.chip.type = 'button';
      this.chip.className = 'sponsor-chip';
      this.chip.onclick = () => {
        const c = this.current;
        if (!c) return;
        track('sponsor-' + (c.id || c.brand || c.b || 'unnamed').toString().toLowerCase().replace(/[^a-z0-9]+/g, '-'));
        window.open(c.url, '_blank', 'noopener');
        this.chip.classList.remove('on');
      };
      document.body.appendChild(this.chip);
    }
    this.current = s;
    this.chip.textContent = `Visit ${s.brand || s.b || 'sponsor'} ↗`;
    this.chip.classList.add('on');
    clearTimeout(this.chipT);
    this.chipT = setTimeout(() => this.chip.classList.remove('on'), 4000);
  },

  // The tip link: in the options menu and on the damage report card (js/features/chaos-report.js reads ctx.tip)
  tip(t) {
    if (!t?.url) return;
    this.ctx.tip = { url: t.url, label: t.label || 'Support Harare3D' };
    const row = document.querySelector('#play-menu .share-row');
    if (!row || row.querySelector('.tip-link')) return;
    const a = document.createElement('a');
    a.className = 'tip-link';
    a.href = t.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = `☕ ${this.ctx.tip.label}`;
    a.addEventListener('click', () => track('tip-menu'));
    const st = document.createElement('style');
    st.textContent = `#play-menu .tip-link{display:block;text-align:center;padding:10px;border-radius:10px;border:1px solid #f5d45380;color:#f5d453;font:600 14px system-ui;text-decoration:none}`;
    document.head.appendChild(st);
    row.querySelector('.share-note')?.after(a);
  },
};
