import { chromium } from 'playwright';
const CHROME = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const b = await chromium.launch({ executablePath: CHROME, headless: false, args: ['--use-angle=metal', '--window-position=-3000,0'] });
const hold = async (p, k, ms) => { await p.keyboard.down(k); await p.waitForTimeout(ms); await p.keyboard.up(k); };
for (let run = 0; run < 4; run++) {
  const p = await b.newPage({ viewport: { width: 900, height: 600 } });
  await p.goto('http://localhost:8765/'); await p.waitForSelector('#loading.done', { state: 'attached', timeout: 90000 }); await p.waitForTimeout(3000);
  await p.mouse.click(450, 300);
  await hold(p, 'KeyW', 2500 + run * 700); await p.keyboard.press('KeyR'); await p.waitForTimeout(3000); await hold(p, 'KeyW', 2500 + run * 500);
  await p.keyboard.press('Digit3'); await p.waitForTimeout(7000);
  if ((await p.evaluate(() => __harare.ctx.getMode())) !== 'drive') { await p.keyboard.press('Digit3'); await p.waitForTimeout(1500); }
  await hold(p, 'KeyW', 3000);
  const d = await p.evaluate(() => {
    const C = __harare.ctx.controls, c = C.car, W = __harare.ctx.contacts; const f = 0.6, x = c.x + Math.sin(c.yaw) * f, z = c.z + Math.cos(c.yaw) * f;
    return { mode: C.mode, kmh: +(Math.abs(c.v) * 3.6).toFixed(0), at: [+c.x.toFixed(1), +c.z.toFixed(1)], alt: c.alt, nowBuildings: C.carHits(c.x, c.z, c.yaw), fwdBuildings: C.carHits(x, z, c.yaw), fwdAll: W.carBlocked(x, z, c.yaw, c.len / 2, c.width / 2, c), fwdNoPeople: W.carBlocked(x, z, c.yaw, c.len / 2, c.width / 2, c, false), backAll: W.carBlocked(c.x - Math.sin(c.yaw) * f, c.z - Math.cos(c.yaw) * f, c.yaw, c.len / 2, c.width / 2, c), len: c.len, width: c.width };
  });
  console.log('run', run, JSON.stringify(d));
  await p.close();
}
await b.close();
