// js/features/telekinesis.js — how the lift power looks. The hero holds a car up by telekinesis, not by hand: the model has
// no lift animation, and arms bent onto a chassis never quite met it. So the raised palm glows, the car floats inside a
// shimmering field lit from below that sheds motes of light, dust lifts off the street as it rises, and a throw goes
// off in a burst of light.
// The motion itself (float, bob, rock, the raised arm) is in js/features/powers.js; this file only draws.
const CYAN = [0.5, 0.95, 1];

export default {
  init(ctx) {
    const T = (this.T = ctx.THREE);
    this.ctx = ctx;
    this.uni = { uTime: { value: 0 }, uA: { value: 0 } };
    // The field: a soft shell around the car, bright at its rim and faint face-on, with bands of light running up it
    const fieldMat = new T.ShaderMaterial({
      uniforms: this.uni,
      transparent: true,
      depthWrite: false,
      // normal blending: an additive glow vanishes against a bright daytime sky; this one reads as light on any background
      vertexShader: /* glsl */ `varying vec3 vN, vV, vP;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `uniform float uTime, uA; varying vec3 vN, vV, vP;
        void main() {
          // a halo at the silhouette only: face-on it is clear, so the car itself stays crisp
          float rim = smoothstep(0.55, 1.0, 1.0 - abs(dot(vN, vV)));
          float band = 0.55 + 0.45 * sin(vP.y * 10.0 - uTime * 6.0 + sin(vP.x * 6.0 + uTime * 2.0) * 1.6);
          float a = clamp(rim * rim * band * 1.4, 0.0, 0.9) * uA;
          vec3 col = mix(vec3(0.25, 0.85, 1.0), vec3(0.85, 1.0, 1.0), rim * band);
          gl_FragColor = vec4(col * 1.25, a);
        }`,
    });
    this.field = new T.Mesh(new T.SphereGeometry(1, 28, 18), fieldMat);
    this.field.visible = false;
    this.field.frustumCulled = false;
    this.field.renderOrder = 6;
    ctx.scene.add(this.field);
    // The palm: a cyan glow on the raised hand
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g2 = cv.getContext('2d'), grad = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(230,255,255,1)');
    grad.addColorStop(0.3, 'rgba(110,230,255,.7)');
    grad.addColorStop(1, 'rgba(60,200,255,0)');
    g2.fillStyle = grad;
    g2.fillRect(0, 0, 64, 64);
    const glowTex = new T.CanvasTexture(cv);
    this.palm = new T.Sprite(new T.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false }));
    this.palm.material.color.setScalar(1.8);
    this.palm.visible = false;
    this.palm.renderOrder = 7;
    ctx.scene.add(this.palm);
    // Under-glow: a cyan light pool on the car's underside, the clearest cue that it is held up by something
    this.under = new T.Sprite(new T.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false }));
    this.under.material.color.setScalar(1.4);
    this.under.visible = false;
    this.under.renderOrder = 7;
    ctx.scene.add(this.under);
    this.a = 0;
    this.last = null;
  },

  update(dt, ctx) {
    const P = ctx.powers, T = this.T;
    if (!P) return;
    this.uni.uTime.value += dt;
    const held = P.held?.state === 'held' ? P.held : null;
    // Just picked up (or caught): dust bursts off the street under it
    if (held && held !== this.last) this.dust(held, 22, 4.5);
    // Just thrown: a burst of light the way it goes and a jolt of the camera
    if (!held && this.last && this.last.state === 'air') this.push(this.last);
    if (held) this.trail = held;
    this.last = held;

    // The field fades in as the car rises and out quickly after it leaves the hand (following it a moment)
    this.a += ((held ? 1 : 0) - this.a) * (1 - Math.exp(-dt * (held ? 6 : 9)));
    const f = held || (this.a > 0.02 ? this.trail : null);
    this.field.visible = !!f && this.a > 0.02;
    if (this.field.visible) {
      const g = f.group, h = f.half;
      this.field.position.copy(g.position);
      this.field.quaternion.copy(g.quaternion);
      this.field.scale.set(h.x * 1.3 + 0.3, h.y * 1.45 + 0.3, h.z * 1.12 + 0.3);
      this.uni.uA.value = this.a * (0.85 + 0.15 * Math.sin(this.uni.uTime.value * 9));
    }
    this.under.visible = this.field.visible;
    if (this.under.visible) {
      const g = f.group, h = f.half;
      this.under.position.set(g.position.x, g.position.y - h.y * 0.95, g.position.z);
      this.under.scale.setScalar((Math.max(h.x, h.z) * 1.6 + 0.6) * (0.92 + Math.sin(this.uni.uTime.value * 7) * 0.08));
      this.under.material.opacity = this.a;
    }
    if (held) {
      const g = held.group.position, h = held.half, j = () => Math.random() - 0.5;
      // motes of light drifting up off the underside, and dust still lifting while it rises
      if ((this.moteT = (this.moteT || 0) - dt) < 0) {
        this.moteT = 0.03;
        P.fire.emit(g.x + j() * h.x * 2.2, g.y - h.y * 0.9, g.z + j() * h.z * 2, j() * 0.6, 0.9 + Math.random() * 1.1, j() * 0.6, 0.9 + Math.random() * 0.6, 0.2 + Math.random() * 0.12, CYAN, 1, 0.1, 0.8, 0.4);
      }
      if (held.lift < 0.8 && Math.random() < 0.5) this.dust(held, 2, 2);
    }
    // the raised palm
    const hand = P.bones?.hand_r;
    this.palm.visible = !!held && !!hand && ctx.controls.player.visible;
    if (this.palm.visible) {
      hand.getWorldPosition(this.palm.position);
      this.palm.scale.setScalar(0.75 + Math.sin(this.uni.uTime.value * 11) * 0.1);
      this.palm.material.opacity = Math.min(1, this.a * 1.2);
    }
  },

  // A puff ring of street dust around the car's footprint (the street under it, not the car's height)
  dust(p, n, speed) {
    const P = this.ctx.powers, c = this.ctx.controls, g = p.group.position, r = Math.max(p.half.x, p.half.z);
    const y = c.surfaceY(g.x, g.z, g.y) + 0.15;
    if (g.y - y > 12) return; // high in the air: nothing to kick up
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.6 + Math.random() * 0.6);
      P.smoke.emit(g.x + Math.sin(a) * r * 0.8, y, g.z + Math.cos(a) * r * 0.8, Math.sin(a) * s, 0.4 + Math.random() * 0.8, Math.cos(a) * s, 1.1 + Math.random() * 0.6, 0.7 + Math.random() * 0.5, [0.62, 0.57, 0.5], 0.42, 2.2, 2.2, 0.2);
    }
  },

  push(p) {
    const P = this.ctx.powers, g = p.group.position, v = p.vel, j = () => Math.random() - 0.5;
    const r = Math.max(p.half.x, p.half.y, p.half.z);
    const n = v.clone().normalize();
    for (let i = 0; i < 40; i++) P.fire.emit(g.x + j() * r, g.y + j() * r, g.z + j() * r, n.x * 9 + j() * 8, n.y * 9 + j() * 8, n.z * 9 + j() * 8, 0.5 + Math.random() * 0.3, 0.2 + Math.random() * 0.1, CYAN, 1, 0.2, 2.5, 0);
    const rig = this.ctx.controls.rig;
    rig.shake = Math.max(rig.shake || 0, 0.35);
  },
};
