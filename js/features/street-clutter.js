// js/features/street-clutter.js — the dense layer of CBD street clutter, called from furniture.js: black-and-white
// painted kerbs and bollards at the corners, yellow pillar hydrants, council bins and concrete planters, ZESA mini-pillars
// and green telecom cabinets, parking meters and parking-marshal posts, Zimbabwe road signs (blue/red no-parking and
// no-stopping roundels, one-way arrows, black-on-yellow kombi stops), wooden tuckshops, newspaper stands, ATM booths
// against the bank fronts, scaffolding on buildings under renovation and, out toward the Avenues, wooden poles carrying
// sagging power and phone lines. Everything instanced; every sign face comes from one canvas atlas in one merged mesh.
import { segDist, coreWeight, groundY, hash2 } from '../util.js';
import { ROBOT_POLES } from '../robots.js';

const PAVE = 0.14;
const U = 128; // atlas cell size (px)

// --- sign face atlas ----------------------------------------------------------------------------------------------------
function drawAtlas() {
  const c = document.createElement('canvas');
  c.width = U * 8;
  c.height = U * 6;
  const g = c.getContext('2d');
  const cells = {};
  const cell = (name, cx, cy, cw, ch, draw) => {
    g.save();
    g.translate(cx * U, cy * U);
    draw(cw * U, ch * U);
    g.restore();
    // inset half a pixel so neighbours don't bleed
    cells[name] = [(cx * U + 1) / c.width, 1 - ((cy + ch) * U - 1) / c.height, ((cx + cw) * U - 1) / c.width, 1 - (cy * U + 1) / c.height];
  };
  const font = (px, w = 'bold') => (g.font = `${w} ${px}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`);
  const text = (t, x, y, px, col, maxW) => {
    font(px);
    const w = g.measureText(t).width;
    if (maxW && w > maxW) font(Math.floor((px * maxW) / w));
    g.fillStyle = col;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(t, x, y);
  };
  const roundel = (W, inner, ring = '#c8102e') => {
    g.fillStyle = ring;
    g.beginPath();
    g.arc(W / 2, W / 2, W / 2 - 2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = inner;
    g.beginPath();
    g.arc(W / 2, W / 2, W / 2 - 15, 0, Math.PI * 2);
    g.fill();
  };
  const slash = (W, x0, y0, x1, y1) => {
    g.save();
    g.beginPath();
    g.arc(W / 2, W / 2, W / 2 - 15, 0, Math.PI * 2);
    g.clip();
    g.strokeStyle = '#c8102e';
    g.lineWidth = 14;
    g.beginPath();
    g.moveTo(x0 * W, y0 * W);
    g.lineTo(x1 * W, y1 * W);
    g.stroke();
    g.restore();
  };
  const board = (W, H, bg, border, lw = 6) => {
    g.fillStyle = border;
    g.fillRect(0, 0, W, H);
    g.fillStyle = bg;
    g.fillRect(lw, lw, W - lw * 2, H - lw * 2);
  };
  // roundels on transparent corners (alpha-tested)
  cell('noPark', 0, 0, 1, 1, (W) => (roundel(W, '#1f4fa0'), slash(W, 0.18, 0.18, 0.82, 0.82)));
  cell('noStop', 1, 0, 1, 1, (W) => (roundel(W, '#1f4fa0'), slash(W, 0.18, 0.18, 0.82, 0.82), slash(W, 0.82, 0.18, 0.18, 0.82)));
  cell('speed40', 2, 0, 1, 1, (W) => (roundel(W, '#ffffff'), text('40', W / 2, W / 2 + 3, 58, '#111')));
  cell('noEntry', 3, 0, 1, 1, (W) => {
    roundel(W, '#c8102e');
    g.fillStyle = '#ffffff';
    g.fillRect(W * 0.2, W * 0.42, W * 0.6, W * 0.16);
  });
  cell('parkP', 4, 0, 1, 1, (W) => (board(W, W, '#1f4fa0', '#ffffff', 7), text('P', W / 2, W / 2 + 4, 92, '#fff')));
  cell('danger', 5, 0, 1, 1, (W) => {
    g.fillStyle = '#111';
    g.beginPath();
    g.moveTo(W / 2, 6), g.lineTo(W - 4, W - 12), g.lineTo(4, W - 12), g.closePath();
    g.fill();
    g.fillStyle = '#f2c200';
    g.beginPath();
    g.moveTo(W / 2, 20), g.lineTo(W - 18, W - 19), g.lineTo(18, W - 19), g.closePath();
    g.fill();
    g.fillStyle = '#111';
    g.beginPath(); // lightning flash
    g.moveTo(W * 0.56, W * 0.34), g.lineTo(W * 0.42, W * 0.62), g.lineTo(W * 0.52, W * 0.62), g.lineTo(W * 0.44, W * 0.84), g.lineTo(W * 0.62, W * 0.55), g.lineTo(W * 0.52, W * 0.55), g.closePath();
    g.fill();
  });
  cell('pedX', 6, 0, 1, 1, (W) => {
    board(W, W, '#1f4fa0', '#ffffff', 7);
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(W / 2, 18), g.lineTo(W - 20, W - 24), g.lineTo(20, W - 24), g.closePath();
    g.fill();
    g.fillStyle = '#111';
    g.beginPath();
    g.arc(W / 2, 52, 7, 0, 7);
    g.fill();
    g.fillRect(W / 2 - 5, 60, 10, 22);
    g.fillRect(W / 2 - 14, 82, 8, 16), g.fillRect(W / 2 + 6, 82, 8, 16);
  });
  cell('hydrantH', 7, 0, 1, 1, (W) => (board(W, W, '#f2c200', '#111', 8), text('H', W / 2, W / 2 + 4, 84, '#111')));
  const arrow = (W, H, right) => {
    board(W, H, '#ffffff', '#111', 6);
    g.fillStyle = '#111';
    const y = H / 2, x0 = right ? 26 : W - 26, x1 = right ? W - 26 : 26, s = right ? 1 : -1;
    g.fillRect(Math.min(x0, x1 - s * 40), y - 11, Math.abs(x1 - s * 40 - x0), 22);
    g.beginPath();
    g.moveTo(x1, y), g.lineTo(x1 - s * 44, y - 34), g.lineTo(x1 - s * 44, y + 34), g.closePath();
    g.fill();
  };
  cell('oneWayL', 0, 1, 2, 1, (W, H) => arrow(W, H, false));
  cell('oneWayR', 2, 1, 2, 1, (W, H) => arrow(W, H, true));
  cell('kombiStop', 4, 1, 2, 1, (W, H) => (board(W, H, '#f2c200', '#111', 8), text('KOMBI STOP', W / 2, H / 2 + 3, 50, '#111', W - 30)));
  cell('zesa', 6, 1, 2, 1, (W, H) => (board(W, H, '#e9e6dc', '#c8102e', 8), text('ZESA', W / 2, H * 0.4, 52, '#c8102e'), text('DANGER · 11 000 V', W / 2, H * 0.78, 20, '#111')));
  const KIOSKS = [
    ['MAI CHIPO TUCKSHOP', '#f2c200', '#1d1d1d'],
    ['KWA BABA TINO · AIRTIME', '#1b8a3a', '#ffffff'],
    ['FRESH MAPUTI & FREEZITS', '#c8102e', '#ffffff'],
    ['PHONE REPAIRS · CHARGING', '#0a4ea2', '#ffffff'],
    ['MBARE FRUIT & VEG', '#e8e2cf', '#2d5a27'],
    ['CHIDO CUTS BARBER', '#1d1d1d', '#f2c200'],
  ];
  KIOSKS.forEach(([t, bg, fg], i) =>
    cell('kiosk' + i, (i % 4) * 2, 2 + Math.floor(i / 4), 2, 1, (W, H) => {
      board(W, H, bg, fg, 5);
      text(t, W / 2, H / 2 + 3, 44, fg, W - 24);
    })
  );
  const BANKS = [['SUNSHINE BANK', '#0a3d7a'], ['MSASA BUILDING SOCIETY', '#1b6e3a'], ['KOPJE TRUST', '#8a1c2b']];
  BANKS.forEach(([t, bg], i) =>
    cell('bank' + i, [4, 6, 0][i], [3, 3, 4][i], 2, 1, (W, H) => {
      board(W, H, bg, '#f4f2ea', 5);
      text(t, W / 2, H * 0.42, 40, '#ffffff', W - 24);
      text('ATM · 24 HRS', W / 2, H * 0.78, 22, '#f2c200');
    })
  );
  cell('telecom', 2, 4, 2, 1, (W, H) => (board(W, H, '#2f5e3e', '#e9e6dc', 5), text('TELECOM', W / 2, H * 0.42, 46, '#e9e6dc'), text('DO NOT OBSTRUCT', W / 2, H * 0.78, 20, '#e9e6dc')));
  cell('atm', 4, 4, 1, 1, (W) => {
    g.fillStyle = '#16314f';
    g.fillRect(0, 0, W, W);
    g.fillStyle = '#5fb4ff';
    g.fillRect(10, 14, W - 20, W * 0.5);
    text('WELCOME', W / 2, 44, 20, '#0b1d33');
    g.fillStyle = '#9aa3ab';
    for (let i = 0; i < 9; i++) g.fillRect(28 + (i % 3) * 26, 86 + Math.floor(i / 3) * 12, 20, 8);
  });
  const HEAD = ['FUEL QUEUES RETURN', 'DYNAMOS WIN DERBY', 'ZESA: NEW SCHEDULE'];
  HEAD.forEach((h, i) =>
    cell('paper' + i, 5 + i, 4, 1, 1, (W) => {
      g.fillStyle = '#f7f5ee';
      g.fillRect(0, 0, W, W);
      g.fillStyle = '#c8102e';
      g.fillRect(0, 0, W, 30);
      text('SUNSHINE TIMES', W / 2, 16, 18, '#fff', W - 8);
      const words = h.split(' ');
      words.forEach((w, k) => text(w, W / 2, 50 + k * 26, 26, '#111', W - 12));
    })
  );
  cell('marshal', 0, 5, 2, 1, (W, H) => {
    board(W, H, '#1f4fa0', '#ffffff', 6);
    text('P', 42, H / 2 + 3, 84, '#fff');
    text('PAY PARKING', W / 2 + 34, H * 0.36, 30, '#fff', W - 100);
    text('MARSHAL ON DUTY', W / 2 + 34, H * 0.7, 22, '#f2c200', W - 100);
  });
  cell('noParkTxt', 2, 5, 2, 1, (W, H) => (board(W, H, '#ffffff', '#c8102e', 7), text('NO PARKING', W / 2, H * 0.4, 40, '#c8102e'), text('TOWING ZONE', W / 2, H * 0.76, 24, '#111')));
  return { canvas: c, cells, kiosks: KIOSKS.length, banks: BANKS.length, papers: HEAD.length };
}

export function buildClutter(ctx, H) {
  const { THREE, DATA, scene, world, buildings } = ctx;
  const { parts, T, instanced, okPave, take, free, kerbGap, junctions, blocked, r } = H;

  // keep clear of the street lamps and robot poles
  for (const [x, z] of world.lightSpots || []) take(x, z, 0.45);
  for (const p of ROBOT_POLES) take(p.x, p.z, 0.5);

  const atlas = drawAtlas();
  const fPos = [], fNrm = [], fUv = [];
  // A textured quad facing yaw (normal (sin yaw, cos yaw)), centred at (x, y, z)
  const face = (x, y, z, yaw, w, h, name) => {
    const [u0, v0, u1, v1] = atlas.cells[name];
    const nx = Math.sin(yaw), nz = Math.cos(yaw), rx = nz, rz = -nx;
    const P = [
      [x - (rx * w) / 2, y - h / 2, z - (rz * w) / 2, u0, v0],
      [x + (rx * w) / 2, y - h / 2, z + (rz * w) / 2, u1, v0],
      [x + (rx * w) / 2, y + h / 2, z + (rz * w) / 2, u1, v1],
      [x - (rx * w) / 2, y + h / 2, z - (rz * w) / 2, u0, v1],
    ];
    for (const k of [0, 1, 2, 0, 2, 3]) fPos.push(P[k][0], P[k][1], P[k][2]), fNrm.push(nx, 0, nz), fUv.push(P[k][3], P[k][4]);
  };
  // local offset (lx along the item's right, lz along its facing) → world
  const at = (it, lx, lz) => [it.x + Math.cos(it.yaw) * lx + Math.sin(it.yaw) * lz, it.z - Math.sin(it.yaw) * lx + Math.cos(it.yaw) * lz];

  const L = {
    stripesB: [], stripesW: [], bollards: [], hydrants: [], bins: [], drums: [], planters: [], zesa: [], telecom: [], meters: [],
    signRound: [], signRect: [], kombiPoles: [], kiosks: [], kioskFix: [], papers: [], atms: [], atmFix: [],
  };
  const yAt = (x, z) => groundY(x, z) + PAVE;
  const nearJn = (x, z, d) => junctions.some((j) => Math.abs(j.x - x) < d + 20 && Math.abs(j.z - z) < d + 20 && Math.hypot(j.x - x, j.z - z) < d + j.rad);

  for (const j of junctions) j.rad = Math.max(...j.arms.map((a) => a.w)) / 2;
  // --- corners: painted kerbs, bollards, hydrants, one-way and no-parking signs ------------------------------------------
  for (const j of junctions) {
    const cw = coreWeight(j.x, j.z);
    if (cw < 0.12) continue;
    for (let k = 0; k < j.arms.length; k++) {
      const a = j.arms[k], b = j.arms[(k + 1) % j.arms.length];
      if (a.w < 6.5) continue;
      // side of arm a facing b
      const cross = a.dx * b.dz - a.dz * b.dx, sd = cross > 0 ? -1 : 1;
      const nx = a.dz * sd, nz = -a.dx * sd; // lateral, toward b's side ((dz, -dx) is the right of a heading outward)
      const s0 = j.rad + 0.6;
      // black-and-white kerb paint for the first ~9 m
      let col = 0;
      for (let s = s0; s < s0 + 9; s += 0.6, col ^= 1) {
        const x = j.x + a.dx * s + nx * (a.w / 2 + 0.16), z = j.z + a.dz * s + nz * (a.w / 2 + 0.16);
        const g = kerbGap(x, z);
        if (g < -0.05 || g > 0.4) continue;
        (col ? L.stripesW : L.stripesB).push({ x, y: groundY(x, z) + 0.3, z, yaw: Math.atan2(a.dx, a.dz) });
      }
      if (cw < 0.2) continue;
      // bollards round the corner, just back from the kerb
      for (const s of [s0 + 0.3, s0 + 1.7, s0 + 3.1]) {
        const x = j.x + a.dx * s + nx * (a.w / 2 + 0.45), z = j.z + a.dz * s + nz * (a.w / 2 + 0.45);
        if (okPave(x, z, 0.15, 0.25, 0.8)) take(x, z, 0.22), L.bollards.push({ x, y: yAt(x, z), z });
      }
      const t = r();
      const sx = j.x + a.dx * (s0 + 5.5) + nx * (a.w / 2 + 0.5), sz = j.z + a.dz * (s0 + 5.5) + nz * (a.w / 2 + 0.5);
      if (t < 0.3) {
        if (okPave(sx, sz, 0.3, 0.25, 1.0)) take(sx, sz, 0.4), L.hydrants.push({ x: sx, y: yAt(sx, sz), z: sz, yaw: r() * 6.28 });
      } else if (t < 0.75) {
        // a sign facing traffic coming out of the junction along a... or, for one-way streets, the cross traffic
        if (!okPave(sx, sz, 0.3, 0.25, 1.0)) continue;
        take(sx, sz, 0.45);
        const y = yAt(sx, sz);
        if (a.e.o) {
          // face the junction so the cross traffic reads which way the street runs
          const yaw = Math.atan2(-a.dx, -a.dz) + sd * 0.5;
          const fx = Math.sin(yaw), fz = Math.cos(yaw), rgx = fz, rgz = -fx;
          const atA = a.e.a === j.n, out = (a.e.o === 1) === atA; // traffic runs away from the junction on this arm
          const tx = out ? a.dx : -a.dx, tz = out ? a.dz : -a.dz;
          L.signRect.push({ x: sx, y, z: sz, yaw });
          face(sx + fx * 0.075, y + 2.45, sz + fz * 0.03, yaw, 0.9, 0.45, tx * rgx + tz * rgz > 0 ? 'oneWayR' : 'oneWayL');
        } else {
          // faces the drivers on this side of the arm
          const fy = sd > 0 ? Math.atan2(-a.dx, -a.dz) : Math.atan2(a.dx, a.dz);
          L.signRound.push({ x: sx, y, z: sz, yaw: fy });
          face(sx + Math.sin(fy) * 0.075, y + 2.35, sz + Math.cos(fy) * 0.075, fy, 0.62, 0.62, r() < 0.6 ? 'noPark' : 'noStop');
        }
      }
    }
  }

  // --- along the pavements --------------------------------------------------------------------------------------------
  const RANKS = { trunk: 6, primary: 5, secondary: 4, tertiary: 3, trunk_link: 3, primary_link: 3, secondary_link: 3, residential: 2, unclassified: 2 };
  for (const rd of DATA.roads) {
    const rank = RANKS[rd.k] || 0;
    if (rank < 2) continue;
    for (const sd of [1, -1]) {
      let acc = 2 + r() * 6, accK = 30 + r() * 80;
      for (let i = 2; i < rd.p.length; i += 2) {
        const ax = rd.p[i - 2], az = rd.p[i - 1], bx = rd.p[i], bz = rd.p[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.1) continue;
        const dx = (bx - ax) / len, dz = (bz - az) / len;
        const ox = dz * sd, oz = -dx * sd; // outward, toward the buildings
        const faceRoad = Math.atan2(-ox, -oz);
        for (; acc < len; acc += 4.5 + r() * 4.5) {
          const px = ax + dx * acc, pz = az + dz * acc;
          const cw = coreWeight(px, pz);
          if (cw < 0.15 || r() > 0.3 + cw * 0.65 || nearJn(px, pz, 7)) continue;
          const back = r() < 0.32;
          const off = rd.w / 2 + (back ? 2.0 : 0.55);
          const x = px + ox * off, z = pz + oz * off;
          const y = yAt(x, z);
          const t = r();
          if (!back) {
            if (t < 0.2) {
              if (!okPave(x, z, 0.35, 0.3, 1.2)) continue;
              take(x, z, 0.45);
              (r() < 0.5 ? L.drums : L.bins).push({ x, y, z, yaw: faceRoad, s: 1.15, c: ['#2f6b3a', '#d0701c', '#4a4d50', '#b8b2a6'][Math.floor(r() * 4)] });
            } else if (t < 0.38 && cw > 0.35 && rank <= 4) {
              // a run of parking meters (or one marshal post) along a parking bay
              if (r() < 0.35) {
                if (!okPave(x, z, 0.3, 0.3, 1.2)) continue;
                take(x, z, 0.45);
                L.signRect.push({ x, y, z, yaw: faceRoad + Math.PI / 2 });
                face(x + Math.sin(faceRoad + Math.PI / 2) * 0.075, y + 2.45, z + Math.cos(faceRoad + Math.PI / 2) * 0.075, faceRoad + Math.PI / 2, 0.9, 0.45, 'marshal');
                continue;
              }
              for (let m = 0; m < 3; m++) {
                const mx = x + dx * m * 2.6, mz = z + dz * m * 2.6;
                if (!okPave(mx, mz, 0.25, 0.3, 1.2)) break;
                take(mx, mz, 0.3);
                L.meters.push({ x: mx, y: yAt(mx, mz), z: mz, yaw: faceRoad });
              }
              acc += 6;
            } else if (t < 0.5) {
              if (!okPave(x, z, 0.8, 0.2, 1.4)) continue;
              take(x, z, 0.9);
              L.planters.push({ x, y, z, yaw: r() * 6.28, c: r() < 0.5 ? '#ffffff' : '#d8cfc0' });
            } else if (t < 0.62) {
              if (!okPave(x, z, 0.3, 0.3, 1.2)) continue;
              take(x, z, 0.4);
              const yaw = sd > 0 ? Math.atan2(-dx, -dz) : Math.atan2(dx, dz); // faces the traffic on this side
              const fy = yaw;
              const name = ['noPark', 'noStop', 'speed40', 'noParkTxt', 'pedX'][Math.floor(r() * 5)];
              if (name === 'noParkTxt') L.signRect.push({ x, y, z, yaw: fy }), face(x + Math.sin(fy) * 0.075, y + 2.45, z + Math.cos(fy) * 0.075, fy, 0.9, 0.45, name);
              else L.signRound.push({ x, y, z, yaw: fy }), face(x + Math.sin(fy) * 0.075, y + 2.35, z + Math.cos(fy) * 0.075, fy, 0.62, 0.62, name);
            } else if (t < 0.74) {
              for (const s of [-0.7, 0.7]) {
                const bx2 = x + dx * s, bz2 = z + dz * s;
                if (okPave(bx2, bz2, 0.15, 0.25, 1.2)) take(bx2, bz2, 0.22), L.bollards.push({ x: bx2, y: yAt(bx2, bz2), z: bz2 });
              }
            } else if (t < 0.84) {
              if (!okPave(x, z, 0.55, 0.3, 1.6)) continue;
              take(x, z, 0.65);
              const zesa = r() < 0.55;
              (zesa ? L.zesa : L.telecom).push({ x, y, z, yaw: faceRoad });
              const it = { x, z, yaw: faceRoad };
              for (const side of [1, -1]) {
                const d = zesa ? 0.28 : 0.215;
                const [fx, fz] = at(it, 0, d * side + 0.004 * side);
                const yaw = side > 0 ? faceRoad : faceRoad + Math.PI;
                if (zesa) face(fx, y + 0.98, fz, yaw, 0.3, 0.3, 'danger'), face(fx, y + 0.6, fz, yaw, 0.6, 0.3, 'zesa');
                else face(fx, y + 1.0, fz, yaw, 0.6, 0.3, 'telecom');
              }
            } else if (t < 0.9) {
              if (!okPave(x, z, 0.3, 0.25, 1.2)) continue;
              take(x, z, 0.4);
              L.hydrants.push({ x, y, z, yaw: r() * 6.28 });
            }
          } else {
            // back of the pavement, against the building line
            const wall = blocked(x + ox * 1.6, z + oz * 1.6) || blocked(x + ox * 2.4, z + oz * 2.4);
            if (t < 0.4 && cw > 0.3) {
              // wooden tuckshop
              if (!okPave(x, z, 1.25, 1.0, 3.4) || !okPave(x + dx * 1.1, z + dz * 1.1, 0.6, 1.0, 3.4) || !okPave(x - dx * 1.1, z - dz * 1.1, 0.6, 1.0, 3.4)) continue;
              take(x, z, 1.6);
              const it = { x, y, z, yaw: faceRoad, c: ['#8a6a48', '#3d6fa8', '#3f7a4a', '#d9b23a', '#a83a2e', '#7a5a3a'][Math.floor(r() * 6)] };
              L.kiosks.push(it), L.kioskFix.push({ ...it, c: undefined });
              const [fx, fz] = at(it, 0, 0.79);
              face(fx, y + 2.08, fz, faceRoad, 2.1, 0.45, 'kiosk' + Math.floor(r() * atlas.kiosks));
            } else if (t < 0.6 && cw > 0.3) {
              if (!okPave(x, z, 0.7, 1.0, 3.4)) continue;
              take(x, z, 0.9);
              const it = { x, y, z, yaw: faceRoad };
              L.papers.push(it);
              const [fx, fz] = at(it, 0.75, 0.08);
              face(fx, y + 0.62, fz, faceRoad, 0.52, 0.52, 'paper' + Math.floor(r() * atlas.papers));
              const [gx, gz] = at(it, -0.1, 0.27);
              face(gx, y + 0.92, gz, faceRoad, 0.36, 0.36, 'paper' + Math.floor(r() * atlas.papers));
            } else if (t < 0.78 && cw > 0.45 && wall) {
              // ATM booth outside a bank
              if (!okPave(x, z, 0.8, 1.0, 3.4)) continue;
              take(x, z, 1.0);
              const b = Math.floor(r() * atlas.banks);
              const it = { x, y, z, yaw: faceRoad, c: ['#0a3d7a', '#1b6e3a', '#8a1c2b'][b] };
              L.atms.push(it), L.atmFix.push({ ...it, c: undefined });
              const [fx, fz] = at(it, 0, 0.6);
              face(fx, y + 2.22, fz, faceRoad, 1.2, 0.42, 'bank' + b);
              const [sx, sz] = at(it, 0, 0.575);
              face(sx, y + 1.38, sz, faceRoad, 0.42, 0.42, 'atm');
            } else if (t < 0.9) {
              if (!okPave(x, z, 0.35, 1.0, 3.4)) continue;
              take(x, z, 0.45);
              (r() < 0.5 ? L.drums : L.bins).push({ x, y, z, yaw: faceRoad, s: 1.15, c: ['#2f6b3a', '#d0701c', '#4a4d50'][Math.floor(r() * 3)] });
            }
          }
        }
        acc -= len;
        // kombi stops on the bigger roads
        if (rank >= 3) {
          for (; accK < len; accK += 90 + r() * 60) {
            const px = ax + dx * accK, pz = az + dz * accK;
            if (coreWeight(px, pz) < 0.12 || nearJn(px, pz, 10)) continue;
            const x = px + ox * (rd.w / 2 + 0.5), z = pz + oz * (rd.w / 2 + 0.5);
            if (!okPave(x, z, 0.3, 0.25, 1.2)) continue;
            take(x, z, 0.5);
            const yaw = sd > 0 ? Math.atan2(-dx, -dz) : Math.atan2(dx, dz);
            const y = yAt(x, z);
            L.kombiPoles.push({ x, y, z, yaw });
            face(x + Math.sin(yaw) * 0.026, y + 2.7, z + Math.cos(yaw) * 0.026, yaw, 1.0, 0.5, 'kombiStop');
            face(x - Math.sin(yaw) * 0.026, y + 2.7, z - Math.cos(yaw) * 0.026, yaw + Math.PI, 1.0, 0.5, 'kombiStop');
          }
          accK -= len;
        }
      }
    }
  }

  // --- geometry -----------------------------------------------------------------------------------------------------------
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const C = (rt, rb, h, n = 10) => new THREE.CylinderGeometry(rt, rb, h, n);
  instanced(scene, parts([[B(0.2, 0.08, 0.56), '#141414', T(0, 0, 0)]]), L.stripesB, { rough: 0.8 });
  instanced(scene, parts([[B(0.2, 0.08, 0.56), '#efefe8', T(0, 0, 0)]]), L.stripesW, { rough: 0.8 });
  // concrete corner bollard, painted in black and white bands
  instanced(scene, parts([
    [new THREE.CylinderGeometry(0.13, 0.15, 0.3, 7, 1, true), '#efefe8', T(0, 0.15, 0)],
    [new THREE.CylinderGeometry(0.13, 0.13, 0.25, 7, 1, true), '#161616', T(0, 0.425, 0)],
    [new THREE.CylinderGeometry(0.12, 0.13, 0.3, 7, 1, true), '#efefe8', T(0, 0.7, 0)],
    [new THREE.ConeGeometry(0.12, 0.1, 7), '#161616', T(0, 0.9, 0)],
  ]), L.bollards, { rough: 0.7 });
  // yellow pillar hydrant
  instanced(scene, parts([
    [C(0.16, 0.18, 0.12, 8), '#d4a800', T(0, 0.06, 0)],
    [C(0.12, 0.13, 0.62, 8), '#f2c200', T(0, 0.43, 0)],
    [new THREE.SphereGeometry(0.13, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2), '#f2c200', T(0, 0.74, 0)],
    [C(0.03, 0.03, 0.06, 5), '#c8102e', T(0, 0.88, 0)],
    [C(0.055, 0.055, 0.42, 6).rotateZ(Math.PI / 2), '#e0b000', T(0, 0.5, 0)],
    [C(0.065, 0.065, 0.12, 6).rotateX(Math.PI / 2), '#c8102e', T(0, 0.48, 0.15)],
  ]), L.hydrants, { rough: 0.5, metal: 0.3 });
  // council bin: bigger post-mounted bucket; and a concrete drum bin with a dark mouth
  instanced(scene, parts([
    [C(0.045, 0.045, 1.15, 6), '#4a4d50', T(0, 0.57, -0.3)],
    [C(0.27, 0.23, 0.72, 12, 1), '#ffffff', T(0, 0.72, 0)],
    [C(0.23, 0.23, 0.04, 12), '#222222', T(0, 1.06, 0)],
    [B(0.36, 0.08, 0.02), '#f2f0e6', T(0, 0.85, 0.255)],
  ]), L.bins, { rough: 0.6, metal: 0.3 });
  instanced(scene, parts([
    [C(0.36, 0.32, 0.9, 14), '#ffffff', T(0, 0.45, 0)],
    [C(0.3, 0.3, 0.02, 14), '#1d1b19', T(0, 0.905, 0)],
    [C(0.37, 0.37, 0.08, 14), '#e8e4d8', T(0, 0.75, 0)],
  ]), L.drums, { rough: 0.85 });
  // big round concrete planter with a shrub
  instanced(scene, parts([
    [new THREE.CylinderGeometry(0.78, 0.6, 0.7, 12, 1, true), '#c4bcae', T(0, 0.35, 0)],
    [new THREE.CircleGeometry(0.76, 12).rotateX(-Math.PI / 2), '#4a3426', T(0, 0.66, 0)],
    [new THREE.IcosahedronGeometry(0.58, 0), '#4f7a35', T(0, 1.05, 0)],
    [new THREE.IcosahedronGeometry(0.38, 0), '#6b9142', T(0.32, 1.28, 0.12)],
    [new THREE.IcosahedronGeometry(0.34, 0), '#3f6a2c', T(-0.3, 1.05, -0.22)],
    [new THREE.IcosahedronGeometry(0.12, 0), '#d0507a', T(-0.2, 1.36, -0.1)],
    [new THREE.IcosahedronGeometry(0.1, 0), '#e0a020', T(0.12, 1.55, 0.2)],
  ]), L.planters, { rough: 0.9 });
  // ZESA mini-pillar and telecom cabinet
  instanced(scene, parts([
    [B(1.05, 0.14, 0.65), '#9a948a', T(0, 0.07, 0)],
    [B(0.95, 1.2, 0.55), '#7d8a80', T(0, 0.74, 0)],
    [B(1.0, 0.05, 0.6), '#6a766d', T(0, 1.36, 0)],
    [B(0.02, 1.0, 0.02), '#4a544d', T(0, 0.74, 0.28)],
  ]), L.zesa, { shadow: true, rough: 0.6, metal: 0.3 });
  instanced(scene, parts([
    [B(0.9, 0.12, 0.5), '#9a948a', T(0, 0.06, 0)],
    [B(0.8, 1.35, 0.42), '#2f5e3e', T(0, 0.8, 0)],
    [B(0.84, 0.04, 0.46), '#244a31', T(0, 1.49, 0)],
  ]), L.telecom, { shadow: true, rough: 0.55, metal: 0.3 });
  // twin-head parking meter
  instanced(scene, parts([
    [new THREE.CylinderGeometry(0.04, 0.045, 1.15, 5, 1, true), '#4a4d50', T(0, 0.575, 0)],
    [B(0.42, 0.06, 0.12), '#4a4d50', T(0, 1.16, 0)],
    ...[-0.15, 0.15].flatMap((x) => [
      [B(0.2, 0.3, 0.15), '#8b9096', T(x, 1.34, 0)],
      [C(0.06, 0.1, 0.1, 6), '#8b9096', T(x, 1.54, 0)],
      [B(0.12, 0.08, 0.01), '#c9d4a0', T(x, 1.4, 0.08)],
      [B(0.12, 0.08, 0.01), '#c9d4a0', T(x, 1.4, -0.08)],
    ]),
  ]), L.meters, { rough: 0.45, metal: 0.5 });
  // sign posts: round back plate, rectangular back plate, and the taller kombi-stop pole with a banded foot
  instanced(scene, parts([
    [C(0.035, 0.035, 2.66, 6), '#8a8d90', T(0, 1.33, 0)],
    [C(0.32, 0.32, 0.02, 18).rotateX(Math.PI / 2), '#9a9da0', T(0, 2.35, 0.055)],
    [B(0.06, 0.3, 0.04), '#8a8d90', T(0, 2.35, 0.03)],
  ]), L.signRound, { rough: 0.5, metal: 0.5 });
  instanced(scene, parts([
    [C(0.035, 0.035, 2.7, 6), '#8a8d90', T(0, 1.35, 0)],
    [B(0.92, 0.47, 0.02), '#9a9da0', T(0, 2.45, 0.055)],
    [B(0.06, 0.3, 0.04), '#8a8d90', T(0, 2.45, 0.03)],
  ]), L.signRect, { rough: 0.5, metal: 0.5 });
  instanced(scene, parts([
    [C(0.045, 0.045, 2.45, 6), '#8a8d90', T(0, 1.225, 0)],
    ...[0, 1, 2, 3].map((i) => [C(0.05, 0.05, 0.25, 6), i % 2 ? '#111111' : '#f2c200', T(0, 0.125 + i * 0.25, 0)]),
    [B(1.02, 0.52, 0.045), '#202020', T(0, 2.7, 0)],
  ]), L.kombiPoles, { rough: 0.5, metal: 0.4 });
  // tuckshop: painted plank body (instance colour) open at the front over a counter; corrugated roof and goods fixed
  instanced(scene, parts([
    [B(2.2, 2.2, 0.08), '#ffffff', T(0, 1.1, -0.7)],
    [B(0.08, 2.2, 1.48), '#ffffff', T(-1.06, 1.1, 0)],
    [B(0.08, 2.2, 1.48), '#ffffff', T(1.06, 1.1, 0)],
    [B(2.2, 1.0, 0.08), '#ffffff', T(0, 0.5, 0.7)],
    [B(2.2, 0.5, 0.08), '#ffffff', T(0, 1.98, 0.7)],
  ]), L.kiosks, { shadow: true, rough: 0.9 });
  instanced(scene, parts([
    [B(2.6, 0.05, 2.0), '#9aa0a3', T(0, 2.3, 0.05, 0.07)],
    [B(2.34, 0.06, 0.42), '#6b4a2e', T(0, 1.03, 0.82)],
    [B(2.0, 1.0, 0.04), '#2a2420', T(0, 1.4, -0.64)],
    [B(1.9, 0.04, 0.3), '#5a3e26', T(0, 1.25, -0.5)],
    [B(1.9, 0.04, 0.3), '#5a3e26', T(0, 1.65, -0.5)],
    ...[[-0.7, '#c8102e'], [-0.35, '#f2c200'], [0, '#2b6cb0'], [0.35, '#1b8a3a'], [0.7, '#ef8a2a']].map(([x, c]) => [B(0.22, 0.26, 0.18), c, T(x, 1.4, -0.5)]),
    ...[[-0.6, '#e8e2d2'], [0.1, '#d63a2a'], [0.55, '#2f8a4b']].map(([x, c]) => [B(0.3, 0.14, 0.22), c, T(x, 1.13, 0.8)]),
  ]), L.kioskFix, { rough: 0.85 });
  // newspaper vendor: a slanted wooden rack of papers, a poster board leaning on a crate
  instanced(scene, parts([
    [B(1.1, 0.05, 0.55), '#7a5a3a', T(0, 0.8, 0, 0.35)],
    ...[[-0.5, -0.2], [0.5, -0.2], [-0.5, 0.2], [0.5, 0.2]].map(([x, z]) => [B(0.05, 0.8, 0.05), '#5a3e26', T(x, 0.4, z)]),
    ...[-0.38, -0.13, 0.12, 0.37].map((x, i) => [B(0.22, 0.012, 0.3), ['#f7f5ee', '#f2e6c8', '#e9eef5', '#f7f5ee'][i], T(x, 0.835, 0.0, 0.35)]),
    [B(0.4, 0.4, 0.4), '#8a6a48', T(0.75, 0.2, 0)],
    [B(0.55, 0.6, 0.03), '#3a2a1c', T(0.75, 0.62, 0.06, -0.15)],
  ]), L.papers, { rough: 0.85 });
  // ATM booth: bank-coloured shell (instance colour), dark fascia round the machine
  instanced(scene, parts([
    [B(1.3, 2.5, 1.1), '#ffffff', T(0, 1.25, 0)],
    [B(1.5, 0.12, 1.35), '#ffffff', T(0, 2.56, 0.1)],
  ]), L.atms, { shadow: true, rough: 0.4, metal: 0.2 });
  instanced(scene, parts([
    [B(1.0, 1.6, 0.04), '#1f2226', T(0, 1.3, 0.56)],
    [B(0.5, 0.06, 0.2), '#3a3f45', T(0, 1.05, 0.64)],
    [B(1.24, 0.46, 0.02), '#f4f2ea', T(0, 2.22, 0.555)],
  ]), L.atmFix, { rough: 0.4, metal: 0.3 });

  // --- scaffolding on a few buildings under renovation --------------------------------------------------------------------
  const tubes = [], boards = [], nets = [];
  {
    const up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), q = new THREE.Quaternion(), m = new THREE.Matrix4(), one = new THREE.Vector3();
    const tube = (x0, y0, z0, x1, y1, z1) => {
      v.set(x1 - x0, y1 - y0, z1 - z0);
      const l = v.length();
      q.setFromUnitVectors(up, v.divideScalar(l));
      tubes.push(m.compose(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), q, one.set(1, l, 1)).clone());
    };
    const cands = [];
    DATA.buildings.forEach((b, i) => {
      const p = b.p;
      if (p.length < 8 || b.h < 9) return;
      const cw = coreWeight(p[0], p[1]);
      if (cw < 0.4 || hash2(i * 0.37, 11.1) > 0.035) return;
      cands.push(b);
    });
    let n = 0;
    for (const b of cands) {
      if (n >= 18) break;
      const p = b.p, k = p.length / 2;
      // clockwise or anticlockwise? pick the edge whose outward side faces a road close by
      let area = 0;
      for (let i = 0; i < k; i++) area += p[i * 2] * p[((i + 1) % k) * 2 + 1] - p[((i + 1) % k) * 2] * p[i * 2 + 1];
      let best = null;
      for (let i = 0; i < k; i++) {
        const ax = p[i * 2], az = p[i * 2 + 1], bx = p[((i + 1) % k) * 2], bz = p[((i + 1) % k) * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 8) continue;
        let nx = (bz - az) / len, nz = -(bx - ax) / len;
        if (area < 0) (nx = -nx), (nz = -nz);
        // make sure (nx, nz) points out of the footprint
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        if (blocked(mx + nx * 0.6, mz + nz * 0.6)) (nx = -nx), (nz = -nz);
        if (blocked(mx + nx * 0.6, mz + nz * 0.6)) continue;
        const g = kerbGap(mx + nx * 1.4, mz + nz * 1.4);
        if (g < 0.8 || g > 4) continue;
        if (!best || len > best.len) best = { ax, az, bx, bz, len, nx, nz };
      }
      if (!best) continue;
      const { ax, az, nx, nz } = best;
      const len = Math.min(best.len, 26);
      const dx = (best.bx - ax) / best.len, dz = (best.bz - az) / best.len;
      const s0 = (best.len - len) / 2;
      // how tall is it really (buildings.js may have its own idea)?
      const mx = ax + dx * (s0 + len / 2) - nx * 0.6, mz = az + dz * (s0 + len / 2) - nz * 0.6;
      let top = 0;
      while (top < 60 && blocked(mx, mz, top + 1)) top += 1;
      top = Math.min(top || b.h, 24);
      if (top < 6) continue;
      n++;
      const lifts = Math.floor(top / 2);
      const bays = Math.max(2, Math.round(len / 2.4)), bay = len / bays;
      const y0 = groundY(ax, az) + PAVE;
      for (let i = 0; i <= bays; i++) {
        for (const o of [0.3, 1.3]) {
          const x = ax + dx * (s0 + i * bay) + nx * o, z = az + dz * (s0 + i * bay) + nz * o;
          tube(x, y0, z, x, y0 + lifts * 2 + 1, z);
        }
      }
      for (let l = 1; l <= lifts; l++) {
        const y = y0 + l * 2;
        for (const o of [0.3, 1.3]) {
          const x0 = ax + dx * s0 + nx * o, z0 = az + dz * s0 + nz * o;
          tube(x0, y, z0, x0 + dx * len, y, z0 + dz * len);
          tube(x0, y + 1, z0, x0 + dx * len, y + 1, z0 + dz * len); // guard rail
        }
        // planks: a deck of boards on every lift
        boards.push({ x: ax + dx * (s0 + len / 2) + nx * 0.8, y: y + 0.05, z: az + dz * (s0 + len / 2) + nz * 0.8, yaw: Math.atan2(dx, dz), sx: 1, sz: len });
      }
      // diagonal braces across the outer face, zig-zagging up
      for (let i = 0; i < bays; i += 2) {
        for (let l = 0; l < lifts; l++) {
          const xa = ax + dx * (s0 + i * bay) + nx * 1.3, za = az + dz * (s0 + i * bay) + nz * 1.3;
          const xb = xa + dx * bay, zb = za + dz * bay;
          if (l % 2) tube(xa, y0 + l * 2, za, xb, y0 + l * 2 + 2, zb);
          else tube(xb, y0 + l * 2, zb, xa, y0 + l * 2 + 2, za);
        }
      }
      // green shade net over the upper part of the face
      const netFrom = Math.floor(lifts * (0.2 + hash2(ax, az) * 0.4));
      const nh = (lifts - netFrom) * 2 + 1;
      nets.push({ x: ax + dx * (s0 + len / 2) + nx * 1.36, y: y0 + netFrom * 2 + nh / 2, z: az + dz * (s0 + len / 2) + nz * 1.36, yaw: Math.atan2(nx, nz), sx: len, sy: nh });
    }
    if (tubes.length) {
      const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 5), new THREE.MeshStandardMaterial({ color: '#8f9396', roughness: 0.45, metalness: 0.6 }), tubes.length);
      tubes.forEach((mm, i) => mesh.setMatrixAt(i, mm));
      mesh.castShadow = true;
      mesh.computeBoundingSphere();
      mesh.userData.fur = 1;
      scene.add(mesh);
    }
    const scaled = (geo, mat, list, shadow) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      const e = new THREE.Euler();
      list.forEach((it, i) => mesh.setMatrixAt(i, m.compose(new THREE.Vector3(it.x, it.y, it.z), q.setFromEuler(e.set(0, it.yaw, 0)), one.set(it.sx || 1, it.sy || 1, it.sz || 1))));
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      mesh.userData.fur = 1;
      scene.add(mesh);
    };
    scaled(new THREE.BoxGeometry(1.0, 0.05, 1), new THREE.MeshStandardMaterial({ color: '#8a6a48', roughness: 0.9 }), boards, true);
    scaled(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: '#2f6b4a', roughness: 0.95, transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: false }), nets, false);
  }

  // --- wooden poles and overhead lines toward the Avenues and the edges ---------------------------------------------------
  const wPoles = [], wire = [];
  for (const rd of DATA.roads) {
    if (!['residential', 'tertiary', 'unclassified', 'secondary'].includes(rd.k)) continue;
    const cw0 = coreWeight(rd.p[0], rd.p[1]);
    if (cw0 > 0.7 || Math.hypot(rd.p[0], rd.p[1]) > 2200) continue;
    const sd = hash2(rd.p[0], rd.p[1]) < 0.5 ? 1 : -1;
    let acc = 4 + r() * 10, prev = null;
    for (let i = 2; i < rd.p.length; i += 2) {
      const ax = rd.p[i - 2], az = rd.p[i - 1], bx = rd.p[i], bz = rd.p[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.1) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len, ox = dz * sd, oz = -dx * sd;
      for (; acc < len; acc += 34) {
        const px = ax + dx * acc, pz = az + dz * acc, cw = coreWeight(px, pz);
        if (cw > 0.7 || cw < 0.0 || Math.hypot(px, pz) > 2200) {
          prev = null;
          continue;
        }
        const x = px + ox * (rd.w / 2 + 0.45), z = pz + oz * (rd.w / 2 + 0.45);
        if (!okPave(x, z, 0.25, 0.2, 1.2)) {
          prev = null;
          continue;
        }
        take(x, z, 0.35);
        const y = groundY(x, z) + PAVE, yaw = Math.atan2(dx, dz);
        const pole = { x, y, z, yaw, s: 0.95 + r() * 0.12 };
        wPoles.push(pole);
        // crossarm across the road direction: three power conductors at the top, a phone wire lower down
        const pts = [-0.65, 0, 0.65].map((o) => [x + ox * o, y + 8.2 * pole.s + 0.12, z + oz * o]).concat([[x, y + 6.2 * pole.s, z]]);
        if (prev) {
          for (let w = 0; w < 4; w++) {
            const [x0, y0, z0] = prev[w], [x1, y1, z1] = pts[w];
            const span = Math.hypot(x1 - x0, z1 - z0);
            if (span > 60) continue;
            const sag = span * (w === 3 ? 0.03 : 0.018);
            for (let k = 0; k < 6; k++) {
              const t0 = k / 6, t1 = (k + 1) / 6;
              wire.push(x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0 - sag * 4 * t0 * (1 - t0), z0 + (z1 - z0) * t0);
              wire.push(x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1 - sag * 4 * t1 * (1 - t1), z0 + (z1 - z0) * t1);
            }
          }
        }
        prev = pts;
      }
      acc -= len;
    }
  }
  instanced(scene, parts([
    [new THREE.CylinderGeometry(0.11, 0.14, 8.6, 6, 1, true), '#6b5338', T(0, 4.3, 0)],
    [B(1.7, 0.1, 0.1), '#5a4630', T(0, 8.2, 0)], // crossarm across the road
    ...[-0.65, 0, 0.65].map((o) => [B(0.07, 0.14, 0.07), '#e8e4da', T(o, 8.31, 0)]),
    [B(0.12, 0.1, 0.12), '#3a3a3a', T(0, 6.2, 0.1)],
  ]), wPoles, { rough: 0.95 });
  if (wire.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#1b1b1b' }));
    lines.userData.fur = 1;
    scene.add(lines);
  }

  // --- the merged sign faces --------------------------------------------------------------------------------------------
  if (fPos.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(fPos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(fNrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(fUv, 2));
    const tex = new THREE.CanvasTexture(atlas.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = ctx.renderer.capabilities.getMaxAnisotropy();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.05, alphaTest: 0.5 }));
    mesh.receiveShadow = true;
    mesh.userData.fur = 1;
    scene.add(mesh);
  }

  const counts = Object.entries(L).filter(([k]) => !/Fix$/.test(k)).map(([k, v]) => `${v.length} ${k}`);
  return `${counts.join(', ')}, ${tubes.length} scaffold tubes on ${nets.length} buildings, ${wPoles.length} wooden poles, ${wire.length / 6} wire segments, ${fPos.length / 18} sign faces`;
}
