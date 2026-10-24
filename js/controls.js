// js/controls.js — three ways around town: walk (third-person figure), drive a kombi (left-hand traffic), fly
// (helicopter free flight, or the MapControls overview as "Map view"). Keyboard, mouse-drag orbit, touch (fed by
// js/features/game.js) and the Gamepad API all land in one input state. Cameras live in js/cameras.js.
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { groundY } from './util.js';
import { vehicleGeometry, lampGeometry } from './vehicles.js';
import { Player } from './player.js';
import { CameraRig } from './cameras.js';

const WALK_V = 1.7, RUN_V = 5.4, JUMP_V = 4.6, GRAV = 14;
const DRIVE_MAX = 24, BOOST_MAX = 36, REVERSE_MAX = 7;
const HALF_L = 2.45, HALF_W = 0.95;
const HELI_V = 28, HELI_FAST = 85;

const _v = new THREE.Vector3(), _look = { x: 0, y: 0 };

// Driver's-eye interior for the cockpit camera: dash, right-hand-drive wheel, pillars, a windscreen banner
// ("GOD IS ABLE", as on half the kombis in town) and beads swinging from the mirror
function buildCockpit() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: '#232326', roughness: 0.8 });
  const trim = new THREE.MeshStandardMaterial({ color: '#d9d6cf', roughness: 0.6 });
  const add = (geo, m, x, y, z, rx = 0) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.rotation.x = rx;
    g.add(o);
    return o;
  };
  add(new THREE.BoxGeometry(1.72, 0.2, 0.5), dark, 0, 1.0, 2.0, -0.12); // dash
  add(new THREE.BoxGeometry(0.5, 0.12, 0.2), dark, -0.42, 1.12, 1.82, -0.3); // instrument hood
  add(new THREE.TorusGeometry(0.19, 0.022, 6, 22), dark, -0.42, 1.08, 1.62, -0.5); // steering wheel (right-hand drive)
  add(new THREE.BoxGeometry(0.36, 0.03, 0.03), dark, -0.42, 1.08, 1.62, -0.5);
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.4).rotateX(Math.PI / 2 - 0.5), dark, -0.42, 1.0, 1.8);
  for (const s of [1, -1]) add(new THREE.BoxGeometry(0.07, 0.95, 0.07), trim, 0.86 * s, 1.55, 2.02, -0.32); // A-pillars
  add(new THREE.BoxGeometry(1.8, 0.16, 0.12), trim, 0, 1.98, 1.86); // header
  // Banner across the top of the windscreen
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 48;
  const x = cv.getContext('2d');
  x.fillStyle = '#121214';
  x.fillRect(0, 0, 512, 48);
  x.font = 'bold 30px system-ui, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillStyle = '#f2c318';
  x.fillText('GOD IS ABLE  \u2726  TOWN \u2013 MBARE', 256, 26);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const banner = add(new THREE.PlaneGeometry(1.5, 0.14), new THREE.MeshBasicMaterial({ map: tex }), 0, 1.86, 1.95);
  banner.rotation.y = Math.PI;
  add(new THREE.BoxGeometry(0.24, 0.07, 0.03), dark, 0, 1.8, 1.93); // mirror
  const beads = new THREE.MeshStandardMaterial({ color: '#b02a2a', roughness: 0.4 });
  for (let i = 0; i < 5; i++) add(new THREE.SphereGeometry(0.014, 6, 4), beads, 0, 1.75 - i * 0.03, 1.93);
  g.traverse((o) => (o.frustumCulled = false));
  return g;
}

