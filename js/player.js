// js/player.js — the walking player: a jointed low-poly figure (hips → thighs → shins, torso → arms → forearms, head)
// posed procedurally every frame. Stride phase advances with ground speed, so feet don't skate; footfalls fire
// `harare:step` events. Faces +z in local space (heading yaw 0 = south, like the vehicles).
import * as THREE from 'three';

const HIP_Y = 0.94;
const THIGH = 0.44, SHIN = 0.44, UPARM = 0.29, FOREARM = 0.27;

function mat(color, rough = 0.8) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
}

// Capsule spanning from y=0 down to y=-len (limb hanging from its pivot)
function limb(r, len, m) {
  const g = new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 3, 8).translate(0, -len / 2, 0);
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  return mesh;
}

export class Player {
  constructor(scene) {
    const skin = mat('#5b3a26', 0.65);
    const jersey = mat('#1f7a3a', 0.7); // Warriors green
    const trim = mat('#f2c318', 0.6); // and gold
    const denim = mat('#2a3550', 0.85);
    const shoe = mat('#1b1b1d', 0.6);
    const sole = mat('#e9e6df', 0.7);
    const cap = mat('#c8202a', 0.7);

    this.root = new THREE.Group();
    this.root.name = 'player';
    this.pelvis = new THREE.Group();
    this.pelvis.position.y = HIP_Y;
    this.root.add(this.pelvis);

    const hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.1, 3, 8).rotateZ(Math.PI / 2).scale(1, 1, 0.85), denim);
    hips.castShadow = true;
    this.pelvis.add(hips);

    // Legs
    this.thigh = [];
    this.shin = [];
    for (const s of [1, -1]) {
      const t = new THREE.Group();
      t.position.set(0.1 * s, 0, 0);
      t.add(limb(0.078, THIGH, denim));
      const sh = new THREE.Group();
      sh.position.y = -THIGH;
      sh.add(limb(0.064, SHIN, denim));
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.25).translate(0, -SHIN - 0.02, 0.05), shoe);
      foot.castShadow = true;
      const so = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.025, 0.26).translate(0, -SHIN - 0.065, 0.05), sole);
      sh.add(foot, so);
      t.add(sh);
      this.pelvis.add(t);
      this.thigh.push(t);
      this.shin.push(sh);
    }

    // Torso, slightly broader at the shoulders
    this.torso = new THREE.Group();
    this.torso.position.y = 0.06;
    this.pelvis.add(this.torso);
    const chestG = new THREE.CylinderGeometry(0.2, 0.16, 0.5, 10, 1).translate(0, 0.25, 0).scale(1, 1, 0.62);
    const chest = new THREE.Mesh(chestG, jersey);
    chest.castShadow = true;
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.018, 4, 10).rotateX(Math.PI / 2).translate(0, 0.5, 0), trim);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.168, 0.165, 0.05, 10, 1).translate(0, 0.07, 0).scale(1, 1, 0.64), trim);
    this.torso.add(chest, collar, band);

    // Head
    this.head = new THREE.Group();
    this.head.position.y = 0.52;
    this.torso.add(this.head);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 6).translate(0, 0.04, 0), skin);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 9).scale(0.95, 1.12, 1.02).translate(0, 0.19, 0.005), skin);
    skull.castShadow = true;
    const capTop = new THREE.Mesh(new THREE.SphereGeometry(0.112, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 0.8, 1.04).translate(0, 0.225, -0.005), cap);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.015, 10, 1, false, -Math.PI / 2, Math.PI).scale(1, 1, 1.25).translate(0, 0.228, 0.07), cap);
    capTop.castShadow = true;
    this.head.add(neck, skull, capTop, brim);

    // Arms
    this.upper = [];
    this.fore = [];
    for (const s of [1, -1]) {
      const u = new THREE.Group();
      u.position.set(0.215 * s, 0.47, 0);
      u.rotation.z = 0.08 * s;
      const sleeve = limb(0.062, 0.16, jersey);
      u.add(sleeve, limb(0.05, UPARM, skin));
      const f = new THREE.Group();
      f.position.y = -UPARM;
      f.add(limb(0.045, FOREARM, skin));
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5).scale(0.8, 1.1, 1).translate(0, -FOREARM - 0.03, 0), skin);
      f.add(hand);
      u.add(f);
      this.torso.add(u);
      this.upper.push(u);
      this.fore.push(f);
    }

    this.root.visible = false;
    scene.add(this.root);

    this.phase = 0;
    this.stepIdx = 0;
    this.gait = 0; // 0 idle … 1 walk … 2 run (smoothed)
    this.air = 0; // 0 grounded … 1 airborne pose (smoothed)
    this.t = 0;
    this.lean = 0;
  }

  set visible(v) {
    this.root.visible = v;
  }
  get visible() {
    return this.root.visible;
  }

  // x, y (feet), z, yaw (heading), speed m/s on the ground, airborne flag, turn rate (rad/s) for a little lean
  update(dt, x, y, z, yaw, speed, airborne, turnRate = 0) {
    this.t += dt;
    const run = speed > 3.2;
    const g = speed < 0.15 ? 0 : run ? 1 + Math.min(1, (speed - 3.2) / 2) : Math.min(1, speed / 1.4);
    this.gait += (g - this.gait) * Math.min(1, dt * 8);
    this.air += ((airborne ? 1 : 0) - this.air) * Math.min(1, dt * 12);
    const G = this.gait, A = this.air;
    const runK = Math.max(0, G - 1); // 0 walking … 1 full run

    // Stride length grows with speed: ~1.45 m per full cycle walking, ~2.6 m running
    const stride = 1.45 + runK * 1.15;
    if (!airborne) this.phase += (speed / stride) * Math.PI * 2 * dt;
    else this.phase += dt * 2; // drift so we don't freeze mid-stride
    const p = this.phase;

    // Footfalls: each half-cycle a foot lands
    const idx = Math.floor(p / Math.PI);
    if (idx !== this.stepIdx) {
      this.stepIdx = idx;
      if (!airborne && speed > 0.4) {
        dispatchEvent(new CustomEvent('harare:step', { detail: { run } }));
      }
    }

    const walkAmp = Math.min(1, G);
    const thighA = (0.42 + runK * 0.45) * walkAmp;
    const kneeA = (0.65 + runK * 0.8) * walkAmp;
    const armA = (0.38 + runK * 0.55) * walkAmp;
    const breathe = Math.sin(this.t * 2.2) * 0.01 * (1 - walkAmp);

    for (let i = 0; i < 2; i++) {
      const ph = p + i * Math.PI;
      const s = Math.sin(ph), c = Math.cos(ph);
      // Thigh: negative x-rotation swings the foot forward. Knee bends most mid-swing (thigh moving forward).
      let th = -thighA * s;
      let kn = kneeA * Math.max(0, c) ** 1.4 + 0.08 * walkAmp;
      // Airborne: tuck one knee up, trail the other
      th = th * (1 - A) + (i === 0 ? -0.85 : 0.25) * A;
      kn = kn * (1 - A) + (i === 0 ? 1.25 : 0.55) * A;
      this.thigh[i].rotation.x = th;
      this.shin[i].rotation.x = kn;
      // Arms counter-swing: left arm goes back as the left leg goes forward
      const ar = armA * s * (1 - A) + (i === 0 ? 0.5 : -1.1) * A;
      this.upper[i].rotation.x = ar;
      this.fore[i].rotation.x = -(0.25 + runK * 0.95) * walkAmp * (1 - A) - 0.15 - (i === 0 ? 0.3 : 0.8) * A;
      this.upper[i].rotation.z = (i === 0 ? 1 : -1) * (0.08 + 0.15 * A);
    }

    // Body: double-frequency bob, forward lean when running, hip sway, lean into turns
    const bob = (0.025 + runK * 0.045) * walkAmp * (Math.cos(p * 2) * 0.5 + 0.5);
    this.pelvis.position.y = HIP_Y - bob + breathe - A * 0.05;
    this.pelvis.rotation.y = Math.sin(p) * 0.12 * walkAmp;
    this.torso.rotation.y = -Math.sin(p) * 0.2 * walkAmp;
    this.torso.rotation.x = 0.04 + runK * 0.2 + A * 0.1;
    this.head.rotation.x = -this.torso.rotation.x * 0.6;
    this.lean += (THREE.MathUtils.clamp(-turnRate * speed * 0.04, -0.25, 0.25) - this.lean) * Math.min(1, dt * 6);

    this.root.position.set(x, y, z);
    this.root.rotation.set(0, yaw, this.lean, 'YXZ');
  }
}
