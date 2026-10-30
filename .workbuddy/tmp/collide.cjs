const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('http://localhost:5173/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.homeScene && window.homeScene.scene, null, { timeout: 20000 });
  await page.waitForTimeout(2500);

  const res = await page.evaluate(async () => {
    const THREE = window.homeScene.THREE || null;
    const scene = window.homeScene.scene;
    let fridge = null;
    scene.traverse((o) => { if (o.userData && o.userData.doors) fridge = o; });
    if (!fridge) return { error: 'fridge not found' };

    const out = {};
    const root = fridge.parent;

    const boxOf = (obj) => {
      const b = new (obj.constructor.prototype.constructor === Object ? Object : Object)();
      return null;
    };

    // helper: world AABB of a subtree
    const worldBox = (obj) => {
      const box = new (window.THREE_BOX3 || Object)();
      return null;
    };

    // Use three from the scene's constructor chain
    const Box3 = scene.children[0].constructor === Object ? null : null;

    // simplest: use THREE via module import map? fall back to manual AABB
    const manualBox = (obj) => {
      let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      obj.updateWorldMatrix(true, true);
      obj.traverse((n) => {
        if (!n.isMesh || !n.geometry) return;
        n.geometry.computeBoundingBox();
        const bb = n.geometry.boundingBox;
        if (!bb) return;
        const m = n.matrixWorld.elements;
        for (let c = 0; c < 8; c++) {
          const x = c & 1 ? bb.max.x : bb.min.x;
          const y = c & 2 ? bb.max.y : bb.min.y;
          const z = c & 4 ? bb.max.z : bb.min.z;
          const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
          const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
          const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
          min = [Math.min(min[0], wx), Math.min(min[1], wy), Math.min(min[2], wz)];
          max = [Math.max(max[0], wx), Math.max(max[1], wy), Math.max(max[2], wz)];
        }
      });
      return { min, max };
    };

    const overlap = (a, b) =>
      a.min[0] <= b.max[0] && a.max[0] >= b.min[0] &&
      a.min[1] <= b.max[1] && a.max[1] >= b.min[1] &&
      a.min[2] <= b.max[2] && a.max[2] >= b.min[2];

    const fmt = (b) => `x[${b.min[0].toFixed(2)},${b.max[0].toFixed(2)}] y[${b.min[1].toFixed(2)},${b.max[1].toFixed(2)}] z[${b.min[2].toFixed(2)},${b.max[2].toFixed(2)}]`;

    for (const angle of [0, Math.PI / 2]) {
      fridge.userData.setOpen(angle);
      root.updateWorldMatrix(true, true);
      const doorTop = manualBox(fridge.userData.doors.top);
      const doorBottom = manualBox(fridge.userData.doors.bottom);
      const hits = [];
      root.children.forEach((child) => {
        if (child === fridge) return;
        const b = manualBox(child);
        if (!isFinite(b.min[0])) return;
        if (overlap(doorTop, b) || overlap(doorBottom, b)) {
          hits.push({ pos: child.position.toArray().map((v) => +v.toFixed(2)), box: fmt(b) });
        }
      });
      out['open_' + Math.round((angle * 180) / Math.PI)] = {
        doorTop: fmt(doorTop),
        doorBottom: fmt(doorBottom),
        hits,
      };
    }
    fridge.userData.setOpen(0.46);
    return out;
  });
  console.log(JSON.stringify(res, null, 2));
  await browser.close();
})();
