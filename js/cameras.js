// js/cameras.js — camera rig: follow cams (chase with drag-orbit + wheel zoom, low-angle action, cockpit / POV),
// cinematic Harare landmark shots that slowly drift, and an auto-director drone that orbits and glides.
// Fly mode adds Map view (MapControls) and Helicopter, which controls.js drives itself.
import * as THREE from 'three';
import { DATA } from './harare-data.js';
import { groundY, pointInPoly } from './util.js';

const FOLLOW = [
  { id: 'chase', name: 'Chase cam', type: 'follow' },
  { id: 'action', name: 'Low-angle action', type: 'follow' },
  { id: 'pov', name: 'Cockpit / POV', type: 'follow' },
];
const FLY = [
  { id: 'heli', name: 'Hero flight', type: 'fly' },
  { id: 'map', name: 'Map view', type: 'fly' },
];
const DRONE = { id: 'drone', name: 'Auto-director drone', type: 'drone' };

function buildingOf(re) {
  for (const b of DATA.buildings) {
    if (!b.n || !re.test(b.n)) continue;
    let x = 0, z = 0;
    const n = b.p.length / 2;
    for (let i = 0; i < b.p.length; i += 2) (x += b.p[i]), (z += b.p[i + 1]);
    return { x: x / n, z: z / n, h: b.h, p: b.p };
  }
  return null;
}

// Find a clear vantage on a landmark building: try headings around the preferred one until the camera stands in the
// open and the sight line to the target height isn't cut by another building.
function solveShot(blocked, b, dist, camH, lookFrac, pref) {
  const ty = b.h * lookFrac;
  for (let rise = 0; rise < 60; rise += 12) {
    for (let k = 0; k < 24; k++) {
      const a = pref + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12);
      const cx = b.x + Math.sin(a) * dist, cz = b.z + Math.cos(a) * dist, cy = groundY(cx, cz) + camH + rise;
      if (blocked(cx, cz, cy) || blocked(cx, cz, 0)) continue;
      let clear = true;
      for (let i = 1; i < 60; i++) {
        const t = i / 60, x = cx + (b.x - cx) * t, z = cz + (b.z - cz) * t, y = cy + (ty - cy) * t;
        if (pointInPoly(x, z, b.p)) break;
        if (blocked(x, z, y)) {
          clear = false;
          break;
        }
      }
      if (clear) return { cam: [cx, cy, cz], look: [b.x, ty, b.z] };
    }
  }
  return { cam: [b.x + dist, camH + 40, b.z + dist], look: [b.x, ty, b.z] };
}

// Landmark shots: camera position, look target, drift (radians of slow orbit about the target), fov
function landmarkShots(blocked) {
  const out = [];
  const add = (name, cam, look, drift = 0.1, fov = 50) => out.push({ id: 'lm:' + name, name, type: 'landmark', cam: new THREE.Vector3(...cam), look: new THREE.Vector3(...look), drift, fov });
  const shot = (name, re, dist, camH, lookFrac, pref, drift, fov) => {
    const b = buildingOf(re);
    if (!b) return;
    const s = solveShot(blocked, b, dist, camH, lookFrac, pref);
    add(name, s.cam, s.look, drift, fov);
  };
  add('Africa Unity Square', [105, 72, 100], [18, 0, -22], 0.12, 54);
  shot('Reserve Bank tower', /^Reserve Bank of Zimbabwe$/, 150, 2, 0.5, Math.PI * 0.25, 0.05, 56);
  shot('Eastgate', /^Eastgate Shopping/, 150, 40, 0.6, Math.PI * 0.3, 0.08, 52);
  shot('Joina City', /^Joina City/, 163, 3, 0.6, Math.atan2(110, -120), 0.06, 55);
  add('First Street Mall', [-262, 2.2, -100], [-290, 4, -230], 0.05, 58);
  const ky = groundY(-1377, 1593);
  add('Kopje lookout', [-1340, ky + 24, 1560], [-150, 30, 40], 0.04, 40);
  return out;
}

const _dir = new THREE.Vector3(), _p = new THREE.Vector3(), _l = new THREE.Vector3(), _q = new THREE.Vector3();

