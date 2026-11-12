// js/features/chaos.js — the chaos meter. Powers that wreck things raise it (harare:chaos events from powers.js and
// heat-vision.js); rescues lower it (catching a falling car, setting one down, punching out a fire). It eases back
// down once things go quiet. Levels: Calm → Disturbance (the news picks it up) → Police called (sirens, red and blue
// at the edges of the screen, light bars on the police cars) → City on alert.
import { track } from '../analytics.js';

const TIERS = [
  { at: 0, name: 'Calm', color: '#4fbf7a' },
  { at: 25, name: 'Disturbance', color: '#f2c318' },
  { at: 50, name: 'Police called', color: '#ff7a2e' },
  { at: 80, name: 'City on alert', color: '#e8343a' },
];
// Headlines from a made-up local outlet; {s} is the street the hero is on
const NEWS = {
  explode: ['Car bursts into flames on {s}', 'Blast on {s}: witnesses describe "red beams from the eyes"'],
  slam: ['Mystery figure crashes into {s}, kombis sent flying', 'Tremor felt across the CBD near {s}'],
  crash: ['Kombi seen flying over {s}', '"It just fell out of the sky," says vendor on {s}'],
  fire: ['Small fires reported along {s}', 'Jacaranda catches fire on {s}'],
  zap: ['Pedestrians flee red beams on {s}'],
  tier2: ['ZRP dispatched to {s} after reports of a flying vandal', 'Police sirens across town as chaos spreads from {s}'],
  tier3: ['City on alert: CBD workers urged to stay indoors', 'Traffic chaos as caped figure tears through {s}'],
  rescue: ['Caped stranger catches a falling car on {s}', 'Mystery hero tidies up a wreck on {s}', 'Fire on {s} put out with a single punch'],
  calm: ['CBD back to normal after a chaotic afternoon'],
};
const pick = (list) => list[Math.floor(Math.random() * list.length)];

