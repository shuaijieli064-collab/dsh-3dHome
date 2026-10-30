const { chromium } = require('playwright');
const path = require('path');

const OUT = 'D:/A_Items/学习/3d小家/.workbuddy/tmp';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const msgs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') msgs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => msgs.push('pageerror: ' + e.message));
  await page.goto('http://localhost:5173/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.homeScene && window.homeScene.scene, null, { timeout: 20000 });
  await page.waitForTimeout(2500);

  async function shot(name, cam, target) {
    await page.evaluate(([p, t]) => {
      const { camera, controls } = window.homeScene;
      camera.position.set(p[0], p[1], p[2]);
      controls.target.set(t[0], t[1], t[2]);
      controls.update();
    }, [cam, target]);
    await page.waitForTimeout(1400);
    await page.screenshot({ path: path.join(OUT, name + '.png') });
  }

  // 1) Wide front view of the workshop corner + ladder area
  await shot('ladder_wide', [-1.95, 2.2, 6.5], [-2.5, 0.6, 1.2]);
  // 2) Low angle looking at the foot of the ladder (stairs base)
  await shot('ladder_foot', [-1.95, 1.1, 3.6], [-1.95, 0.35, 0.5]);
  // 3) Close-up from inside, near the ground
  await shot('ladder_close', [-2.6, 0.9, 2.6], [-1.9, 0.3, 0.6]);

  console.log('console:', JSON.stringify(msgs.slice(0, 12)));
  await browser.close();
})();
