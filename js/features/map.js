// js/features/map.js — navigation + HUD: toolbar (time presets, teleport, map, labels, clean view), live fps,
// Harare street-blade signs for the nearest intersection, heading-up minimap with GPS route, and the full-screen
// Harare Street Atlas [M] with search and click-to-route.
import { buildGeo, shortName } from '../hud/geo.js';
import { buildLayers, iconColor } from '../hud/render.js';
import { createMinimap } from '../hud/minimap.js';
import { createAtlas } from '../hud/atlas.js';

const $ = (id) => document.getElementById(id);
let C = null; // ctx
let geo, minimap, atlas;
const dir = { x: 0, y: 0, z: -1 };
let headingA = -Math.PI / 2;
let dest = null; // {x,z,name,spot}
let route = null; // flat [x,z,...]
let routeLen = 0;
let routeFrom = { x: 1e9, z: 1e9, mode: '' };
let routeT = 0, signT = 0, fpsT = 0, fpsN = 0, fpsAge = 0, presetT = 0, whereT = 0;
let labelsOn = true;
let timeBtns = [];
let toastTimer = 0;
let lastWhere = '';
let signKey = '';
const sign = {};

function toast(msg, secs = 2.2) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  toastTimer = secs;
}

const fmtDist = (m) => (m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

// Put the active player next to (x, z): drivers on the road in the left lane, walkers on the pavement facing it
function teleportTo(x, z, spot) {
  const mode = C.getMode();
  if (spot?.walkTo) [x, z] = spot.walkTo;
  if (mode === 'fly') {
    C.teleport(x, z);
    return;
  }
  const r = geo.snapToRoad(x, z);
  if (!r.dx && !r.dz) return C.teleport(x, z);
  let dx = r.dx, dz = r.dz;
  const L = Math.hypot(dx, dz) || 1;
  dx /= L;
  dz /= L;
  if (mode === 'drive') {
    // face the more useful way (towards the landmark) unless one-way; keep left
    if (!r.o && (x - r.x) * dx + (z - r.z) * dz < 0) (dx = -dx), (dz = -dz);
    const off = r.o ? 0 : Math.min(3, r.w / 4);
    C.teleport(r.x + dz * off, r.z - dx * off, Math.atan2(dx, dz));
  } else {
    // on the pavement on the landmark's side, looking at it
    let nx = -dz, nz = dx;
    if ((x - r.x) * nx + (z - r.z) * nz < 0) (nx = -nx), (nz = -nz);
    const px = r.x + nx * (r.w / 2 + 2.2), pz = r.z + nz * (r.w / 2 + 2.2);
    C.teleport(px, pz, Math.atan2(x - px, z - pz));
  }
}

function setDest(x, z, name, spot) {
  dest = { x, z, name, spot };
  routeFrom.x = 1e9;
  computeRoute();
}
function clearDest() {
  dest = null;
  route = null;
  routeLen = 0;
  $('gps-chip').hidden = true;
}
function computeRoute() {
  if (!dest) return;
  const p = (C.controls.playerState || C.controls.position), mode = C.getMode();
  routeFrom.x = p.x;
  routeFrom.z = p.z;
  routeFrom.mode = mode;
  const r = geo.route(p.x, p.z, dest.x, dest.z, mode === 'drive');
  route = r ? r.pts : null;
  routeLen = r ? r.len : 0;
  const chip = $('gps-chip');
  chip.hidden = false;
  chip.innerHTML = '';
  const ic = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ic.setAttribute('class', 'icon');
  ic.innerHTML = '<use href="#i-route"/>';
  const n = document.createElement('span');
  n.textContent = dest.name;
  const b = document.createElement('b');
  b.textContent = fmtDist(routeLen || Math.hypot(dest.x - p.x, dest.z - p.z));
  chip.append(ic, n, b);
  chip.lastChild.dataset.d = '1';
}

function buildTeleportList() {
  const list = $('teleport-list');
  const groups = new Map();
  for (const s of geo.spots) {
    const g = s.d === 'CBD' || s.d === 'Railway' ? 'City centre' : s.d === 'Kopje' ? 'Kopje & Mbare side' : 'Around town';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(s);
  }
  for (const [g, items] of groups) {
    const h = document.createElement('div');
    h.className = 'pop-group';
    h.textContent = g;
    list.append(h);
    for (const s of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pop-item tp-item';
      b.innerHTML = '<span class="tp-dot"><i></i></span><span class="pop-name"></span><span class="pop-sub"></span>';
      b.querySelector('i').style.setProperty('--c', iconColor(s.icon));
      b.querySelector('.pop-name').textContent = s.n;
      b.querySelector('.pop-sub').textContent = s.street ? shortName(s.street) : s.d;
      b.addEventListener('click', () => {
        teleportTo(s.x, s.z, s);
        $('teleport-pop').hidePopover();
        toast(`Teleported to ${s.n}`);
      });
      list.append(b);
    }
  }
}

// Anchor a popover under its toolbar button (right-aligned to it)
function anchor(popId, btnId) {
  const pop = $(popId), btn = $(btnId);
  pop.addEventListener('beforetoggle', (e) => {
    if (e.newState !== 'open') return;
    const r = btn.getBoundingClientRect(), tb = $('toolbar').getBoundingClientRect();
    pop.style.top = `${tb.bottom + 8}px`;
    if (innerWidth > 640) {
      pop.style.right = `${Math.max(16, innerWidth - r.right - 6)}px`;
      pop.style.left = 'auto';
    } else {
      pop.style.left = pop.style.right = '';
    }
  });
}

function setHidden(h) {
  document.body.classList.toggle('ui-hidden', h);
  if (h) for (const id of ['time-pop', 'teleport-pop']) $(id).matches(':popover-open') && $(id).hidePopover();
}

function updateSigns() {
  const p = (C.controls.playerState || C.controls.position);
  const fly = C.getMode() === 'fly';
  const high = fly && C.camera.position.y > 700;
  const street = high ? null : geo.nearestStreet(p.x, p.z, fly ? 80 : 45);
  const j = high ? null : geo.nearestJunction(p.x, p.z, street);
  let on = street, cross = null, dj = 0;
  if (j) {
    if (street && j.names.includes(street)) cross = j.names.find((n) => n !== street);
    else if (!street) (on = j.names[0]), (cross = j.names[1]);
    dj = Math.hypot(j.x - p.x, j.z - p.z);
    if (dj > 260) cross = null;
  }
  let near = null, nd = fly ? 260 : 180;
  if (!high) for (const s of geo.spots) {
    const d = Math.hypot(s.x - p.x, s.z - p.z);
    if (d < nd) (nd = d), (near = s);
  }
  const key = `${on}|${cross}|${near?.n}`;
  if (key !== signKey) {
    signKey = key;
    sign.near.style.display = near ? '' : 'none';
    if (near) sign.nearName.textContent = near.n;
    sign.on.style.display = on ? '' : 'none';
    if (on) sign.onText.textContent = shortName(on);
    sign.cross.style.display = cross ? '' : 'none';
    if (cross) sign.crossText.textContent = shortName(cross);
    // restart the slide-in on change
    for (const el of [sign.on, sign.cross]) {
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
    }
  }
  if (cross) {
    const t = dj < 25 ? 'here' : fmtDist(dj);
    if (sign.crossDist.textContent !== t) sign.crossDist.textContent = t;
  }
  // "You are at …" for the atlas header
  return on ? (cross ? `${shortName(on)} & ${shortName(cross)}` : shortName(on)) : 'Harare CBD';
}

function buildSigns() {
  const box = $('hud-signs');
  box.innerHTML = '<div class="near">Near <b></b></div><div class="blade"><span></span></div><div class="blade cross"><span></span><small></small></div>';
  sign.near = box.children[0];
  sign.nearName = sign.near.querySelector('b');
  sign.on = box.children[1];
  sign.onText = sign.on.querySelector('span');
  sign.cross = box.children[2];
  sign.crossText = sign.cross.querySelector('span');
  sign.crossDist = sign.cross.querySelector('small');
  for (const el of box.children) el.style.display = 'none';
}

let youText = 'Harare CBD';

export default {
  init(ctx) {
    C = ctx;
    const t0 = performance.now();
    geo = buildGeo(ctx.DATA);
    ctx.controls.roadSnap = geo.snapToRoad;
    const layers = buildLayers(ctx.DATA);
    minimap = createMinimap($('minimap-canvas'), geo, layers);
    const getPlayer = () => (C.controls.playerState || C.controls.position);
    atlas = createAtlas({
      DATA: ctx.DATA,
      geo,
      layers,
      getPlayer,
      getHeading: () => headingA,
      getDest: () => dest,
      getRoute: () => route,
      onDest: setDest,
      onClear: clearDest,
      onTeleport: (x, z, spot) => {
        teleportTo(x, z, spot);
        toast(`Teleported to ${dest?.name || 'pin'}`);
        clearDest();
      },
    });
    buildSigns();
    buildTeleportList();
    anchor('teleport-pop', 'btn-teleport');
    anchor('time-pop', 'btn-clock');

    // Time presets (toolbar segments and the popover list)
    timeBtns = [...document.querySelectorAll('.time-btn[data-hour]')];
    for (const b of timeBtns) b.addEventListener('click', () => {
      C.setHour(parseFloat(b.dataset.hour));
      presetT = 0;
    });

    $('btn-map').addEventListener('click', () => atlas.toggle());
    $('minimap').addEventListener('click', () => atlas.open());
    const labelsBtn = $('btn-labels');
    const syncLabels = () => labelsBtn.setAttribute('aria-pressed', String(labelsOn));
    labelsBtn.addEventListener('click', () => {
      // main.js owns the label state and toggles it on L; drive it through the same key
      dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyL', key: 'l' }));
      dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyL', key: 'l' }));
      labelsBtn.blur();
    });
    $('btn-hide').addEventListener('click', () => setHidden(true));
    $('btn-show-ui').addEventListener('click', () => setHidden(false));

    addEventListener('keydown', (e) => {
      const typing = e.target?.tagName === 'INPUT' && e.target.type === 'text';
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'KeyL' && e.target?.tagName !== 'INPUT') {
        labelsOn = !labelsOn;
        syncLabels();
      }
      if (e.code === 'KeyM') atlas.toggle();
      else if (e.code === 'KeyU') setHidden(!document.body.classList.contains('ui-hidden'));
      else if (e.code === 'Escape' && atlas.isOpen) atlas.close();
      else if (atlas.isOpen && (e.key === '+' || e.key === '=')) atlas.zoomBy(1.5);
      else if (atlas.isOpen && (e.key === '-' || e.key === '_')) atlas.zoomBy(1 / 1.5);
    });
    syncLabels();
    window.__harare && (window.__harare.nav = { geo, atlas, setDest, clearDest, teleportTo, get route() { return route; } });
    console.log(`[harare] nav HUD ready in ${(performance.now() - t0).toFixed(0)} ms (${geo.junctions.length} junctions, ${geo.entries.length} searchable names)`);
  },

  update(dt, ctx) {
    // fps
    fpsN++;
    // the first seconds after loading are shader warm-up: don't greet the player with a red number
    if ((fpsT += dt) >= 0.5) {
      const fps = Math.round(fpsN / fpsT);
      const el = $('hud-fps');
      if ((fpsAge += fpsT) > 6) el.textContent = fps;
      if (fpsAge > 6) el.className = 'fps' + (fps < 20 ? ' bad' : fps < 40 ? ' warn' : '');
      fpsN = 0;
      fpsT = 0;
    }
    if (toastTimer > 0 && (toastTimer -= dt) <= 0) $('toast').classList.remove('show');

    // Heading from the camera (forward on the ground plane)
    const cam = ctx.camera, e = cam.matrixWorld.elements;
    dir.x = -e[8];
    dir.z = -e[10];
    if (dir.x * dir.x + dir.z * dir.z > 1e-6) headingA = Math.atan2(dir.z, dir.x);

    const p = (ctx.controls.playerState || ctx.controls.position), mode = ctx.getMode();

    // GPS: re-route as you move, arrive when close
    if (dest && (routeT -= dt) <= 0) {
      routeT = 0.8;
      const dd = Math.hypot(dest.x - p.x, dest.z - p.z);
      if (dd < (mode === 'fly' ? 40 : 22)) {
        toast(`You have arrived at ${dest.name}`);
        clearDest();
      } else if (Math.hypot(p.x - routeFrom.x, p.z - routeFrom.z) > 6 || mode !== routeFrom.mode) computeRoute();
    }

    if ((signT -= dt) <= 0) {
      signT = 0.25;
      youText = updateSigns();
    }
    // Quality toasts that main.js writes into #where (hidden)
    if ((whereT -= dt) <= 0) {
      whereT = 0.3;
      const w = $('where').textContent;
      if (w !== lastWhere) {
        lastWhere = w;
        if (w.startsWith('Quality')) toast(w);
      }
    }
    if ((presetT -= dt) <= 0) {
      presetT = 0.3;
      const h = ctx.getHour();
      for (const b of timeBtns) b.classList.toggle('active', Math.abs(parseFloat(b.dataset.hour) - h) < 0.03);
    }

    if (atlas.isOpen) atlas.update(dt, youText);
    else if (!document.body.classList.contains('ui-hidden')) {
      const camY = cam.position.y;
      const r = mode === 'walk' ? 150 : mode === 'drive' ? 230 + Math.abs(ctx.controls.car?.v || 0) * 7 : Math.max(260, Math.min(900, camY * 1.1));
      minimap.draw(dt, p.x, p.z, headingA, r, route, dest);
    }
  },
};
