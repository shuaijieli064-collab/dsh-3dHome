/**
 * Zero-dependency build: turns src/ into the two files a DSH bundle must ship.
 *
 *   lib/index.js   host half, ESM, referenced by package.json "main"
 *   lib/client.js  client half, CJS wrapped in the harness module-loader
 *                  envelope (window.__ModuleLoader__.load({ id, factory }))
 *
 * No bundler, no npm install — `node build.mjs` is the whole toolchain.
 */
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ID = 'dsh-home3d';

const BANNER = `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
`;
const FOOTER = `
return module.exports; } });
`;

async function main() {
  const outDir = path.join(HERE, 'lib');
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  // host 半区：index.js + 它 import 的同目录模块（零依赖构建，不做打包，
  // 所以相对 import 必须原样搬到 lib/ 里，路径也改成 './'）
  const HOST_MODULES = ['host.js', 'translate.mjs', 'tool-map.mjs'];
  for (const file of HOST_MODULES) {
    let code = await readFile(path.join(HERE, 'src', file), 'utf8');
    if (file === 'host.js') {
      // src/host.js import 的是 './translate.mjs'，搬到 lib/ 后同目录依旧成立
      code = code.replaceAll("from '../", "from './");
    }
    const name = file === 'host.js' ? 'index.js' : file;
    await writeFile(path.join(outDir, name), code, 'utf8');
  }

  const client = await readFile(path.join(HERE, 'src', 'client.js'), 'utf8');
  await writeFile(path.join(outDir, 'client.js'), BANNER + client + FOOTER, 'utf8');

  console.log('[dsh-home3d] built lib/index.js + lib/client.js');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
