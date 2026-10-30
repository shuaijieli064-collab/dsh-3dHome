const { chromium } = require('playwright');
const path = require('path');

const OUT = process.env.OUT || 'D:/A_Items/学习/3d小家/.workbuddy/tmp';
const shots = JSON.parse(process.env.SHOTS);

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const msgs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') msgs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => msgs.push('pageerror: ' + e.message));
  await page.goto('http://localhost:5173/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.homeScene && window.homeScene.scene, null, { timeout: 20000 });
  await page.waitForTimeout(2500);

  if (process.env.TOD) {
    await page.evaluate((t) => window.homeScene.home.setTimeOfDay(t), process.env.TOD);
    await page.waitForTimeout(1200);
  }

  for (const s of shots) {
    if (s.open !== undefined) {
      await page.evaluate((a) => {
        let found = 0;
        window.homeScene.scene.traverse((o) => {
          if (o.userData && o.userData.doors) { o.userData.setOpen(a); found++; }
        });
        return found;
      }, s.open);
      await page.waitForTimeout(600);
    }
    if (s.cam) {
      await page.evaluate(([p, t]) => {
        const { camera, controls } = window.homeScene;
        camera.position.set(p[0], p[1], p[2]);
        controls.target.set(t[0], t[1], t[2]);
        controls.update();
      }, [s.cam, s.target]);
    } else if (s.preset) {
      await page.evaluate((p) => window.homeScene.flyTo(p), s.preset);
    }
    await page.waitForTimeout(1400);
    await page.screenshot({ path: path.join(OUT, s.name + '.png') });
  }
  console.log('console:', JSON.stringify(msgs.slice(0, 12)));
  await browser.close();
})();
