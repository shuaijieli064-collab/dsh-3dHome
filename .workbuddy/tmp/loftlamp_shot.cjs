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

  // loft overview
  await shot('loft_overview', [4.6, 9.2, 6.4], [-3.7, 3.0, -2.4]);
  // close-up at the ladder top / loft lamp
  await shot('loftlamp_close', [-1.6, 4.4, 3.2], [-2.0, 2.9, -0.7]);

  console.log('console:', JSON.stringify(msgs.slice(0, 12)));
  await browser.close();
})();
