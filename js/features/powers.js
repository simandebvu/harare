// js/features/powers.js — hero superpowers, cartoon rules: nobody gets hurt and the city repairs itself.
//  G  lift the nearest car or kombi overhead (on foot or in flight), G again throws it where the camera looks.
//  X  in flight: slam straight down, a shockwave scaled by the fall that flips nearby cars and scatters the crowd.
//     On foot: a smaller stomp.
// A lifted vehicle leaves the traffic simulation and is drawn here as a standalone prop with full tumbling physics.
// Wrecks smoke for a while, then fold away in a puff of dust and the car rejoins traffic somewhere out of sight.
import { gltfLoader } from '../gltf-loader.js';
import { vehicleGeometry, VEHICLE_TYPES, ATLAS, ROUTES } from '../vehicles.js';
import { groundY } from '../util.js';
import { overheadAt } from '../overheads.js';

const MAX_PROPS = 10, GRAVITY = 22, ROAD_Y = 0.22, WRECK_LIFE = 14, GRAB_REACH = 2.6;
const FLOAT = 0.55; // telekinesis: the gap between the raised hand and a carried car
const GLB = { fit: 'fit', sedan: 'sedan', police: 'police', kombi: 'hiace' };
const glbCache = new Map();
const glb = (name) => {
  if (!glbCache.has(name)) glbCache.set(name, gltfLoader.loadAsync(new URL(`../../assets/models/${name}.glb`, import.meta.url).href).catch(() => null));
  return glbCache.get(name);
};

