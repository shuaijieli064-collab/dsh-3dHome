const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('http://localhost:5173/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.homeScene && window.homeScene.scene, null, { timeout: 20000 });
  await page.waitForTimeout(2500);
  const res = await page.evaluate(() => {
    const scene = window.homeScene.scene;
    let fridge = null;
    scene.traverse((o) => { if (o.userData && o.userData.doors) fridge = o; });
    const root = fridge.parent;
    const manualBox = (obj) => {
      let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      obj.updateWorldMatrix(true, true);
      obj.traverse((n) => {
        if (!n.isMesh || !n.geometry) return;
        n.geometry.computeBoundingBox();
        const bb = n.geometry.boundingBox; if (!bb) return;
        const m = n.matrixWorld.elements;
        for (let c = 0; c < 8; c++) {
          const x = c & 1 ? bb.max.x : bb.min.x, y = c & 2 ? bb.max.y : bb.min.y, z = c & 4 ? bb.max.z : bb.min.z;
          min = [Math.min(min[0], m[0]*x+m[4]*y+m[8]*z+m[12]), Math.min(min[1], m[1]*x+m[5]*y+m[9]*z+m[13]), Math.min(min[2], m[2]*x+m[6]*y+m[10]*z+m[14])];
          max = [Math.max(max[0], m[0]*x+m[4]*y+m[8]*z+m[12]), Math.max(max[1], m[1]*x+m[5]*y+m[9]*z+m[13]), Math.max(max[2], m[2]*x+m[6]*y+m[10]*z+m[14])];
        }
      });
      return { min, max };
    };
    const ov = (a, b) => a.min[0] <= b.max[0] && a.max[0] >= b.min[0] && a.min[1] <= b.max[1] && a.max[1] >= b.min[1] && a.min[2] <= b.max[2] && a.max[2] >= b.min[2];
    const fmt = (b) => `x[${b.min[0].toFixed(2)},${b.max[0].toFixed(2)}] y[${b.min[1].toFixed(2)},${b.max[1].toFixed(2)}] z[${b.min[2].toFixed(2)},${b.max[2].toFixed(2)}]`;
    const pad = (b, p) => ({ min: b.min.map((v) => v - p), max: b.max.map((v) => v + p) });
    fridge.userData.setOpen(0);
    root.updateWorldMatrix(true, true);
    const fb = manualBox(fridge);
    const fbPad = pad(fb, 0.05);
    const near = [];
    root.children.forEach((c) => {
      if (c === fridge) return;
      const b = manualBox(c);
      if (!isFinite(b.min[0])) return;
      if (ov(fbPad, b)) near.push({ pos: c.position.toArray().map((v) => +v.toFixed(2)), box: fmt(b), strict: ov(fb, b) });
    });
    return { fridge: fmt(fb), near };
  });
  console.log(JSON.stringify(res, null, 2));
  await browser.close();
})();