export class Controls {
  constructor(camera, dom, scene, blocked) {
    this.camera = camera;
    this.dom = dom;
    this.blocked = blocked;
    this.mode = 'fly';
    this.keys = new Set();
    this.traffic = null; // set by game.js so the kombi can bump into other cars

    this.map = new MapControls(camera, dom);
    this.map.enableDamping = true;
    this.map.maxPolarAngle = Math.PI * 0.47;
    this.map.minDistance = 20;
    this.map.maxDistance = 3500;
    this.map.screenSpacePanning = false;

    // The follow camera also keeps clear of our own kombi while walking
    this.rig = new CameraRig(camera, dom, (x, z, y = 0) => blocked(x, z, y) || (this.mode === 'walk' && this.inKombi(x, z, 0.25, y - groundY(x, z) - 0.3)));
    this.rig.onChange = (p) => this.onCamera(p);

    // Walker
    this.walk = { x: 30, z: -20, y: 0, vy: 0, vx: 0, vz: 0, yaw: 0, air: false, speed: 0, turn: 0 };
    this.player = new Player(scene);

    // Player kombi: yaw group → lean pivot at axle height → body
    const body = new THREE.Mesh(vehicleGeometry('kombi'), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.3 }));
    this.lampMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    const lamps = new THREE.Mesh(lampGeometry('kombi'), this.lampMat);
    body.castShadow = true;
    body.position.y = lamps.position.y = -0.33;
    this.kombiBody = body;
    this.kombiLean = new THREE.Group();
    this.kombiLean.position.y = 0.33;
    this.kombiLean.add(body, lamps);
    this.cockpit = buildCockpit();
    this.cockpit.position.y = -0.33;
    this.cockpit.visible = false;
    this.kombiLean.add(this.cockpit);
    this.kombi = new THREE.Group();
    this.kombi.add(this.kombiLean);
    this.kombi.visible = false;
    scene.add(this.kombi);
    this.car = { x: 60, z: 75, yaw: -Math.PI / 2, v: 0, vx: 0, vz: 0, vl: 0, steer: 0, yawRate: 0, roll: 0, rollV: 0, pitch: 0, pitchV: 0, boost: false, hoot: 0, lastV: 0 };
    this.driven = false;

    // Helicopter (free flight)
    this.heli = { x: 0, y: 120, z: 0, yaw: 0, pitch: -0.25, vx: 0, vy: 0, vz: 0, bank: 0, tilt: 0 };
    this.camWritten = new THREE.Vector3(NaN, 0, 0);

    // Input state: keyboard + touch + gamepad merged each frame
    this.input = { fwd: 0, side: 0, up: 0, run: false, jump: false, brake: false, lookX: 0, lookY: 0 };
    this.touch = { x: 0, y: 0, run: false, jump: false, brake: false, up: 0 };
    this.pad = null;
    this.padPrev = [];
    this.jumpHeld = false;

    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      this.keys.add(e.code);
      if (e.repeat) return;
      if (e.code === 'KeyV') this.rig.next(e.shiftKey ? -1 : 1);
      if (e.code === 'KeyH' || e.code === 'KeyB') this.hoot();
      if (e.code === 'Space' && this.mode !== 'fly') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('gamepadconnected', (e) => (this.pad = e.gamepad.index));
    addEventListener('gamepaddisconnected', () => (this.pad = null));
  }

  onCamera(p) {
    this.map.enabled = this.mode === 'fly' && p.id === 'map';
    this.rig.focus = null;
    if (p.id !== 'pov') this.rig.setNear(1);
    if (this.mode === 'fly' && p.id === 'heli' && !this.settingMode) this.heliFromCamera();
    if (this.mode === 'fly' && p.id === 'map' && !this.settingMode) {
      // Look down at whatever was below us
      const h = this.heli;
      this.map.target.set(h.x + Math.sin(h.yaw) * 150, 0, h.z + Math.cos(h.yaw) * 150);
      this.map.update();
    }
    this.player.visible = this.mode === 'walk' && p.id !== 'pov';
    this.cockpit.visible = this.mode === 'drive' && p.id === 'pov';
    this.kombiBody.visible = !this.cockpit.visible;
    this.onCameraChange?.(p);
  }

  heliFromCamera() {
    const h = this.heli, c = this.camera;
    c.getWorldDirection(_v);
    h.x = c.position.x;
    h.y = Math.max(c.position.y, groundY(c.position.x, c.position.z) + 3);
    h.z = c.position.z;
    h.yaw = Math.atan2(_v.x, _v.z);
    h.pitch = THREE.MathUtils.clamp(Math.asin(_v.y), -1.2, 0.6);
    h.vx = h.vy = h.vz = h.bank = h.tilt = 0;
    this.writeHeliCamera();
  }

  hoot() {
    if (this.mode !== 'drive') return;
    this.car.hoot = 0.45;
    const p = this.position;
    dispatchEvent(new CustomEvent('harare:hoot', { detail: { x: p.x, z: p.z, mode: this.mode } }));
  }

  setMode(mode) {
    const prev = this.mode;
    this.mode = mode;
    if (document.pointerLockElement) document.exitPointerLock();
    const t = this.map.target;
    const w = this.walk, c = this.car;
    if (mode === 'walk') {
      if (prev === 'fly') (w.x = t.x), (w.z = t.z);
      if (prev === 'drive') {
        // Step out on the kerb side (left of the kombi)
        w.x = c.x + Math.cos(c.yaw) * 1.6;
        w.z = c.z - Math.sin(c.yaw) * 1.6;
        w.yaw = c.yaw;
        this.rig.yaw = c.yaw;
      }
      w.vx = w.vz = w.vy = 0;
      w.y = groundY(w.x, w.z) + 0.16;
      this.nudgeFree(w);
    }
    if (mode === 'drive') {
      if (prev === 'fly') (c.x = t.x), (c.z = t.z), (c.v = 0);
      if (prev === 'walk' && (!this.driven || Math.hypot(w.x - c.x, w.z - c.z) > 30)) {
        c.x = w.x + Math.cos(w.yaw) * 2.5;
        c.z = w.z - Math.sin(w.yaw) * 2.5;
        c.yaw = w.yaw;
        c.v = 0;
      }
      c.vx = c.vz = c.vl = 0;
      this.nudgeFree(c);
      this.driven = true;
      this.rig.yaw = c.yaw;
    }
    if (mode === 'fly') {
      const src = prev === 'walk' ? w : c;
      // Lift off behind and above the player, looking toward them
      const h = this.heli;
      h.yaw = prev === 'walk' ? this.rig.yaw : c.yaw;
      h.x = src.x - Math.sin(h.yaw) * 90;
      h.z = src.z - Math.cos(h.yaw) * 90;
      h.y = 75;
      h.pitch = -0.55;
      h.vx = h.vy = h.vz = 0;
      t.set(src.x, 0, src.z);
      this.camera.position.set(src.x + 120, 160, src.z + 180);
      this.map.update();
    }
    this.kombi.visible = this.driven;
    this.settingMode = true;
    this.rig.setKind(mode);
    this.settingMode = false;
    this.writeHeliCamera();
  }

  // Move the active player (walker, kombi or fly target) to (x, z), facing yaw (radians, 0 = south / +z)
  teleport(x, z, yaw) {
    const o = this.mode === 'walk' ? this.walk : this.mode === 'drive' ? this.car : null;
    if (o) {
      o.x = x;
      o.z = z;
      if (yaw !== undefined) (o.yaw = yaw), (this.rig.yaw = yaw), (this.rig.orbitYaw = 0);
      if (this.mode === 'drive') this.car.v = this.car.vx = this.car.vz = this.car.vl = 0;
      else this.walk.y = groundY(x, z) + 0.16;
      this.nudgeFree(o);
      this.rig.snapNext = true;
    } else if (this.rig.current.id === 'map') {
      const d = this.camera.position.clone().sub(this.map.target);
      this.map.target.set(x, 0, z);
      this.camera.position.set(x, 0, z).add(d);
      this.map.update();
    } else {
      const h = this.heli;
      h.x = x - Math.sin(h.yaw) * 80;
      h.z = z - Math.cos(h.yaw) * 80;
      if (yaw !== undefined) h.yaw = yaw;
      this.writeHeliCamera();
    }
  }

  // Spiral outward until we're not standing inside a building
  nudgeFree(o) {
    for (let r = 0; r < 200 && this.blocked(o.x, o.z); r += 2) {
      const a = r * 0.7;
      if (!this.blocked(o.x + Math.cos(a) * r, o.z + Math.sin(a) * r)) (o.x += Math.cos(a) * r), (o.z += Math.sin(a) * r);
    }
  }

  // Where the action is (shadow focus, HUD street name): the player, or the landmark a scenic camera looks at
  get position() {
    if (this.rig.focus) return this.rig.focus;
    if (this.mode === 'walk') return this.walk;
    if (this.mode === 'drive') return this.car;
    return this.rig.current.id === 'heli' ? this.heli : this.map.target;
  }

  // The player themself regardless of camera: walker, kombi, or helicopter / map target ({x, z, yaw?})
  get playerState() {
    if (this.mode === 'walk') return this.walk;
    if (this.mode === 'drive') return this.car;
    return this.rig.current.id === 'map' ? this.map.target : this.heli;
  }

  // Player speed in m/s (for audio / HUD)
  get speed() {
    if (this.mode === 'walk') return this.walk.speed;
    if (this.mode === 'drive') return Math.abs(this.car.v);
    if (this.rig.current.id === 'heli') return Math.hypot(this.heli.vx, this.heli.vy, this.heli.vz);
    return 0;
  }
  get boosting() {
    return this.mode === 'drive' ? this.car.boost : this.mode === 'walk' ? this.walk.speed > 3.2 : this.input.run;
  }
  get maxSpeed() {
    return this.mode === 'drive' ? (this.car.boost ? BOOST_MAX : DRIVE_MAX) : this.mode === 'walk' ? RUN_V : HELI_FAST;
  }
  get altitude() {
    if (this.mode !== 'fly') return 0;
    const p = this.rig.current.id === 'heli' ? this.heli : this.camera.position;
    return p.y - groundY(p.x, p.z);
  }

  readInput(dt) {
    const k = this.keys, I = this.input, T = this.touch;
    const kf = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const ks = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    I.fwd = kf - T.y;
    I.side = ks + T.x;
    I.up = (k.has('KeyE') || k.has('PageUp') ? 1 : 0) - (k.has('KeyQ') || k.has('PageDown') ? 1 : 0) + T.up;
    I.run = k.has('ShiftLeft') || k.has('ShiftRight') || T.run;
    I.jump = k.has('Space') || T.jump;
    I.brake = k.has('Space') || T.brake;
    I.lookX = I.lookY = 0;
    // Gamepad: left stick move, right stick camera, RT/LT throttle/brake, A jump/handbrake, B hoot, X boost,
    // Y / bumpers cycle cameras
    if (this.pad !== null) {
      const gp = navigator.getGamepads?.()[this.pad];
      if (gp) {
        const dz = (v) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
        const ax = gp.axes, b = gp.buttons;
        const btn = (i) => !!b[i]?.pressed;
        const val = (i) => b[i]?.value || 0;
        I.side += dz(ax[0] || 0);
        if (this.mode === 'drive') I.fwd += val(7) - val(6);
        else I.fwd -= dz(ax[1] || 0);
        if (this.mode === 'fly') I.up += val(7) - val(6);
        I.lookX = dz(ax[2] || 0);
        I.lookY = dz(ax[3] || 0);
        I.run ||= btn(2) || btn(10);
        I.jump ||= btn(0);
        I.brake ||= btn(0);
        const P = this.padPrev;
        const edge = (i) => btn(i) && !P[i];
        if (edge(1)) this.hoot();
        if (edge(3) || edge(5)) this.rig.next(1);
        if (edge(4)) this.rig.next(-1);
        for (let i = 0; i < b.length; i++) P[i] = btn(i);
      }
    }
    I.fwd = THREE.MathUtils.clamp(I.fwd, -1, 1);
    I.side = THREE.MathUtils.clamp(I.side, -1, 1);
    I.up = THREE.MathUtils.clamp(I.up, -1, 1);
  }

  update(dt, nightness) {
    dt = Math.min(dt, 0.1);
    this.readInput(dt);
    this.nightness = nightness;
    const I = this.input;
    const preset = this.rig.current;

    if (this.mode === 'fly') {
      if (preset.id === 'map') this.updateMap(dt);
      else if (preset.id === 'heli') this.updateHeli(dt);
      else this.updateHeli(dt, true), this.rig.update(dt, this.heliTarget(), I);
    } else if (this.mode === 'walk') {
      this.updateWalk(dt);
      const w = this.walk;
      this.rig.update(dt, this.followTarget('walk', w.x, w.y, w.z, w.yaw, w.speed), I);
    } else {
      this.updateDrive(dt);
      const c = this.car;
      this.rig.update(dt, this.followTarget('drive', c.x, groundY(c.x, c.z) + 0.22, c.z, c.yaw, Math.abs(c.v)), I);
    }
    this.updateKombiLamps();
  }

  followTarget(kind, x, y, z, yaw, speed) {
    const t = (this._ft ||= {});
    t.kind = kind;
    t.x = x;
    t.y = y;
    t.z = z;
    t.yaw = yaw;
    t.speed = speed;
    t.boost = kind === 'drive' && this.car.boost;
    t.vx = kind === 'drive' ? this.car.vx : undefined;
    t.vz = kind === 'drive' ? this.car.vz : undefined;
    t.reverse = kind === 'drive' && this.car.v < -0.5;
    return t;
  }

  heliTarget() {
    const h = this.heli;
    return this.followTarget('fly', h.x, groundY(h.x, h.z), h.z, h.yaw, 0);
  }

  updateMap(dt) {
    const I = this.input;
    if (I.fwd || I.side || I.up) {
      const dir = _v;
      this.camera.getWorldDirection(dir);
      dir.y = 0;
      dir.normalize();
      const sp = Math.max(40, this.camera.position.y) * dt * 1.2 * (I.run ? 2.5 : 1);
      const mx = dir.x * I.fwd * sp - dir.z * I.side * sp, mz = dir.z * I.fwd * sp + dir.x * I.side * sp;
      this.camera.position.x += mx;
      this.camera.position.z += mz;
      this.map.target.x += mx;
      this.map.target.z += mz;
      this.camera.position.y = Math.max(25, this.camera.position.y + I.up * sp);
    }
    this.map.update();
    this.rig.setFov(55);
  }

  // Helicopter-ish: drag / right stick to look, WASD move on the horizontal plane, Q/E (or Space/C) altitude,
  // Shift fast. Banks into strafes, noses down when accelerating. `still` = keep simulating but don't own the camera.
  updateHeli(dt, still = false) {
    const h = this.heli, I = this.input, c = this.camera;
    // Someone else (tools/shot.mjs setCamera, a feature) moved the camera: hand over to Map view
    if (!still && this.camWritten.distanceToSquared(c.position) > 1e-4) {
      this.rig.select('map');
      return this.updateMap(dt);
    }
    if (!still) {
      this.rig.takeLook(_look);
      h.yaw -= _look.x * 0.0035 + I.lookX * dt * 1.8;
      h.pitch = THREE.MathUtils.clamp(h.pitch - _look.y * 0.003 - I.lookY * dt * 1.4, -1.35, 0.9);
      // Arrow-key / A-D-only turning when not strafing with the mouse: A/D yaw, mouse drag strafes are rare in heli
      h.yaw -= I.side * dt * 1.1;
    }
    const fast = I.run ? HELI_FAST : HELI_V;
    const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw);
    const up = I.up + (this.keys.has('Space') ? 1 : 0) - (this.keys.has('KeyC') ? 1 : 0);
    const tx = fx * I.fwd * fast, tz = fz * I.fwd * fast, ty = THREE.MathUtils.clamp(up, -1, 1) * fast * 0.6;
    const a = Math.min(1, dt * 1.6);
    h.vx += (tx - h.vx) * a;
    h.vz += (tz - h.vz) * a;
    h.vy += (ty - h.vy) * Math.min(1, dt * 2.5);
    let nx = h.x + h.vx * dt, ny = h.y + h.vy * dt, nz = h.z + h.vz * dt;
    if (this.blocked(nx, nz, ny - 2)) {
      // Rooftop or wall: try sliding, else stop dead
      if (!this.blocked(nx, h.z, ny - 2)) nz = h.z, (h.vz = 0);
      else if (!this.blocked(h.x, nz, ny - 2)) nx = h.x, (h.vx = 0);
      else (nx = h.x), (nz = h.z), (h.vx = h.vz = 0), (ny = Math.max(ny, h.y));
    }
    h.x = nx;
    h.z = nz;
    h.y = THREE.MathUtils.clamp(ny, groundY(nx, nz) + 2.5, 2500);
    // Attitude: bank into turns, tilt with forward acceleration
    const fwdV = h.vx * fx + h.vz * fz;
    h.bank += (I.side * 0.22 - h.bank) * Math.min(1, dt * 3);
    h.tilt += ((tx * fx + tz * fz - fwdV) * -0.004 - h.tilt) * Math.min(1, dt * 3);
    if (still) return;
    c.position.set(h.x, h.y, h.z);
    c.rotation.set(h.pitch + h.tilt, h.yaw + Math.PI, -h.bank, 'YXZ');
    this.rig.setFov(60 + Math.min(12, Math.hypot(h.vx, h.vz) * 0.12), dt);
    this.camWritten.copy(c.position);
  }

  writeHeliCamera() {
    if (this.mode !== 'fly' || this.rig.current.id !== 'heli') return;
    const h = this.heli, c = this.camera;
    c.position.set(h.x, h.y, h.z);
    c.rotation.set(h.pitch, h.yaw + Math.PI, 0, 'YXZ');
    c.updateMatrixWorld();
    this.camWritten.copy(c.position);
  }

  updateWalk(dt) {
    const w = this.walk, I = this.input;
    // Move relative to where the camera is looking
    const hy = this.rig.current.type === 'follow' ? this.rig.yaw : this.rig.heading();
    const fx = Math.sin(hy), fz = Math.cos(hy);
    let mx = fx * I.fwd - fz * I.side, mz = fz * I.fwd + fx * I.side;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) (mx /= ml), (mz /= ml);
    const vmax = I.run ? RUN_V : WALK_V;
    const acc = Math.min(1, dt * (w.air ? 2 : 10));
    w.vx += (mx * vmax - w.vx) * acc;
    w.vz += (mz * vmax - w.vz) * acc;
    // Collide (radius ~0.3 m) one axis at a time so we slide along walls
    const r = 0.3;
    const nx = w.x + w.vx * dt, nz = w.z + w.vz * dt;
    const feet = w.y - groundY(w.x, w.z);
    if (!this.blocked(nx + Math.sign(w.vx) * r, w.z, feet) && !this.inKombi(nx, w.z, r, feet)) w.x = nx;
    else w.vx = 0;
    if (!this.blocked(w.x, nz + Math.sign(w.vz) * r, feet) && !this.inKombi(w.x, nz, r, feet)) w.z = nz;
    else w.vz = 0;
    // Jump / gravity
    const gy = groundY(w.x, w.z) + 0.16;
    if (!w.air && I.jump && !this.jumpHeld) (w.vy = JUMP_V), (w.air = true), dispatchEvent(new CustomEvent('harare:jump'));
    this.jumpHeld = I.jump;
    if (w.air) {
      w.vy -= GRAV * dt;
      w.y += w.vy * dt;
      if (w.y <= gy) (w.y = gy), (w.vy = 0), (w.air = false), dispatchEvent(new CustomEvent('harare:step', { detail: { run: true, land: true } }));
    } else w.y = gy;
    w.speed = Math.hypot(w.vx, w.vz);
    // Face the direction of travel
    let turn = 0;
    if (w.speed > 0.2) {
      let d = Math.atan2(w.vx, w.vz) - w.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      turn = d * Math.min(1, dt * 10);
      w.yaw += turn;
    }
    w.turn = turn / Math.max(dt, 1e-4);
    this.player.update(dt, w.x, w.y, w.z, w.yaw, w.air ? 0 : w.speed, w.air, w.turn);
  }

  // Is a walker of radius r at (x, z) inside the parked kombi? (feet above the roof: no — you can stand on it)
  inKombi(x, z, r, feet) {
    if (!this.kombi.visible || feet > 2.0) return false; // walkers can't reach the roof, but cameras can pass over it
    const c = this.car, dx = x - c.x, dz = z - c.z;
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    return Math.abs(dx * fx + dz * fz) < HALF_L + r && Math.abs(dx * fz - dz * fx) < HALF_W + r;
  }

  updateDrive(dt) {
    const c = this.car, I = this.input;
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    // Body-frame velocity: forward v, lateral vl (left = (fz, -fx))
    let v = c.vx * fx + c.vz * fz;
    let vl = c.vx * fz - c.vz * fx;
    c.boost = I.run && I.fwd > 0;
    const vmax = c.boost ? BOOST_MAX : DRIVE_MAX;
    const thr = I.fwd;
    if (thr > 0) {
      if (v < -0.5) v += 16 * thr * dt;
      else v += (c.boost ? 9.5 : 5.8) * thr * dt * Math.max(0, 1 - (v / vmax) ** 2);
    } else if (thr < 0) {
      if (v > 0.5) v -= 15 * -thr * dt;
      else v = Math.max(-REVERSE_MAX, v - 4.2 * -thr * dt);
    }
    // Rolling resistance + air drag
    const drag = (thr === 0 ? 1.6 : 0.2) + 0.0035 * v * v;
    v -= Math.sign(v) * Math.min(Math.abs(v), drag * dt);
    if (v > vmax) v -= Math.min(v - vmax, 6 * dt); // boost released: settle back
    const hand = I.brake;
    if (hand) v -= Math.sign(v) * Math.min(Math.abs(v), 11 * dt);

    // Steering: less lock at speed, quick to centre
    const lock = 0.6 / (1 + Math.abs(v) * 0.075);
    const want = -I.side * lock;
    c.steer += (want - c.steer) * Math.min(1, dt * (want === 0 ? 8 : 5));
    // Yaw from bicycle model (wheelbase 2.6 m); handbrake lets the tail come round
    const yawTarget = (v / 2.6) * Math.tan(c.steer) * (hand ? 1.35 : 1);
    c.yawRate += (yawTarget - c.yawRate) * Math.min(1, dt * 7);
    c.yaw += c.yawRate * dt;
    // Grip: lateral slip decays; low grip on the handbrake or at high boost speed → a little drift
    const grip = hand ? 1.6 : 7 - Math.min(3, Math.max(0, Math.abs(v) - 18) * 0.2);
    // Re-project the world velocity onto the new heading so slip appears naturally
    const nfx = Math.sin(c.yaw), nfz = Math.cos(c.yaw);
    const wx = fx * v + fz * vl, wz = fz * v - fx * vl;
    v = wx * nfx + wz * nfz;
    vl = (wx * nfz - wz * nfx) * Math.exp(-grip * dt);
    c.vx = nfx * v + nfz * vl;
    c.vz = nfz * v - nfx * vl;

    // Move with collision: buildings via the footprint test at the leading corners, then other traffic
    let nx = c.x + c.vx * dt, nz = c.z + c.vz * dt;
    const impact = this.carHits(nx, nz, c.yaw, v);
    if (impact) {
      // Try sliding along one axis before giving up
      if (!this.carHits(nx, c.z, c.yaw, v)) (nz = c.z), (c.vz *= 0.3);
      else if (!this.carHits(c.x, nz, c.yaw, v)) (nx = c.x), (c.vx *= 0.3);
      else {
        nx = c.x;
        nz = c.z;
        if (Math.abs(v) > 6) this.crash(Math.abs(v));
        c.vx *= -0.25;
        c.vz *= -0.25;
      }
      if (Math.abs(v) > 9) this.crash(Math.abs(v) * 0.5);
      v = c.vx * nfx + c.vz * nfz;
    }
    c.x = nx;
    c.z = nz;
    this.bumpTraffic(c, nfx, nfz);
    c.v = c.vx * nfx + c.vz * nfz;

    // Body roll (into the outside of the turn) and pitch (dive on braking, squat on throttle), sprung
    const accel = (c.v - c.lastV) / Math.max(dt, 1e-3);
    c.lastV = c.v;
    const rollT = THREE.MathUtils.clamp(c.v * c.yawRate * 0.011, -0.085, 0.085);
    const pitchT = THREE.MathUtils.clamp(-accel * 0.0065, -0.05, 0.06);
    c.rollV += ((rollT - c.roll) * 90 - c.rollV * 11) * dt;
    c.roll += c.rollV * dt;
    c.pitchV += ((pitchT - c.pitch) * 80 - c.pitchV * 10) * dt;
    c.pitch += c.pitchV * dt;

    const y = groundY(c.x, c.z) + 0.22;
    this.kombi.position.set(c.x, y, c.z);
    this.kombi.rotation.set(0, c.yaw, 0);
    this.kombiLean.rotation.set(c.pitch, 0, c.roll);
    c.hoot = Math.max(0, c.hoot - dt);
  }

  // Does the kombi overlap a building at (x, z) heading yaw? Probes the leading corners and the sides.
  carHits(x, z, yaw, v) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const s = v >= 0 ? 1 : -1;
    const lx = fz, lz = -fx;
    const L = HALF_L * s;
    return (
      this.blocked(x + fx * L + lx * HALF_W, z + fz * L + lz * HALF_W) ||
      this.blocked(x + fx * L - lx * HALF_W, z + fz * L - lz * HALF_W) ||
      this.blocked(x + fx * L * 0.1 + lx * HALF_W, z + fz * L * 0.1 + lz * HALF_W) ||
      this.blocked(x + fx * L * 0.1 - lx * HALF_W, z + fz * L * 0.1 - lz * HALF_W)
    );
  }

  // Shove out of other vehicles (each approximated by two circles along its axis), losing speed into them
  bumpTraffic(c, fx, fz) {
    const cars = this.traffic?.cars;
    if (!cars) return;
    for (let i = 0; i < cars.length; i++) {
      const o = cars[i];
      if (!o.init) continue;
      const dx0 = o.x - c.x, dz0 = o.z - c.z;
      if (dx0 * dx0 + dz0 * dz0 > 200) continue;
      const ox = Math.sin(o.h), oz = Math.cos(o.h), oh = (o.len || 4.5) * 0.25;
      for (let a = -1; a <= 1; a += 2) {
        for (let b = -1; b <= 1; b += 2) {
          const px = c.x + fx * 1.25 * a, pz = c.z + fz * 1.25 * a;
          const qx = o.x + ox * oh * b, qz = o.z + oz * oh * b;
          const dx = px - qx, dz = pz - qz, d2 = dx * dx + dz * dz, R = 2.0;
          if (d2 >= R * R || d2 < 1e-6) continue;
          const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, pen = R - d;
          c.x += nx * pen;
          c.z += nz * pen;
          const vn = c.vx * nx + c.vz * nz;
          if (vn < 0) {
            c.vx -= nx * vn * 1.3;
            c.vz -= nz * vn * 1.3;
            if (-vn > 5) this.crash(-vn);
          }
        }
      }
    }
  }

  crash(strength) {
    this.rig.shake = Math.min(1, strength / 14);
    const now = performance.now();
    if (now - (this._lastCrash || 0) < 400) return;
    this._lastCrash = now;
    dispatchEvent(new CustomEvent('harare:crash', { detail: { strength } }));
  }

  updateKombiLamps() {
    if (!this.kombi.visible) return;
    const c = this.car;
    // Hooter: flash the lamps (headlights double-flash)
    const flash = c.hoot > 0 ? (Math.sin(c.hoot * 40) > 0 ? 3 : 0) : 0;
    this.lampMat.color.setScalar(0.35 + (this.nightness || 0) * 2.2 + flash);
  }
}