export class CameraRig {
  constructor(camera, dom, blocked) {
    this.camera = camera;
    this.dom = dom;
    this.blocked = blocked;
    this.landmarks = landmarkShots(blocked);
    this.lists = {
      walk: [...FOLLOW, ...this.landmarks, DRONE],
      drive: [...FOLLOW, ...this.landmarks, DRONE],
      fly: [...FLY, ...this.landmarks, DRONE],
    };
    this.kind = 'drive';
    this.index = { walk: 0, drive: 0, fly: 0 };
    this.onChange = null;

    // Follow state
    this.yaw = 0; // absolute heading of the follow camera (0 = looking south / +z)
    this.pitch = 0.18; // orbit pitch (positive = above)
    this.orbitYaw = 0; // drive: user offset that relaxes back behind the kombi
    this.zoom = 1;
    this.userT = 0; // seconds since the user last dragged (counts down)
    this.dist = 10; // smoothed collision-limited distance
    this.lookDX = 0;
    this.lookDY = 0;
    this.dragging = false;
    this.shake = 0;
    this.fov = 55;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.followPosition = new THREE.Vector3();
    this.followLook = new THREE.Vector3();
    this.snapNext = true;
    this.t = 0;
    // Drone
    this.drone = { a: 0, style: 0, styleT: 0, pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false };

    this.bindPointer();
  }

  bindPointer() {
    const el = this.dom;
    const pts = new Map();
    let pinch = 0;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => {
      if (!this.wantsPointer() || (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      el.setPointerCapture?.(e.pointerId);
      this.dragging = true;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    el.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      if (pts.size === 2) {
        p.x = e.clientX;
        p.y = e.clientY;
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 1 && d > 1) this.zoom = THREE.MathUtils.clamp(this.zoom * (pinch / d), 0.45, 2.5);
        pinch = d;
        return;
      }
      this.lookDX += e.clientX - p.x;
      this.lookDY += e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      this.userT = 3;
    });
    const up = (e) => {
      if (!pts.delete(e.pointerId)) return;
      this.dragging = pts.size > 0;
      pinch = 0;
    };
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(t, up);
    el.addEventListener('contextmenu', (e) => this.wantsPointer() && e.preventDefault());
    el.addEventListener('wheel', (e) => {
      if (!this.wantsPointer()) return;
      e.preventDefault();
      this.zoom = THREE.MathUtils.clamp(this.zoom * (1 + e.deltaY * 0.001), 0.45, 2.5);
    }, { passive: false });
  }

  // Map view leaves the pointer to MapControls
  wantsPointer() {
    return this.current.id !== 'map';
  }

  get list() {
    return this.lists[this.kind];
  }
  get current() {
    return this.list[this.index[this.kind]];
  }

  setKind(kind) {
    this.kind = kind;
    if (kind === 'fly') this.index.fly = 0;
    this.snapNext = true;
    this.onChange?.(this.current);
  }

  select(id) {
    const i = this.list.findIndex((p) => p.id === id);
    if (i >= 0) this.index[this.kind] = i;
    this.snapNext = true;
    this.onChange?.(this.current);
  }

  next(d = 1) {
    const n = this.list.length;
    this.index[this.kind] = (this.index[this.kind] + d + n) % n;
    this.snapNext = true;
    this.drone.init = false;
    this.lookDX = this.lookDY = 0;
    this.onChange?.(this.current);
  }

  // Take accumulated drag deltas (pixels) — controls.js uses this for the helicopter
  takeLook(out) {
    out.x = this.lookDX;
    out.y = this.lookDY;
    this.lookDX = this.lookDY = 0;
    return out;
  }

