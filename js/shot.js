// js/shot.js — turning a frame of the city into something worth sending: a branded picture (photo mode) or a
// portrait damage report (the chaos report card), shared through the phone's share sheet (WhatsApp status, X, …)
// or saved as a file where there is none.
const URL_TEXT = 'simandebvu.github.io/harare';
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

// Copy `src` into a w × h box, cropping to fill it
function cover(g, src, x, y, w, h) {
  const s = Math.max(w / src.width, h / src.height), sw = w / s, sh = h / s;
  g.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, x, y, w, h);
}

function brand(g, x, y, size) {
  g.font = `800 ${size}px ${FONT}`;
  g.fillStyle = '#fff';
  g.fillText('Harare', x, y);
  const w = g.measureText('Harare').width;
  g.fillStyle = '#f5d453';
  g.fillText('3D', x + w, y);
  return w + g.measureText('3D').width;
}

// The frame with a strip along the bottom: Harare3D, where it was taken, the address
export function photoCard(frame, where) {
  const W = Math.min(frame.width, 1920), H = Math.round((W * frame.height) / frame.width);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d'), u = W / 1000;
  cover(g, frame, 0, 0, W, H);
  const grad = g.createLinearGradient(0, H - 120 * u, 0, H);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,.62)');
  g.fillStyle = grad;
  g.fillRect(0, H - 120 * u, W, 120 * u);
  g.textBaseline = 'alphabetic';
  const bw = brand(g, 26 * u, H - 26 * u, 30 * u);
  g.font = `600 ${15 * u}px ${FONT}`;
  g.fillStyle = 'rgba(255,255,255,.85)';
  g.fillText(where ? `${where}, Harare` : 'Harare', 26 * u + bw + 14 * u, H - 30 * u);
  g.textAlign = 'right';
  g.fillStyle = 'rgba(255,255,255,.7)';
  g.fillText(URL_TEXT, W - 24 * u, H - 30 * u);
  return c;
}

// 1080 × 1350 (a phone status / feed post): the frame on top, the news-style tally underneath
export function reportCard(frame, r) {
  const W = 1080, H = 1350, c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#14211f';
  g.fillRect(0, 0, W, H);
  const PH = 640;
  if (frame) cover(g, frame, 0, 0, W, PH);
  // the "BREAKING" banner across the bottom of the picture
  g.fillStyle = '#d8343a';
  g.fillRect(0, PH - 74, 250, 74);
  g.fillStyle = 'rgba(250,248,242,.96)';
  g.fillRect(250, PH - 74, W - 250, 74);
  g.font = `800 30px ${FONT}`;
  g.fillStyle = '#fff';
  g.textBaseline = 'middle';
  g.fillText('BREAKING', 34, PH - 37);
  g.fillStyle = '#1b1a18';
  g.font = `700 29px ${FONT}`;
  fit(g, r.headline, 276, PH - 37, W - 300);
  g.textBaseline = 'alphabetic';
  g.font = `700 22px ${FONT}`;
  g.fillStyle = '#8fa59b';
  g.fillText('DAMAGE REPORT · SUNSHINE CITY NEWS', 60, PH + 72);
  g.font = `800 92px ${FONT}`;
  g.fillStyle = '#f5d453';
  g.fillText(r.damage, 56, PH + 168);
  g.font = `600 26px ${FONT}`;
  g.fillStyle = '#b9c9c1';
  g.fillText(`in damage around ${r.street} · peak: ${r.peak}`, 60, PH + 214);
  // two columns of tallies
  const rows = r.rows.slice(0, 8);
  g.font = `600 30px ${FONT}`;
  rows.forEach(([n, label], i) => {
    const x = 60 + (i % 2) * 500, y = PH + 300 + Math.floor(i / 2) * 62;
    g.fillStyle = '#fff';
    g.font = `800 34px ${FONT}`;
    g.fillText(String(n), x, y);
    const nw = g.measureText(String(n)).width;
    g.font = `500 28px ${FONT}`;
    g.fillStyle = '#d8e3dd';
    g.fillText(label, x + nw + 14, y);
  });
  // footer
  g.fillStyle = '#0d1715';
  g.fillRect(0, H - 110, W, 110);
  brand(g, 60, H - 42, 44);
  g.font = `600 26px ${FONT}`;
  g.fillStyle = '#b9c9c1';
  g.textAlign = 'right';
  g.fillText(`Can you top it? ${URL_TEXT}`, W - 60, H - 48);
  return c;
}

function fit(g, text, x, y, max) {
  // shrink first (down to 22 px), then trim
  for (let px = parseInt(g.font.match(/(\d+)px/)[1]); px > 22 && g.measureText(text).width > max; px -= 1) g.font = g.font.replace(/\d+px/, px - 1 + 'px');
  let t = text;
  while (g.measureText(t).width > max && t.length > 4) t = t.slice(0, -2).trimEnd() + '…';
  g.fillText(t === text ? text : t, x, y);
}

// Share sheet with the image where the browser can send files (phones), otherwise save it
export async function sendImage(canvas, name, text) {
  const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.9));
  if (!blob) return 'failed';
  const file = new File([blob], name + '.jpg', { type: 'image/jpeg' });
  try {
    if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer:coarse)').matches) {
      await navigator.share({ files: [file], text: `${text} https://${URL_TEXT}/` });
      return 'shared';
    }
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled';
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name + '.jpg';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'saved';
}
