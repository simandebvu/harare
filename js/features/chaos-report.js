// js/features/chaos-report.js — once a rampage dies down (the chaos meter climbed to at least Disturbance and has eased
// back to Calm) a report card tallies it: an estimated damage bill, cars thrown and blown up, fires, slams, rescues,
// and the street it centred on. "Share report" makes a 1080 × 1350 picture with the best moment as the backdrop.
import { reportCard, sendImage } from '../shot.js';
import { track } from '../analytics.js';

const PEAKS = ['Calm', 'Disturbance', 'Police called', 'City on alert'];
// a cartoon bill, in US dollars
const COST = { crash: 4500, explode: 22000, slam: 1800, fire: 1200, tree: 800, scorch: 150 };
const money = (n) => 'US$' + Math.round(n).toLocaleString('en-US');

export default {
  init(ctx) {
    this.ctx = ctx;
    this.reset();
    const st = document.createElement('style');
    st.textContent = `
.chaos-report{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%) scale(.96);z-index:31;width:min(400px,calc(100vw - 32px));box-sizing:border-box;padding:0 0 16px;border-radius:16px;overflow:hidden;background:#14211ff7;color:#edf5ee;border:1px solid #ffffff30;box-shadow:0 16px 60px #0009;font:14px/1.4 system-ui,sans-serif;opacity:0;pointer-events:none;transition:opacity .3s,transform .3s}
.chaos-report.on{opacity:1;transform:translate(-50%,-50%);pointer-events:auto}
.chaos-report header{display:flex;align-items:stretch;font-weight:700}
.chaos-report header b{background:#d8343a;color:#fff;padding:9px 11px;font-size:11px;letter-spacing:.08em;display:flex;align-items:center}
.chaos-report header span{background:#faf8f2;color:#1b1a18;padding:8px 12px;font-size:13px;flex:1}
.chaos-report .bill{padding:14px 18px 2px}.chaos-report .bill small{display:block;color:#8fa59b;font-size:10.5px;letter-spacing:.12em;font-weight:700}
.chaos-report .bill strong{display:block;font-size:34px;line-height:1.15;color:#f5d453}
.chaos-report .bill p{margin:0;color:#b9c9c1;font-size:12.5px}
.chaos-report ul{list-style:none;margin:10px 18px 14px;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;font-size:13px;color:#d8e3dd}
.chaos-report li b{color:#fff;font-size:16px;margin-right:5px}
.chaos-report .acts{display:flex;gap:9px;padding:0 18px}
.chaos-report .tip{display:block;margin:10px 18px 0;text-align:center;color:#f5d453;font:600 13px system-ui;text-decoration:none}
.chaos-report button{flex:1;padding:11px;border-radius:10px;border:1px solid #ffffff38;background:#273d36;color:#fff;font:600 14px system-ui;cursor:pointer}
.chaos-report button.primary{background:#f5d453;color:#18201c;border-color:#f5d453}
.chaos-report button:focus-visible{outline:2px solid #fff;outline-offset:3px}
.chaos-report .note{margin:8px 18px 0;font-size:12px;color:#8fa59b;min-height:1em}
body.photo-mode .chaos-report{display:none}`;
    document.head.appendChild(st);
    const el = (this.el = document.createElement('section'));
    el.className = 'chaos-report';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Damage report');
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      if (e.target.closest('a.tip')) return track('tip-report');
      const b = e.target.closest('button');
      if (b?.dataset.do === 'share') this.share();
      else if (b?.dataset.do === 'close') this.hide();
    });
    addEventListener('harare:chaos', (e) => this.add(e.detail));
  },

  reset() {
    this.t = { lift: 0, crash: 0, explode: 0, slam: 0, fire: 0, tree: 0, scorch: 0, zap: 0, catch: 0, repair: 0, out: 0 };
    this.damage = 0;
    this.peak = 0;
    this.street = '';
    this.frame = null;
    this.frameLevel = -1;
    this.shotT = 0;
  },

  add({ n, kind, label }) {
    const t = this.t, ch = this.ctx.chaos;
    if (kind === 'fire') {
      if (n >= 5) t.tree++;
      else if (n >= 3) t.fire++;
      else t.scorch++;
    } else if (kind === 'rescue') {
      if (/Caught/.test(label)) t.catch++;
      else if (/Fire/.test(label)) t.out++;
      else t.repair++;
    } else if (kind in t) t[kind]++;
    const cost = kind === 'fire' ? (n >= 5 ? COST.tree : n >= 3 ? COST.fire : COST.scorch) : kind === 'slam' ? COST.slam * Math.max(1, n - 2) : COST[kind] || 0;
    this.damage += cost;
    // remember the street and a frame from the wildest moment so far (at most one grab every 2 s)
    const lvl = ch?.level || 0;
    if (n >= 3 && lvl >= this.frameLevel && this.shotT <= 0) {
      this.shotT = 2;
      this.frameLevel = lvl;
      this.street = ch?.street?.() || this.street;
      this.ctx.snapshot?.().then((f) => (this.frame = f));
    }
  },

  update(dt) {
    const ch = this.ctx.chaos;
    if (!ch) return;
    this.shotT -= dt;
    this.peak = Math.max(this.peak, ch.tier || 0);
    // a rampage that reached Disturbance is over once the meter is back near zero
    if (this.peak >= 1 && ch.level < 1 && ch.quiet > 6) this.show();
    else if (this.peak === 0 && ch.level < 0.5) this.reset();
  },

  report() {
    const t = this.t, rows = [];
    const add = (n, one, many) => n > 0 && rows.push([n, n === 1 ? one : many]);
    add(t.explode, 'car blown up', 'cars blown up');
    add(t.crash, 'car sent flying', 'cars sent flying');
    add(t.lift, 'car lifted', 'cars lifted');
    add(t.slam, 'slam', 'slams');
    add(t.fire, 'fire started', 'fires started');
    add(t.tree, 'tree set alight', 'trees set alight');
    add(t.zap, 'person startled', 'people startled');
    const saves = t.catch + t.repair + t.out;
    add(saves, 'rescue', 'rescues');
    const street = this.street || 'the CBD';
    const bad = t.explode + t.crash + t.tree + t.fire;
    const headline =
      saves > bad ? `Hero or menace? Caped stranger tidies up ${street}` :
      t.explode >= 3 ? `${t.explode} cars blown up as caped figure rampages on ${street}` :
      t.tree >= 2 ? `Jacarandas ablaze on ${street}` :
      `CBD counts the cost after chaos on ${street}`;
    return { headline, damage: money(this.damage), street, peak: PEAKS[this.peak], rows };
  },

  show() {
    const r = (this.last = this.report());
    this.lastFrame = this.frame;
    this.reset();
    if (!r.rows.length) return;
    this.el.innerHTML = `<header><b>BREAKING</b><span>${esc(r.headline)}</span></header><div class="bill"><small>DAMAGE REPORT</small><strong>${r.damage}</strong><p>around ${esc(r.street)} · peak: ${r.peak}</p></div><ul>${r.rows.map(([n, l]) => `<li><b>${n}</b>${l}</li>`).join('')}</ul><div class="acts"><button type="button" class="primary" data-do="share">Share report</button><button type="button" data-do="close">Keep playing</button></div>${this.ctx.tip ? `<a class="tip" href="${esc(this.ctx.tip.url)}" target="_blank" rel="noopener">☕ ${esc(this.ctx.tip.label)}</a>` : ''}<p class="note" role="status"></p>`;
    this.el.classList.add('on');
    track('chaos-report');
    clearTimeout(this.hideT);
    this.hideT = setTimeout(() => this.hide(), 30000);
  },

  hide() {
    this.el.classList.remove('on');
    clearTimeout(this.hideT);
  },

  async share() {
    const note = this.el.querySelector('.note');
    note.textContent = 'Making the picture…';
    const how = await sendImage(reportCard(this.lastFrame, this.last), 'harare3d-damage-report', `${this.last.damage} in damage on ${this.last.street}. Can you top it? Harare3D:`);
    track('report-' + how);
    note.textContent = how === 'saved' ? 'Saved to your downloads' : how === 'shared' ? 'Shared' : how === 'failed' ? 'Could not make the picture' : '';
  },
};

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
