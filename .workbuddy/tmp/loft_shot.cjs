const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const msgs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') msgs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => msgs.push('pageerror: ' + e.message));
  await page.goto('http://localhost:5173/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.homeScene && window.homeScene.scene, null, { timeout: 20000 });
  await page.waitForTimeout(2500);

  const shots = [
    { name: 'loft_default', preset: 'loft' },
    { name: 'loft_top', cam: [-3.6, 8.5, 1.2], target: [-3.6, 2.9, -2.4] },
    { name: 'loft_ladder', cam: [1.8, 3.4, 1.6], target: [-1.9, 2.9, 0.2] },
    { name: 'loft_plant', cam: [0.4, 3.6, 0.2], target: [-1.7, 2.9, -2.4] },
  ];
  for (const s of shots) {
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
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'D:/A_Items/学习/3d小家/.workbuddy/tmp/' + s.name + '.png' });
  }
  console.log('console:', JSON.stringify(msgs.slice(0, 12)));
  await browser.close();
})();
