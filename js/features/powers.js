// js/features/powers.js — hero superpowers, cartoon rules: nobody gets hurt and the city repairs itself.
//  G  lift the nearest car or kombi overhead (on foot or in flight), G again throws it where the camera looks.
//  X  in flight: slam straight down, a shockwave scaled by the fall that flips nearby cars and scatters the crowd.
//     On foot: a smaller stomp.
// A lifted vehicle leaves the traffic simulation and is drawn here as a standalone prop with full tumbling physics.
// Wrecks smoke for a while, then fold away in a puff of dust and the car rejoins traffic somewhere out of sight.
import { gltfLoader } from '../gltf-loader.js';
import { vehicleGeometry, VEHICLE_TYPES, ATLAS, ROUTES } from '../vehicles.js';
import { groundY } from '../util.js';

const MAX_PROPS = 10, GRAVITY = 22, ROAD_Y = 0.22, WRECK_LIFE = 14, GRAB_REACH = 2.6;
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
    for (const [type, file] of Object.entries(GLB)) glb(file).then((g) => g && (this.models[type] = g.scene));
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

  // --- the hero ------------------------------------------------------------------------------------------------------
  hero() {
    const c = this.ctx.controls;
    if (c.mode === 'walk') return { x: c.walk.x, y: c.walk.y, z: c.walk.z, yaw: c.walk.yaw, vx: c.walk.vx || 0, vy: c.walk.vy || 0, vz: c.walk.vz || 0 };
    if (c.mode === 'fly' && c.rig.current.id !== 'map') { const h = c.heli; return { x: h.x, y: h.y, z: h.z, yaw: h.yaw, vx: h.vx, vy: h.vy, vz: h.vz }; }
    return null;
  },

  grab() {
    if (this.held) return this.throw();
    const me = this.hero();
    if (!me) return;
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
    if (!best) return this.toast(this.ctx.controls.mode === 'fly' ? 'Fly down next to a car to lift it' : 'Walk up to a car to lift it');
    const p = this.spawnProp(best.car, best.parked, best.base);
    if (!p) return;
    p.state = 'held';
    p.lift = 0;
    this.held = p;
    this.say('lift');
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
    this.say('throw');
  },

  slam() {
    const c = this.ctx.controls, me = this.hero();
    if (!me) return;
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
    if (c.walk.air) return;
    dispatchEvent(new CustomEvent('harare:hero-burst', { detail: { x: me.x, y: me.y - 0.16, z: me.z, kind: 'land' } }));
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

  // --- props ---------------------------------------------------------------------------------------------------------
  spawnProp(car, parked, base) {
    const T = this.T, tr = this.ctx.traffic;
    if (this.props.length >= MAX_PROPS) {
      const old = this.props.find((p) => p.state === 'rest');
      if (!old) return null;
      this.removeProp(old);
    }
    const type = car.type || 'kombi', color = car.color || '#f2f1ec';
    const group = new T.Group(), body = this.makeBody(type, color);
    const box = new T.Box3().setFromObject(body.root), size = box.getSize(new T.Vector3()), centre = box.getCenter(new T.Vector3());
    body.root.position.sub(centre); // pivot on the middle of the body so it tumbles about its centre of mass
    group.add(body.root);
    group.position.set(car.x, base + centre.y, car.z);
    group.rotation.y = car.h;
    this.ctx.scene.add(group);
    tr.take(car, 1e9);
    const p = {
      car, parked, type, group, body, half: size.multiplyScalar(0.5), vel: new T.Vector3(), spin: new T.Vector3(),
      state: 'air', life: WRECK_LIFE, damage: 0, smokeT: 0, settle: 0, from: group.position.clone(), fromQ: group.quaternion.clone(),
    };
    this.props.push(p);
    return p;
  },

  makeBody(type, color) {
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
      return { root: wrap, damage: (k) => paint.forEach((m) => m.color.multiplyScalar(k)), dispose: () => mats.forEach((m) => m.dispose()) };
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
    return { root: wrap, damage: (k) => (c.multiplyScalar(k), mesh.setColorAt(0, c), (mesh.instanceColor.needsUpdate = true)), dispose: () => geo.dispose() };
  },

  removeProp(p) {
    this.ctx.scene.remove(p.group);
    p.body.dispose();
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

  update(dt) {
    dt = Math.min(dt, 0.05);
    const c = this.ctx.controls, me = this.hero(), T = this.T, v = this.v;
    if (this.held && !me) this.throw(); // switched to the taxi or the map with a car overhead: drop it
    const carry = this.held ? Math.min(2.6, Math.max(1, this.held.half.z / 2.45)) : 0; // a bus needs more room than a Fit
    c.rig.carry = (c.rig.carry || 0) + (carry - (c.rig.carry || 0)) * (1 - Math.exp(-dt * 4));
    for (const p of [...this.props]) {
      const g = p.group;
      if (p.state === 'held') {
        // Rise from the street into a press overhead, then ride along above the hero's head
        p.lift = Math.min(1, p.lift + dt / 0.45);
        const k = p.lift * p.lift * (3 - 2 * p.lift);
        const ahead = p.half.z * 0.55; // pressed up and forward: the hero stays in view below its tail
        v.a.set(me.x + Math.sin(me.yaw) * ahead, me.y + 2.05 + p.half.y, me.z + Math.cos(me.yaw) * ahead);
        g.position.lerpVectors(p.from, v.a, k);
        v.q.setFromEuler(v.e.set(0, me.yaw, 0)); // carried front-to-back: from the chase camera you see its tail, not a wall
        g.quaternion.slerpQuaternions(p.fromQ, v.q, k);
        if (p.lift >= 1) (p.from.copy(g.position), p.fromQ.copy(g.quaternion));
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
        p.settle = Math.min(1, p.settle + dt / 0.35);
        g.quaternion.slerpQuaternions(p.fromQ, p.restQ, p.settle);
        g.position.y = p.restY;
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
    this.updateParticles(dt);
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
    const T = this.T, N = (this.pN = 400), geo = new T.BufferGeometry();
    this.pPos = new Float32Array(N * 3);
    this.pCol = new Float32Array(N * 4);
    this.pSize = new Float32Array(N);
    this.pState = Array.from({ length: N }, () => ({ age: 1, life: 0, vx: 0, vy: 0, vz: 0, size: 1, grow: 0, alpha: 0, drag: 1 }));
    geo.setAttribute('position', new T.BufferAttribute(this.pPos, 3));
    geo.setAttribute('aCol', new T.BufferAttribute(this.pCol, 4));
    geo.setAttribute('aSize', new T.BufferAttribute(this.pSize, 1));
    const mat = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: `attribute vec4 aCol;attribute float aSize;varying vec4 vCol;
        void main(){vCol=aCol;vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=aSize*600./max(1.,-mv.z);}`,
      fragmentShader: `varying vec4 vCol;void main(){float d=length(gl_PointCoord-.5)*2.;float a=smoothstep(1.,.2,d)*vCol.a;if(a<.01)discard;gl_FragColor=vec4(vCol.rgb,a);}`,
    });
    this.points = new T.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.name = 'power-particles';
    this.ctx.scene.add(this.points);
    this.pNext = 0;
  },

  emit(x, y, z, vx, vy, vz, life, size, col, alpha, grow = 1.6, drag = 1.2) {
    const i = this.pNext, s = this.pState[i];
    this.pNext = (i + 1) % this.pN;
    Object.assign(s, { age: 0, life, vx, vy, vz, size, grow, alpha, drag });
    this.pPos.set([x, y, z], i * 3);
    this.pCol.set([col[0], col[1], col[2], alpha], i * 4);
  },

  dust(x, y, z, count, speed, col) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.6), t = 0.6 + Math.random() * 0.5;
      this.emit(x + Math.cos(a) * 0.6, y + 0.3, z + Math.sin(a) * 0.6, Math.cos(a) * s, 0.6 + Math.random() * speed * 0.25, Math.sin(a) * s, 1.1 + Math.random() * 0.9, 1.2 + Math.random(), [col[0] * t + 0.1, col[1] * t + 0.1, col[2] * t + 0.1], 0.6, 2.2, 2.8);
    }
  },

  updateParticles(dt) {
    let live = 0;
    for (let i = 0; i < this.pN; i++) {
      const s = this.pState[i];
      if (s.age >= s.life) {
        this.pSize[i] = 0;
        continue;
      }
      live++;
      s.age += dt;
      const k = Math.exp(-dt * s.drag), o = i * 3;
      s.vx *= k;
      s.vz *= k;
      s.vy = s.vy * k + 0.3 * dt;
      this.pPos[o] += s.vx * dt;
      this.pPos[o + 1] += s.vy * dt;
      this.pPos[o + 2] += s.vz * dt;
      const t = s.age / s.life;
      this.pSize[i] = s.size * (1 + t * s.grow);
      this.pCol[i * 4 + 3] = s.alpha * Math.min(1, t * 8) * (1 - t);
    }
    this.points.visible = live > 0;
    if (!live) return;
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.aCol.needsUpdate = a.aSize.needsUpdate = true;
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
      st.textContent = `.power-toast{position:fixed;left:50%;top:58%;transform:translateX(-50%);z-index:30;padding:8px 14px;border-radius:999px;background:rgba(10,14,18,.78);color:#f3efe6;font:600 13px/1.2 system-ui,sans-serif;pointer-events:none;opacity:0;transition:opacity .25s}.power-toast.on{opacity:1}`;
      document.head.appendChild(st);
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => el.classList.remove('on'), 2200);
  },
};
