/* 验证 demo.html 加载真实 小拾.glb：等待 __charReady，多角度截图。 */
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const outDir = path.join(__dirname, '..');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-gl=angle', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto('http://localhost:5173/demo.html', { waitUntil: 'domcontentloaded' });

  // 80MB 模型 + 3 张大贴图解码，给足时间
  try {
    await page.waitForFunction('window.__charReady === true || window.__charError', null, { timeout: 90000 });
  } catch { /* 超时也先截图看现状 */ }
  await page.waitForTimeout(2500);

  const state = await page.evaluate(() => ({
    ready: window.__charReady === true,
    error: window.__charError || null,
  }));
  console.log('STATE', JSON.stringify(state));

  await page.screenshot({ path: path.join(outDir, 'xiaoshi_front.png') });

  // 拖拽画布 → OrbitControls 环绕，看侧面与背面
  const drag = async (dx) => {
    await page.mouse.move(550, 450);
    await page.mouse.down();
    await page.mouse.move(550 + dx, 430, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(600);
  };
  await drag(320);
  await page.screenshot({ path: path.join(outDir, 'xiaoshi_side.png') });
  await drag(320);
  await page.screenshot({ path: path.join(outDir, 'xiaoshi_back.png') });

  await browser.close();
  console.log('CONSOLE ISSUES:', errors.length ? '\n' + errors.join('\n') : 'CLEAN');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
