// js/features/heat-vision.js — hold Z (Heat on touch): twin beams from the hero's eyes to whatever is under the
// centre of the screen. The beam scorches streets and walls (marks fade after a while), lingering on one spot starts a
// small fire, cars overheat and blow up (js/features/powers.js does the wreck), and the crowd runs from it.
// The aim point is found by marching the camera ray through the city's own collision queries — no mesh raycasts.
import { groundY } from '../util.js';
import { protectedAt } from '../protected.js';

const RANGE = 170, STEP = 0.5, OVERHEAT = 0.55, MARKS = 90, MARK_LIFE = 40, FIRES = 18, FIRE_LIFE = 8;

export default {
  init(ctx) {
    const T = (this.T = ctx.THREE);
    this.ctx = ctx;
    this.on = false;
    ctx.heatVision = this;
    this.v = { a: new T.Vector3(), b: new T.Vector3(), d: new T.Vector3(), up: new T.Vector3(0, 1, 0), q: new T.Quaternion() };
    // Beams: a white-hot core in a flickering orange glow in a faint heat haze, one per eye; unit length along +Y, scaled
    // to reach the hit. Each layer fades to nothing at its edges (by the angle to the view), so none reads as a tube.
    const cyl = (r) => new T.CylinderGeometry(r, r, 1, 12, 1, true).translate(0, 0.5, 0);
    this.beamTime = { value: 0 };
    const layer = (color, alpha, sharp, crackle) =>
      new T.ShaderMaterial({
        uniforms: { uTime: this.beamTime, uColor: { value: new T.Color(color) }, uA: { value: alpha } },
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
        toneMapped: false,
        vertexShader: /* glsl */ `varying float vEdge; varying vec3 vW;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
            vec3 n = mat3(modelMatrix) * normal, toCam = normalize(cameraPosition - w.xyz);
            vEdge = abs(dot(n, toCam)) / max(length(n), 1e-5);
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `uniform float uTime, uA; uniform vec3 uColor; varying float vEdge; varying vec3 vW;
          void main() {
            // pow() of a value a hair outside 0..1 is NaN on some GPUs, and bloom smears one NaN into black blocks
            float f = pow(clamp(vEdge, 0.0001, 1.0), ${sharp.toFixed(1)});
            float c = 1.0 - ${crackle.toFixed(2)} * (0.5 + 0.5 * sin(dot(vW, vec3(13.1, 17.7, 11.3)) - uTime * 55.0) * sin(dot(vW, vec3(5.3, -7.1, 9.7)) + uTime * 31.0));
            gl_FragColor = vec4(uColor * f * c * uA, 1.0);
          }`,
      });
    const core = layer(0xfff4dc, 1.6, 1.5, 0.15), glow = layer(0xff4a14, 0.9, 1.2, 0.45), haze = layer(0xff2a08, 0.28, 1.0, 0.3);
    this.beams = [0, 1].map(() => {
      const g = new T.Group();
      g.add(new T.Mesh(cyl(0.028), core), new T.Mesh(cyl(0.11), glow), new T.Mesh(cyl(0.3), haze));
      g.visible = false;
      g.frustumCulled = false;
      g.traverse((o) => (o.frustumCulled = false));
      ctx.scene.add(g);
      return g;
    });
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const c2 = canvas.getContext('2d'), grad = c2.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,240,200,1)');
    grad.addColorStop(0.25, 'rgba(255,120,40,.8)');
    grad.addColorStop(1, 'rgba(255,40,0,0)');
    c2.fillStyle = grad;
    c2.fillRect(0, 0, 64, 64);
    this.flare = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(canvas), transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
    this.flare.visible = false;
    ctx.scene.add(this.flare);
    const eyeMat = this.flare.material.clone();
    eyeMat.toneMapped = false;
    eyeMat.color.setScalar(1.6);
    this.eyeGlow = [0, 1].map(() => {
      const s = new T.Sprite(eyeMat);
      s.visible = false;
      s.renderOrder = 7;
      ctx.scene.add(s);
      return s;
    });
    // Scorch marks: a ring of reused discs, fading out once they are old (the city repairs itself)
    const markGeo = new T.CircleGeometry(0.5, 20);
    this.marks = Array.from({ length: MARKS }, () => {
      const m = new T.Mesh(markGeo, new T.MeshBasicMaterial({ color: 0x120c08, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.visible = false;
      m.userData.age = MARK_LIFE;
      ctx.scene.add(m);
      return m;
    });
    this.markNext = 0;
    this.cool = new T.Color(0x120c08);
    this.lastMark = new T.Vector3(1e9, 0, 0);
    this.fires = [];
    this.treeHeat = new Map();
    this.heat = new Map(); // 2 m cells of street or wall → seconds under the beam
    this.reticle = document.createElement('div');
    this.reticle.className = 'heat-reticle';
    const st = document.createElement('style');
    st.textContent = `.heat-reticle{position:fixed;left:50%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;border:2px solid rgba(255,120,60,.9);border-radius:50%;box-shadow:0 0 8px rgba(255,80,20,.8);pointer-events:none;z-index:9;display:none}.heat-reticle.on{display:block}`;
    document.head.appendChild(st);
    document.body.appendChild(this.reticle);
    const typing = (e) => /INPUT|TEXTAREA|SELECT/.test(e.target?.tagName) || e.target.closest?.('[popover]:popover-open');
    addEventListener('keydown', (e) => e.code === 'KeyZ' && !typing(e) && (this.on = true));
    addEventListener('keyup', (e) => e.code === 'KeyZ' && (this.on = false));
    addEventListener('blur', () => (this.on = false));
    addEventListener('harare:power-hold', (e) => e.detail?.what === 'heat' && (this.on = !!e.detail.on));
  },

  // Eyes: the hero model's head bone when there is one (it lies flat in flight), else a standing eye height
  eyes(me) {
    const c = this.ctx.controls, T = this.T;
    if (this.headOf !== c.player.imported?.root) (this.head = undefined), (this.headOf = c.player.imported?.root);
    if (this.head === undefined && c.player.imported) {
      this.head = null;
      c.player.imported.root?.traverse((o) => !this.head && o.isBone && /head$/i.test(o.name) && (this.head = o));
    }
    if (this.head) return this.head.getWorldPosition(this.v.a).add(this.v.b.set(Math.sin(me.yaw), 0, Math.cos(me.yaw)).multiplyScalar(0.12));
    return this.v.a.set(me.x + Math.sin(me.yaw) * 0.12, me.y + (c.mode === 'fly' ? 1.2 : 1.62), me.z + Math.cos(me.yaw) * 0.12);
  },

  // March the camera's centre ray: the first street, roof, wall or vehicle it meets
  aim(from, dir, skip) {
    const c = this.ctx.controls, tr = this.ctx.traffic, P = this.ctx.powers;
    const cands = [];
    const near = (x, y, z, r) => {
      const dx = x - from.x, dy = y - from.y, dz = z - from.z, t = dx * dir.x + dy * dir.y + dz * dir.z;
      if (t < skip - 3 || t > RANGE) return false;
      return (dx - dir.x * t) ** 2 + (dy - dir.y * t) ** 2 + (dz - dir.z * t) ** 2 < (r + 1) ** 2;
    };
    for (const car of tr.cars) if (car.init && !(car.away > 0) && near(car.x, groundY(car.x, car.z) + 1, car.z, car.len / 2)) cands.push({ car, parked: false, base: groundY(car.x, car.z) + 0.22 });
    for (const car of tr.parkedCars) if (!(car.away > 0) && near(car.x, car.y + 1, car.z, car.len / 2)) cands.push({ car, parked: true, base: car.y });
    for (const p of P.props) if (p !== P.held && near(p.group.position.x, p.group.position.y, p.group.position.z, Math.max(p.half.x, p.half.z))) cands.push({ prop: p });
    // People stop the beam too (it only startles them: cartoon rules), and so do tree crowns, which catch fire
    const ppl = this.ctx.people;
    for (const list of [ppl.walkers, ppl.loiter]) for (const q of list) {
      if (q.hidden || !Number.isFinite(q.x)) continue;
      const gy = groundY(q.x, q.z);
      if (near(q.x, gy + 0.9, q.z, 0.6)) cands.push({ person: q, gy });
    }
    const C = this.ctx.trees?.crowns;
    if (C) for (let i = 0; i < C.N; i++) if (!C.gone[i] && near(C.cx[i], C.cy[i], C.cz[i], C.cr[i])) cands.push({ tree: i, r: C.cr[i] * 0.75 });
    const pt = this.v.d;
    for (let t = skip; t < RANGE; t += STEP) {
      pt.copy(dir).multiplyScalar(t).add(from);
      for (const k of cands) {
        if (k.person) {
          const q = k.person;
          if ((pt.x - q.x) ** 2 + (pt.z - q.z) ** 2 < 0.12 && pt.y > k.gy && pt.y < k.gy + 1.8) return { point: pt.clone(), normal: dir.clone().negate(), target: k };
          continue;
        }
        if (k.tree !== undefined) {
          if ((pt.x - C.cx[k.tree]) ** 2 + (pt.y - C.cy[k.tree]) ** 2 + (pt.z - C.cz[k.tree]) ** 2 < k.r * k.r) return { point: pt.clone(), normal: dir.clone().negate(), target: k };
          continue;
        }
        if (k.prop) {
          const g = k.prop.group.position, r = Math.max(k.prop.half.x, k.prop.half.y, k.prop.half.z) * 0.8;
          if (pt.distanceToSquared(g) < r * r) return { point: pt.clone(), normal: dir.clone().negate(), target: k };
          continue;
        }
        const car = k.car, dx = pt.x - car.x, dz = pt.z - car.z, cs = Math.cos(car.h), sn = Math.sin(car.h);
        const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs, h = car.type === 'zupco' ? 3 : car.kombi || car.type === 'kombi' ? 2.1 : 1.6;
        if (Math.abs(lx) < car.width / 2 && Math.abs(lz) < car.len / 2 && pt.y > k.base && pt.y < k.base + h) return { point: pt.clone(), normal: dir.clone().negate(), target: k };
      }
      const floor = c.surfaceY(pt.x, pt.z, pt.y);
      if (pt.y <= floor + 0.02) return { point: pt.clone().setY(floor + 0.02), normal: this.v.up.clone(), surface: true };
      if (c.blocked(pt.x, pt.z, pt.y)) {
        // Back out to the wall face; the normal faces back along the beam (good enough for a soft round mark)
        pt.addScaledVector(dir, -STEP * 0.5);
        // Which way the wall faces: probe either side; a corner (or no answer) falls back to facing the beam
        const b = (x, z) => (c.blocked(x, z, pt.y) ? 1 : 0), e = 0.35;
        const n = new this.T.Vector3(b(pt.x - e, pt.z) - b(pt.x + e, pt.z), 0, b(pt.x, pt.z - e) - b(pt.x, pt.z + e));
        const flat = n.lengthSq() > 0; // 2 = a diagonal wall or an outside corner
        if (!flat) n.copy(dir).setY(0).negate();
        n.normalize();
        return { point: pt.clone(), normal: n, surface: true, wall: true, corner: !flat || Math.abs(n.x * n.z) > 0.1 };
      }
    }
    return { point: pt.copy(dir).multiplyScalar(RANGE).add(from).clone(), normal: null };
  },

  update(dt) {
    const P = this.ctx.powers, c = this.ctx.controls, T = this.T, v = this.v;
    const me = P?.hero(), active = this.on && !!me;
    c.rig.aim = (c.rig.aim || 0) + ((active ? 1 : 0) - (c.rig.aim || 0)) * (1 - Math.exp(-dt * 8));
    this.reticle.classList.toggle('on', active);
    this.updateMarks(dt);
    this.updateFires(dt);
    this.hum(active, dt);
    this.sacredT = (this.sacredT || 0) - dt;
    if (!active) {
      for (const b of this.beams) b.visible = false;
      for (const s of this.eyeGlow) s.visible = false;
      this.flare.visible = false;
      this.headW = 0;
      this.fireT = 0;
      return;
    }
    const cam = this.ctx.camera, dir = cam.getWorldDirection(new T.Vector3());
    const skip = Math.max(0.5, v.b.set(me.x, me.y + 1, me.z).sub(cam.position).dot(dir) + 0.8); // start past the hero
    const hit = (this.last = this.aim(cam.position.clone(), dir, skip));
    // On foot the hero squares up to the target while firing, so the beams leave the face and not over a shoulder
    if (c.mode === 'walk') {
      const want = Math.atan2(hit.point.x - me.x, hit.point.z - me.z), w = c.walk;
      w.yaw += Math.atan2(Math.sin(want - w.yaw), Math.cos(want - w.yaw)) * (1 - Math.exp(-dt * 10));
    }
    this.lookAt(hit.point, dt);
    const eye = this.eyes(me).clone(), right = v.b.set(Math.cos(me.yaw), 0, -Math.sin(me.yaw));
    this.beamTime.value += dt;
    // the beams shoot out from the eyes over a tenth of a second rather than appearing whole
    this.fireT = (this.fireT || 0) + dt;
    const reach = Math.min(1, this.fireT / 0.1), landed = reach >= 1;
    this.beams.forEach((b, i) => {
      const from = eye.clone().addScaledVector(right, i ? 0.034 : -0.034), d = hit.point.clone().sub(from), len = d.length();
      this.eyeGlow[i].position.copy(from);
      this.eyeGlow[i].visible = true;
      this.eyeGlow[i].scale.setScalar(0.26 + Math.random() * 0.08);
      b.position.copy(from);
      b.quaternion.setFromUnitVectors(v.up, d.divideScalar(len || 1));
      b.scale.set(0.85 + Math.random() * 0.3, len * reach, 0.85 + Math.random() * 0.3);
      b.visible = true;
    });
    this.flare.visible = !!hit.normal && landed;
    if (!hit.normal || !landed) return;
    this.flare.position.copy(hit.point).addScaledVector(hit.normal, 0.15);
    this.flare.scale.setScalar(1.9 + Math.random() * 0.9);
    // a slight shudder while it burns
    c.rig.shake = Math.max(c.rig.shake || 0, 0.14);
    // Sparks spraying off the surface, embers drifting up, a wisp of smoke
    const j = () => Math.random() - 0.5, h = hit.point;
    for (let k = 0; k < 6; k++) P.fire.emit(h.x, h.y + 0.1, h.z, j() * 7 + hit.normal.x * 4, 2.5 + Math.random() * 5, j() * 7 + hit.normal.z * 4, 0.3 + Math.random() * 0.35, 0.15 + Math.random() * 0.1, [1, 0.55 + Math.random() * 0.25, 0.2], 1, 0, 0.6, -14);
    if (Math.random() < 0.5) P.fire.emit(h.x + j(), h.y + 0.3, h.z + j(), j() * 0.6, 1 + Math.random() * 1.5, j() * 0.6, 1 + Math.random() * 0.8, 0.12, [1, 0.45, 0.1], 0.9, 0, 0.8, 1.2);
    if (Math.random() < 0.4) P.smoke.emit(h.x, h.y + 0.2, h.z, j() * 0.4, 1 + Math.random(), j() * 0.4, 1.8, 0.8, [0.22, 0.21, 0.21], 0.45, 2, 1, 0.4);
    if ((this.scareT = (this.scareT || 0) - dt) < 0) (this.scareT = 0.3), this.ctx.people.scare(h.x, h.z, 9, 0);
    // Protected places (the Nehanda statue, Parliament, churches): the beam glances off in a gold shimmer, no scorch, no fire
    const sacred = !hit.target || hit.target.tree !== undefined ? protectedAt(h.x, h.z) : null;
    if (sacred) {
      for (let k = 0; k < 2; k++) P.fire.emit(h.x, h.y + 0.1, h.z, j() * 3 + hit.normal.x * 4, 1 + Math.random() * 3, j() * 3 + hit.normal.z * 4, 0.5, 0.14, [1, 0.85, 0.4], 1, 0, 0.6, -6);
      if (!(this.sacredT > 0) || this.sacredName !== sacred) {
        this.sacredT = 8;
        this.sacredName = sacred;
        P.toast(sacred === 'Mbuya Nehanda' ? 'Mbuya Nehanda is protected · the beam glances off' : `The beam glances off ${/^(the|parliament)\b/i.test(sacred) ? sacred.replace(/^The\b/, 'the') : 'the ' + sacred}`);
      }
      return;
    }
    if (hit.target?.person) {
      if ((this.zapT = (this.zapT || 0) - dt) < 0) (this.zapT = 0.4), this.ctx.people.scare(h.x, h.z, 2.5, 0.8), P.chaos(1, 'zap');
      return;
    }
    if (hit.target?.tree !== undefined) {
      const i = hit.target.tree, C = this.ctx.trees.crowns;
      this.treeHeat.set(i, (this.treeHeat.get(i) || 0) + dt);
      if (this.treeHeat.get(i) > 0.8 && !this.fires.some((f) => f.tree === i)) {
        this.treeHeat.delete(i);
        if (this.fires.length >= FIRES) this.fires.shift();
        this.fires.push({ p: new this.T.Vector3(C.cx[i], C.cy[i] - C.cr[i] * 0.2, C.cz[i]), n: v.up.clone(), age: 0, t: 0, tree: i, spread: C.cr[i] * 0.9, big: 1.8 });
        P.chaos(5, 'fire');
      }
      return;
    }
    if (hit.target) {
      const k = hit.target, obj = k.prop || k.car;
      obj.heat = (obj.heat || 0) + dt;
      if (obj.heat > OVERHEAT) {
        obj.heat = k.prop ? -1.2 : 0; // a wreck can be blown up again, after a breather
        if (k.prop) P.explode(k.prop.car, k.prop.parked);
        else P.explode(k.car, k.parked);
      }
      return;
    }
    if ((this.scorchT = (this.scorchT || 0) + dt) > 1) (this.scorchT = 0), P.chaos(1, 'fire');
    if (h.distanceTo(this.lastMark) > 0.45) this.mark(h, hit.normal, hit.corner ? 0.45 : hit.wall ? 0.75 : 1);
    const key = Math.round(h.x / 2) + ',' + Math.round(h.y / 2) + ',' + Math.round(h.z / 2);
    const t = (this.heat.get(key) || 0) + dt;
    this.heat.set(key, t);
    if (t > 1.1 && !this.fires.some((f) => f.p.distanceTo(h) < 3)) {
      this.heat.delete(key);
      if (this.fires.length >= FIRES) this.fires.shift();
      this.fires.push({ p: h.clone(), n: hit.normal.clone(), age: 0, t: 0 });
      P.chaos(3, 'fire');
    }
    if (this.heat.size > 400) this.heat.clear();
  },

  // Turn the head toward what the beams are hitting (on top of the animation), within what a neck can do
  lookAt(target, dt) {
    const head = this.head, T = this.T;
    if (!head || !this.ctx.controls.player.visible) return;
    this.headW = Math.min(0.9, (this.headW || 0) + dt * 6);
    const model = this.ctx.controls.player.imported.root.children[0];
    const fwd = new T.Vector3(0, 0, 1).applyQuaternion(model.getWorldQuaternion(new T.Quaternion()));
    const want = target.clone().sub(head.getWorldPosition(new T.Vector3())).normalize();
    const turn = new T.Quaternion().setFromUnitVectors(fwd, want), angle = 2 * Math.acos(Math.min(1, Math.abs(turn.w)));
    if (angle > 1.1) turn.slerp(new T.Quaternion(), 1 - 1.1 / angle);
    const world = turn.multiply(head.getWorldQuaternion(new T.Quaternion()));
    head.quaternion.slerp(head.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(world), this.headW);
    head.updateMatrixWorld(true);
  },

  // A crackling electric hum while firing, louder and hissier where the beam is burning something
  hum(active, dt) {
    const S = this.ctx.sound;
    if (!S?.ac || (!this.snd && !active)) return;
    if (!this.snd) {
      const ac = S.ac, out = ac.createGain();
      out.gain.value = 0;
      out.connect(S.out);
      const a = ac.createOscillator(), b = ac.createOscillator(), tone = ac.createBiquadFilter();
      a.type = 'sawtooth';
      a.frequency.value = 92;
      b.type = 'square';
      b.frequency.value = 185.5;
      tone.type = 'lowpass';
      tone.frequency.value = 1100;
      const bg = ac.createGain();
      bg.gain.value = 0.35;
      a.connect(tone);
      b.connect(bg).connect(tone);
      tone.connect(out);
      const len = ac.sampleRate, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (Math.random() < 0.08 ? 1 : 0.25);
      const noise = ac.createBufferSource(), band = ac.createBiquadFilter(), hiss = ac.createGain();
      noise.buffer = buf;
      noise.loop = true;
      band.type = 'bandpass';
      band.frequency.value = 3200;
      band.Q.value = 0.7;
      hiss.gain.value = 0;
      noise.connect(band).connect(hiss).connect(out);
      a.start();
      b.start();
      noise.start();
      this.snd = { out, hiss, a };
    }
    const on = active && S.on, t = S.ac.currentTime, burning = on && this.last?.normal ? 1 : 0;
    this.snd.out.gain.setTargetAtTime(on ? 0.16 : 0, t, on ? 0.03 : 0.08);
    this.snd.hiss.gain.setTargetAtTime(burning * 0.9, t, 0.05);
    if (on) this.snd.a.frequency.setTargetAtTime(88 + Math.random() * 10, t, 0.02);
  },

  mark(p, n, size = 1) {
    const m = this.marks[this.markNext];
    this.markNext = (this.markNext + 1) % MARKS;
    m.position.copy(p).addScaledVector(n, 0.03);
    m.lookAt(this.v.a.copy(m.position).add(n));
    m.scale.setScalar((0.7 + Math.random() * 0.5) * size);
    m.userData.age = 0;
    m.material.color.setRGB(1, 0.42, 0.08); // molten for a moment, then it cools (updateMarks)
    m.visible = true;
    this.lastMark.copy(p);
  },

  updateMarks(dt) {
    for (const m of this.marks) {
      if (!m.visible) continue;
      const a = (m.userData.age += dt);
      if (a > MARK_LIFE) m.visible = false;
      else m.material.opacity = 0.78 * Math.min(1, (MARK_LIFE - a) / 6);
      if (a < 1.6) m.material.color.setRGB(1, 0.42, 0.08).lerp(this.cool, Math.min(1, a / 1.6) ** 0.6);
    }
  },

  // Small street fires: flames and smoke for a few seconds, then out
  updateFires(dt) {
    const P = this.ctx.powers;
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.age += dt;
      if (f.age > FIRE_LIFE) {
        this.fires.splice(i, 1);
        continue;
      }
      const s = Math.min(1, f.age * 2, (FIRE_LIFE - f.age) / 2);
      if ((f.t -= dt) > 0) continue;
      f.t = 0.06;
      const j = () => Math.random() - 0.5, p = f.p;
      const sp = f.spread || 0.9, big = f.big || 1;
      for (let k = 0; k < big; k++) P.fire.emit(p.x + j() * sp * 2 + f.n.x * 0.3, p.y + 0.1 + j() * sp * 0.6, p.z + j() * sp * 2 + f.n.z * 0.3, j() * 0.3, 1.2 + Math.random() * 1.4, j() * 0.3, 0.45 + Math.random() * 0.35, (0.6 + Math.random() * 0.5) * s * Math.sqrt(big), [1, 0.45 + Math.random() * 0.3, 0.1], 0.85, 0.3, 1.5, 2);
      if (Math.random() < 0.35 * big) P.smoke.emit(p.x + j() * sp, p.y + 1.2, p.z + j() * sp, j() * 0.3, 1.5, j() * 0.3, 2.8, 1.2 * s * big, [0.14, 0.14, 0.15], 0.5, 2.2, 1, 0.5);
    }
  },
};
