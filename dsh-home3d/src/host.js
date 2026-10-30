/**
 * dsh-home3d — host half (Node / Electron main process).
 *
 * Two jobs:
 *   1. Make sure the 3D home is actually running: reuse an existing
 *      server on :5173, otherwise spawn `node server.mjs --demo` from the
 *      project root and wait for /health.
 *   2. Mount it into the harness web server under a same-origin prefix
 *      (/api/dsh-home3d) so the client panel can point its iframe at a
 *      relative URL. Same-origin is what keeps the panel out of CSP trouble —
 *      the page then reaches its own /events stream through the same prefix.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-home3d';
export const inject = ['webServer'];

const HERE = path.dirname(fileURLToPath(import.meta.url)); // <pkg>/lib
const PROJECT_ROOT = path.resolve(HERE, '..', '..'); // <proj>/  (dsh-home3d lives at the project root)
const MOUNT = '/api/dsh-home3d';

const DEFAULT_PORT = Number(process.env.DSH_HOME3D_PORT || 5173);
const DEFAULT_ROOT = process.env.DSH_HOME3D_ROOT || PROJECT_ROOT;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function apply(ctx, config = {}) {
  const port = Number(config?.port ?? DEFAULT_PORT) || DEFAULT_PORT;
  const root = String(config?.root ?? DEFAULT_ROOT);
  const autoStart = config?.autoStart !== false;

  let child = null;
  let booting = null;

  async function ping() {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(800),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function boot() {
    if (await ping()) {
      console.log(`[dsh-home3d] reusing the home server already on :${port}`);
      return true;
    }
    if (!autoStart) return false;

    console.log(`[dsh-home3d] starting "node server.mjs --demo" in ${root}`);
    child = spawn(process.execPath, ['server.mjs', '--demo'], {
      cwd: root,
      // server.mjs reads PORT, so config.port stays meaningful.
      env: { ...process.env, PORT: String(port) },
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', (err) => console.warn('[dsh-home3d] spawn failed:', err.message));
    child.on('exit', (code) => {
      child = null;
      console.log(`[dsh-home3d] home server exited (code ${code})`);
    });

    for (let i = 0; i < 30; i++) {
      await sleep(500);
      if (await ping()) {
        console.log(`[dsh-home3d] home server is up on :${port}`);
        return true;
      }
    }
    console.warn(`[dsh-home3d] home server never answered /health on :${port}`);
    return false;
  }

  // Cached so concurrent requests share one boot attempt; cleared on failure
  // so the next request (e.g. after the user fixes things) can retry.
  function ensure() {
    if (!booting) {
      booting = boot().then((ok) => {
        if (!ok) booting = null;
        return ok;
      });
    }
    return booting;
  }

  function proxy(req, res, target) {
    const headers = { ...req.headers };
    delete headers.host;
    // Strip encoding negotiation: a gzipped SSE stream would just sit in the
    // proxy buffer instead of reaching the page.
    delete headers['accept-encoding'];

    const upstream = http.request(
      { host: '127.0.0.1', port, path: target, method: req.method, headers },
      (ures) => {
        res.writeHead(ures.statusCode || 502, ures.headers);
        ures.pipe(res);
      }
    );
    upstream.on('error', (err) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`[dsh-home3d] 无法连到小家服务 :${port} — ${err.message}`);
    });
    req.pipe(upstream);
  }

  const handler = async (req, res) => {
    const ready = await ensure();
    if (!ready) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(
        `[dsh-home3d] 小家服务未就绪（${root}，端口 ${port}）。
手动启动方式：在该目录执行 node server.mjs --demo`
      );
      return;
    }

    const raw = (req.url || '/').slice(MOUNT.length) || '/';
    const target = raw.startsWith('/') ? raw : `/${raw}`;
    proxy(req, res, target === '/' ? '/index.html' : target);
  };

  ctx.inject(['webServer'], (serverCtx) => {
    const server = serverCtx.get('webServer');
    if (!server?.register) {
      console.warn('[dsh-home3d] webServer service has no register(); panel will 404');
      return;
    }
    serverCtx.effect(
      () => server.register({ kind: 'prefix', path: MOUNT, handler }),
      'dsh-home3d: route'
    );
  });

  ctx.effect(
    () => () => {
      if (child) {
        try {
          child.kill();
        } catch {
          /* already gone */
        }
        child = null;
      }
    },
    'dsh-home3d: child process'
  );

  // Warm it up at boot so the first panel open is instant.
  void ensure();
}
