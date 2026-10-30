/**
 * Offline smoke test — exercises both halves of the bundle without DSH.
 *
 *   node test/smoke.mjs
 *
 * The host half is mounted on a real http server with a stand-in cordis
 * context; the client half is evaluated against a fake module loader, fake
 * React and a fake shell so we can assert the slot registrations and the iframe
 * the panel would create. No DSH, no restart, no profile edits.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
};

const get = (url) =>
  new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
  });

/* ---------------- host half ---------------- */

function fakeCtx(webServer) {
  const disposers = [];
  const serverCtx = {
    get: (n) => (n === 'webServer' ? webServer : undefined),
    effect: (fn) => {
      const d = fn();
      if (typeof d === 'function') disposers.push(d);
      return d;
    },
  };
  const ctx = {
    inject: (names, cb) => {
      if (names.includes('webServer')) cb(serverCtx);
    },
    effect: (fn) => {
      const d = fn();
      if (typeof d === 'function') disposers.push(d);
      return d;
    },
  };
  return { ctx, disposers };
}

async function testHost() {
  console.log('\n--- host half ---');
  const { apply } = await import(pathToFileURL(path.join(PKG, 'lib', 'index.js')).href);

  const mounted = [];
  const webServer = {
    register(opts) {
      mounted.push(opts);
      return () => {};
    },
  };
  const { ctx, disposers } = fakeCtx(webServer);

  apply(ctx, {});
  check('registers one prefix route', mounted.length === 1, mounted[0]?.path);
  check('route is same-origin prefix', mounted[0]?.path === '/api/dsh-home3d');

  const route = mounted[0];
  const server = http.createServer((req, res) => {
    const pathname = (req.url || '/').split('?')[0];
    if (pathname.startsWith(route.path)) route.handler(req, res);
    else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api/dsh-home3d`;

  // The home server is expected to be running (or started by the plugin).
  const index = await get(`${base}/`);
  check('GET /  → 200 html', index.status === 200 && index.body.includes('小拾的小家'), `status ${index.status}`);

  const css = await get(`${base}/styles.css`);
  check('GET /styles.css → 200', css.status === 200, `status ${css.status}`);

  const health = await get(`${base}/health`);
  check('GET /health → ok', health.status === 200 && health.body.includes('"ok":true'), health.body.slice(0, 40));

  const events = await get(`${base}/events`).catch((e) => ({ status: 0, body: e.message }));
  check(
    'SSE endpoint is proxied (stream stays open → request times out, which is correct)',
    events.status === 0 || events.headers?.['content-type']?.includes('event-stream'),
    events.status === 0 ? 'stream open (timeout)' : events.headers?.['content-type']
  );

  server.close();
  for (const d of disposers) {
    try {
      d();
    } catch {
      /* ignore */
    }
  }
}

async function testHostSpawns() {
  console.log('\n--- host half, spawns the server itself ---');
  const { apply } = await import(pathToFileURL(path.join(PKG, 'lib', 'index.js')).href);
  const mounted = [];
  const { ctx, disposers } = fakeCtx({ register: (o) => (mounted.push(o), () => {}) });

  // 5199 is free: nothing to reuse, so the plugin must start server.mjs there.
  apply(ctx, { port: 5199 });
  const route = mounted[0];
  const server = http.createServer((req, res) => route.handler(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  const res = await get(`http://127.0.0.1:${server.address().port}/api/dsh-home3d/`);
  check('auto-started server answers through the proxy', res.status === 200 && res.body.includes('小拾的小家'), `status ${res.status}`);

  server.close();
  for (const d of disposers) {
    try {
      d();
    } catch {
      /* ignore */
    }
  }
}

async function testHostUnreachable() {
  console.log('\n--- host half, nothing listening ---');
  const { apply } = await import(pathToFileURL(path.join(PKG, 'lib', 'index.js')).href);
  const mounted = [];
  const { ctx } = fakeCtx({ register: (o) => (mounted.push(o), () => {}) });
  apply(ctx, { port: 5199, autoStart: false });

  const route = mounted[0];
  const server = http.createServer((req, res) => route.handler(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const res = await get(`http://127.0.0.1:${server.address().port}/api/dsh-home3d/`);
  check('unreachable home → 503 with a hint', res.status === 503 && res.body.includes('node server.mjs'), `status ${res.status}`);
  server.close();
}

/* ---------------- client half ---------------- */

function fakeReact() {
  const h = (type, props, ...children) => ({ type, props: props || {}, children });
  return { createElement: h };
}

function fakeDocument() {
  const doc = {
    createElement(tag) {
      const el = {
        tag,
        style: { cssText: '' },
        attrs: {},
        children: [],
        ownerDocument: doc,
        isConnected: true,
        setAttribute(k, v) {
          this.attrs[k] = v;
        },
        appendChild(child) {
          this.children.push(child);
          child.parentNode = this;
          return child;
        },
      };
      return el;
    },
  };
  return doc;
}

async function testClient() {
  console.log('\n--- client half ---');
  const code = await readFile(path.join(PKG, 'lib', 'client.js'), 'utf8');
  const loaded = {};
  const win = {
    __ModuleLoader__: {
      load: ({ id, factory }) => {
        loaded[id] = factory((name) => (name === 'react' ? fakeReact() : undefined));
      },
    },
  };
  const sandbox = { window: win, console };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const mod = loaded['dsh-home3d'];
  check('module-loader envelope registers the bundle', Boolean(mod), Object.keys(loaded).join());

  check('exports inject slots + layout', Array.isArray(mod.inject) && mod.inject.includes('slots') && mod.inject.includes('layout'), JSON.stringify(mod.inject));

  const registrations = [];
  const disposeCalls = [];
  const slots = {
    register(desc, component) {
      registrations.push({ desc, component });
      return () => disposeCalls.push(desc.name);
    },
    inject(slotName, fn) {
      return fn();
    },
  };
  const effects = [];
  const ctx = {
    slots,
    layout: { selectPanel() {} },
    locale: { register: () => () => {} },
    effect: (fn) => {
      const d = fn();
      if (typeof d === 'function') effects.push(d);
      return d;
    },
  };

  mod.apply(ctx);
  check('registers two slots', registrations.length === 2, registrations.map((r) => r.desc.name).join(', '));

  const sidebar = registrations.find((r) => r.desc.name === 'sidebar.panellist');
  const main = registrations.find((r) => r.desc.name === 'main');
  check('sidebar row id', sidebar?.desc.id === 'dsh-home3d', sidebar?.desc.id);
  check('sidebar label is a function', typeof sidebar?.desc.label === 'function', sidebar?.desc.label?.());
  check('main slot is keyed (not id)', main?.desc.key === 'dsh-home3d', String(main?.desc.key));

  const doc = fakeDocument();
  const host = doc.createElement('div');
  const page = main.component();
  page.props.ref(host);
  const frame = host.children[0];
  check('panel mounts an iframe', frame?.tag === 'iframe', frame?.tag);
  check('iframe src is relative (survives a deployment prefix)', frame?.attrs.src === 'api/dsh-home3d/index.html' || frame?.src === 'api/dsh-home3d/index.html', frame?.attrs?.src || frame?.src);

  const host2 = doc.createElement('div');
  main.component().props.ref(host2);
  check('iframe is reused across mounts (no scene reload)', host2.children[0] === frame);

  for (const d of effects) {
    try {
      d();
    } catch {
      /* ignore */
    }
  }
  check('unmount disposes both slots', disposeCalls.length === 2, disposeCalls.join(', '));
}

await testHost();
await testHostSpawns();
await testHostUnreachable();
await testClient();

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
