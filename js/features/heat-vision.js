// js/features/heat-vision.js — hold Z (Heat on touch): twin beams from the hero's eyes to whatever is under the
// centre of the screen. The beam scorches streets and walls (marks fade after a while), lingering on one spot starts a
// small fire, cars overheat and blow up (js/features/powers.js does the wreck), and the crowd runs from it.
// The aim point is found by marching the camera ray through the city's own collision queries — no mesh raycasts.
import { groundY } from '../util.js';

const RANGE = 170, STEP = 0.5, OVERHEAT = 0.55, MARKS = 90, MARK_LIFE = 40, FIRES = 18, FIRE_LIFE = 8;

export default {
  init(ctx) {
    const T = (this.T = ctx.THREE);
    this.ctx = ctx;
    this.on = false;
    ctx.heatVision = this;
    this.v = { a: new T.Vector3(), b: new T.Vector3(), d: new T.Vector3(), up: new T.Vector3(0, 1, 0), q: new T.Quaternion() };
    // Beams: a hot core inside a soft glow, one pair per eye; unit length along +Y, scaled to reach the hit
    const cyl = (r) => new T.CylinderGeometry(r, r, 1, 10, 1, true).translate(0, 0.5, 0);
    const core = new T.MeshBasicMaterial({ color: 0xfff1d0, transparent: true, depthWrite: false, blending: T.AdditiveBlending });
    const glow = new T.MeshBasicMaterial({ color: 0xff3a10, transparent: true, opacity: 0.45, depthWrite: false, blending: T.AdditiveBlending });
    this.beams = [0, 1].map(() => {
      const g = new T.Group();
      g.add(new T.Mesh(cyl(0.022), core), new T.Mesh(cyl(0.09), glow));
      g.visible = false;
      g.frustumCulled = false;
      g.traverse((o) => (o.frustumCulled = false));
      ctx.scene.add(g);
      return g;
    });
    this.glowMat = glow;
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
    this.lastMark = new T.Vector3(1e9, 0, 0);
    this.fires = [];
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
    const pt = this.v.d;
    for (let t = skip; t < RANGE; t += STEP) {
      pt.copy(dir).multiplyScalar(t).add(from);
      for (const k of cands) {
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
        const n = dir.clone().setY(0).negate().normalize();
        return { point: pt.clone(), normal: n, surface: true };
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
    if (!active) {
      for (const b of this.beams) b.visible = false;
      this.flare.visible = false;
      return;
    }
    const cam = this.ctx.camera, dir = cam.getWorldDirection(new T.Vector3());
    const skip = Math.max(0.5, v.b.set(me.x, me.y + 1, me.z).sub(cam.position).dot(dir) + 0.8); // start past the hero
    const hit = (this.last = this.aim(cam.position.clone(), dir, skip));
    const eye = this.eyes(me).clone(), right = v.b.set(Math.cos(me.yaw), 0, -Math.sin(me.yaw));
    this.glowMat.opacity = 0.35 + Math.random() * 0.2;
    this.beams.forEach((b, i) => {
      const from = eye.clone().addScaledVector(right, i ? 0.034 : -0.034), d = hit.point.clone().sub(from), len = d.length();
      b.position.copy(from);
      b.quaternion.setFromUnitVectors(v.up, d.divideScalar(len || 1));
      b.scale.set(1, len, 1);
      b.visible = true;
    });
    this.flare.visible = !!hit.normal;
    if (!hit.normal) return;
    this.flare.position.copy(hit.point).addScaledVector(hit.normal, 0.15);
    this.flare.scale.setScalar(1.2 + Math.random() * 0.6);
    // Sparks and a wisp of smoke where it lands
    const j = () => Math.random() - 0.5, h = hit.point;
    for (let k = 0; k < 3; k++) P.fire.emit(h.x, h.y + 0.1, h.z, j() * 5 + hit.normal.x * 3, 2 + Math.random() * 4, j() * 5 + hit.normal.z * 3, 0.35 + Math.random() * 0.3, 0.18, [1, 0.6, 0.25], 1, 0, 0.6, -14);
    if (Math.random() < 0.3) P.smoke.emit(h.x, h.y + 0.2, h.z, j() * 0.4, 1 + Math.random(), j() * 0.4, 1.8, 0.7, [0.25, 0.24, 0.24], 0.4, 2, 1, 0.4);
    if ((this.scareT = (this.scareT || 0) - dt) < 0) (this.scareT = 0.3), this.ctx.people.scare(h.x, h.z, 9, 0);
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
    if (h.distanceTo(this.lastMark) > 0.45) this.mark(h, hit.normal);
    const key = Math.round(h.x / 2) + ',' + Math.round(h.y / 2) + ',' + Math.round(h.z / 2);
    const t = (this.heat.get(key) || 0) + dt;
    this.heat.set(key, t);
    if (t > 1.1 && !this.fires.some((f) => f.p.distanceTo(h) < 3)) {
      this.heat.delete(key);
      if (this.fires.length >= FIRES) this.fires.shift();
      this.fires.push({ p: h.clone(), n: hit.normal.clone(), age: 0, t: 0 });
    }
    if (this.heat.size > 400) this.heat.clear();
  },

  mark(p, n) {
    const m = this.marks[this.markNext];
    this.markNext = (this.markNext + 1) % MARKS;
    m.position.copy(p).addScaledVector(n, 0.03);
    m.lookAt(this.v.a.copy(m.position).add(n));
    m.scale.setScalar(0.7 + Math.random() * 0.5);
    m.userData.age = 0;
    m.visible = true;
    this.lastMark.copy(p);
  },

  updateMarks(dt) {
    for (const m of this.marks) {
      if (!m.visible) continue;
      const a = (m.userData.age += dt);
      if (a > MARK_LIFE) m.visible = false;
      else m.material.opacity = 0.78 * Math.min(1, (MARK_LIFE - a) / 6);
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
      P.fire.emit(p.x + j() * 0.9 + f.n.x * 0.3, p.y + 0.1, p.z + j() * 0.9 + f.n.z * 0.3, j() * 0.3, 1.2 + Math.random() * 1.4, j() * 0.3, 0.45 + Math.random() * 0.35, (0.6 + Math.random() * 0.5) * s, [1, 0.45 + Math.random() * 0.3, 0.1], 0.85, 0.3, 1.5, 2);
      if (Math.random() < 0.35) P.smoke.emit(p.x + j(), p.y + 1.2, p.z + j(), j() * 0.3, 1.5, j() * 0.3, 2.8, 1.2 * s, [0.14, 0.14, 0.15], 0.5, 2.2, 1, 0.5);
    }
  },
};
