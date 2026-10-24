// js/controls.js — three ways around town: fly (map controls), walk (first person), drive a kombi (chase cam)
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { groundY } from './util.js';
import { vehicleGeometry, lampGeometry } from './vehicles.js';

export class Controls {
  constructor(camera, dom, scene, blocked) {
    this.camera = camera;
    this.dom = dom;
    this.blocked = blocked;
    this.mode = 'fly';
    this.keys = new Set();

    this.map = new MapControls(camera, dom);
    this.map.enableDamping = true;
    this.map.maxPolarAngle = Math.PI * 0.47;
    this.map.minDistance = 20;
    this.map.maxDistance = 3500;
    this.map.screenSpacePanning = false;

    // Walker
    this.walk = { x: 30, z: -20, yaw: Math.PI, pitch: 0 };
    // Player kombi
    const body = new THREE.Mesh(vehicleGeometry('kombi'), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.3 }));
    this.lampMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    const lamps = new THREE.Mesh(lampGeometry('kombi'), this.lampMat);
    body.castShadow = true;
    this.kombi = new THREE.Group();
    this.kombi.add(body, lamps);
    this.kombi.visible = false;
    scene.add(this.kombi);
    this.car = { x: 60, z: 75, yaw: -Math.PI / 2, v: 0, steer: 0 };
    this.chase = new THREE.Vector3();

    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('click', () => {
      if (this.mode === 'walk' && document.pointerLockElement !== dom) dom.requestPointerLock?.();
    });
    addEventListener('mousemove', (e) => {
      if (this.mode !== 'walk' || document.pointerLockElement !== dom) return;
      this.walk.yaw -= e.movementX * 0.0022;
      this.walk.pitch = Math.max(-1.3, Math.min(1.3, this.walk.pitch - e.movementY * 0.0022));
    });
    // Touch: drag to look while walking
    let last = null;
    dom.addEventListener('touchstart', (e) => (last = e.touches[0]));
    dom.addEventListener('touchmove', (e) => {
      if (this.mode !== 'walk' || !last) return;
      const t = e.touches[0];
      this.walk.yaw -= (t.clientX - last.clientX) * 0.005;
      this.walk.pitch = Math.max(-1.3, Math.min(1.3, this.walk.pitch - (t.clientY - last.clientY) * 0.005));
      last = t;
    });
  }

  setMode(mode) {
    const prev = this.mode;
    this.mode = mode;
    this.map.enabled = mode === 'fly';
    this.kombi.visible = mode === 'drive';
    if (document.pointerLockElement) document.exitPointerLock();
    const t = this.map.target;
    if (mode === 'walk' && prev === 'fly') {
      this.walk.x = t.x;
      this.walk.z = t.z;
      this.nudgeFree(this.walk);
    }
    if (mode === 'drive' && prev === 'fly') {
      this.car.x = t.x;
      this.car.z = t.z;
      this.nudgeFree(this.car);
    }
    if (mode === 'fly') {
      const src = prev === 'walk' ? this.walk : this.car;
      t.set(src.x, 0, src.z);
      this.camera.position.set(src.x + 120, 160, src.z + 180);
      this.map.update();
    }
    this.chase.set(this.car.x, 0, this.car.z);
  }

  // Move the active player (walker, kombi or fly target) to (x, z), facing yaw (radians, 0 = south / +z)
  teleport(x, z, yaw) {
    const o = this.mode === 'walk' ? this.walk : this.mode === 'drive' ? this.car : null;
    if (o) {
      o.x = x;
      o.z = z;
      if (yaw !== undefined) o.yaw = this.mode === 'walk' ? yaw + Math.PI : yaw;
      if (this.mode === 'drive') (this.car.v = 0), this.chase.set(x, 0, z);
      this.nudgeFree(o);
    } else {
      const d = this.camera.position.clone().sub(this.map.target);
      this.map.target.set(x, 0, z);
      this.camera.position.set(x, 0, z).add(d);
      this.map.update();
    }
  }

  // Spiral outward until we're not standing inside a building
  nudgeFree(o) {
    for (let r = 0; r < 200 && this.blocked(o.x, o.z); r += 2) {
      const a = r * 0.7;
      if (!this.blocked(o.x + Math.cos(a) * r, o.z + Math.sin(a) * r)) (o.x += Math.cos(a) * r), (o.z += Math.sin(a) * r);
    }
  }

  get position() {
    if (this.mode === 'walk') return this.walk;
    if (this.mode === 'drive') return this.car;
    return this.map.target;
  }

  update(dt, nightness) {
    dt = Math.min(dt, 0.1);
    const k = this.keys;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const side = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);

    if (this.mode === 'fly') {
      // WASD pans the map too
      if (fwd || side) {
        const dir = new THREE.Vector3();
        this.camera.getWorldDirection(dir);
        dir.y = 0;
        dir.normalize();
        const right = new THREE.Vector3(-dir.z, 0, dir.x);
        const sp = Math.max(40, this.camera.position.y) * dt * 1.2;
        const move = dir.multiplyScalar(fwd * sp).add(right.multiplyScalar(side * sp));
        this.camera.position.add(move);
        this.map.target.add(move);
      }
      this.map.update();
    } else if (this.mode === 'walk') {
      const w = this.walk;
      const run = k.has('ShiftLeft') || k.has('ShiftRight') ? 3.2 : 1;
      const sp = 1.6 * run * dt;
      const fx = -Math.sin(w.yaw), fz = -Math.cos(w.yaw);
      const nx = w.x + (fx * fwd + -fz * side) * sp, nz = w.z + (fz * fwd + fx * side) * sp;
      if (!this.blocked(nx, w.z)) w.x = nx;
      if (!this.blocked(w.x, nz)) w.z = nz;
      if (k.has('KeyQ')) w.yaw += dt * 1.8;
      if (k.has('KeyE')) w.yaw -= dt * 1.8;
      this.camera.position.set(w.x, groundY(w.x, w.z) + 1.7, w.z);
      this.camera.rotation.set(w.pitch, w.yaw, 0, 'YXZ');
    } else {
      const c = this.car;
      const brake = k.has('Space');
      if (fwd > 0) c.v += (c.v < 0 ? 14 : 5.5) * dt;
      else if (fwd < 0) c.v -= (c.v > 0 ? 14 : 4) * dt;
      else c.v -= Math.sign(c.v) * Math.min(Math.abs(c.v), 2.2 * dt);
      if (brake) c.v -= Math.sign(c.v) * Math.min(Math.abs(c.v), 18 * dt);
      c.v = Math.max(-7, Math.min(c.v, 26));
      c.steer += (side * -0.6 - c.steer) * Math.min(1, dt * 6);
      c.yaw += (c.v / 3.2) * Math.tan(c.steer) * dt * Math.min(1, 6 / (Math.abs(c.v) + 4) + 0.4);
      const nx = c.x + Math.sin(c.yaw) * c.v * dt, nz = c.z + Math.cos(c.yaw) * c.v * dt;
      const fx = Math.sin(c.yaw) * 2.4 * Math.sign(c.v || 1), fz = Math.cos(c.yaw) * 2.4 * Math.sign(c.v || 1);
      if (this.blocked(nx + fx, nz + fz)) c.v *= -0.25;
      else (c.x = nx), (c.z = nz);
      const y = groundY(c.x, c.z) + 0.22;
      this.kombi.position.set(c.x, y, c.z);
      this.kombi.rotation.set(0, c.yaw, 0);
      this.lampMat.color.setScalar(0.35 + nightness * 2.2);
      // Chase camera
      const target = new THREE.Vector3(c.x - Math.sin(c.yaw) * 11, y + 4.5, c.z - Math.cos(c.yaw) * 11);
      this.chase.lerp(target, Math.min(1, dt * 4));
      this.camera.position.copy(this.chase);
      this.camera.position.y = Math.max(this.camera.position.y, groundY(this.chase.x, this.chase.z) + 1.5);
      this.camera.lookAt(c.x + Math.sin(c.yaw) * 6, y + 1.6, c.z + Math.cos(c.yaw) * 6);
    }
  }
}
