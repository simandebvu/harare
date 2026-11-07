// js/features/game.js — the game layer's HUD: speedometer + camera switcher (bottom right), touch joystick and
// action buttons, and the street-level start (behind the wheel of a kombi on Jason Moyo Avenue by Unity Square).
// Movement, cameras and the player live in controls.js / cameras.js / player.js.

const LABELS = {
  drive: ['Kombi · Toyota HiAce', 'Free roam'],
  walk: ['Skyweaver · On foot', ''],
  fly: ['Skyweaver', 'Superflight'],
};
const KEYS = {
  drive: '<kbd>W</kbd><kbd>S</kbd> gas · <kbd>A</kbd><kbd>D</kbd> steer · <kbd>Space</kbd> brake · <kbd>Shift</kbd> boost · <kbd>H</kbd> hoot',
  walk: '<kbd>WASD</kbd> walk · click to look · <kbd>Shift</kbd> run · <kbd>Space</kbd> jump',
  fly: '<kbd>WASD</kbd> fly · <kbd>Q</kbd><kbd>E</kbd> down / up · click to look · <kbd>Shift</kbd> fast',
};
const TOUCH_ACTIONS = {
  drive: [['brake', 'Brake'], ['run', 'Boost'], ['hoot', 'Hoot']],
  walk: [['jump', 'Jump'], ['run', 'Run']],
  fly: [['up', 'Up'], ['down', 'Down'], ['run', 'Fast']],
};

// Start where the city is busiest: Jason Moyo Avenue heading west past Africa Unity Square, in the left lane
function spawnPoint(DATA) {
  const want = { x: 95, z: 62 };
  let best = null, bd = Infinity;
  for (const e of DATA.graph.edges) {
    if (e.n !== 'Jason Moyo Avenue') continue;
    for (let i = 0; i < e.p.length - 2; i += 2) {
      const ax = e.p[i], az = e.p[i + 1], bx = e.p[i + 2], bz = e.p[i + 3];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((want.x - ax) * dx + (want.z - az) * dz) / l2));
      const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(want.x - px, want.z - pz);
      if (d < bd) (bd = d), (best = { px, pz, dx, dz, e });
    }
  }
  if (!best) return { x: 80, z: 66, yaw: -Math.PI / 2 };
  const s = best.e.o === -1 ? -1 : 1;
  const L = Math.hypot(best.dx, best.dz);
  const tx = (best.dx / L) * s, tz = (best.dz / L) * s;
  const lanes = best.e.o ? best.e.l : Math.max(1, Math.floor(best.e.l / 2));
  const laneW = Math.min(3.3, (best.e.o ? best.e.w : best.e.w / 2) / lanes);
  // Kerb-side lane, where kombis live — kept clear of the kerb (graph widths run a little wider than the painted road)
  const off = Math.min(best.e.o ? ((lanes - 1) / 2) * laneW : laneW * 0.5, best.e.w / 2 - 3.2);
  return { x: best.px + tz * off, z: best.pz - tx * off, yaw: Math.atan2(tx, tz) };
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

let ui = null;
const last = { speed: -1, mode: '', label: '', tag: '', gear: '', meter: -1, boost: null, cam: '' };

function buildUI(ctx) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'css/game.css';
  document.head.appendChild(link);

  const root = el('div', 'gm-hud');
  root.id = 'game-hud';
  const cluster = el('section', 'gm-cluster');
  cluster.setAttribute('aria-label', 'Speed and camera');
  cluster.innerHTML = `
    <div class="gm-gauge">
      <div class="gm-top"><span class="gm-label"></span><span class="gm-tag"></span></div>
      <div class="gm-speed"><span class="gm-num">0</span><span class="gm-unit">km/h</span><span class="gm-gear"></span><span class="gm-hoot">Hoot!</span></div>
      <div class="gm-meter" aria-hidden="true"><span></span></div>
    </div>
    <div class="gm-cams">
      <button class="gm-ib" data-cam="-1" type="button" title="Previous camera [Shift+V]" aria-label="Previous camera">‹</button>
      <button class="gm-cam" data-cam="1" type="button" title="Next camera [V]"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 5h2.5l1.2-1.6h4.6L11.5 5H14v8H2z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="8" cy="8.8" r="2.3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg><span class="gm-camname"></span><kbd>V</kbd></button>
      <button class="gm-ib" data-cam="1" type="button" title="Next camera [V]" aria-label="Next camera">›</button>
    </div>
    <div class="gm-keys"></div>`;
  root.appendChild(cluster);
  document.body.appendChild(root);

  const q = (s) => cluster.querySelector(s);
  ui = {
    root, cluster,
    label: q('.gm-label'), tag: q('.gm-tag'), num: q('.gm-num'), unit: q('.gm-unit'), gear: q('.gm-gear'),
    meter: q('.gm-meter span'), camname: q('.gm-camname'), keys: q('.gm-keys'),
  };
  cluster.querySelectorAll('[data-cam]').forEach((b) => b.addEventListener('click', (e) => {
    ctx.controls.rig.next(+b.dataset.cam);
    e.currentTarget.blur();
  }));

  let hootTimer = 0;
  addEventListener('harare:hoot', () => {
    cluster.classList.remove('is-hoot');
    void cluster.offsetWidth; // restart the animation
    cluster.classList.add('is-hoot');
    clearTimeout(hootTimer);
    hootTimer = setTimeout(() => cluster.classList.remove('is-hoot'), 600);
  });

  buildTouch(ctx);
}

