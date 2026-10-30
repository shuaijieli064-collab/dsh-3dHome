import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_SCRIPT } from './src/data/demo.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5173);
const DEMO = process.argv.includes('--demo');
// 默认不缓存静态资源。本地开发时改一行 .js 就得能立刻看到效果；
// 想开短缓存（部署用）设 HOME3D_CACHE=1。
const DEV_NO_CACHE = !process.env.HOME3D_CACHE;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/* ------------------------------------------------------------------ */
/*  In-memory state                                                    */
/* ------------------------------------------------------------------ */

const clients = new Set();
const history = [];
const agents = {};

function broadcast(eventName, payload) {
  const chunk = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try {
      res.write(chunk);
    } catch {
      clients.delete(res);
    }
  }
}

function ingest(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.type !== 'string') {
    throw new Error('event must be an object with a string "type"');
  }

  const ev = { ...raw, ts: raw.ts || Date.now() };

  history.push(ev);
  if (history.length > 300) history.shift();

  if (ev.type === 'agent.state' && typeof ev.agent === 'string') {
    agents[ev.agent] = {
      state: ev.state || 'idle',
      task: ev.task,
      progress: ev.progress,
      detail: ev.detail,
      ts: ev.ts,
    };
  }

  if (ev.type === 'session.end') {
    for (const id of Object.keys(agents)) {
      agents[id] = { state: 'offline', ts: ev.ts };
    }
  }

  broadcast('state', ev);

  const label = ev.agent ? ` [${ev.agent}]` : '';
  console.log(`→ ${ev.type}${label}${ev.state ? ` ${ev.state}` : ''}${ev.task ? ` · ${ev.task}` : ''}`);

  return ev;
}

/* ------------------------------------------------------------------ */
/*  HTTP                                                               */
/* ------------------------------------------------------------------ */

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...CORS });
  res.end(JSON.stringify(body));
}

function serveStatic(res, filePath) {
  return readFile(filePath)
    .then((data) => {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        // 默认不缓存：源码 .js 改了必须立刻生效。否则改完名/改完样式，
        // 面板里看到的还是上一次的内容——.js 曾被缓存 60 秒，坑就在这里。
        // 设 HOME3D_CACHE=1 才允许短缓存（生产部署时用）。
        'Cache-Control': DEV_NO_CACHE
          ? 'no-store, must-revalidate'
          : ext === '.html'
            ? 'no-cache'
            : 'public, max-age=60',
        ...CORS,
      });
      res.end(data);
    })
    .catch((err) => {
      if (err.code === 'ENOENT' || err.code === 'EISDIR') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
      } else {
        console.error(err);
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Server error');
      }
    });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  /* ---------------- SSE ---------------- */
  if (pathname === '/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...CORS,
    });

    res.write('retry: 3000\n\n');
    res.write(
      `event: snapshot\ndata: ${JSON.stringify({
        agents,
        recent: history.slice(-20),
      })}\n\n`
    );

    clients.add(res);

    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        /* ignore */
      }
    }, 20000);

    req.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(res);
    });
    return;
  }

  /* ---------------- snapshot ---------------- */
  if (pathname === '/state' && req.method === 'GET') {
    json(res, 200, { agents, recent: history.slice(-50) });
    return;
  }

  /* ---------------- event intake ---------------- */
  if (pathname === '/event' && req.method === 'POST') {
    let body = '';
    let tooLarge = false;

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 65536) {
        tooLarge = true;
        req.destroy();
      }
    });

    req.on('end', () => {
      if (tooLarge) return;
      try {
        const ev = ingest(JSON.parse(body || '{}'));
        json(res, 202, { ok: true, ts: ev.ts });
      } catch (err) {
        json(res, 400, { ok: false, error: err.message });
      }
    });
    return;
  }

  if (pathname === '/health') {
    json(res, 200, { ok: true, clients: clients.size, events: history.length });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method not allowed');
    return;
  }

  /* ---------------- static files ---------------- */
  const relative = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(ROOT, `.${relative}`);

  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  await serveStatic(res, filePath);
});

/* ------------------------------------------------------------------ */
/*  Demo feed                                                          */
/* ------------------------------------------------------------------ */

function runDemo() {
  console.log('\n▶ 演示剧本开始（一轮约 1 分钟，按小拾真实走路节奏排）');
  for (const step of DEMO_SCRIPT) {
    setTimeout(() => {
      try {
        ingest(step.event);
      } catch (err) {
        console.error(err.message);
      }
    }, step.delay);
  }

  const last = DEMO_SCRIPT[DEMO_SCRIPT.length - 1];
  setTimeout(runDemo, last.delay + 7000);
}

/* ------------------------------------------------------------------ */
/*  Boot                                                               */
/* ------------------------------------------------------------------ */

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用，试试：PORT=5174 node server.mjs`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log('');
  console.log('  小拾的小家 · Xiaoshi Home');
  console.log(`  打开   http://localhost:${PORT}`);
  console.log(`  状态   http://localhost:${PORT}/state`);
  console.log(`  推送   POST http://localhost:${PORT}/event`);
  console.log(`  模式   ${DEMO ? '演示剧本 (--demo)' : '等待真实会话事件'}`);
  console.log('');

  if (DEMO) runDemo();
});
