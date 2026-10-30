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

  const host = await readFile(path.join(HERE, 'src', 'host.js'), 'utf8');
  await writeFile(path.join(outDir, 'index.js'), host, 'utf8');

  const client = await readFile(path.join(HERE, 'src', 'client.js'), 'utf8');
  await writeFile(path.join(outDir, 'client.js'), BANNER + client + FOOTER, 'utf8');

  console.log('[dsh-home3d] built lib/index.js + lib/client.js');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
