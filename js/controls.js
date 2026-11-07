// js/controls.js — three ways around town: walk (third-person figure), drive a kombi (left-hand traffic), fly
// (helicopter free flight, or the MapControls overview as "Map view"). Keyboard, mouse-drag orbit, touch (fed by
// js/features/game.js) and the Gamepad API all land in one input state. Cameras live in js/cameras.js.
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { groundY } from './util.js';
import { sweepPose } from './collision.js';
import { PlayerKombi } from './player-kombi.js';
import { Player } from './player.js';
import { createRoadster } from './roadster.js';
import { Flight } from './game/flight.js';
import { CameraRig } from './cameras.js';

const WALK_V = 1.7, RUN_V = 6.2, JUMP_V = 4.6, GRAV = 14;
const DRIVE_MAX = 24, BOOST_MAX = 36, REVERSE_MAX = 7;
const HALF_L = 2.45, HALF_W = 0.95;
const HELI_V = 24, HELI_FAST = 58;

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

    // Player kombi: yaw group → lean pivot at axle height → body (the traffic model, material and lamps)
    this.pk = new PlayerKombi(scene, { color: '#f2f1ec', plate: 17, opt: 1, dirt: 0.2, route: 'MBARE' });
    const body = this.pk.mesh;
    body.position.y = -0.33;
    this.kombiBody = body;
    this.kombiLean = new THREE.Group();
    this.kombiLean.position.y = 0.33;
    this.kombiLean.add(body);
    this.cockpit = buildCockpit();
    this.cockpit.position.y = -0.33;
    this.cockpit.visible = false;
    this.kombiLean.add(this.cockpit);
    this.kombi = new THREE.Group();
    this.kombi.add(this.kombiLean);
    this.kombi.visible = false;
    scene.add(this.kombi);
    this.car = { x: 60, z: 75, yaw: -Math.PI / 2, v: 0, vx: 0, vz: 0, vl: 0, steer: 0, yawRate: 0, roll: 0, rollV: 0, pitch: 0, pitchV: 0, boost: false, hoot: 0, lastV: 0, brake: 0, ind: 0, indT: 0 };
    this.vehicleType='kombi';this.flight=new Flight();
    this.roadster=createRoadster(scene);this.roadster.root.position.y=-.33;this.roadster.root.visible=false;this.kombiLean.add(this.roadster.root);
    this.car.len=4.9;this.car.width=1.9;this.car.alt=0;
    addEventListener('keydown',e=>{if(e.code==='KeyF'&&!e.repeat&&!/INPUT|TEXTAREA|SELECT/.test(e.target?.tagName))this.toggleFlight();});
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
      if (/INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName) || e.target.closest?.('[popover]:popover-open')) return;
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
    if(this.vehicleType==='roadster'&&this.mode==='drive'&&p.id==='pov'){this.rig.select('chase');return;}
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
    this.player.visible = (this.mode === 'walk' && p.id !== 'pov') || (this.mode === 'fly' && p.id !== 'map');
    this.cockpit.visible = this.mode === 'drive' && p.id === 'pov';
    this.kombiBody.visible = !this.cockpit.visible && this.vehicleType!=='roadster';
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
    if((this.car?.alt||0)>.01 && mode!==this.mode)return false;
    const prev = this.mode;
    if (this.flightStarted && prev === 'fly' && mode === 'fly') { if(this.heli.phase!=='impact')this.heli.landing = null; return; }
    if(prev==='fly' && ['charge','impact'].includes(this.heli.phase))return false;
    if (this.flightStarted && prev === 'fly' && mode !== 'fly' && this.rig.current.id !== 'map' && this.heli.y > groundY(this.heli.x,this.heli.z)+.22) {
      this.heli.landing = mode;
      dispatchEvent(new CustomEvent('harare:landing'));
      return false;
    }
    this.mode = mode;
    const t = this.map.target;
    const w = this.walk, c = this.car;
    if (mode === 'walk') {
      if (prev === 'fly') { w.yaw=this.heli.yaw;this.rig.yaw=w.yaw;w.x=this.rig.current.id==='map'?t.x:this.heli.x;w.z=this.rig.current.id==='map'?t.z:this.heli.z; }
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
      if (prev === 'fly') this.placeCarOnRoad(this.heli.x, this.heli.z, this.heli.yaw);
      if (prev === 'walk' && (!this.driven || Math.hypot(w.x - c.x, w.z - c.z) > 30)) this.placeCarOnRoad(w.x + Math.cos(w.yaw) * 2.5, w.z - Math.sin(w.yaw) * 2.5, w.yaw);
      c.vx = c.vz = c.vl = 0;
      this.nudgeFree(c);
      this.driven = true;
      this.rig.yaw = c.yaw;
    }
    if (mode === 'fly') {
      this.flightStarted=true;
      const src = prev === 'walk' ? w : c;
      // Lift off behind and above the player, looking toward them
      const h = this.heli;
      h.yaw = prev === 'walk' ? this.rig.yaw : c.yaw;
      h.x = src.x;
      h.z = src.z;
      h.y = groundY(src.x,src.z)+.16;
      h.landing=null;h.bank=0;h.tilt=0;h.phase='charge';h.phaseTime=0;
      h.pitch = -0.12;
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
    if(this.car.alt>.01)return false;
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

  // Spawn/teleport clear of walls with room for the actor's whole body.
  nudgeFree(o) {
    const hit=(x,z)=>o===this.car?this.carHits(x,z,o.yaw)||!!this.contacts?.carBlocked(x,z,o.yaw,o.len/2,o.width/2,o,false):this.walkHits(x,z,.3,0,o);
    if(!hit(o.x,o.z))return;
    const ox=o.x,oz=o.z;
    for(let r=.5;r<100;r+=.5)for(let k=0;k<16;k++) {
      const x=ox+Math.cos(k*Math.PI/8)*r,z=oz+Math.sin(k*Math.PI/8)*r;
      if(!hit(x,z)){o.x=x;o.z=z;return;}
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

  // A summoned kombi appears in the nearest road's left lane, facing closest to the player's heading, never on the pavement
  placeCarOnRoad(x, z, yaw) {
    const c = this.car, r = this.roadSnap?.(x, z);
    c.v = 0;
    if (!r || (!r.dx && !r.dz) || Math.hypot(r.x - x, r.z - z) > 60) return void ((c.x = x), (c.z = z), (c.yaw = yaw));
    const L = Math.hypot(r.dx, r.dz);
    let dx = r.dx / L, dz = r.dz / L;
    if (!r.o && Math.sin(yaw) * dx + Math.cos(yaw) * dz < 0) (dx = -dx), (dz = -dz);
    const off = r.o ? 0 : Math.min(3, r.w / 4);
    c.x = r.x + dz * off;
    c.z = r.z - dx * off;
    c.yaw = Math.atan2(dx, dz);
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
    return this.mode === 'drive' ? (this.vehicleType==='roadster'?(this.car.boost?44:32):(this.car.boost ? BOOST_MAX : DRIVE_MAX)) : this.mode === 'walk' ? RUN_V : HELI_FAST;
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
      if(preset.id!=='map'){const h=this.heli,hs=Math.hypot(h.vx,h.vz);this.player.flightAction={phase:h.phase,time:h.phaseTime,landing:!!h.landing,climb:hs+Math.abs(h.vy)>2?Math.atan2(h.vy,hs):0};this.player.update(dt,h.x,h.y,h.z,h.yaw,Math.hypot(hs,h.vy),false,h.bank,true);}
    } else if (this.mode === 'walk') {
      this.updateWalk(dt);
      const w = this.walk;
      this.rig.update(dt, this.followTarget('walk', w.x, w.y, w.z, w.yaw, w.speed), I);
    } else {
      this.updateDrive(dt);
      const c = this.car;
      this.rig.update(dt, this.followTarget('drive', c.x, groundY(c.x, c.z) + 0.22 + (c.alt||0), c.z, c.yaw, Math.abs(c.v)), I);
    }
    this.updateKombiLamps(dt);
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
    return this.followTarget('fly', h.x, h.y, h.z, h.yaw, 0);
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
    h.phaseTime=(h.phaseTime||0)+dt;
    if(h.phase==='charge' && h.phaseTime>=.55){h.phase='launch';h.phaseTime=0;dispatchEvent(new CustomEvent('harare:hero-burst',{detail:{x:h.x,y:groundY(h.x,h.z),z:h.z,kind:'launch'}}));}
    if(h.phase==='launch' && h.phaseTime>=.65){h.phase='cruise';h.phaseTime=0;}
    const planted=h.phase==='charge'||h.phase==='impact';
    const fast = planted ? 0 : h.landing ? 7 : I.run ? HELI_FAST : HELI_V;
    const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw);
    const up = I.up + (I.jump ? 1 : 0) - (this.keys.has('KeyC') ? 1 : 0);
    const ground = groundY(h.x,h.z)+.16;
    const clearance=h.y-ground;
    // Fly where you look: W follows the view's pitch (look up to climb, down to dive). A small dead zone keeps level
    // cruising level; the view only tilts ±0.9 rad, so the flight path is steepened to reach ~80° climbs and dives.
    const look = Math.abs(h.pitch) > 0.15 ? h.pitch - Math.sign(h.pitch) * 0.15 : 0;
    const climb = THREE.MathUtils.clamp(look * 1.9, -1.4, 1.4);
    h.climb = climb;
    const tx = fx * I.fwd * fast * Math.cos(climb), tz = fz * I.fwd * fast * Math.cos(climb);
    let ty=THREE.MathUtils.clamp(up,-1,1)*(I.run?30:14) + I.fwd * fast * Math.sin(climb);
    if(h.landing) ty=-Math.min(18,Math.max(1.2,clearance*3));
    else if(clearance<2.34 && up>=0)ty=Math.max(ty,(2.34-clearance)*3);
    // Strong enough to clear shop awnings and first-floor ledges before settling into a hover
    if(h.phase==='launch')ty=Math.max(ty,24*(1-h.phaseTime/.9));
    if(planted)ty=0;
    // Exponential damping keeps handling consistent across frame rates; releasing movement brakes promptly.
    const a=1-Math.exp(-dt*(I.fwd?2.4:4.8));
    h.vx+=(tx-h.vx)*a;h.vz+=(tz-h.vz)*a;
    h.vy+=(ty-h.vy)*(1-Math.exp(-dt*4));
    if(planted)h.vx=h.vy=h.vz=0;
    let nx = h.x + h.vx * dt, ny = h.y + h.vy * dt, nz = h.z + h.vz * dt;
    const hit=(x,y,z)=>this.blocked.circle?.(x,z,.45,y)||this.blocked(x,z,y)||this.contacts?.personBlocked(x,z,.45,null,y-groundY(x,z));
    const steps=Math.max(1,Math.ceil(Math.hypot(nx-h.x,ny-h.y,nz-h.z)/.2));
    let px=h.x,py=h.y,pz=h.z;
    for(let i=0;i<steps;i++){
      const x=px+h.vx*dt/steps,y=py+h.vy*dt/steps,z=pz+h.vz*dt/steps;
      if(!hit(x,py,pz))px=x;else h.vx=0;
      if(!hit(px,py,z))pz=z;else h.vz=0;
      if(!hit(px,y,pz))py=y;else h.vy=0;
    }
    nx=px;ny=py;nz=pz;
    h.x = nx;
    h.z = nz;
    h.y = THREE.MathUtils.clamp(ny, groundY(nx, nz) + .16, 600);
    // Attitude: bank into turns, tilt with forward acceleration
    const fwdV = h.vx * fx + h.vz * fz;
    h.bank += (I.side * 0.22 - h.bank) * Math.min(1, dt * 3);
    h.tilt += ((tx * fx + tz * fz - fwdV) * -0.004 - h.tilt) * Math.min(1, dt * 3);
    if(h.landing && h.phase!=='impact' && h.y<=groundY(h.x,h.z)+.22){
      h.phase='impact';h.phaseTime=0;h.y=groundY(h.x,h.z)+.16;h.vx=h.vy=h.vz=0;
      dispatchEvent(new CustomEvent('harare:hero-burst',{detail:{x:h.x,y:groundY(h.x,h.z),z:h.z,kind:'land'}}));
    }
    if(h.phase==='impact' && h.phaseTime>=.72){
      const next=h.landing||'walk';h.landing=null;h.phase='cruise';
      dispatchEvent(new CustomEvent('harare:landed',{detail:next}));return;
    }
    if (still) return;
    const speed=Math.hypot(h.vx,h.vz),distance=6+Math.min(2,speed*.035);
    // A damped chase camera eases through turns; pitch drag now changes the view.
    _v.set(h.x-fx*distance,h.y+2.2-Math.sin(h.pitch)*distance*.65,h.z-fz*distance);
    c.position.x+=h.vx*dt;c.position.y+=h.vy*dt;c.position.z+=h.vz*dt;
    c.position.lerp(_v,1-Math.exp(-dt*7));
    if(h.phase==='impact')c.position.y+=Math.sin(h.phaseTime*55)*.065*Math.exp(-h.phaseTime*7);
    c.lookAt(h.x+fx*2,h.y+1+Math.sin(h.pitch)*2,h.z+fz*2);
    this.rig.setFov(60 + Math.min(12, Math.hypot(h.vx, h.vz) * 0.12), dt);
    this.camWritten.copy(c.position);
  }

  writeHeliCamera() {
    if (this.mode !== 'fly' || this.rig.current.id !== 'heli') return;
    const h = this.heli, c = this.camera;
    c.position.set(h.x-Math.sin(h.yaw)*6, h.y+2.2, h.z-Math.cos(h.yaw)*6);
    c.lookAt(h.x,h.y+1,h.z);
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
    // Circle against full building footprints and nearby actors; slide at walls.
    const r = .3, feet = w.y - groundY(w.x,w.z);
    const blocked = (x,z) => this.walkHits(x,z,r,feet,w);
    const steps=Math.max(1,Math.ceil(Math.hypot(w.vx,w.vz)*dt/.15));
    for(let i=0;i<steps;i++) {
      const nx=w.x+w.vx*dt/steps,nz=w.z+w.vz*dt/steps;
      if(!blocked(nx,w.z)) w.x=nx; else w.vx=0;
      if(!blocked(w.x,nz)) w.z=nz; else w.vz=0;
    }
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

  walkHits(x,z,r,feet=0,owner=null) {
    return (this.blocked.circle ? this.blocked.circle(x,z,r,feet) : this.blocked(x,z,feet)) ||
      (this.contacts ? this.contacts.personBlocked(x,z,r,owner,feet) : this.inKombi(x,z,r,feet));
  }

  // Is a walker of radius r at (x, z) inside the parked kombi? (feet above the roof: no — you can stand on it)
  inKombi(x, z, r, feet) {
    if (!this.kombi.visible || feet > 2.0) return false; // walkers can't reach the roof, but cameras can pass over it
    const c = this.car, dx = x - c.x, dz = z - c.z;
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    return Math.abs(dx * fx + dz * fz) < (this.car.len/2) + r && Math.abs(dx * fz - dz * fx) < (this.car.width/2) + r;
  }

  toggleFlight(){if(this.vehicleType==='roadster'&&this.mode==='drive')return this.flight.toggle();return false;}
  setVehicle(type){
    if(!['kombi','roadster'].includes(type)||Math.abs(this.car.v)>.5||this.car.alt>.01)return false;
    if(globalThis.__harare?.ctx?.shift?.state.status==='active')return false;
    this.vehicleType=type;this.car.len=type==='roadster'?4.3:4.9;this.car.width=1.9;
    this.roadster.root.visible=type==='roadster';this.roadster.particles.visible=false;this.flight=new Flight();this.car.alt=0;
    this.onCamera(this.rig.current);this.nudgeFree(this.car);return true;
  }

  updateDrive(dt) {
    const c = this.car, I = this.input;
    const roadster=this.vehicleType==='roadster';
    if(roadster)c.alt=this.flight.update(dt,this.carHits(c.x,c.z,c.yaw)||this.contacts?.carBlocked(c.x,c.z,c.yaw,c.len/2,c.width/2,c));
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    // Body-frame velocity: forward v, lateral vl (left = (fz, -fx))
    let v = c.vx * fx + c.vz * fz;
    let vl = c.vx * fz - c.vz * fx;
    c.boost = I.run && I.fwd > 0;
    const vmax = roadster ? (c.boost?44:32) : (c.boost ? BOOST_MAX : DRIVE_MAX);
    const thr = I.fwd;
    if (thr > 0) {
      if (v < -0.5) v += 16 * thr * dt;
      else v += (roadster?(c.boost?15:10):(c.boost ? 9.5 : 5.8)) * thr * dt * Math.max(0, 1 - (v / vmax) ** 2);
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
    // Brake lights: footbrake (throttle against the motion), handbrake, or held at a standstill
    const braking = (thr < 0 && v > 0.5) || (thr > 0 && v < -0.5) || hand || (Math.abs(v) < 0.4 && thr === 0) ? 1 : 0;
    c.brake += (braking - c.brake) * Math.min(1, dt * 14);
    c.hand = hand;

    // Steering: less lock at speed, quick to centre
    const lock = 0.6 / (1 + Math.abs(v) * 0.075);
    const want = -I.side * lock;
    c.steer += (want - c.steer) * Math.min(1, dt * (want === 0 ? 8 : 5));
    // Yaw from bicycle model (wheelbase 2.6 m); handbrake lets the tail come round
    const yawTarget = (v / 2.6) * Math.tan(c.steer) * (hand ? 1.35 : 1);
    c.yawRate += (yawTarget - c.yawRate) * Math.min(1, dt * 7);
    const oldYaw=c.yaw;
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

    // Sweep the complete rectangle, including the rear corner swinging out in a turn.
    const hit = p => this.carHits(p.x,p.z,p.yaw) || (c.alt<4.6 && this.contacts?.carBlocked(p.x,p.z,p.yaw,c.len/2,c.width/2,c));
    const result=sweepPose({x:c.x,z:c.z,yaw:oldYaw},{x:c.x+c.vx*dt,z:c.z+c.vz*dt,yaw:c.yaw},hit);
    c.x=result.x;c.z=result.z;c.yaw=result.yaw;
    if(result.hit) {
      if(Math.abs(v)>5)this.crash(Math.abs(v));
      c.vx=c.vz=c.yawRate=0;c.brake=1;
    }
    c.v = c.vx * Math.sin(c.yaw) + c.vz * Math.cos(c.yaw);

    // Body roll (into the outside of the turn) and pitch (dive on braking, squat on throttle), sprung
    const accel = (c.v - c.lastV) / Math.max(dt, 1e-3);
    c.lastV = c.v;
    const rollT = THREE.MathUtils.clamp(c.v * c.yawRate * 0.011, -0.085, 0.085);
    const pitchT = THREE.MathUtils.clamp(-accel * 0.0065, -0.05, 0.06);
    c.rollV += ((rollT - c.roll) * 90 - c.rollV * 11) * dt;
    c.roll += c.rollV * dt;
    c.pitchV += ((pitchT - c.pitch) * 80 - c.pitchV * 10) * dt;
    c.pitch += c.pitchV * dt;

    const y = groundY(c.x, c.z) + 0.22 + (c.alt||0);
    this.kombi.position.set(c.x, y, c.z);
    this.kombi.rotation.set(0, c.yaw, 0);
    this.kombiLean.rotation.set(c.pitch, 0, c.roll);
    c.hoot = Math.max(0, c.hoot - dt);
    // Indicators: steering hard flicks them on toward the turn and they keep blinking a moment after
    const lockNow = 0.6 / (1 + Math.abs(c.v) * 0.075);
    if (Math.abs(c.steer) > lockNow * 0.45 && Math.abs(c.v) > 0.5) (c.ind = c.steer < 0 ? 1 : -1), (c.indT = 1.2);
    else if ((c.indT -= dt) <= 0) c.ind = 0;
  }

  // A full footprint catches walls crossing the body even when every corner is outside.
  carHits(x,z,yaw) {
    const HALF_L=this.car.len/2,HALF_W=this.car.width/2;
    if(this.blocked.box)return this.blocked.box(x,z,yaw,HALF_L,HALF_W);
    for(const l of [-HALF_L,0,HALF_L])for(const w of [-HALF_W,0,HALF_W]) {
      if(this.blocked(x+Math.sin(yaw)*l+Math.cos(yaw)*w,z+Math.cos(yaw)*l-Math.sin(yaw)*w)) return true;
    }
    return false;
  }

  crash(strength) {
    this.rig.shake = Math.min(1, strength / 14);
    const now = performance.now();
    if (now - (this._lastCrash || 0) < 400) return;
    this._lastCrash = now;
    dispatchEvent(new CustomEvent('harare:crash', { detail: { strength } }));
  }

  updateKombiLamps(dt) {
    const pk = this.pk;
    if(this.vehicleType==='roadster'){
      if(pk.glow)pk.glow.visible=false;
      this.roadster.update(dt,this.car.v,this.car.steer,this.car.brake,this.flight);return;
    }
    if (!pk.shared && this.traffic) pk.attach(this.traffic);
    const c = this.car, night = this.nightness || 0, visible = this.kombi.visible;
    if (!visible) return pk.update(dt, night, 0, 0, 0, 0, c.x, 0, c.z, c.yaw, false);
    const driving = this.mode === 'drive';
    // Headlights after dusk while driving (sidelights when parked); the hooter double-flashes them
    const flash = c.hoot > 0 && Math.sin(c.hoot * 40) > 0 ? 1.4 : 0;
    const head = Math.max(driving ? (night > 0.18 ? 1 : 0) : 0.1 * night, flash);
    const brake = driving ? c.brake : 0;
    // Hazards: handbrake on at a standstill, or parked at the kerb while you're out on foot
    const ind = !driving || (c.hand && Math.abs(c.v) < 1) ? 2 : c.ind;
    pk.update(dt, night, head, brake, ind, 0.8 * night, this.kombi.position.x, this.kombi.position.y, this.kombi.position.z, c.yaw, true, c.v, c.steer);
  }
}
