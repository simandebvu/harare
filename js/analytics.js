// js/analytics.js — privacy-friendly page and event counts with GoatCounter (no cookies, no personal data). Off until
// <meta name="goatcounter" content="https://YOURCODE.goatcounter.com/count"> in index.html has an address, and never on
// localhost. Events count each thing once per visit: which powers people find, how often the police get called, shares.
const endpoint = document.querySelector('meta[name="goatcounter"]')?.content?.trim();
const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname);
const on = !!endpoint && !local;
const seen = new Set(), queue = [];

if (on) {
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.dataset.goatcounter = endpoint;
  s.onload = () => {
    const flush = () => (window.goatcounter?.count ? queue.splice(0).forEach(send) : setTimeout(flush, 500));
    flush();
  };
  document.head.appendChild(s);
}

function send(name) {
  try {
    window.goatcounter.count({ path: 'harare/' + name, title: name, event: true });
  } catch {}
}

export function track(name) {
  if (!on || seen.has(name)) return;
  seen.add(name);
  if (window.goatcounter?.count) send(name);
  else queue.push(name);
}

// What the powers did (from the chaos meter's feed) and which buttons got pressed
addEventListener('harare:chaos', (e) => e.detail?.kind && track('chaos-' + e.detail.kind));
addEventListener('harare:power', (e) => typeof e.detail === 'string' && track('power-' + e.detail));
addEventListener('keydown', (e) => ({ KeyG: 'grab', KeyX: 'slam', KeyZ: 'heat' })[e.code] && track('power-' + { KeyG: 'grab', KeyX: 'slam', KeyZ: 'heat' }[e.code]));