export default {
  init(ctx) {
    this.ctx = ctx;
    this.level = 0;
    this.quiet = 0;
    this.tier = 0;
    this.newsT = 0;
    ctx.chaos = this;
    const st = document.createElement('style');
    st.textContent = `
.chaos{position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:9;width:230px;padding:7px 10px 9px;border-radius:12px;background:rgba(18,16,22,.62);border:1px solid rgba(255,255,255,.1);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#f6f1e8;font:12px/1.2 system-ui,sans-serif;pointer-events:none;transition:opacity .4s}
.chaos[hidden]{display:block;opacity:0}
.chaos-top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}
.chaos-top b{font-size:9.5px;letter-spacing:.12em;color:rgba(246,241,232,.55)}
.chaos-top span{font-weight:700}
.chaos-track{height:6px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden;position:relative}
.chaos-track i{position:absolute;inset:0 auto 0 0;width:0;border-radius:3px;transition:width .25s,background .4s}
.chaos-track::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent 24.6%,rgba(0,0,0,.5) 24.6% 25.4%,transparent 25.4% 49.6%,rgba(0,0,0,.5) 49.6% 50.4%,transparent 50.4% 79.6%,rgba(0,0,0,.5) 79.6% 80.4%,transparent 80.4%)}
.chaos.bump{animation:chaos-bump .3s}
@keyframes chaos-bump{30%{transform:translateX(-50%) scale(1.06)}}
.chaos-pop{position:fixed;left:50%;top:62px;transform:translateX(-50%);z-index:9;font:800 14px system-ui,sans-serif;pointer-events:none;animation:chaos-pop 1.4s ease-out forwards;text-shadow:0 1px 3px rgba(0,0,0,.6)}
@keyframes chaos-pop{0%{opacity:0;transform:translate(-50%,6px)}15%{opacity:1;transform:translate(-50%,0)}100%{opacity:0;transform:translate(-50%,-18px)}}
.news{position:fixed;left:50%;top:70px;width:max-content;transform:translateX(-50%) translateY(-8px);z-index:9;max-width:min(92vw,560px);display:flex;align-items:stretch;border-radius:8px;overflow:hidden;box-shadow:0 6px 20px rgba(0,0,0,.35);opacity:0;transition:opacity .35s,transform .35s;pointer-events:none;font:600 13px/1.25 system-ui,sans-serif}
.news.on{opacity:1;transform:translateX(-50%)}
.news b{background:#d8343a;color:#fff;padding:7px 9px;font-size:10.5px;letter-spacing:.08em;display:flex;align-items:center;white-space:nowrap}
.news span{background:rgba(250,248,242,.95);color:#1b1a18;padding:7px 11px}
.news small{display:block;font:700 9px/1 system-ui,sans-serif;letter-spacing:.1em;color:#8a8478;margin-bottom:3px}
.sirens{position:fixed;inset:0;z-index:4;pointer-events:none;opacity:0;transition:opacity .6s}
.sirens.on{animation:sirens .9s steps(1) infinite}
@keyframes sirens{0%{box-shadow:inset 90px 0 110px -70px rgba(255,30,40,.95),inset -90px 0 110px -70px rgba(30,70,255,.55)}50%{box-shadow:inset 90px 0 110px -70px rgba(30,70,255,.95),inset -90px 0 110px -70px rgba(255,30,40,.55)}}
body.gm-has-touch .chaos{width:150px;padding:5px 8px 7px;font-size:11px}
@media (max-width:600px) and (orientation:portrait){body.gm-has-touch .chaos{left:auto;right:10px;top:168px;transform:none}body.gm-has-touch .chaos.bump{animation:none}body.gm-has-touch .news,body.gm-has-touch .news.on{top:62px;z-index:21;left:10px;right:10px;width:auto;max-width:none;transform:none;font-size:12px}body.gm-has-touch .chaos-pop{left:auto;right:30px;top:212px;transform:none}}
@media (max-height:500px) and (orientation:landscape){body.gm-has-touch .chaos{top:50px}body.gm-has-touch .news{top:96px;max-width:calc(100vw - 300px);font-size:12px}body.gm-has-touch .chaos-pop{top:96px}}`;
    document.head.appendChild(st);
    const el = (this.el = document.createElement('div'));
    el.className = 'chaos';
    el.hidden = true;
    el.setAttribute('role', 'meter');
    el.setAttribute('aria-label', 'Chaos');
    el.innerHTML = '<div class="chaos-top"><b>CHAOS</b><span>Calm</span></div><div class="chaos-track"><i></i></div>';
    this.label = el.querySelector('span');
    this.fill = el.querySelector('i');
    document.body.appendChild(el);
    this.news = document.createElement('div');
    this.news.className = 'news';
    this.news.setAttribute('role', 'status');
    this.news.innerHTML = '<b>BREAKING</b><span><small>SUNSHINE CITY NEWS</small><em></em></span>';
    this.newsText = this.news.querySelector('em');
    this.newsText.style.fontStyle = 'normal';
    document.body.appendChild(this.news);
    this.sirens = document.createElement('div');
    this.sirens.className = 'sirens';
    document.body.appendChild(this.sirens);
    addEventListener('harare:chaos', (e) => this.add(e.detail));
  },

  street() {
    const s = document.querySelector('.blade span')?.textContent?.trim();
    if (!s) return 'the CBD';
    return s.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()).replace(/\bAve\b/, 'Avenue').replace(/\bSt\b/, 'Street');
  },

  add({ n, kind, label }) {
    const before = this.level;
    this.level = Math.max(0, Math.min(100, this.level + n));
    if (n > 0) this.quiet = 0;
    if (Math.abs(this.level - before) >= 1 || label) this.pop(n, label);
    if (n > 0 && Math.abs(n) >= 3) {
      this.el.classList.remove('bump');
      void this.el.offsetWidth;
      this.el.classList.add('bump');
    }
    // The news picks up big moments (and rescues), at most every 12 s
    if (this.newsT <= 0 && ((n >= 5 && this.level >= 20) || n <= -8) && NEWS[n < 0 ? 'rescue' : kind]) this.headline(pick(NEWS[n < 0 ? 'rescue' : kind]));
  },

  pop(n, label) {
    const el = document.createElement('div');
    el.className = 'chaos-pop';
    el.style.color = n < 0 ? '#7ee39e' : '#ffb27a';
    el.textContent = (label ? label + '  ' : '') + (n > 0 ? '+' : '−') + Math.abs(Math.round(n));
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  },

  headline(text) {
    this.newsT = 12;
    this.newsText.textContent = text.replace('{s}', this.street());
    this.news.classList.add('on');
    clearTimeout(this.newsHide);
    this.newsHide = setTimeout(() => this.news.classList.remove('on'), 6500);
  },

  update(dt) {
    this.newsT -= dt;
    this.quiet += dt;
    // Things calm down by themselves once you stop
    if (this.quiet > 6 && this.level > 0) this.level = Math.max(0, this.level - dt * (this.level > 50 ? 2.2 : 1.6));
    let tier = 0;
    for (let i = 0; i < TIERS.length; i++) if (this.level >= TIERS[i].at) tier = i;
    // a little hysteresis on the way down so the sirens don't flicker on the threshold
    if (tier < this.tier && this.level > TIERS[this.tier].at - 6) tier = this.tier;
    if (tier !== this.tier) {
      if (tier > this.tier && tier >= 2) this.headline(pick(NEWS['tier' + tier])), track(tier >= 3 ? 'city-on-alert' : 'police-called');
      if (tier === 0 && this.tier >= 2) this.headline(pick(NEWS.calm));
      this.tier = tier;
      this.label.textContent = TIERS[tier].name;
      this.fill.style.background = TIERS[tier].color;
    }
    this.fill.style.width = this.level.toFixed(1) + '%';
    this.el.hidden = this.level < 0.5 && this.quiet > 3;
    const police = tier >= 2;
    this.sirens.classList.toggle('on', police);
    this.sirens.style.opacity = police ? (tier >= 3 ? 0.6 : 0.35) : 0;
    this.lightBars(police);
    this.siren(police ? (tier >= 3 ? 1 : 0.6) : 0);
  },

  // Police cars in traffic switch their light bars on while the police are out
  lightBars(on) {
    const tr = this.ctx.traffic;
    if (on === this.barsOn || !tr.renderer.setOpt) return;
    this.barsOn = on;
    for (const car of tr.cars) if (car.type === 'police') tr.renderer.setOpt(car.ri, 4, on);
  },

  // A two-tone wail somewhere across town, louder at City on alert; follows the mute switch
  siren(level) {
    const S = this.ctx.sound;
    if (!S?.ac || (!this.snd && !level)) return;
    if (!this.snd) {
      const ac = S.ac, osc = ac.createOscillator(), lfo = ac.createOscillator(), depth = ac.createGain(), tone = ac.createBiquadFilter(), out = ac.createGain();
      osc.type = 'triangle';
      osc.frequency.value = 950;
      lfo.type = 'sine';
      lfo.frequency.value = 0.32;
      depth.gain.value = 330;
      lfo.connect(depth).connect(osc.frequency);
      tone.type = 'lowpass';
      tone.frequency.value = 2200;
      out.gain.value = 0;
      osc.connect(tone).connect(out).connect(S.out);
      osc.start();
      lfo.start();
      this.snd = out;
    }
    this.snd.gain.setTargetAtTime(S.on ? level * 0.05 : 0, S.ac.currentTime, 0.4);
  },
};