  setFov(f, dt) {
    const k = dt ? 1 - Math.exp(-dt * 3) : 1;
    this.fov += (f - this.fov) * k;
    if (Math.abs(this.camera.fov - this.fov) > 0.05) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  setNear(n) {
    if (this.camera.near === n) return;
    this.camera.near = n;
    this.camera.updateProjectionMatrix();
  }

  // Pull the camera in toward the pivot if a building sits between them
  clearance(px, py, pz, cx, cy, cz) {
    const steps = Math.min(100,Math.max(8,Math.ceil(Math.hypot(cx-px,cy-py,cz-pz)/.5)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (this.blocked(px + (cx - px) * t, pz + (cz - pz) * t, py + (cy - py) * t)) return Math.max(0.15, (i - 1.3) / steps);
    }
    return 1;
  }

  // t: { x, y, z, yaw, speed, kind: 'walk'|'drive', boost, vx, vz, maxSpeed }
  update(dt, t, extra = {}) {
    this.t += dt;
    this.userT = Math.max(0, this.userT - dt);
    const cam = this.camera;
    const preset = this.current;
    const snap = this.snapNext;
    this.snapNext = false;
    this.shake = Math.max(0, this.shake - dt * 2.5);

    if (preset.id !== 'pov') this.setNear(1);
    if (preset.type === 'landmark') {
      this.lookDX = this.lookDY = 0;
      this.setFov(preset.fov);
      const a = Math.sin(this.t * 0.06) * preset.drift;
      const dx = preset.cam.x - preset.look.x, dz = preset.cam.z - preset.look.z;
      const c = Math.cos(a), s = Math.sin(a);
      cam.position.set(preset.look.x + dx * c - dz * s, preset.cam.y + Math.sin(this.t * 0.11) * 0.6, preset.look.z + dx * s + dz * c);
      cam.lookAt(preset.look);
      this.focus = preset.look;
      return;
    }
    this.focus = null;

    if (preset.type === 'drone') return this.updateDrone(dt, t, snap);

    // --- follow cams ---
    const walk = t.kind === 'walk';
    // Drag input orbits
    const dxp = this.lookDX, dyp = this.lookDY;
    this.lookDX = this.lookDY = 0;
    const gx = extra.lookX || 0, gy = extra.lookY || 0; // gamepad right stick (rad/s)
    if (walk) {
      this.yaw -= dxp * 0.006 + gx * dt * 2.6;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dyp * 0.005 + gy * dt * 1.8, -0.5, 1.2);
      if (gx || gy) this.userT = 2;
      // Drift gently back behind the walker once they're moving and the user has let go
      if (this.userT <= 0 && t.speed > 0.5) {
        let d = t.yaw - this.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        // …but not when they walk toward the camera (that would whip it round)
        if (Math.abs(d) < 1.9) this.yaw += d * Math.min(1, dt * 0.9 * Math.min(1, t.speed / 2));
      }
    } else {
      this.orbitYaw -= dxp * 0.006 + gx * dt * 2.6;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dyp * 0.005 + gy * dt * 1.8, -0.3, 1.2);
      if (gx || gy) this.userT = 2;
      // Follow heading — blend toward the direction of travel when sliding
      let target = t.yaw;
      if (t.speed > 3 && t.vx !== undefined) {
        const vy = Math.atan2(t.vx, t.vz) + (t.reverse ? Math.PI : 0);
        let dv = vy - target;
        dv = Math.atan2(Math.sin(dv), Math.cos(dv));
        target += dv * 0.5;
      }
      let d = target - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw = snap ? target : this.yaw + d * (1 - Math.exp(-dt * 3.2));
      if (this.userT <= 0) {
        this.orbitYaw *= Math.exp(-dt * 1.5);
        this.pitch += (0.18 - this.pitch) * Math.min(1, dt * 1.2);
      }
    }

    const yaw = this.yaw + (walk ? 0 : this.orbitYaw);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const sp = t.speed || 0;
    const pos = this.pos, look = this.look;

    if (preset.id === 'pov') {
      if (walk) {
        pos.set(t.x + fx * 0.25, t.y + 1.62, t.z + fz * 0.25);
        _l.set(pos.x + fx * 10, pos.y - this.pitch * 10 + 1.8, pos.z + fz * 10);
      } else {
        // Right-hand drive: the driver sits on the kombi's right (-x local)
        const cy = Math.cos(t.yaw), sy = Math.sin(t.yaw);
        const lx = -0.42, lz = 0.95;
        pos.set(t.x + lx * cy + lz * sy, t.y + 1.5, t.z - lx * sy + lz * cy);
        const ly = t.yaw + this.orbitYaw;
        _l.set(pos.x + Math.sin(ly) * 20, pos.y - 0.6 - (this.pitch - 0.18) * 20, pos.z + Math.cos(ly) * 20);
      }
      this.setFov(walk ? 70 : 68 + Math.min(10, sp * 0.3), dt);
      this.setNear(walk ? 0.3 : 0.1);
      cam.position.copy(pos);
      this.applyShake(cam);
      cam.lookAt(_l);
      return;
    }

    let dist, height, lookH, fov;
    if (preset.id === 'action') {
      if (walk) (dist = 2.6), (height = 0.35), (lookH = 1.25), (fov = 62);
      else (dist = 6.2 + sp * 0.06), (height = 0.55), (lookH = 1.6), (fov = 62 + Math.min(14, sp * 0.4));
    } else if (walk) (dist = 4.2), (height = 1.75), (lookH = 1.45), (fov = 56);
    else (dist = 10 + sp * 0.08), (height = 2.7), (lookH = 1.9), (fov = 55 + Math.min(16, sp * 0.45) + (t.boost ? 6 : 0));

    dist *= this.zoom;
    const pitch = preset.id === 'action' ? 0 : this.pitch;
    const cp = Math.cos(pitch), spch = Math.sin(pitch);
    // Action cam swings out to the kerb side a little for a 3/4 view
    const side = preset.id === 'action' ? 0.45 : 0;
    const ox = -(fx * Math.cos(side) - fz * Math.sin(side)), oz = -(fz * Math.cos(side) + fx * Math.sin(side));
    look.set(t.x, t.y + lookH, t.z);
    const hy = walk ? height + spch * dist : height + spch * dist * 0.8;
    const want = _q.set(look.x + ox * dist * cp, t.y + Math.max(0.3, hy), look.z + oz * dist * cp);
    const dWant = this.clearance(look.x, look.y, look.z, want.x, want.y, want.z);
    this.dist = snap ? dWant : this.dist + (dWant - this.dist) * (dWant < this.dist ? 1 : 1 - Math.exp(-dt * 2.5));
    pos.set(look.x + (want.x - look.x) * this.dist, look.y + (want.y - look.y) * this.dist, look.z + (want.z - look.z) * this.dist);
    pos.y = Math.max(pos.y, groundY(pos.x, pos.z) + 0.3);
    this.setFov(fov, snap ? 0 : dt);
    // Gentle follow lag, followed by another wall check so smoothing cannot cross a facade.
    if(snap || this.followPosition.distanceToSquared(pos)>2500)this.followPosition.copy(pos);
    else this.followPosition.lerp(pos,1-Math.exp(-dt*(walk?12:8)));
    const safe=this.clearance(look.x,look.y,look.z,this.followPosition.x,this.followPosition.y,this.followPosition.z);
    if(safe<1)this.followPosition.lerpVectors(look,this.followPosition,safe);
    this.followPosition.y=Math.max(this.followPosition.y,groundY(this.followPosition.x,this.followPosition.z)+.3);
    cam.position.copy(this.followPosition);
    this.applyShake(cam);
    _l.set(look.x + Math.sin(t.yaw) * sp * 0.15, look.y, look.z + Math.cos(t.yaw) * sp * 0.15);
    if(snap)this.followLook.copy(_l);else this.followLook.lerp(_l,1-Math.exp(-dt*10));
    cam.lookAt(this.followLook);
  }

