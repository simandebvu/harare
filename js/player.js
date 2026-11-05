// Animated hero character with a lightweight procedural fallback and shared footstep events.
import * as THREE from 'three';
import { loadPlayerModel } from './imported-models.js';
import { createFigures, HAIR, OUTFIT, IDLE } from './figures.js';

const TAU = Math.PI * 2;
const smooth = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export class Player {
  constructor(scene) {
    const c = (h) => new THREE.Color(h);
    this.F = createFigures(scene, 1, { near: 400, far: 4000 });
    this.i = this.F.add({
      fem: 0,
      skin: c('#5b3a26'),
      top: c('#12803c'), // Warriors green
      bag: c('#f2c318'), // kit trim: gold
      sleeve: 0.21,
      outfit: OUTFIT.JERSEY,
      bot: c('#2a3550'), // jeans
      hem: 0,
      acc: c('#c8202a'), // red cap
      hairStyle: HAIR.CAP,
      hair: c('#120e0c'),
      shoe: c('#e8e6e0'),
      seed: 0.37,
      phase: 0,
      freq: 6,
    });
    this.F.meshes.forEach((m) => (m.name = 'player'));
    this.scale = 1.02;
    this.F.pose(this.i, 0, IDLE.HANG, 0);
    this.F.hide(this.i, true);
    this._visible = false;

    this.phase = 0;
    this.stepIdx = 0;
    this.runK = 0; // 0 walk … 1 run (smoothed)
    this.air = 0; // 0 grounded … 1 airborne pose (smoothed)
    this.t = 0;
    this.lean = 0;
    this.scene = scene;
    this.models = new Map();
    this.character = 'male';
    this.ready = this.setCharacter('male').catch(error => console.warn('[harare] Character load failed', error));
  }

  async setCharacter(character) {
    const request = this.characterRequest = (this.characterRequest || 0) + 1;
    let model = this.models.get(character);
    if (!model) {
      model = await loadPlayerModel(character);
      model.root.visible = false;
      this.models.set(character, model);
      this.scene.add(model.root);
    }
    if (request !== this.characterRequest) return;
    if (this.imported) {
      model.root.position.copy(this.imported.root.position);
      model.root.quaternion.copy(this.imported.root.quaternion);
      this.imported.root.visible = false;
    }
    this.imported = model;
    this.character = character;
    model.root.visible = this._visible;
    this.F.hide(this.i, true);
    this.F.commit(this.t);
  }

  set visible(v) {
    this._visible = !!v;
    this.F.hide(this.i, !!this.imported || !v);
    if (this.imported) this.imported.root.visible = !!v;
    this.F.commit(this.t); // drop / restore the instance now (update() doesn't run outside walk mode)
  }
  get visible() {
    return this._visible;
  }

  // x, y (feet), z, yaw (heading), speed m/s on the ground, airborne flag, turn rate (rad/s) for a little lean
  update(dt, x, y, z, yaw, speed, airborne, turnRate = 0, powered = false) {
    this.t += dt;
    const F = this.F, i = this.i;
    this.runK += (smooth(2.5, 4.4, speed) - this.runK) * Math.min(1, dt * 6);
    this.air += ((airborne ? 1 : 0) - this.air) * Math.min(1, dt * (airborne ? 9 : 16));
    const r = this.runK;

    // Cadence (gait cycles per second) rises with speed; the stance fraction shrinks from 60% walking to 30% running.
    // Half stance span A = v · stance · T / 2 keeps the planted foot still on the ground.
    const fWalk = 0.62 + 0.24 * Math.min(speed, 2.6), fRun = 1.35 + 0.06 * speed;
    const f = fWalk + (fRun - fWalk) * r;
    const st = 0.6 + (0.28 - 0.6) * r; // stance fractions of figures.js footPath / footRun
    const A = airborne ? 0 : (speed * st) / f / 2;
    if (!airborne && speed > 0.03) this.phase += TAU * f * dt;
    else if (airborne) this.phase += dt * 3; // drift so we don't freeze mid-stride
    if (this.phase > TAU * 1e4) this.phase -= TAU * 1e4;

    // Footfalls: each half-cycle a heel strikes (left at cycle 0, right at 0.5); the imported hero's own gait clock
    // drives them when it is shown, so the sound lands with the visible feet
    const idx = this.imported ? Math.floor(this.imported.gait * 2) : Math.floor(this.phase / Math.PI);
    if (idx !== this.stepIdx) {
      this.stepIdx = idx;
      if (!powered && !airborne && speed > 0.4) dispatchEvent(new CustomEvent('harare:step', { detail: { run: speed > 3.2 } }));
    }

    this.lean += (THREE.MathUtils.clamp(-turnRate * speed * 0.035, -0.22, 0.22) - this.lean) * Math.min(1, dt * 6);
    if (this.imported) {
      this.imported.update(dt, x, y, z, yaw, speed, powered?false:airborne, powered?turnRate:this.lean, powered, powered?this.flightAction:null);
      return;
    }
    F.place(i, x, y, z, yaw, this.scale, 1.03);
    F.drive(i, this.phase, A);
    F.ext(i, r, this.air);
    F.pose(i, 0, IDLE.HANG, -this.lean);
    F.commit(this.t);
  }
}