export default {
  init(ctx) {
    const T = (this.T = ctx.THREE);
    this.ctx = ctx;
    this.props = [];
    this.held = null;
    this.v = { a: new T.Vector3(), b: new T.Vector3(), q: new T.Quaternion(), q2: new T.Quaternion(), e: new T.Euler() };
    this.models = {};
    this.pool = {};
    // main.js waits for this (briefly) before its shader warm-up frame, which compiles the pooled bodies with the rest
    this.loaded = Promise.all(Object.entries(GLB).map(([type, file]) => glb(file).then((g) => g && (this.models[type] = g.scene)))).then(() => this.prewarm());
    this.buildParticles();
    this.buildShockwave();
    ctx.powers = this;
    const fire = (what) => {
      if (what === 'grab') this.grab();
      else if (what === 'slam') this.slam();
    };
    addEventListener('keydown', (e) => {
      if (e.repeat || /INPUT|TEXTAREA|SELECT/.test(e.target?.tagName) || e.target.closest?.('[popover]:popover-open')) return;
      if (e.code === 'KeyG') fire('grab');
      else if (e.code === 'KeyX') fire('slam');
    });
    addEventListener('harare:power', (e) => fire(e.detail));
    addEventListener('harare:hero-burst', (e) => {
      const d = e.detail;
      if (d.kind === 'land' && d.slam > 0) this.blast(d.x, d.y, d.z, Math.min(1, 0.35 + d.slam / 45));
    });
  },

  // Chaos meter (features/chaos.js): positive for damage, negative for rescues
  chaos(n, kind, label) {
    dispatchEvent(new CustomEvent('harare:chaos', { detail: { n, kind, label } }));
  },

  // --- the hero ------------------------------------------------------------------------------------------------------
  hero() {
    const c = this.ctx.controls;
    if (c.mode === 'walk') return { x: c.walk.x, y: c.walk.y, z: c.walk.z, yaw: c.walk.yaw, vx: c.walk.vx || 0, vy: c.walk.vy || 0, vz: c.walk.vz || 0 };
    if (c.mode === 'fly' && c.rig.current.id !== 'map') { const h = c.heli; return { x: h.x, y: h.y, z: h.z, yaw: h.yaw, vx: h.vx, vy: h.vy, vz: h.vz }; }
    return null;
  },

  grab() {
    if (this.held) return this.throw();
    const best = this.target();
    if (best?.prop) return this.catchProp(best.prop);
    if (!best) return this.hero() && this.toast(this.ctx.controls.mode === 'fly' ? 'Fly down next to a car to lift it' : 'Walk up to a car to lift it');
    const type = best.car.type || 'kombi', T = VEHICLE_TYPES[type];
    const half = this.pool[type]?.[0]?.half || { x: T.width / 2, y: type === 'zupco' ? 1.6 : type === 'kombi' ? 1.05 : 0.8, z: T.len / 2 };
    if (!this.roomAbove(this.hero(), half)) return this.toast('No room overhead · step out into the open');
    const p = this.spawnProp(best.car, best.parked, best.base);
    if (!p) return;
    p.state = 'held';
    p.lift = 0;
    this.held = p;
    this.say('lift');
    this.chaos(1, 'lift');
  },

  // Rescue: snatch a car out of the air before it lands
  catchProp(p) {
    p.state = 'held';
    p.lift = 0.4;
    p.from.copy(p.group.position);
    p.fromQ.copy(p.group.quaternion);
    p.vel.set(0, 0, 0);
    p.spin.set(0, 0, 0);
    p.burn = 0;
    this.held = p;
    this.say('lift');
    this.chaos(-10, 'rescue', 'Caught it!');
  },

  // Rescue: X while carrying sets the car down gently in front of you, upright and repaired
  setDown() {
    const p = this.held, me = this.hero(), c = this.ctx.controls;
    if (!p || !me) return;
    this.held = null;
    const fx = Math.sin(me.yaw), fz = Math.cos(me.yaw), d = 1.2 + p.half.z;
    let x = me.x + fx * d, z = me.z + fz * d;
    if (c.blocked(x, z, me.y + 1)) (x = me.x), (z = me.z);
    const top = c.surfaceY(x, z, me.y + 2), floor = top + (top <= groundY(x, z) + 0.05 ? ROAD_Y : 0);
    const wreck = p.damage > 0;
    p.body.recolor(p.color);
    p.damage = 0;
    p.burn = 0;
    p.fromQ = p.group.quaternion.clone();
    p.restQ = new this.T.Quaternion().setFromEuler(new this.T.Euler(0, me.yaw, 0));
    p.restY = floor + p.half.y;
    p.restLow = p.half.y;
    p.fromP = p.group.position.clone();
    p.restP = new this.T.Vector3(x, p.restY, z);
    p.settle = 0;
    p.state = 'rest';
    p.life = 3;
    this.chaos(wreck ? -8 : -3, 'rescue', wreck ? 'Repaired' : 'Put it back');
    this.toastEl?.classList.remove('on');
  },

  // Where a carried car sits: pressed overhead along the body's head direction (straight up on foot, out in front when
  // flying flat out, Superman-style), a little forward so the hero stays in view below its tail
  heldCentre(me, half, out) {
    const up = this.bodyUp(), ahead = half.z * 0.3 * Math.max(0, up.y), bob = Math.sin((performance.now() / 1000) * 2.1) * 0.1;
    out.set(me.x, me.y + 1, me.z).addScaledVector(up, 0.82 + FLOAT + bob + half.y); // floating clear of the raised hand
    out.x += Math.sin(me.yaw) * ahead;
    out.z += Math.cos(me.yaw) * ahead;
    return out;
  },
  // Is there room for a car of these half extents overhead? Walls, and the pavement roofs nothing else collides
  // with (shop verandahs and canopies, rank and bus shelters: js/overheads.js)
  roomAbove(me, half) {
    const c = this.ctx.controls, ctr = this.heldCentre(me, half, new this.T.Vector3());
    const sn = Math.sin(me.yaw), cs = Math.cos(me.yaw), lo = ctr.y - half.y - 0.4, hi = ctr.y + half.y;
    for (const [a, b] of [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1], [0, 1], [0, -1]]) {
      const lx = a * half.x * 0.9, lz = b * half.z * 0.9, px = ctr.x + lx * cs + lz * sn, pz = ctr.z - lx * sn + lz * cs;
      if (overheadAt(px, pz, lo, hi) !== null) return false;
      if (c.blocked(px, pz, ctr.y - half.y * 0.5) || c.blocked(px, pz, hi - 0.1)) return false;
    }
    return true;
  },

  // The vehicle within arm's reach of the hero, if any (also drives the "Lift" prompt)
  target() {
    const me = this.hero();
    if (!me) return null;
    const tr = this.ctx.traffic;
    let best = null, bd = GRAB_REACH;
    const consider = (car, parked) => {
      if (car.away > 0 || (!parked && !car.init)) return;
      const dx = me.x - car.x, dz = me.z - car.z;
      if (Math.abs(dx) + Math.abs(dz) > 16) return;
      const cs = Math.cos(car.h), sn = Math.sin(car.h);
      const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
      const d = Math.hypot(Math.max(0, Math.abs(lx) - car.width / 2), Math.max(0, Math.abs(lz) - car.len / 2));
      const base = parked ? car.y : groundY(car.x, car.z) + ROAD_Y;
      if (d < bd && me.y > base - 1 && me.y < base + 4.5) (bd = d), (best = { car, parked, base });
    };
    for (const car of tr.cars) consider(car, false);
    for (const car of tr.parkedCars) consider(car, true);
    // A car in the air close by can be caught (a rescue), and that beats lifting a parked one
    for (const p of this.props) {
      if (p.state !== 'air' || p === this.held) continue;
      const g = p.group.position, d = Math.hypot(g.x - me.x, g.y - (me.y + 1.5), g.z - me.z) - Math.max(p.half.x, p.half.z);
      if (d < 5) return { prop: p };
    }
    return best;
  },

  throw() {
    const p = this.held, me = this.hero();
    this.held = null;
    if (!p) return;
    p.state = 'air';
    const T = this.T, dir = this.ctx.camera.getWorldDirection(new T.Vector3());
    // Throw where the camera looks, with a lift so it arcs; heavier vehicles go less far
    const heavy = p.type === 'zupco' ? 0.55 : p.type === 'kombi' ? 0.85 : 1;
    p.vel.set(dir.x * 30 * heavy, Math.max(dir.y * 30, 0) * heavy + 7, dir.z * 30 * heavy);
    if (me) p.vel.add(this.v.a.set(me.vx, me.vy, me.vz));
    p.spin.set((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 5);
    this.throwT = 0.42; // arms follow through (pose)
    this.say('throw');
  },

  slam() {
    const c = this.ctx.controls, me = this.hero();
    if (!me) return;
    if (this.held) return this.held.state === 'held' && this.held.lift >= 1 ? this.setDown() : undefined;
    if (c.mode === 'fly') {
      const h = c.heli, floor = c.surfaceY(h.x, h.z, h.y);
      if (['charge', 'impact'].includes(h.phase) || h.slam) return;
      // Too low for a proper slam: just stomp where you hover
      if (h.y - floor < 4) return this.toast('Climb higher for a slam');
      h.slam = h.y;
      c.setMode('walk'); // begins the landing; the slam flag turns it into a dive (controls.updateHeli)
      if (!h.landing) h.slam = null;
      return;
    }
    if (c.walk.air || this.pound) return;
    // Ground pound: hop with both fists raised, then drive them into the street as you land (see update)
    c.walk.vy = 6.5;
    c.walk.air = true;
    this.pound = true;
    dispatchEvent(new CustomEvent('harare:jump'));
  },
  stompHit() {
    const me = this.hero();
    if (!me || this.ctx.controls.mode !== 'walk') return;
    dispatchEvent(new CustomEvent('harare:hero-burst', { detail: { x: me.x, y: me.y - 0.16, z: me.z, kind: 'land' } }));
    // The blast of air snuffs out fires close by (a rescue) before it does any damage of its own
    let out = 0;
    const HV = this.ctx.heatVision;
    if (HV) for (let i = HV.fires.length - 1; i >= 0; i--) {
      const f = HV.fires[i];
      if (Math.hypot(f.p.x - me.x, f.p.z - me.z) < 7 && f.tree === undefined) (HV.fires.splice(i, 1), out++);
    }
    for (const p of this.props) if (p.burn > 0 && p.group.position.distanceTo(this.v.a.set(me.x, me.y, me.z)) < 7) (p.burn = 0), out++;
    if (out) {
      this.dust(me.x, me.y, me.z, 30, 5, [0.85, 0.85, 0.85]);
      this.chaos(-Math.min(12, 4 * out), 'rescue', out > 1 ? 'Fires out' : 'Fire out');
      return; // a fire-fighting punch: no shockwave
    }
    this.blast(me.x, me.y - 0.16, me.z, 0.32);
  },

  // A shockwave at (x, y, z), power 0..1: flips the cars closest in, stops the rest, scatters the pavement
  blast(x, y, z, power) {
    const tr = this.ctx.traffic, R = 6 + power * 14, list = [];
    for (const group of [tr.cars, tr.parkedCars]) for (const car of group) {
      if (car.away > 0 || (group === tr.cars && !car.init)) continue;
      const d = Math.hypot(car.x - x, car.z - z);
      if (d < R) list.push([d, car, group !== tr.cars]);
      else if (d < R * 1.8 && group === tr.cars) car.v = 0;
    }
    list.sort((a, b) => a[0] - b[0]);
    if (!this.exploding) this.chaos(Math.round(2 + power * 5 + Math.min(list.length, 8) * 1.5), 'slam');
    for (const [d, car, parked] of list) {
      if (this.props.length >= MAX_PROPS) {
        if (!parked) car.v = 0;
        continue;
      }
      const base = parked ? car.y : groundY(car.x, car.z) + ROAD_Y;
      if (Math.abs(base - y) > 6) continue; // a slam on a rooftop doesn't toss the cars in the street below
      const p = this.spawnProp(car, parked, base);
      if (!p) continue;
      const k = 1 - d / R, ux = (car.x - x) / (d || 1), uz = (car.z - z) / (d || 1);
      p.state = 'air';
      p.vel.set(ux * (4 + 12 * k) * power, (5 + 13 * k) * power + 2, uz * (4 + 12 * k) * power);
      p.spin.set(-uz * 5 * k * power + (Math.random() - 0.5), (Math.random() - 0.5) * 2, ux * 5 * k * power + (Math.random() - 0.5));
    }
    this.ctx.people.scare(x, z, R * 2.4, 1.5 * power);
    this.shockwave(x, y, z, R);
    this.dust(x, y, z, 26 + power * 40, 6 + power * 10, [0.72, 0.62, 0.5]);
    this.ctx.controls.rig.shake = Math.min(1, 0.45 + power * 0.6);
    dispatchEvent(new CustomEvent('harare:crash', { detail: { strength: 6 + power * 10 } }));
  },

  // Heat vision (anything hot): the vehicle — traffic or an existing wreck — blows up into the air, charred and burning
  explode(car, parked) {
    let p = this.props.find((q) => q.car === car);
    if (!p) p = this.spawnProp(car, parked, parked ? car.y : groundY(car.x, car.z) + ROAD_Y);
    if (!p) return null;
    if (p === this.held) this.held = null;
    const j = () => Math.random() - 0.5;
    p.state = 'air';
    p.vel.set(j() * 3, 9 + Math.random() * 4, j() * 3);
    p.spin.set(j() * 5, j() * 2, j() * 5);
    if (p.damage < 3) p.body.damage(0.4);
    this.chaos(8, 'explode');
    p.damage = 3;
    p.burn = 9;
    p.life = WRECK_LIFE + 4;
    const { x, y, z } = p.group.position;
    for (let k = 0; k < 46; k++)
      this.fire.emit(x + j() * 2, y + j(), z + j() * 2, j() * 9, 1 + Math.random() * 7, j() * 9, 0.5 + Math.random() * 0.5, 1.4 + Math.random() * 1.6, [1, 0.5 + Math.random() * 0.35, 0.12], 0.95, 1.6, 2.6, 1.2);
    this.exploding = true;
    this.blast(x, y - p.half.y, z, 0.3);
    this.exploding = false;
    return p;
  },

  // --- props ---------------------------------------------------------------------------------------------------------
  spawnProp(car, parked, base) {
    const T = this.T, tr = this.ctx.traffic;
    if (this.props.length >= MAX_PROPS) {
      const old = this.props.find((p) => p.state === 'rest');
      if (!old) return null;
      this.removeProp(old);
    }
    const type = car.type || 'kombi', color = car.color || '#f2f1ec';
    const group = new T.Group(), body = this.body(type, color);
    group.add(body.root);
    group.position.set(car.x, base + body.cy, car.z);
    group.rotation.y = car.h;
    this.ctx.scene.add(group);
    tr.take(car, 1e9);
    const p = {
      car, parked, type, group, body, color, half: body.half, vel: new T.Vector3(), spin: new T.Vector3(),
      state: 'air', life: WRECK_LIFE, damage: 0, smokeT: 0, settle: 0, from: group.position.clone(), fromQ: group.quaternion.clone(),
    };
    this.props.push(p);
    return p;
  },

  // Vehicle bodies are pooled per type: cloning a downloaded model (and its materials) mid-slam costs a frame hitch
  body(type, color) {
    const pool = (this.pool[type] ||= []);
    const b = pool.pop() || this.makeBody(type);
    b.recolor(color);
    return b;
  },
  prewarm() {
    for (const type of Object.keys(GLB)) {
      const pool = (this.pool[type] ||= []);
      while (pool.length < (type === 'kombi' ? 8 : 3)) pool.push(this.makeBody(type));
    }
    // Park them in the scene, hidden, for main.js's warm-up frame to compile (so the first slam doesn't stall on it)
    const stage = new this.T.Group();
    stage.visible = false;
    for (const pool of Object.values(this.pool)) for (const b of pool) stage.add(b.root);
    this.ctx.scene.add(stage);
    const done = () => {
      this.ctx.scene.remove(stage);
      for (const pool of Object.values(this.pool)) for (const b of pool) if (b.root.parent === stage) stage.remove(b.root);
    };
    addEventListener('harare:warmed', done, { once: true });
  },

  makeBody(type) {
    const b = this.makeMesh(type), T = this.T;
    // Pivot on the middle of the body so it tumbles about its centre of mass
    const box = new T.Box3().setFromObject(b.root), centre = box.getCenter(new T.Vector3());
    b.half = box.getSize(new T.Vector3()).multiplyScalar(0.5);
    b.cy = centre.y;
    b.root.position.sub(centre);
    const holder = new T.Group();
    holder.add(b.root);
    b.root = holder;
    return b;
  },

  makeMesh(type, color = '#ffffff') {
    const T = this.T, src = this.models[type];
    if (src) {
      const root = src.clone(true), paint = [];
      const mats = new Map(), copy = (m) => (mats.has(m) || mats.set(m, m.clone()), mats.get(m));
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = o.receiveShadow = true;
        o.material = Array.isArray(o.material) ? o.material.map(copy) : copy(o.material);
      });
      for (const m of mats.values()) {
        if (m.name === 'Paint' || m.name === 'base') (m.color.set(color), paint.push(m));
        if (m.emissive) m.emissiveIntensity = 0;
      }
      if (type !== 'kombi') root.scale.x *= VEHICLE_TYPES[type].width / new T.Box3().setFromObject(root).getSize(new T.Vector3()).x;
      const wrap = new T.Group();
      wrap.add(root);
      return { root: wrap, recolor: (col) => paint.forEach((m) => m.color.set(col)), damage: (k) => paint.forEach((m) => m.color.multiplyScalar(k)) };
    }
    // Procedural model on the traffic material, for the vehicles without a downloaded model (bakkies, ZUPCO bus)
    const geo = vehicleGeometry(type, 1, true);
    const inst = (vals) => new T.InstancedBufferAttribute(new Float32Array(vals), 4);
    geo.setAttribute('iVar', inst([Math.floor(Math.random() * ATLAS.plates), 1, 0.45, Math.floor(Math.random() * ROUTES.length)]));
    geo.setAttribute('iLamp', inst([0, 0, 0, 0]));
    const mesh = new T.InstancedMesh(geo, this.ctx.traffic.renderer.material, 1);
    mesh.setMatrixAt(0, new T.Matrix4());
    const c = new T.Color(color);
    mesh.setColorAt(0, c);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const wrap = new T.Group();
    wrap.add(mesh);
    const paint = (fn) => (fn(), mesh.setColorAt(0, c), (mesh.instanceColor.needsUpdate = true));
    return { root: wrap, recolor: (col) => paint(() => c.set(col)), damage: (k) => paint(() => c.multiplyScalar(k)) };
  },

  removeProp(p) {
    this.ctx.scene.remove(p.group);
    p.group.remove(p.body.root);
    this.pool[p.type].push(p.body);
    if (this.held === p) this.held = null;
    this.props.splice(this.props.indexOf(p), 1);
    p.car.away = 0.001; // repaired: back on the rank, or rejoining traffic out of sight (traffic.respawn)
  },

  // Lowest point of the tumbling box below its centre (exact for a box: the half extents projected on world up)
  reach(p) {
    const e = p.group.matrixWorld.elements, h = p.half;
    return Math.abs(e[1]) * h.x + Math.abs(e[5]) * h.y + Math.abs(e[9]) * h.z;
  },

  impact(p, speed) {
    if (speed < 6) return;
    const { x, y, z } = p.group.position, cam = this.ctx.camera.position;
    const near = Math.max(0, 1 - Math.hypot(x - cam.x, y - cam.y, z - cam.z) / 140);
    if (near > 0) dispatchEvent(new CustomEvent('harare:crash', { detail: { strength: Math.min(16, speed * 0.7) * near } }));
    this.ctx.controls.rig.shake = Math.max(this.ctx.controls.rig.shake, Math.min(0.8, speed / 30) * near);
    this.dust(x, y - this.reach(p), z, 8 + speed, 3 + speed * 0.2, [0.62, 0.58, 0.52]);
    this.ctx.people.scare(x, z, 6 + speed * 0.8, 0.6);
    if (p.damage < 2) (p.damage++, p.body.damage(0.82));
    if (!p.crashed && speed > 12) (p.crashed = true), this.chaos(4, 'crash');
    // A hard landing knocks the cars it falls on flying too
    if (speed > 12) for (const group of [this.ctx.traffic.cars, this.ctx.traffic.parkedCars]) for (const car of group) {
      if (car.away > 0 || this.props.length >= MAX_PROPS) continue;
      const d = Math.hypot(car.x - x, car.z - z);
      if (d > 3.6 || (group === this.ctx.traffic.cars && !car.init)) continue;
      const base = group === this.ctx.traffic.cars ? groundY(car.x, car.z) + ROAD_Y : car.y;
      const q = this.spawnProp(car, group !== this.ctx.traffic.cars, base);
      if (!q) continue;
      q.vel.set((car.x - x) * 2 + p.vel.x * 0.4, 5 + speed * 0.25, (car.z - z) * 2 + p.vel.z * 0.4);
      q.spin.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 4);
    }
  },

  // The hero model's own up (head) direction: world up standing, tipped forward lying along a flight
  bodyUp() {
    const model = this.ctx.controls.player.imported?.root?.children[0];
    if (!model) return this.v.b.set(0, 1, 0);
    model.getWorldQuaternion(this.v.q2);
    return this.v.b.set(0, 1, 0).applyQuaternion(this.v.q2);
  },

  // Arms by hand on top of the animation clips (the model has no lift or throw clips): each upper and lower arm is
  // turned in world space so it points the way the pose wants, blended in by weight
  pose(dt, me) {
    const c = this.ctx.controls, model = c.player.imported?.root;
    if (!model || !me) return;
    if (this.bonesOf !== model) {
      this.bonesOf = model;
      const by = {};
      model.traverse((o) => o.isBone && (by[o.name] = o));
      this.bones = by.upperarm_l && by.lowerarm_l && by.hand_l && by.upperarm_r && by.lowerarm_r && by.hand_r && by.neck_01 ? by : null;
    }
    const B = this.bones;
    this.carryW = (this.carryW || 0) + ((this.held?.state === 'held' ? 1 : 0) - (this.carryW || 0)) * (1 - Math.exp(-dt * 10));
    if (this.throwT > 0) this.throwT -= dt;
    // Slam dive: one fist driven down at the street, the other arm out for balance
    const diving = c.mode === 'fly' && c.heli.slam && c.heli.phase !== 'impact';
    this.diveW = (this.diveW || 0) + ((diving ? 1 : 0) - (this.diveW || 0)) * (1 - Math.exp(-dt * 12));
    const throwing = this.throwT > 0, w = throwing ? 1 : this.carryW;
    if (!B || !c.player.visible) return;
    const T = this.T, up = this.bodyUp().clone(), fwd = new T.Vector3(Math.sin(me.yaw), 0, Math.cos(me.yaw));
    // Ground pound: fists raised together overhead on the way up, driven down in front on landing
    if (this.stompA > 0) this.stompA -= dt;
    this.windW = (this.windW || 0) + ((this.pound ? 1 : 0) - (this.windW || 0)) * (1 - Math.exp(-dt * 14));
    const sk = this.stompA > 0 ? 1 - this.stompA / 0.5 : 1;
    const punchW = this.stompA > 0 ? Math.min(1, (1 - sk) * 2.5) : 0, armW = Math.max(punchW, this.windW);
    if (armW > 0.01 && w < 0.01) {
      model.updateMatrixWorld(true);
      const dir = punchW > this.windW ? new T.Vector3(0, -1, 0).addScaledVector(fwd, 0.55).normalize() : new T.Vector3(0, 1, 0).addScaledVector(fwd, 0.25).normalize();
      const mid = B.neck_01.getWorldPosition(new T.Vector3());
      for (const side of ['l', 'r']) {
        const upper = B['upperarm_' + side], inward = mid.clone().sub(upper.getWorldPosition(new T.Vector3())).setY(0).normalize();
        this.point(upper, B['lowerarm_' + side], dir.clone().addScaledVector(inward, 0.25).normalize(), armW);
        this.point(B['lowerarm_' + side], B['hand_' + side], dir.clone().addScaledVector(inward, 0.4).normalize(), armW);
      }
      return;
    }
    if (this.diveW > 0.01 && w < 0.01) {
      model.updateMatrixWorld(true);
      const down = new T.Vector3(0, -1, 0), neck = B.neck_01.getWorldPosition(new T.Vector3());
      const outR = B.upperarm_r.getWorldPosition(new T.Vector3()).sub(neck).setY(0).normalize();
      const outL = B.upperarm_l.getWorldPosition(new T.Vector3()).sub(neck).setY(0).normalize();
      this.point(B.upperarm_r, B.lowerarm_r, down.clone().addScaledVector(outR, 0.15).normalize(), this.diveW);
      this.point(B.lowerarm_r, B.hand_r, down, this.diveW);
      this.point(B.upperarm_l, B.lowerarm_l, outL.clone().addScaledVector(up, 0.35).normalize(), this.diveW);
      this.point(B.lowerarm_l, B.hand_l, outL.clone().addScaledVector(up, 0.7).normalize(), this.diveW);
      return;
    }
    if (w < 0.01) return;
    // Throw: from overhead, both arms whip forward and down past the shoulders
    let aim = up;
    if (throwing) {
      const k = 1 - Math.max(0, this.throwT) / 0.42, e = k * k * (3 - 2 * k);
      aim = up.clone().multiplyScalar(1 - e).addScaledVector(fwd, 1.2 * e).addScaledVector(new T.Vector3(0, -1, 0), 0.5 * e).normalize();
    }
    model.updateMatrixWorld(true);
    // Telekinesis: one palm raised to the car (the other arm keeps its walk or idle swing); a throw thrusts that palm
    // forward, the way the camera looks. Arms bent onto a chassis never quite met it, and read as broken.
    const neck = B.neck_01.getWorldPosition(new T.Vector3()), upper = B.upperarm_r, lower = B.lowerarm_r, hand = B.hand_r;
    const shoulder = upper.getWorldPosition(new T.Vector3()), out = shoulder.clone().sub(neck).setY(0).normalize();
    let reach;
    if (throwing) {
      const k = 1 - Math.max(0, this.throwT) / 0.42, e = 1 - (1 - k) ** 3;
      const look = this.ctx.camera.getWorldDirection(new T.Vector3());
      reach = up.clone().multiplyScalar(1 - e).addScaledVector(look.setY(Math.max(look.y, -0.2)).normalize(), 1.6 * e).normalize();
    } else if (this.held?.state === 'held') reach = this.held.group.position.clone().sub(shoulder).normalize();
    else reach = aim;
    this.point(upper, lower, reach.clone().addScaledVector(out, 0.14).normalize(), w);
    this.point(lower, hand, reach, w);
  },
  point(bone, child, dir, w) {
    const T = this.T, from = bone.getWorldPosition(new T.Vector3()), cur = child.getWorldPosition(new T.Vector3()).sub(from).normalize();
    const world = bone.getWorldQuaternion(new T.Quaternion()), parent = bone.parent.getWorldQuaternion(new T.Quaternion());
    const target = new T.Quaternion().setFromUnitVectors(cur, dir).multiply(world);
    bone.quaternion.slerp(parent.invert().multiply(target), w);
    bone.updateMatrixWorld(true);
  },

  update(dt) {
    dt = Math.min(dt, 0.05);
    const c = this.ctx.controls, T = this.T, v = this.v;
    let me = this.hero();
    if (this.pound && (c.mode !== 'walk' || (!c.walk.air && c.walk.vy <= 0))) {
      this.pound = false;
      if (c.mode === 'walk') (this.stompA = 0.5), c.player.imported?.stomp?.(), this.stompHit();
    }
    // Carrying: the car can't follow you under a verandah or into a wall, so neither can you
    if (this.held && me) {
      const s = c.mode === 'walk' ? c.walk : c.heli;
      if (this.roomAbove(me, this.held.half)) this.free = { x: s.x, y: s.y, z: s.z, mode: c.mode };
      else if (this.free && this.free.mode === c.mode) {
        s.x = this.free.x;
        s.z = this.free.z;
        if (c.mode === 'fly') (s.y = this.free.y), (s.vx = s.vy = s.vz = 0);
        else s.vx = s.vz = 0;
        if (!(this.tightT > 0)) (this.tightT = 2.5), this.toast('Too low to carry it under there');
      }
      this.tightT -= dt;
      me = this.hero();
    } else this.free = null;
    this.pose(dt, me);
    if ((this.scanT = (this.scanT || 0) - dt) < 0) (this.scanT = 0.15), (this.ready = this.held ? null : this.target());
    if (this.held && !me) this.throw(); // switched to the taxi or the map with a car overhead: drop it
    const carry = this.held ? Math.min(2.6, Math.max(1, this.held.half.z / 2.45)) : 0; // a bus needs more room than a Fit
    c.rig.carry = (c.rig.carry || 0) + (carry - (c.rig.carry || 0)) * (1 - Math.exp(-dt * 4));
    for (const p of [...this.props]) {
      const g = p.group;
      if (p.burn > 0) {
        p.burn -= dt;
        if ((p.fireT = (p.fireT || 0) - dt) < 0) {
          p.fireT = 0.045;
          const s = g.position, j = () => (Math.random() - 0.5) * 2;
          this.fire.emit(s.x + j() * p.half.x, s.y + p.half.y * 0.3, s.z + j() * p.half.z * 0.7, j() * 0.3, 1.5 + Math.random() * 1.5, j() * 0.3, 0.5 + Math.random() * 0.4, 0.9 + Math.random() * 0.7, [1, 0.42 + Math.random() * 0.3, 0.08], 0.8, 0.4, 1.5, 2.5);
          if (Math.random() < 0.4) this.smoke.emit(s.x + j(), s.y + p.half.y + 0.4, s.z + j(), j() * 0.3, 2 + Math.random(), j() * 0.3, 3.2, 1.8, [0.1, 0.1, 0.11], 0.65, 2, 1.2, 0.5);
        }
      }
      if (p.state === 'held') {
        // Telekinesis: the car rises off the street (overshooting a touch, then settling) and floats above the hero's
        // raised hand, bobbing and rocking in the field (js/features/telekinesis.js draws the field)
        p.lift = Math.min(1, p.lift + dt / 0.6);
        const x1 = p.lift - 1, k = 1 + 2.4 * x1 * x1 * x1 + 1.4 * x1 * x1;
        // Overhead along the body's head direction: straight up on foot, out in front when flying flat out
        // (Superman-style); a little forward so the hero stays in view below its tail
        this.heldCentre(me, p.half, v.a);
        g.position.lerpVectors(p.from, v.a, k);
        const tt = performance.now() / 1000;
        // carried front-to-back: from the chase camera you see its tail, not a wall
        v.q.setFromEuler(v.e.set(Math.sin(tt * 1.7) * 0.045, me.yaw + Math.sin(tt * 1.1) * 0.05, Math.sin(tt * 2.3) * 0.055));
        g.quaternion.slerpQuaternions(p.fromQ, v.q, Math.min(1, k));
        continue;
      }
      if (p.state === 'air') {
        p.vel.y -= GRAVITY * dt;
        const nx = g.position.x + p.vel.x * dt, nz = g.position.z + p.vel.z * dt, ny = g.position.y + p.vel.y * dt;
        // Walls: bounce off the building instead of passing through it
        if (c.blocked(nx, nz, ny)) {
          this.impact(p, Math.hypot(p.vel.x, p.vel.z));
          p.vel.x *= -0.3;
          p.vel.z *= -0.3;
          p.spin.multiplyScalar(0.5).add(v.a.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(3));
        } else g.position.set(nx, ny, nz);
        const w = p.spin.length();
        if (w > 1e-4) g.quaternion.premultiply(v.q.setFromAxisAngle(v.a.copy(p.spin).divideScalar(w), w * dt));
        g.updateMatrixWorld();
        const top = c.surfaceY(g.position.x, g.position.z, g.position.y), floor = top + (top <= groundY(g.position.x, g.position.z) + 0.05 ? ROAD_Y : 0);
        const low = this.reach(p);
        if (g.position.y - low <= floor) {
          g.position.y = floor + low;
          const hit = -p.vel.y;
          this.impact(p, hit + Math.hypot(p.vel.x, p.vel.z) * 0.3);
          if (hit > 4) {
            p.vel.y = hit * 0.28;
            p.vel.x *= 0.62;
            p.vel.z *= 0.62;
            p.spin.multiplyScalar(0.55).add(v.a.set(Math.random() - 0.5, 0, Math.random() - 0.5).multiplyScalar(2.5));
          } else {
            p.vel.y = 0;
            p.vel.x *= Math.exp(-dt * 5);
            p.vel.z *= Math.exp(-dt * 5);
            p.spin.multiplyScalar(Math.exp(-dt * 6));
            if (Math.hypot(p.vel.x, p.vel.z) < 1.2) this.restOn(p, floor);
          }
        }
        if (g.position.y < -50) this.removeProp(p);
        continue;
      }
      // Resting: settle onto the nearest stable face, smoke, then fold away and come back repaired
      if (p.settle < 1) {
        p.settle = Math.min(1, p.settle + dt / (p.fromP ? 0.45 : 0.35));
        const k = p.settle * p.settle * (3 - 2 * p.settle);
        g.quaternion.slerpQuaternions(p.fromQ, p.restQ, k);
        if (p.fromP) g.position.lerpVectors(p.fromP, p.restP, k); // set down: carried from overhead to the street
        else g.position.y = p.restY;
      }
      p.life -= dt;
      if (p.damage > 0 && (p.smokeT -= dt) < 0) {
        p.smokeT = 0.12;
        const s = g.position;
        this.emit(s.x + (Math.random() - 0.5), s.y + p.half.y * 0.6, s.z + (Math.random() - 0.5), (Math.random() - 0.5) * 0.4, 1.4 + Math.random(), (Math.random() - 0.5) * 0.4, 2.6, 1.6, [0.22, 0.22, 0.24], 0.55);
      }
      if (p.life < 0.5) g.scale.setScalar(Math.max(0.01, p.life / 0.5));
      if (p.life <= 0) {
        this.dust(g.position.x, p.restY - p.restLow, g.position.z, 14, 2.5, [0.8, 0.8, 0.78]);
        this.removeProp(p);
      }
    }
    // Wrecks lying on the street: traffic queues behind them (traffic.js) until they fold away
    const obs = this.ctx.traffic.obstacles;
    obs.length = 0;
    for (const p of this.props) if (p.state === 'rest') obs.push({ x: p.group.position.x, z: p.group.position.z, r: Math.max(p.half.x, p.half.z) * 0.85 });
    this.smoke.update(dt);
    this.fire.update(dt);
    this.updateShockwave(dt);
  },

  // Come to rest on the box face pointing most nearly down: wheels, roof or a side (never balanced on a bumper)
  restOn(p, floor) {
    const T = this.T, g = p.group, up = new T.Vector3(0, 1, 0).applyQuaternion(g.quaternion.clone().invert());
    let roll = 0, low = p.half.y;
    if (Math.abs(up.x) > Math.abs(up.y)) (roll = up.x > 0 ? Math.PI / 2 : -Math.PI / 2), (low = p.half.x);
    else if (up.y < 0) roll = Math.PI;
    const f = new T.Vector3(0, 0, 1).applyQuaternion(g.quaternion);
    const yaw = Math.atan2(f.x, f.z);
    p.restQ = new T.Quaternion().setFromEuler(new T.Euler(0, yaw, 0)).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), roll));
    p.fromQ = g.quaternion.clone();
    p.restY = floor + low;
    p.restLow = low;
    p.settle = 0;
    p.state = 'rest';
    p.vel.set(0, 0, 0);
    if (roll) p.damage = Math.max(p.damage, 1);
  },

  // --- effects ---------------------------------------------------------------------------------------------------------
  buildParticles() {
    this.smoke = new Puffs(this.T, this.ctx.scene, 400, false);
    this.fire = new Puffs(this.T, this.ctx.scene, 300, true);
  },
  emit(...args) {
    this.smoke.emit(...args);
  },

  dust(x, y, z, count, speed, col) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.6), t = 0.6 + Math.random() * 0.5;
      this.emit(x + Math.cos(a) * 0.6, y + 0.3, z + Math.sin(a) * 0.6, Math.cos(a) * s, 0.6 + Math.random() * speed * 0.25, Math.sin(a) * s, 1.1 + Math.random() * 0.9, 1.2 + Math.random(), [col[0] * t + 0.1, col[1] * t + 0.1, col[2] * t + 0.1], 0.6, 2.2, 2.8);
    }
  },

  buildShockwave() {
    const T = this.T;
    this.wave = new T.Mesh(
      new T.RingGeometry(0.86, 1, 72).rotateX(-Math.PI / 2),
      new T.MeshBasicMaterial({ color: 0xfff1d6, transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide }),
    );
    this.wave.visible = false;
    this.wave.renderOrder = 4;
    this.ctx.scene.add(this.wave);
    this.waveAge = 1;
  },

  shockwave(x, y, z, r) {
    this.wave.position.set(x, y + 0.12, z);
    this.waveR = r;
    this.waveAge = 0;
    this.wave.visible = true;
  },

  updateShockwave(dt) {
    if (this.waveAge >= 1) return (this.wave.visible = false);
    this.waveAge = Math.min(1, this.waveAge + dt / 0.55);
    const t = 1 - (1 - this.waveAge) ** 3;
    this.wave.scale.setScalar(0.5 + t * this.waveR);
    this.wave.material.opacity = 0.85 * (1 - this.waveAge);
  },

  // --- feedback --------------------------------------------------------------------------------------------------------
  say(what) {
    dispatchEvent(new CustomEvent('harare:step', { detail: { run: true, land: true } }));
    if (what === 'lift' && !this.taught) (this.taught = true), this.toast(document.body.classList.contains('gm-has-touch') ? 'Tap Lift again to throw it where you look' : 'Press G again to throw it where you look');
  },

  toast(text) {
    let el = this.toastEl;
    if (!el) {
      el = this.toastEl = document.createElement('div');
      el.className = 'power-toast';
      el.setAttribute('role', 'status');
      const st = document.createElement('style');
      st.textContent = `.power-toast{position:fixed;left:50%;top:30%;transform:translateX(-50%);z-index:30;padding:8px 14px;border-radius:999px;background:rgba(10,14,18,.78);color:#f3efe6;font:600 13px/1.2 system-ui,sans-serif;pointer-events:none;opacity:0;transition:opacity .25s}.power-toast.on{opacity:1}`;
      document.head.appendChild(st);
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => el.classList.remove('on'), 2200);
  },
};

