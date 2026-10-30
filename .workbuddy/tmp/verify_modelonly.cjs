/* 验证「只剩模型化小拾」这条路线：
   1) 主场景展示台上确实站着一个模型角色（不是程序化，也不是空台）
   2) 报告网格数/顶点数/材质，证明是 80MB 那个真模型
   3) 手写矩阵乘法算世界包围盒，确认脚底落在台面上、没飞天没巨人化
   4) 记录控制台错误；台子近景 + 全景回归截图                           */
const { chromium } = require('playwright');
const path = require('path');

const OUT = path.join(__dirname, '..');

async function run() {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-gl=angle', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const issues = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') issues.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => issues.push(`pageerror: ${e.message}`));

  const t0 = Date.now();
  await page.goto('http://localhost:5173/#character', { waitUntil: 'domcontentloaded' });

  let ok = true;
  try {
    await page.waitForFunction(
      'window.homeScene?.home?.characterStage?.character?.userData?.animate !== undefined',
      null,
      { timeout: 120000 }
    );
  } catch {
    ok = false;
  }
  console.log(`WAIT ${Date.now() - t0}ms  mounted=${ok}`);
  await page.waitForTimeout(2500);

  const state = await page.evaluate(() => {
    // 纯 JS 4x4（column-major，与 three 的 Matrix4.elements 一致）
    const mul = (m, v) => [
      m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
      m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
      m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
    ];
    const stage = window.homeScene?.home?.characterStage;
    const ch = stage?.character;
    if (!ch) return { hasCharacter: false };

    let meshes = 0;
    let verts = 0;
    const mats = new Set();
    const names = [];
    const lo = [1e9, 1e9, 1e9];
    const hi = [-1e9, -1e9, -1e9];

    ch.updateWorldMatrix(true, true);
    ch.traverse((o) => {
      if (!o.isMesh) return;
      meshes += 1;
      const g = o.geometry;
      const p = g?.attributes?.position;
      if (p) verts += p.count;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        if (!m) return;
        mats.add(`${m.type}:${m.name || m.userData?.gltfName || '(anon)'}`);
        if (m.map) mats.add('hasMap');
      });
      if (o.name) names.push(o.name);
      if (!g) return;
      if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox;
      if (!b) return;
      const e = o.matrixWorld.elements;
      for (let i = 0; i < 8; i++) {
        const c = mul(e, [
          i & 1 ? b.max.x : b.min.x,
          i & 2 ? b.max.y : b.min.y,
          i & 4 ? b.max.z : b.min.z,
          1,
        ]);
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], c[k]);
          hi[k] = Math.max(hi[k], c[k]);
        }
      }
    });

    const r = (n) => +n.toFixed(3);
    return {
      hasCharacter: true,
      rootName: ch.name || '(anon)',
      meshes,
      verts,
      materials: [...mats].slice(0, 10),
      meshNames: names.slice(0, 10),
      scale: r(ch.scale.x),
      worldSize: { x: r(hi[0] - lo[0]), y: r(hi[1] - lo[1]), z: r(hi[2] - lo[2]) },
      worldMinY: r(lo[1]),
      worldCenterXZ: [r((hi[0] + lo[0]) / 2), r((hi[2] + lo[2]) / 2)],
      hasAnimate: typeof ch.userData.animate === 'function',
      hasSetExpression: typeof ch.userData.setExpression === 'function',
      // characterStage 是 { stage, character } 包装，tick 挂在真 .stage 上
      stageTickWired: typeof stage.stage?.userData?.tick === 'function',
      charScaleOnStage: stage.stage?.userData?.charScale,
    };
  });
  console.log('STAGE_STATE', JSON.stringify(state, null, 1));

  const anim = await page.evaluate(async () => {
    const ch = window.homeScene.home.characterStage.character;
    const a = ch.rotation.y;
    await new Promise((r) => setTimeout(r, 500));
    return { before: +a.toFixed(4), after: +ch.rotation.y.toFixed(4), moving: a !== ch.rotation.y };
  });
  console.log('ANIMATE', JSON.stringify(anim));

  await page.evaluate(() => {
    const { camera, controls } = window.homeScene;
    camera.position.set(13.4, 1.9, 7.2);
    controls.target.set(11.8, 0.95, 4.65);
    controls.update();
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, 'verify_stage.png') });

  await page.evaluate(() => {
    const { camera, controls } = window.homeScene;
    camera.position.set(11.5, 9.5, 12.5);
    controls.target.set(0, 1.2, 0);
    controls.update();
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, 'verify_overview.png') });

  await browser.close();
  console.log('CONSOLE ISSUES:', issues.length ? '\n' + issues.join('\n') : 'CLEAN');
  process.exit(ok ? 0 : 2);
}

run().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
