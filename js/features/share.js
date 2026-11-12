// js/features/share.js — links that drop a friend where you are. ?at=x,z (metres) or ?at=a-place-name (searched
// like the map's search box, e.g. ?at=nehanda or ?at=eastgate), with &m=fly to arrive in the air. The options menu gets
// a "Share where you are" button (the phone's share sheet where there is one, otherwise the link is copied) and a
// "Made by" line pointing at the author's other projects.
import { track } from '../analytics.js';

const AUTHOR = { name: 'Simakk', url: 'https://simakk.co.za/?ref=harare3d' };
// The studio's other projects, most relevant to this audience first
const MORE = [
  { n: 'Rotapot', d: 'An AI treasurer for mukando, stokvels and diaspora savings rounds', url: 'https://rotapot.simakk.co.za/?ref=harare3d' },
  { n: 'Maat', d: 'Product intelligence for African markets', url: 'https://maat.simakk.co.za/?ref=harare3d' },
  { n: 'Lantern', d: 'A calm space for daily prayer', url: 'https://www.simakk.co.za/lantern?ref=harare3d' },
];

export default {
  init(ctx) {
    this.ctx = ctx;
    this.arrive();
    const st = document.createElement('style');
    st.textContent = `
#play-menu .share-row{border-top:1px solid #ffffff22;margin-top:18px;padding-top:14px;display:grid;gap:8px}
#play-menu .share-btn{padding:11px;border-radius:10px;border:1px solid #f5d453;background:#f5d453;color:#18201c;font:600 14px system-ui;cursor:pointer}
#play-menu .share-btn:focus-visible{outline:2px solid #fff;outline-offset:3px}
#play-menu .share-note{margin:0;font-size:12px;color:#8fa59b;min-height:1em}
#play-menu .made-by{margin:14px 0 0;font-size:12.5px;color:#b9c9c1}#play-menu .made-by a,#play-menu .more a{color:#f5d453}
#play-menu .more{margin:6px 0 0;padding:0 0 0 2px;list-style:none;display:grid;gap:5px;font-size:12.5px;color:#b9c9c1}#play-menu .more a{font-weight:650}
@media (max-width:600px){#credit .by{display:none}}`;
    document.head.appendChild(st);
    const menu = document.getElementById('play-menu');
    if (!menu) return;
    const row = document.createElement('div');
    row.className = 'share-row';
    row.innerHTML = `<button type="button" class="share-btn">Share where you are</button><p class="share-note" role="status"></p><p class="made-by">Made by <a href="${AUTHOR.url}" target="_blank" rel="noopener">${AUTHOR.name}</a>, a studio in Cape Town. More from us:</p><ul class="more">${MORE.map((m) => `<li><a href="${m.url}" target="_blank" rel="noopener">${m.n}</a> · ${m.d}</li>`).join('')}</ul>`;
    row.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => track('out-' + a.textContent.toLowerCase())));
    menu.appendChild(row);
    this.note = row.querySelector('.share-note');
    row.querySelector('.share-btn').onclick = () => this.share();
    const credit = document.getElementById('credit');
    if (credit && !credit.querySelector('.by')) credit.insertAdjacentHTML('afterbegin', `<span class="by">Made by <a href="${AUTHOR.url}" target="_blank" rel="noopener">${AUTHOR.name}</a> · </span>`);
  },

  where() {
    const c = this.ctx.controls, m = c.mode, p = m === 'fly' ? c.heli : m === 'drive' ? c.car : c.walk;
    return { x: Math.round(p.x), z: Math.round(p.z), fly: m === 'fly' };
  },

  link() {
    const { x, z, fly } = this.where();
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    return u.toString() + `?at=${x},${z}` + (fly ? '&m=fly' : ''); // a plain comma reads better than %2C in a chat
  },

  async share() {
    const url = this.link(), street = this.ctx.chaos?.street?.() || 'the CBD';
    const text = `I'm on ${street} in Harare 3D. Come find me:`;
    track('share');
    try {
      if (navigator.share && matchMedia('(pointer:coarse)').matches) {
        await navigator.share({ title: 'Harare 3D', text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${url}`);
      this.say('Link copied. Paste it into WhatsApp or anywhere.');
    } catch (e) {
      if (e?.name === 'AbortError') return;
      this.say(url); // no clipboard (insecure context or denied): show it to copy by hand
    }
  },

  say(msg) {
    if (!this.note) return;
    this.note.textContent = msg;
    clearTimeout(this.noteT);
    this.noteT = setTimeout(() => (this.note.textContent = ''), 6000);
  },

  // Follow an ?at= link once the world is up
  arrive() {
    const q = new URLSearchParams(location.search), at = q.get('at');
    if (!at) return;
    const nav = window.__harare?.nav;
    if (!nav) return;
    let x, z, spot;
    const m = at.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
    if (m) (x = +m[1]), (z = +m[2]);
    else {
      const hit = nav.geo.search(at.replace(/[-_+]/g, ' '), 1)[0];
      if (!hit) return console.warn('[harare] share: no place called', at);
      (x = hit.x), (z = hit.z), (spot = hit.spot);
    }
    if (!Number.isFinite(x) || Math.abs(x) > 6000 || Math.abs(z) > 6000) return;
    if (q.get('m') === 'fly') this.ctx.setMode('fly');
    nav.teleportTo(x, z, spot);
    track('arrive-by-link');
  },
};