// Soft round particles: smoke and dust (normal blending) or fire and sparks (additive)
class Puffs {
  constructor(T, scene, N, additive) {
    this.N = N;
    this.next = 0;
    this.pos = new Float32Array(N * 3);
    this.col = new Float32Array(N * 4);
    this.size = new Float32Array(N);
    this.st = Array.from({ length: N }, () => ({ age: 1, life: 0, vx: 0, vy: 0, vz: 0, size: 1, grow: 0, alpha: 0, drag: 1, rise: 0.3 }));
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(this.pos, 3));
    geo.setAttribute('aCol', new T.BufferAttribute(this.col, 4));
    geo.setAttribute('aSize', new T.BufferAttribute(this.size, 1));
    const mat = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? T.AdditiveBlending : T.NormalBlending,
      vertexShader: `attribute vec4 aCol;attribute float aSize;varying vec4 vCol;
        void main(){vCol=aCol;vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=aSize*600./max(1.,-mv.z);}`,
      fragmentShader: `varying vec4 vCol;void main(){float d=length(gl_PointCoord-.5)*2.;float a=smoothstep(1.,.2,d)*vCol.a;if(a<.01)discard;gl_FragColor=vec4(vCol.rgb,a);}`,
    });
    this.points = new T.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
    this.points.visible = false;
    scene.add(this.points);
  }
  // rise: upward acceleration (smoke and flame climb, sparks pass a negative one to fall)
  emit(x, y, z, vx, vy, vz, life, size, col, alpha, grow = 1.6, drag = 1.2, rise = 0.3) {
    const i = this.next, s = this.st[i];
    this.next = (i + 1) % this.N;
    Object.assign(s, { age: 0, life, vx, vy, vz, size, grow, alpha, drag, rise });
    this.pos.set([x, y, z], i * 3);
    this.col.set([col[0], col[1], col[2], alpha], i * 4);
  }
  update(dt) {
    let live = 0;
    for (let i = 0; i < this.N; i++) {
      const s = this.st[i];
      if (s.age >= s.life) {
        this.size[i] = 0;
        continue;
      }
      live++;
      s.age += dt;
      const k = Math.exp(-dt * s.drag), o = i * 3;
      s.vx *= k;
      s.vz *= k;
      s.vy = s.vy * k + s.rise * dt;
      this.pos[o] += s.vx * dt;
      this.pos[o + 1] += s.vy * dt;
      this.pos[o + 2] += s.vz * dt;
      const t = s.age / s.life;
      this.size[i] = s.size * (1 + t * s.grow);
      this.col[i * 4 + 3] = s.alpha * Math.min(1, t * 8) * (1 - t);
    }
    this.points.visible = live > 0;
    if (!live) return;
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.aCol.needsUpdate = a.aSize.needsUpdate = true;
  }
}