  applyShake(cam) {
    if (this.shake <= 0) return;
    const s = this.shake * this.shake * 0.18;
    cam.position.x += Math.sin(this.t * 67) * s;
    cam.position.y += Math.sin(this.t * 83 + 1) * s;
    cam.position.z += Math.sin(this.t * 53 + 2) * s;
  }

  // Auto-director: changes shot style every ~9 s — wide orbit, low glide alongside, high crane looking down
  updateDrone(dt, t, snap) {
    const D = this.drone, cam = this.camera;
    if (!D.init || snap) {
      D.init = true;
      D.style = 0;
      D.styleT = 0;
      D.a = (t.yaw || 0) + Math.PI * 0.75;
    }
    D.styleT += dt;
    if (D.styleT > 9) (D.styleT = 0), (D.style = (D.style + 1) % 3), (D.a += 0.8);
    const tt = this.t;
    const ty = t.y || 0;
    const fly = t.kind === 'fly';
    const scale = fly ? 4 : 1;
    if (D.style === 0) {
      D.a += dt * 0.16;
      const r = (34 + Math.sin(tt * 0.13) * 10) * scale;
      _p.set(t.x + Math.sin(D.a) * r, ty + (20 + Math.sin(tt * 0.09) * 8) * scale, t.z + Math.cos(D.a) * r);
    } else if (D.style === 1) {
      // Glide: hold a side offset relative to the subject's heading, low and close
      const h = (t.yaw || 0) + 1.2 + Math.sin(tt * 0.1) * 0.5;
      _p.set(t.x + Math.sin(h) * 14 * scale, ty + 4.5 * scale, t.z + Math.cos(h) * 14 * scale);
    } else {
      D.a += dt * 0.05;
      _p.set(t.x + Math.sin(D.a) * 22 * scale, ty + 70 * scale, t.z + Math.cos(D.a) * 22 * scale);
    }
    // Never inside a building
    for (let i = 0; i < 12 && this.blocked(_p.x, _p.z, _p.y - 3); i++) _p.y += 8;
    _p.y = Math.max(_p.y, groundY(_p.x, _p.z) + 2);
    _q.set(t.x, ty + (fly ? 0 : 1.2), t.z);
    if (snap) D.pos.copy(_p), D.look.copy(_q);
    D.pos.lerp(_p, 1-Math.exp(-dt*1.1));
    D.look.lerp(_q, 1-Math.exp(-dt*4));
    // Keep the subject in sight: slide in along the sight line past anything in the way, and stay out of roofs
    const k = this.clearance(_q.x, _q.y, _q.z, D.pos.x, D.pos.y, D.pos.z);
    if (k < 1) D.pos.lerpVectors(_q, D.pos, Math.max(0.12, k));
    for (let i = 0; i < 20 && this.blocked(D.pos.x, D.pos.z, D.pos.y - 1.5); i++) D.pos.y += 2;
    this.setFov(48, dt);
    cam.position.copy(D.pos);
    cam.lookAt(D.look);
  }

  // World-space direction the camera faces on the ground plane, as a heading
  heading() {
    this.camera.getWorldDirection(_dir);
    return Math.atan2(_dir.x, _dir.z);
  }
}
