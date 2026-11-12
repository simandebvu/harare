// js/features/photo.js — photo mode: O (or "Photo mode" in the menu) clears the screen down to the city and a shutter.
// The city keeps running, so you can still look around, fly, or hold a kombi overhead for the shot. The picture gets a
// Harare3D strip with the street name, then goes to the share sheet (phones) or downloads.
import { photoCard, sendImage } from '../shot.js';
import { track } from '../analytics.js';

export default {
  init(ctx) {
    this.ctx = ctx;
    const st = document.createElement('style');
    st.textContent = `
body.photo-mode>*:not(#app):not(.photo-bar):not(.photo-flash):not(.power-toast){visibility:hidden!important}
body.photo-mode #app>:not(canvas){visibility:hidden!important}
.photo-bar{position:fixed;left:50%;bottom:calc(22px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:40;display:none;align-items:center;gap:14px;padding:8px 10px;border-radius:999px;background:rgba(14,18,20,.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
body.photo-mode .photo-bar{display:flex}
.photo-bar button{border:0;cursor:pointer;font:600 14px system-ui,sans-serif;color:#fff;background:rgba(255,255,255,.14);border-radius:999px;padding:10px 16px}
.photo-bar .shutter{width:64px;height:64px;padding:0;border-radius:50%;background:#fff;box-shadow:inset 0 0 0 4px #14211f,0 0 0 3px #fff}
.photo-bar .shutter:active{transform:scale(.94)}
.photo-bar button:focus-visible{outline:2px solid #f5d453;outline-offset:3px}
.photo-bar small{color:rgba(255,255,255,.75);font:12px system-ui,sans-serif;max-width:170px}
.photo-flash{position:fixed;inset:0;z-index:41;background:#fff;opacity:0;pointer-events:none;transition:opacity .35s}
.photo-flash.on{opacity:.8;transition:none}`;
    document.head.appendChild(st);
    const bar = (this.bar = document.createElement('div'));
    bar.className = 'photo-bar';
    bar.innerHTML = `<button type="button" class="photo-exit">Done</button><button type="button" class="shutter" aria-label="Take photo"></button><small class="photo-note" role="status">${matchMedia('(pointer:coarse)').matches ? 'Drag to frame it' : 'Move and look to frame it'}</small>`;
    document.body.appendChild(bar);
    this.note = bar.querySelector('.photo-note');
    this.flash = document.createElement('div');
    this.flash.className = 'photo-flash';
    document.body.appendChild(this.flash);
    bar.querySelector('.photo-exit').onclick = () => this.toggle(false);
    bar.querySelector('.shutter').onclick = () => this.take();
    addEventListener('keydown', (e) => {
      if (e.target.closest?.('input,select,textarea') || e.repeat) return;
      if (e.code === 'KeyO') this.toggle();
      else if (this.on && e.code === 'Escape') this.toggle(false);
      else if (this.on && (e.code === 'Enter' || e.code === 'KeyK')) this.take();
    });
    // a menu entry beside "Share where you are"
    const row = document.querySelector('#play-menu .share-row');
    if (row) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'share-btn photo-btn';
      b.textContent = 'Photo mode';
      b.style.cssText = 'background:transparent;color:#f5d453';
      b.onclick = () => (document.getElementById('play-menu')?.hidePopover?.(), this.toggle(true));
      row.insertBefore(b, row.querySelector('.share-note'));
    }
  },

  toggle(on = !this.on) {
    this.on = on;
    document.body.classList.toggle('photo-mode', on);
    if (on) track('photo-mode');
  },

  async take() {
    if (this.busy) return;
    this.busy = true;
    try {
      const frame = await this.ctx.snapshot();
      this.flash.classList.add('on');
      requestAnimationFrame(() => this.flash.classList.remove('on'));
      const street = this.ctx.chaos?.street?.() || '';
      const card = photoCard(frame, street === 'the CBD' ? '' : street);
      const how = await sendImage(card, 'harare3d-' + Date.now().toString(36), street && street !== 'the CBD' ? `${street}, Harare, in Harare3D` : 'Harare, in Harare3D');
      track('photo-' + how);
      this.note.textContent = how === 'saved' ? 'Saved to your downloads' : how === 'shared' ? 'Shared' : how === 'failed' ? 'Could not take that one' : 'Drag to frame it';
    } finally {
      this.busy = false;
    }
  },
};
