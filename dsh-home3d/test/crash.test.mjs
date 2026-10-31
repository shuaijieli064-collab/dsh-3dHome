/**
 * 只测一件事：走一遍代理路径，确认 DEBUG 分支不抛 ReferenceError。
 * 上游给完数据就 end，不保持连接，避免脚本挂住。
 */
import { createServer, request as httpRequest } from 'node:http';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UP = 5199;

let codes = { loaded: false, route: false, health: null, events: null, crashes: [] };
process.on('uncaughtException', (e) => codes.crashes.push(e.message));
process.on('unhandledRejection', (e) => codes.crashes.push(String(e?.message ?? e)));

const up = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end('{"ok":true}');
  }
  // SSE 头，但立刻结束
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  res.end('retry: 3000\n\n');
});

const done = (ok) => {
  console.log('RESULT', JSON.stringify(codes));
  console.log(ok ? 'ALL PASS' : 'FAIL');
  try { up.close(); } catch {}
  process.exit(ok ? 0 : 1);
};

up.listen(UP, async () => {
  try {
    const mod = await import(pathToFileURL(path.join(HERE, '..', 'lib', 'index.js')).href);
    codes.loaded = true;

    let route = null;
    mod.apply(
      {
        inject(names, cb) {
          if (!names.includes('webServer')) return;
          cb({ get: () => ({ register: (r) => ((route = r), () => {}) }), effect: (f) => f() });
        },
        effect: (f) => f?.(),
        on: () => () => {},
      },
      { port: UP, root: path.resolve(HERE, '..', '..'), autoStart: false }
    );
    codes.route = !!route;

    const proxy = createServer(route.handler);
    proxy.listen(0, () => {
      const port = proxy.address().port;
      const hit = (p, cb) =>
        httpRequest({ host: '127.0.0.1', port, path: p }, (res) => {
          let b = '';
          res.on('data', (c) => (b += c));
          res.on('end', () => cb({ status: res.statusCode, body: b.slice(0, 40) }));
        }).end();

      hit('/api/dsh-home3d/events', (r) => {
        codes.events = r;
        hit('/api/dsh-home3d/health', (r2) => {
          codes.health = r2;
          proxy.close();
          setTimeout(() => {
            const ok = codes.loaded && codes.route && codes.health?.status === 200 && codes.crashes.length === 0;
            done(ok);
          }, 300);
        });
      });
    });
  } catch (e) {
    codes.crashes.push('outer: ' + e.message);
    done(false);
  }
});
