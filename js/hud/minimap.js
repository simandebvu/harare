// js/hud/minimap.js — heading-up radar. The street map is rendered ONCE to a big offscreen canvas; each frame we blit
// the window around the player rotated to the camera heading, then draw the GPS route, a few pins, a handful of live
// street names and the player arrow on top.
import { drawLayers, drawArrow, drawPin, haloText, iconColor } from './render.js';
import { shortName } from './geo.js';

const RES = 0.55; // px per metre in the pre-render
const X0 = -3600, Z0 = -2600, X1 = 3200, Z1 = 2000;
const RANK = { trunk: 6, primary: 5, secondary: 4, tertiary: 3, trunk_link: 2, primary_link: 2, secondary_link: 2, unclassified: 1, residential: 1, pedestrian: 1, service: 0 };

export function createMinimap(canvas, geo, layers) {
  const off = document.createElement('canvas');
  off.width = Math.round((X1 - X0) * RES);
  off.height = Math.round((Z1 - Z0) * RES);
  {
    const g = off.getContext('2d');
    g.fillStyle = '#15181c';
    g.fillRect(0, 0, off.width, off.height);
    g.setTransform(RES, 0, 0, RES, -X0 * RES, -Z0 * RES);
    drawLayers(g, layers, RES, { bldColor: '#262b33', bldTallColor: '#30363f' });
  }

  const g = canvas.getContext('2d');
  let size = 0, dpr = 1;
  const resize = () => {
    size = canvas.clientWidth;
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
  };
  addEventListener('resize', resize);
  resize();

  // Live street labels, re-picked a few times a second
  const picks = [];
  const pool = Array.from({ length: 8 }, () => ({ n: '', x: 0, z: 0, a: 0, rank: 0, d: 0 }));
  const best = new Map();
  let pickT = 0;
  function pick(px, pz, rad) {
    best.clear();
    geo.forSegs(px, pz, rad, (s) => {
      if (!s.r.n || s.len < 18) return;
      const mx = (s.ax + s.bx) / 2, mz = (s.az + s.bz) / 2;
      const d = Math.hypot(mx - px, mz - pz);
      if (d > rad * 0.85) return;
      const sc = d - (RANK[s.r.k] || 0) * 25 - Math.min(s.len, 120) * 0.4;
      const cur = best.get(s.r.n);
      if (!cur || sc < cur.sc) best.set(s.r.n, { s, sc, mx, mz });
    });
    const arr = [...best.values()].sort((a, b) => a.sc - b.sc).slice(0, pool.length);
    picks.length = 0;
    for (let i = 0; i < arr.length; i++) {
      const o = pool[i], s = arr[i].s;
      o.n = shortName(s.r.n);
      o.x = arr[i].mx;
      o.z = arr[i].mz;
      o.a = Math.atan2(s.bz - s.az, s.bx - s.ax);
      picks.push(o);
    }
  }

  const placed = new Float32Array(32);
  let radius = 260;
  let cx = 0, cy = 0, c = 1, sn = 0, k = 1, px = 0, pz = 0;
  const toX = (x, z) => cx + ((x - px) * c - (z - pz) * sn) * k;
  const toY = (x, z) => cy + ((x - px) * sn + (z - pz) * c) * k;

  // heading: screen-space angle of the camera's forward vector (atan2(dz, dx)); route: flat [x,z,...] or null
  function draw(dt, x, z, heading, targetRadius, route, dest) {
    if (!size) return;
    radius += (targetRadius - radius) * Math.min(1, dt * 2.5);
    const S = size;
    px = x;
    pz = z;
    cx = S / 2;
    cy = S * 0.56;
    k = (S * 0.5) / radius; // css px per metre
    const th = -Math.PI / 2 - heading; // rotate so forward points up
    c = Math.cos(th);
    sn = Math.sin(th);

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#15181c';
    g.fillRect(0, 0, S, S);

    g.save();
    g.translate(cx, cy);
    g.rotate(th);
    g.scale(k, k);
    g.translate(-px, -pz);
    const R = radius * 1.75;
    const sx = (px - R - X0) * RES, sy = (pz - R - Z0) * RES, sw = 2 * R * RES;
    g.imageSmoothingQuality = 'high';
    // clamp the source rect to the image so every browser samples it the same way
    const x0 = Math.max(0, sx), y0 = Math.max(0, sy), x1 = Math.min(off.width, sx + sw), y1 = Math.min(off.height, sy + sw);
    if (x1 > x0 && y1 > y0) g.drawImage(off, x0, y0, x1 - x0, y1 - y0, X0 + x0 / RES, Z0 + y0 / RES, (x1 - x0) / RES, (y1 - y0) / RES);
    g.restore();

    // Street names (upright, along the road)
    if ((pickT -= dt) <= 0) {
      pickT = 0.3;
      pick(px, pz, radius * 1.1);
    }
    g.font = `650 ${S < 160 ? 9 : 10}px Inter, system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let np = 0;
    for (const o of picks) {
      const x = toX(o.x, o.z), y = toY(o.x, o.z);
      if (x < 14 || x > S - 14 || y < 12 || y > S - 30) continue;
      if (Math.hypot(x - cx, y - cy) < 16) continue;
      let clash = false;
      for (let i = 0; i < np; i += 2) if (Math.abs(placed[i] - x) < 46 && Math.abs(placed[i + 1] - y) < 13) clash = true;
      if (clash) continue;
      placed[np++] = x;
      placed[np++] = y;
      let a = o.a + th;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      if (a > Math.PI / 2) a -= Math.PI;
      else if (a < -Math.PI / 2) a += Math.PI;
      g.save();
      g.translate(x, y);
      g.rotate(a);
      haloText(g, o.n, 0, 0, 'rgba(245,242,236,0.92)', 'rgba(10,12,15,0.92)', 3);
      g.restore();
    }

    if (route && route.length >= 4) {
      g.save();
      g.translate(cx, cy);
      g.rotate(th);
      g.scale(k, k);
      g.translate(-px, -pz);
      g.lineCap = g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(route[0], route[1]);
      for (let i = 2; i < route.length; i += 2) g.lineTo(route[i], route[i + 1]);
      g.strokeStyle = 'rgba(6,30,52,0.9)';
      g.lineWidth = 7.5 / k;
      g.stroke();
      g.strokeStyle = '#3fb8ff';
      g.lineWidth = 4.5 / k;
      g.stroke();
      g.restore();
    }

    // Landmark pins
    for (const s of geo.spots) {
      const x = toX(s.x, s.z), y = toY(s.x, s.z);
      if (x < 6 || x > S - 6 || y < 6 || y > S - 6) continue;
      drawPin(g, x, y, iconColor(s.icon), 3.2);
    }
    // Destination
    if (dest) {
      let x = toX(dest.x, dest.z), y = toY(dest.x, dest.z);
      const inside = x > 8 && x < S - 8 && y > 8 && y < S - 8;
      if (!inside) {
        // clamp to the rim as a direction hint
        const dx = x - cx, dy = y - cy, m = Math.max(Math.abs(dx) / (S / 2 - 10), Math.abs(dy) / (S / 2 - 10));
        x = cx + dx / m;
        y = cy + dy / m;
      }
      g.beginPath();
      g.arc(x, y, 6, 0, Math.PI * 2);
      g.fillStyle = '#0b0d10';
      g.fill();
      g.beginPath();
      g.arc(x, y, 4.2, 0, Math.PI * 2);
      g.fillStyle = '#ff5a4a';
      g.fill();
    }

    drawArrow(g, cx, cy, 0, S < 160 ? 6.5 : 7.5);

    // North marker on the rim
    const na = -Math.PI / 2 + th;
    const nr = S / 2 - 12;
    let nx = cx + Math.cos(na) * nr * 1.4, ny = cy + Math.sin(na) * nr * 1.4;
    nx = Math.max(12, Math.min(S - 12, nx));
    ny = Math.max(12, Math.min(S - 12, ny));
    g.beginPath();
    g.arc(nx, ny, 8.5, 0, Math.PI * 2);
    g.fillStyle = 'rgba(10,12,15,0.85)';
    g.fill();
    g.font = '800 10px Inter, system-ui, sans-serif';
    g.fillStyle = '#ff6b5c';
    g.fillText('N', nx, ny + 0.5);
  }

  return { draw, resize, canvas: off };
}
