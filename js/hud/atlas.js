// js/hud/atlas.js — full-screen "Harare Street Atlas": pan/zoom canvas map, street + landmark labels, fuzzy search,
// click-to-route. The base layer redraws only when the view changes; the overlay (you, route, pin) is cheap per frame.
import { drawLayers, drawArrow, drawPin, haloText, iconColor } from './render.js';
import { shortName } from './geo.js';

const $ = (id) => document.getElementById(id);
const RANK = { trunk: 6, primary: 5, secondary: 4, tertiary: 3, trunk_link: 1, primary_link: 1, secondary_link: 1, unclassified: 2, residential: 2, pedestrian: 2 };
const MIN_S = 0.06, MAX_S = 5;

export function createAtlas({ DATA, geo, layers, getPlayer, getHeading, onDest, onTeleport, onClear, getDest, getRoute }) {
  const root = $('atlas'), base = $('atlas-base'), over = $('atlas-over');
  const gb = base.getContext('2d'), go = over.getContext('2d');
  const q = $('atlas-q'), results = $('atlas-results'), card = $('atlas-card'), status = $('atlas-status'), you = $('atlas-you');
  let W = 0, H = 0, dpr = 1;
  let cx = 0, cz = 0, s = 0.35; // view centre (m) and px per metre
  let dirty = true, open = false;

  // Street-label candidates: every named segment, longest first within each class
  const cand = [];
  for (const seg of geo.segs) {
    const r = seg.r;
    if (!r.n || r.k === 'service' || seg.len < 25) continue;
    cand.push({ seg, n: shortName(r.n), rank: RANK[r.k] ?? 1 });
  }
  cand.sort((a, b) => b.rank - a.rank || b.seg.len - a.seg.len);
  const widthCache = new Map();
  const textW = (t, font) => {
    const k = font + t;
    let w = widthCache.get(k);
    if (w === undefined) {
      gb.font = font;
      w = gb.measureText(t).width;
      widthCache.set(k, w);
    }
    return w;
  };
  document.fonts?.addEventListener?.('loadingdone', () => {
    widthCache.clear();
    dirty = true;
  });

  // Minor places (hotels, churches, ranks) shown when zoomed in
  const minor = DATA.places.filter((p) => !geo.spots.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < 40));

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth;
    H = innerHeight;
    for (const c of [base, over]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    dirty = true;
  }
  addEventListener('resize', () => open && resize());

  const sx = (x) => (x - cx) * s + W / 2, sy = (z) => (z - cz) * s + H / 2;
  const wx = (px) => (px - W / 2) / s + cx, wz = (py) => (py - H / 2) / s + cz;

  // Axis-aligned boxes of placed labels for collision
  const boxes = [];
  const free = (x0, y0, x1, y1) => {
    for (let i = 0; i < boxes.length; i += 4) if (x0 < boxes[i + 2] && x1 > boxes[i] && y0 < boxes[i + 3] && y1 > boxes[i + 1]) return false;
    return true;
  };
  const claim = (x0, y0, x1, y1) => boxes.push(x0, y0, x1, y1);

  function renderBase() {
    dirty = false;
    const g = gb;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0e1114';
    g.fillRect(0, 0, base.width, base.height);
    g.setTransform(dpr * s, 0, 0, dpr * s, dpr * (W / 2 - cx * s), dpr * (H / 2 - cz * s));
    drawLayers(g, layers, s, { bldColor: s > 0.5 ? '#2a3039' : '#232830', bldTallColor: '#353c47' });

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    boxes.length = 0;
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    // Districts (big, letter-spaced, beneath everything else)
    if (s < 1.4) {
      for (const d of geo.districts) {
        const x = sx(d.x), y = sy(d.z);
        if (x < -200 || x > W + 200 || y < -50 || y > H + 50) continue;
        const fs = d.small ? 11 : d.big ? 15 : 13;
        g.font = `700 ${fs}px Inter, system-ui, sans-serif`;
        if ('letterSpacing' in g) g.letterSpacing = '0.22em';
        const t = d.n.toUpperCase();
        g.globalAlpha = s > 0.8 ? 0.35 : 0.6;
        haloText(g, t, x, y, d.small ? '#7fae8c' : '#b9b2c8', 'rgba(14,17,20,0.7)', 4);
        g.globalAlpha = 1;
        if ('letterSpacing' in g) g.letterSpacing = '0px';
      }
    }

    // Landmark pins + names (claimed before streets so they win)
    const pinNames = s > 0.16;
    g.font = '650 12px Inter, system-ui, sans-serif';
    for (const p of geo.spots) {
      const x = sx(p.x), y = sy(p.z);
      if (x < -40 || x > W + 40 || y < -40 || y > H + 40) continue;
      drawPin(g, x, y, iconColor(p.icon), s > 0.5 ? 6 : 4.5);
      claim(x - 8, y - 8, x + 8, y + 8);
      if (!pinNames) continue;
      const w = textW(p.n, g.font);
      const lx = x + 10, ly = y;
      if (free(lx, ly - 8, lx + w + 4, ly + 8)) {
        g.textAlign = 'left';
        haloText(g, p.n, lx, ly, '#ffe79a', 'rgba(10,12,15,0.92)', 3.5);
        g.textAlign = 'center';
        claim(lx, ly - 8, lx + w + 4, ly + 8);
      }
    }
    if (s > 0.55) {
      g.font = '550 11px Inter, system-ui, sans-serif';
      for (const p of minor) {
        const x = sx(p.x), y = sy(p.z);
        if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
        g.beginPath();
        g.arc(x, y, 3, 0, Math.PI * 2);
        g.fillStyle = '#c9a6ff';
        g.fill();
        if (s > 1.0) {
          const w = textW(p.n, g.font);
          if (free(x + 6, y - 7, x + 8 + w, y + 7)) {
            g.textAlign = 'left';
            haloText(g, p.n, x + 7, y, '#d9c8f5', 'rgba(10,12,15,0.9)', 3);
            g.textAlign = 'center';
            claim(x + 6, y - 7, x + 8 + w, y + 7);
          }
        }
      }
    }

    // Street names along their segments
    const minRank = s > 0.7 ? 0 : s > 0.4 ? 2 : s > 0.22 ? 3 : s > 0.12 ? 5 : 99;
    const fs = s > 1.5 ? 12 : 11;
    const font = `600 ${fs}px Inter, system-ui, sans-serif`;
    g.font = font;
    const spacing = 320; // px between repeats of the same name
    const lastAt = new Map();
    let count = 0;
    for (const c of cand) {
      if (c.rank < minRank) continue;
      const sg = c.seg;
      const ax = sx(sg.ax), ay = sy(sg.az), bx = sx(sg.bx), by = sy(sg.bz);
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      if (mx < 0 || mx > W || my < 0 || my > H) continue;
      const L = sg.len * s, w = textW(c.n, font);
      if (L < w + 14) continue;
      const prev = lastAt.get(c.n);
      if (prev) {
        let near = false;
        for (let i = 0; i < prev.length; i += 2) if (Math.hypot(prev[i] - mx, prev[i + 1] - my) < spacing) near = true;
        if (near) continue;
      }
      let a = Math.atan2(by - ay, bx - ax);
      if (a > Math.PI / 2) a -= Math.PI;
      else if (a < -Math.PI / 2) a += Math.PI;
      const ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a));
      const hw = (w / 2) * ca + (fs / 2 + 2) * sa, hh = (w / 2) * sa + (fs / 2 + 2) * ca;
      if (!free(mx - hw, my - hh, mx + hw, my + hh)) continue;
      claim(mx - hw, my - hh, mx + hw, my + hh);
      if (prev) prev.push(mx, my);
      else lastAt.set(c.n, [mx, my]);
      g.save();
      g.translate(mx, my);
      g.rotate(a);
      haloText(g, c.n, 0, 0.5, c.rank >= 5 ? '#fff4d6' : '#ecebe6', 'rgba(12,14,17,0.92)', 3);
      g.restore();
      if (++count > 260) break;
    }

    // Mbare lies beyond the edge of the extract
    const mx = sx(-900), my = sy(1880);
    if (mx > -100 && mx < W + 100 && my > -40 && my < H + 40) {
      g.font = 'italic 650 12px Inter, system-ui, sans-serif';
      haloText(g, 'to Mbare ↓', mx, my, '#b9b2c8', 'rgba(14,17,20,0.8)', 3);
    }
  }

  let pulse = 0;
  function renderOver(dt) {
    pulse += dt;
    const g = go;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const route = getRoute();
    if (route && route.length >= 4) {
      g.save();
      g.setTransform(dpr * s, 0, 0, dpr * s, dpr * (W / 2 - cx * s), dpr * (H / 2 - cz * s));
      g.lineCap = g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(route[0], route[1]);
      for (let i = 2; i < route.length; i += 2) g.lineTo(route[i], route[i + 1]);
      g.strokeStyle = 'rgba(4,24,44,0.95)';
      g.lineWidth = Math.max(10, 9 / s);
      g.stroke();
      g.strokeStyle = '#3fb8ff';
      g.lineWidth = Math.max(6, 5.5 / s);
      g.stroke();
      g.restore();
    }
    const d = getDest();
    if (d) {
      const x = sx(d.x), y = sy(d.z);
      g.save();
      g.translate(x, y);
      g.beginPath();
      g.moveTo(0, 0);
      g.bezierCurveTo(-3, -6, -10, -11, -10, -19);
      g.arc(0, -19, 10, Math.PI, 0);
      g.bezierCurveTo(10, -11, 3, -6, 0, 0);
      g.fillStyle = '#ff5a4a';
      g.strokeStyle = '#0b0d10';
      g.lineWidth = 2.5;
      g.stroke();
      g.fill();
      g.beginPath();
      g.arc(0, -19, 3.8, 0, Math.PI * 2);
      g.fillStyle = '#fff';
      g.fill();
      g.restore();
    }
    const p = getPlayer();
    const px = sx(p.x), py = sy(p.z);
    g.beginPath();
    g.arc(px, py, 14 + Math.sin(pulse * 3) * 3, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,207,58,0.14)';
    g.fill();
    drawArrow(g, px, py, getHeading() + Math.PI / 2, 9);
  }

  // --- interaction --------------------------------------------------------------------------------------------------
  const zoomAt = (f, px, py) => {
    const ns = Math.max(MIN_S, Math.min(MAX_S, s * f));
    const x = wx(px), z = wz(py);
    s = ns;
    cx = x - (px - W / 2) / s;
    cz = z - (py - H / 2) / s;
    dirty = true;
    placeCard();
  };
  let anim = null;
  const flyTo = (x, z, ns) => (anim = { x0: cx, z0: cz, s0: s, x, z, s: ns ?? s, t: 0 });

  const ptrs = new Map();
  let moved = false, pinch = 0, downX = 0, downY = 0;
  over.addEventListener('pointerdown', (e) => {
    try {
      over.setPointerCapture(e.pointerId);
    } catch {}
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) (moved = false), (downX = e.clientX), (downY = e.clientY);
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
      moved = true;
    }
    anim = null;
  });
  over.addEventListener('pointermove', (e) => {
    const pt = ptrs.get(e.pointerId);
    if (!pt) return hover(e.clientX, e.clientY);
    const dx = e.clientX - pt.x, dy = e.clientY - pt.y;
    pt.x = e.clientX;
    pt.y = e.clientY;
    if (ptrs.size === 1) {
      if (!moved && Math.hypot(e.clientX - downX, e.clientY - downY) > 5) (moved = true), over.classList.add('panning');
      if (moved) {
        cx -= dx / s;
        cz -= dy / s;
        dirty = true;
        placeCard();
      }
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0) zoomAt(d / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch = d;
    }
  });
  const up = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    over.classList.remove('panning');
    if (ptrs.size === 0 && !moved && e.type === 'pointerup') clickAt(e.clientX, e.clientY);
    if (ptrs.size < 2) pinch = 0;
  };
  over.addEventListener('pointerup', up);
  over.addEventListener('pointercancel', up);
  over.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX, e.clientY);
  }, { passive: false });
  over.addEventListener('dblclick', (e) => {
    // double-click: teleport straight there
    const d = getDest();
    if (d) onTeleport(d.x, d.z), close();
  });

  const fmtDist = (m) => (m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
  const DEFAULT_STATUS = matchMedia('(hover: none)').matches
    ? 'Tap anywhere for a GPS route · drag to pan · pinch to zoom'
    : 'Click anywhere for a GPS route · double-click to teleport · drag to pan · scroll to zoom';
  let hoverT = 0;
  function hover(x, y) {
    const now = performance.now();
    if (now - hoverT < 60) return;
    hoverT = now;
    const X = wx(x), Z = wz(y);
    const n = geo.nearestStreet(X, Z, 30 / Math.min(1, s));
    const p = getPlayer();
    status.textContent = n ? `${shortName(n)} · ${fmtDist(Math.hypot(X - p.x, Z - p.z))} from you` : DEFAULT_STATUS;
  }

  function describe(x, z) {
    let spot = null, bd = 70;
    for (const sp of geo.spots) {
      const d = Math.hypot(sp.x - x, sp.z - z);
      if (d < bd) (bd = d), (spot = sp);
    }
    const st = geo.nearestStreet(x, z, 120);
    if (spot) return { name: spot.n, sub: spot.street ? shortName(spot.street) : spot.d, spot };
    if (st) {
      const j = geo.nearestJunction(x, z, st);
      const cross = j && j.names.find((n) => n !== st);
      return { name: shortName(st), sub: cross && Math.hypot(j.x - x, j.z - z) < 160 ? `near ${shortName(cross)}` : 'Harare' };
    }
    return { name: 'Dropped pin', sub: 'off the street map' };
  }

  let cardFor = null;
  function setDest(x, z, info) {
    info ||= describe(x, z);
    onDest(x, z, info.name, info.spot);
    cardFor = { x, z };
    $('card-name').textContent = info.name;
    const r = getRoute();
    const len = r ? routeLen(r) : 0;
    $('card-sub').textContent = `${info.sub}${len ? ` · ${fmtDist(len)} by road` : ''}`;
    card.hidden = false;
    placeCard();
  }
  const routeLen = (r) => {
    let L = 0;
    for (let i = 2; i < r.length; i += 2) L += Math.hypot(r[i] - r[i - 2], r[i + 1] - r[i - 1]);
    return L;
  };
  function placeCard() {
    if (card.hidden || !cardFor || W <= 640) return;
    const x = sx(cardFor.x), y = sy(cardFor.z);
    const cw = 290, ch = card.offsetHeight || 110;
    let l = x + 18, t = y - ch - 30;
    if (l + cw > W - 80) l = x - cw - 18;
    if (t < 90) t = y + 20;
    card.style.left = `${Math.max(16, Math.min(W - cw - 80, l))}px`;
    card.style.top = `${Math.max(90, Math.min(H - ch - 70, t))}px`;
  }
  function clickAt(x, y) {
    hideResults();
    setDest(wx(x), wz(y));
  }
  $('card-go').addEventListener('click', () => {
    const d = getDest();
    if (d) onTeleport(d.x, d.z, d.spot);
    close();
  });
  $('card-nav').addEventListener('click', () => close());
  $('card-x').addEventListener('click', () => {
    onClear();
    card.hidden = true;
    cardFor = null;
  });

  // --- search ---------------------------------------------------------------------------------------------------------
  let hits = [], sel = 0;
  const hideResults = () => {
    results.innerHTML = '';
    hits = [];
  };
  function renderResults() {
    results.innerHTML = '';
    hits.forEach((e, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === sel));
      const ic = document.createElement('span');
      ic.className = 'r-ic' + (e.kind === 'street' ? '' : ' place');
      ic.textContent = e.kind === 'street' ? 'St' : e.kind === 'place' ? '★' : '▣';
      const n = document.createElement('span');
      n.className = 'r-n';
      n.textContent = e.kind === 'street' ? shortName(e.n) : e.n;
      const sb = document.createElement('span');
      sb.className = 'r-s';
      sb.textContent = e.sub;
      li.append(ic, n, sb);
      li.addEventListener('pointerdown', (ev) => (ev.preventDefault(), choose(e)));
      results.append(li);
    });
  }
  function choose(e) {
    hideResults();
    q.value = e.kind === 'street' ? shortName(e.n) : e.n;
    q.blur();
    // close enough to read the streets around it, not so close the pin fills the screen
    flyTo(e.x, e.z, Math.max(s, e.kind === 'street' ? 0.45 : 0.6));
    setTimeout(() => setDest(e.x, e.z, e.spot ? { name: e.spot.n, sub: e.sub, spot: e.spot } : { name: e.kind === 'street' ? shortName(e.n) : e.n, sub: e.sub }), 0);
  }
  // An empty search box offers the landmarks, so teleporting never depends on knowing a name
  const landmarks = () => geo.entries.filter((e) => e.spot);
  q.addEventListener('focus', () => {
    if (q.value) return;
    hits = landmarks();
    sel = 0;
    renderResults();
  });
  q.addEventListener('input', () => {
    hits = q.value ? geo.search(q.value, 8) : landmarks();
    sel = 0;
    renderResults();
  });
  q.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') (sel = Math.min(hits.length - 1, sel + 1)), renderResults(), e.preventDefault();
    else if (e.key === 'ArrowUp') (sel = Math.max(0, sel - 1)), renderResults(), e.preventDefault();
    else if (e.key === 'Enter' && hits[sel]) choose(hits[sel]);
    else if (e.key === 'Escape') {
      if (q.value) (q.value = ''), hideResults();
      else q.blur();
      e.preventDefault();
    }
  });
  q.addEventListener('blur', () => setTimeout(hideResults, 120));

  // --- controls ---------------------------------------------------------------------------------------------------------
  $('atlas-in').addEventListener('click', () => zoomAt(1.6, W / 2, H / 2));
  $('atlas-out').addEventListener('click', () => zoomAt(1 / 1.6, W / 2, H / 2));
  $('atlas-locate').addEventListener('click', () => {
    const p = getPlayer();
    flyTo(p.x, p.z, Math.max(s, 0.9));
  });
  $('atlas-fit').addEventListener('click', fit);
  $('atlas-close').addEventListener('click', () => close());
  function fit() {
    // CBD + inner suburbs
    flyTo(-300, -150, Math.min(W / 4200, H / 3300));
  }

  function openAtlas() {
    if (open) return;
    open = true;
    root.hidden = false;
    if (document.pointerLockElement) document.exitPointerLock();
    resize();
    const p = getPlayer();
    cx = p.x;
    cz = p.z;
    s = Math.min(W / 2200, H / 1600, 0.6);
    s = Math.max(s, 0.22);
    dirty = true;
    status.textContent = DEFAULT_STATUS;
    const d = getDest();
    if (d) {
      cardFor = { x: d.x, z: d.z };
      $('card-name').textContent = d.name;
      $('card-sub').textContent = 'Your GPS destination';
      card.hidden = false;
    } else card.hidden = true;
    requestAnimationFrame(placeCard);
  }
  function close() {
    if (!open) return;
    open = false;
    root.hidden = true;
    hideResults();
    q.blur();
  }

  function update(dt, youText) {
    if (!open) return;
    if (anim) {
      anim.t = Math.min(1, anim.t + dt * 2.6);
      const e = 1 - Math.pow(1 - anim.t, 3);
      cx = anim.x0 + (anim.x - anim.x0) * e;
      cz = anim.z0 + (anim.z - anim.z0) * e;
      s = Math.exp(Math.log(anim.s0) + (Math.log(anim.s) - Math.log(anim.s0)) * e);
      dirty = true;
      placeCard();
      if (anim.t >= 1) anim = null;
    }
    if (dirty) renderBase();
    renderOver(dt);
    if (youText !== undefined && you.textContent !== youText) you.textContent = youText;
  }

  return {
    open: openAtlas,
    close,
    toggle: () => (open ? close() : openAtlas()),
    get isOpen() {
      return open;
    },
    update,
    zoomBy: (f) => zoomAt(f, W / 2, H / 2),
    searching: () => document.activeElement === q,
  };
}
