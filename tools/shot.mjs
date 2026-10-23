// tools/shot.mjs — headed Chromium screenshots + console errors + fps, for checking visual changes
// usage: node tools/shot.mjs <name> [steps...]   (server on :8765; screenshots land in shots/<name>-N.png)
// steps: shot | wait:<ms> | key:<Code>[*holdMs][,...] | time:<hour> | cam:x,y,z,tx,ty,tz | any JS expression
import { chromium } from 'playwright';
import fs from 'node:fs';

const [, , name = 'shot', ...steps] = process.argv;
const CHROME = process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
fs.mkdirSync('shots', { recursive: true });
const b = await chromium.launch({ executablePath: fs.existsSync(CHROME) ? CHROME : undefined, headless: false, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--window-position=-3000,0'] });
const p = await b.newPage({ viewport: { width: 1400, height: 850 } });
p.on('console', (m) => (m.type() === 'error' || m.type() === 'warning' || m.text().startsWith('[harare]')) && console.log(`[${m.type()}]`, m.text().slice(0, 300)));
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(process.env.URL || 'http://localhost:8765/');
await p.waitForSelector('#loading.done', { timeout: 90000 }).catch(() => console.log('loading never finished'));
await p.waitForTimeout(2500);
let i = 0;
for (const s of steps) {
  if (s === 'shot') await p.screenshot({ path: `shots/${name}-${i++}.png` });
  else if (s.startsWith('wait:')) await p.waitForTimeout(+s.slice(5));
  else if (s.startsWith('time:')) await p.evaluate((h) => { const t = document.getElementById('time'); t.value = h; t.dispatchEvent(new Event('input')); }, s.slice(5));
  else if (s.startsWith('cam:')) await p.evaluate((v) => window.__harare?.setCamera(...v.split(',').map(Number)), s.slice(4)), await p.waitForTimeout(600);
  else if (s.startsWith('key:')) {
    for (const k of s.slice(4).split(',')) {
      const [key, ms] = k.split('*');
      if (ms) await p.keyboard.down(key), await p.waitForTimeout(+ms), await p.keyboard.up(key);
      else await p.keyboard.press(key);
    }
    await p.waitForTimeout(600);
  } else console.log('[eval]', JSON.stringify(await p.evaluate(s)));
}
const fps = await p.evaluate(() => new Promise((r) => { let n = 0; const t = performance.now(); const f = () => (++n, performance.now() - t < 2000 ? requestAnimationFrame(f) : r(n / 2)); requestAnimationFrame(f); }));
console.log('fps', fps);
await b.close();
