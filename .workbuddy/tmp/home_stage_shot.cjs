/* 验证主场景 index.html：展示台上的模型化小拾。 */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const outDir = path.join(__dirname, '..');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-gl=angle', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });

  // 等 80MB 模型加载进展示台（loadModelIntoStage 成功后 character 被替换）
  try {
    await page.waitForFunction(
      "() => window.homeScene?.home?.characterStage?.character?.userData?.animate",
      null, { timeout: 90000 }
    );
  } catch { /* 超时也截图 */ }
  await page.waitForTimeout(1500);

  const state = await page.evaluate(() => {
    const stage = window.homeScene?.home?.characterStage;
    const ch = stage?.character;
    return {
      hasCharacter: !!ch,
      isModeled: !!(ch && ch.userData && ch.userData.animate),
      pos: ch ? ch.getWorldPosition(new (ch.constructor)().setFromMatrixPosition ? undefined : undefined) : null,
    };
  }).catch(() => ({ evalFailed: true }));
  console.log('STATE', JSON.stringify(state));

  // 把相机对准展示台 (11.8, 0, 4.65)
  await page.evaluate(() => {
    const { camera, controls } = window.homeScene;
    camera.position.set(13.6, 2.0, 7.4);
    controls.target.set(11.8, 0.9, 4.65);
    controls.update();
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(outDir, 'home_stage.png') });

  await browser.close();
  console.log('CONSOLE ISSUES:', errors.length ? '\n' + errors.join('\n') : 'CLEAN');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
