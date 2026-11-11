// js/features/powers-hud.js — tells the player they have powers and what each one will do right now.
// Desktop: a strip on top of the speed panel with the three keys and a live verb ("Lift kombi" when one is in reach,
// "Throw" while carrying, "Climb higher" when a slam isn't possible yet). Touch: the Lift / Slam / Heat buttons get the
// same verbs and glow when ready. Once, a callout introduces the powers.
const NAMES = { fit: 'car', sedan: 'car', police: 'police car', kombi: 'kombi', hilux: 'bakkie', pickup: 'bakkie', zupco: 'bus' };

export default {
  init(ctx) {
    this.ctx = ctx;
    const st = document.createElement('style');
    st.textContent = `
.powers-strip{width:286px;margin-bottom:8px;pointer-events:auto;display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--gm-line);border:1px solid var(--gm-line);border-radius:12px;overflow:hidden;backdrop-filter:blur(10px) saturate(1.2);-webkit-backdrop-filter:blur(10px) saturate(1.2);box-shadow:0 6px 24px rgba(0,0,0,.28)}
.powers-strip .pw{background:var(--gm-bg);padding:7px 8px 8px;display:grid;gap:3px;transition:background .2s,box-shadow .2s}
.powers-strip .pw b{font:700 9.5px/1 system-ui,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:var(--gm-text-3)}
.powers-strip .pw span{font:600 12.5px/1.15 system-ui,sans-serif;color:var(--gm-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.powers-strip .pw kbd{margin-right:5px}
.powers-strip .pw.off span{color:var(--gm-text-3)}
.powers-strip .pw.ready{background:rgba(242,195,24,.2);box-shadow:inset 0 -2px 0 var(--gm-gold)}
.powers-strip .pw.live{background:rgba(255,90,40,.26);box-shadow:inset 0 -2px 0 #ff6a30}
.powers-strip.intro{animation:pw-pulse 1.2s ease-in-out 5}
@keyframes pw-pulse{50%{box-shadow:0 0 0 3px rgba(242,195,24,.75),0 6px 24px rgba(0,0,0,.28)}}
.powers-callout{position:fixed;left:50%;top:22%;transform:translateX(-50%);z-index:30;max-width:min(92vw,440px);padding:12px 16px 13px;border-radius:14px;background:rgba(14,12,18,.86);color:#f6f1e8;font:14px/1.35 system-ui,sans-serif;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.35);border:1px solid rgba(242,195,24,.5)}
.powers-callout strong{display:block;font-size:16px;margin-bottom:4px;color:#f2c318}
.powers-callout kbd{font:600 11px/1 ui-monospace,monospace;padding:2px 5px;border-radius:4px;background:rgba(255,255,255,.14)}
.powers-callout button{margin-top:9px;border:0;border-radius:8px;padding:6px 14px;font:600 13px system-ui,sans-serif;background:#f2c318;color:#1d1a10;cursor:pointer}
body.gm-has-touch .powers-strip{display:none}
.gm-act.ready{box-shadow:0 0 0 3px rgba(242,195,24,.85)}
.gm-act.live{box-shadow:0 0 0 3px rgba(255,106,48,.9)}`;
    document.head.appendChild(st);
    const strip = (this.strip = document.createElement('div'));
    strip.className = 'powers-strip';
    strip.setAttribute('aria-label', 'Superpowers');
    strip.innerHTML = ['grab', 'slam', 'heat'].map((k) => `<div class="pw" data-pw="${k}"><b></b><span></span></div>`).join('');
    this.cells = Object.fromEntries([...strip.children].map((el) => [el.dataset.pw, { el, b: el.querySelector('b'), span: el.querySelector('span'), key: '' }]));
    // Clicking a cell works too (useful for a mouse player who hasn't found the keys yet)
    strip.addEventListener('pointerdown', (e) => {
      const k = e.target.closest('.pw')?.dataset.pw;
      if (k === 'heat') (this.stripHeat = true), dispatchEvent(new CustomEvent('harare:power-hold', { detail: { what: 'heat', on: true } }));
      else if (k) dispatchEvent(new CustomEvent('harare:power', { detail: k }));
    });
    addEventListener('pointerup', () => this.stripHeat && ((this.stripHeat = false), dispatchEvent(new CustomEvent('harare:power-hold', { detail: { what: 'heat', on: false } }))));
    let seen = false;
    try {
      seen = localStorage.getItem('harare-powers-intro') === '1';
    } catch {}
    this.introDue = !seen;
    this.t = 0;
    const used = () => this.dismissIntro();
    addEventListener('harare:power', used);
    addEventListener('harare:power-hold', used);
    addEventListener('keydown', (e) => /Key[GXZ]/.test(e.code) && used());
  },

  dismissIntro() {
    if (this.introDue) {
      this.introDue = false;
      try {
        localStorage.setItem('harare-powers-intro', '1');
      } catch {}
    }
    this.callout?.remove();
    this.callout = null;
  },

  showIntro() {
    const touch = document.body.classList.contains('gm-has-touch');
    const el = (this.callout = document.createElement('div'));
    el.className = 'powers-callout';
    el.setAttribute('role', 'status');
    el.innerHTML = touch
      ? `<strong>You have superpowers</strong>Walk up to a car and tap <b>Lift</b>, then tap again to throw it. <b>Slam</b> from the sky, hold <b>Heat</b> for heat vision.<br><button type="button">Got it</button>`
      : `<strong>You have superpowers</strong><kbd>G</kbd> lift a car, again to throw it · <kbd>X</kbd> slam down from the sky · hold <kbd>Z</kbd> for heat vision. They're listed above the speed panel.<br><button type="button">Got it</button>`;
    el.querySelector('button').onclick = () => this.dismissIntro();
    document.body.appendChild(el);
    this.strip.classList.add('intro');
    setTimeout(() => this.callout === el && this.dismissIntro(), 14000);
  },

  set(k, key, verb, state) {
    const c = this.cells[k];
    if (c.key !== key) (c.key = key), (c.b.innerHTML = key);
    if (c.span.textContent !== verb) c.span.textContent = verb;
    for (const s of ['ready', 'live', 'off']) c.el.classList.toggle(s, state === s);
    // touch buttons mirror it
    const btn = document.querySelector(`.gm-act[data-act="${k}"]`);
    if (btn) {
      const label = k === 'grab' ? (state === 'live' ? 'Throw' : 'Lift') : btn.textContent;
      if (btn.textContent !== label) btn.textContent = label;
      btn.classList.toggle('ready', state === 'ready');
      btn.classList.toggle('live', state === 'live');
    }
  },

  update(dt) {
    const ctx = this.ctx, P = ctx.powers, c = ctx.controls;
    if (!this.strip.isConnected) document.querySelector('.gm-hud')?.prepend(this.strip);
    const me = P?.hero();
    this.strip.hidden = !me;
    this.t += dt;
    if (this.introDue && !this.callout && me && this.t > 4 && !document.body.classList.contains('welcoming') && !document.querySelector('.look-hint:not([hidden])')) this.showIntro();
    if (!me) return;
    const fly = c.mode === 'fly';
    if (P.held) this.set('grab', '<kbd>G</kbd>Throw', `Throw ${NAMES[P.held.type] || 'car'}`, 'live');
    else if (P.ready) this.set('grab', '<kbd>G</kbd>Lift', `Lift ${NAMES[P.ready.car.type || 'kombi'] || 'car'}`, 'ready');
    else this.set('grab', '<kbd>G</kbd>Lift', fly ? 'Land first' : 'Get close', 'off');
    if (fly) {
      const h = c.heli, high = h.y - c.surfaceY(h.x, h.z, h.y) >= 4;
      this.set('slam', '<kbd>X</kbd>Slam', h.slam ? 'Slam!' : high ? 'Dive' : 'Go higher', h.slam ? 'live' : high ? '' : 'off');
    } else this.set('slam', '<kbd>X</kbd>Stomp', P.pound || P.stompA > 0 ? 'Stomp!' : 'Stomp', P.pound || P.stompA > 0 ? 'live' : '');
    const on = ctx.heatVision?.on;
    this.set('heat', '<kbd>Z</kbd>Heat', on ? 'Burning' : 'Hold', on ? 'live' : '');
  },
};