// Virtual joystick (left thumb) + three hold buttons (right thumb). Camera look stays a drag on the canvas.
function buildTouch(ctx) {
  const T = ctx.controls.touch;
  const wrap = el('div', 'gm-touch');
  wrap.hidden = true;
  wrap.innerHTML = `<div class="gm-stick" aria-label="Move joystick"><span class="gm-knob"></span></div><div class="gm-acts"></div>`;
  document.body.appendChild(wrap);
  ui.touch = wrap;
  ui.acts = wrap.querySelector('.gm-acts');
  const stick = wrap.querySelector('.gm-stick'), knob = wrap.querySelector('.gm-knob');
  let sid = null, cx = 0, cy = 0;
  const R = 46;
  const move = (e) => {
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > R) (dx *= R / d), (dy *= R / d);
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    T.x = dx / R;
    T.y = dy / R;
  };
  stick.addEventListener('pointerdown', (e) => {
    sid = e.pointerId;
    const r = stick.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    stick.setPointerCapture(sid);
    move(e);
    e.preventDefault();
  });
  stick.addEventListener('pointermove', (e) => e.pointerId === sid && move(e));
  const end = (e) => {
    if (e.pointerId !== sid) return;
    sid = null;
    T.x = T.y = 0;
    knob.style.transform = '';
  };
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) stick.addEventListener(t, end);

  const show = () => {
    wrap.hidden = false;
    document.body.classList.add('gm-has-touch');
  };
  if (matchMedia('(pointer: coarse)').matches) show();
  addEventListener('touchstart', show, { once: true, passive: true });
}

function setTouchActions(ctx, mode) {
  const T = ctx.controls.touch;
  ui.acts.innerHTML = '';
  T.run = T.jump = T.brake = false;
  T.up = 0;
  for (const [a, label] of TOUCH_ACTIONS[mode]) {
    const b = el('button', 'gm-act', label);
    b.type = 'button';
    const set = (on) => {
      b.classList.toggle('on', on);
      if (a === 'run') T.run = on;
      else if (a === 'jump') T.jump = on;
      else if (a === 'brake') T.brake = on;
      else if (a === 'up') T.up = on ? 1 : 0;
      else if (a === 'down') T.up = on ? -1 : 0;
      else if (a === 'hoot' && on) ctx.controls.hoot();
    };
    b.addEventListener('pointerdown', (e) => (e.preventDefault(), b.setPointerCapture(e.pointerId), set(true)));
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(t, () => set(false));
    ui.acts.appendChild(b);
  }
  const cam = el('button', 'gm-act gm-act-cam', 'Cam');
  cam.type = 'button';
  cam.addEventListener('click', () => ctx.controls.rig.next(1));
  ui.acts.appendChild(cam);
}

export default {
  init(ctx) {
    const c = ctx.controls;
    c.traffic = ctx.traffic;
    buildUI(ctx);
    // Street level from the first frame
    ctx.setMode('drive');
    const s = spawnPoint(ctx.DATA);
    c.teleport(s.x, s.z, s.yaw);
  },

  update(dt, ctx) {
    if (!ui) return;
    const c = ctx.controls, mode = c.mode;
    const cam = c.rig.current;
    if (mode !== last.mode) {
      last.mode = mode;
      ui.root.dataset.mode = mode;
      ui.keys.innerHTML = KEYS[mode];
      setTouchActions(ctx, mode);
    }
    // Labels
    let label = LABELS[mode][0], tag = LABELS[mode][1];
    if(mode==='drive'&&c.vehicleType==='roadster')label='Vela X1 · Flight taxi';
    if(mode==='drive'&&ctx.shift?.state.status==='active')tag='→ '+ctx.shift.stops[ctx.shift.state.target].name;
    if (mode === 'fly') {
      if (cam.id === 'map') label = 'Map view';
      tag = `Alt ${Math.round(c.altitude)} m`;
    }
    if (label !== last.label) ui.label.textContent = last.label = label;
    if (tag !== last.tag) ui.tag.textContent = last.tag = tag;
    if (cam.name !== last.cam) ui.camname.textContent = last.cam = cam.name;

    const kmh = Math.round(c.speed * 3.6);
    if (kmh !== last.speed) ui.num.textContent = last.speed = kmh;
    const gear = mode === 'drive' ? (c.car.v < -0.3 ? 'R' : c.car.boost ? 'Boost' : kmh === 0 ? 'N' : 'D') : mode === 'walk' ? (c.walk.air ? 'Jump' : kmh > 12 ? 'Run' : kmh > 0 ? 'Walk' : '') : c.boosting ? 'Fast' : '';
    if (gear !== last.gear) ui.gear.textContent = last.gear = gear;
    const m = Math.round(Math.min(1, c.speed / c.maxSpeed) * 100) / 100;
    if (m !== last.meter) ui.meter.style.transform = `scaleX(${(last.meter = m)})`;
    const boost = !!c.boosting && c.speed > 1;
    if (boost !== last.boost) ui.cluster.classList.toggle('is-boost', (last.boost = boost));
  },
};
