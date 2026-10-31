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
import { translate, sessionIdOf, isPrimarySession } from './translate.mjs';

export const name = 'dsh-home3d';
export const inject = ['webServer'];

const HERE = path.dirname(fileURLToPath(import.meta.url)); // <pkg>/lib
const PROJECT_ROOT = path.resolve(HERE, '..', '..'); // <proj>/  (dsh-home3d lives at the project root)
const MOUNT = '/api/dsh-home3d';

const DEFAULT_PORT = Number(process.env.DSH_HOME3D_PORT || 5173);
const DEFAULT_ROOT = process.env.DSH_HOME3D_ROOT || PROJECT_ROOT;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 调试开关：DSH_HOME3D_DEBUG=1 打印代理与原始事件，排查用。
 *  必须是模块级常量——proxy() 和 handler 都要读它，放进函数里会 ReferenceError。 */
const DEBUG = process.env.DSH_HOME3D_DEBUG === '1';

/* ------------------------------------------------------------------ */
/*  真实会话 → 小家（节流推送）                                          */
/* ------------------------------------------------------------------ */

/** POST 一条协议事件到小家服务。失败只警告一次，绝不影响宿主。 */
function postEvent(port, ev) {
  return new Promise((resolve) => {
    const body = JSON.stringify(ev);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/event',
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
        timeout: 1200,
      },
      (res) => {
        res.resume();
        res.on('end', resolve);
      }
    );
    req.on('error', () => resolve()); // 小家没起不算错误
    req.on('timeout', () => {
      req.destroy();
      resolve();
    });
    req.end(body);
  });
}

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

    // 默认静默启动：真实会话事件由 session/event 推过来，不能掺演示剧本，
    // 否则假事件会和真事件打架（小拾在两个房间里被拽来拽去）。
    // 想单独看演示：config.demo = true，或手动 node server.mjs --demo。
    const demo = config?.demo === true;
    const args = demo ? ['server.mjs', '--demo'] : ['server.mjs'];
    console.log(`[dsh-home3d] starting "node ${args.join(' ')}" in ${root}`);
    child = spawn(process.execPath, args, {
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

    const isSSE = target.includes('/events');

    const upstream = http.request(
      { host: '127.0.0.1', port, path: target, method: req.method, headers },
      (ures) => {
        const isStream = ures.headers['content-type']?.includes('text/event-stream');
        const outHeaders = { ...ures.headers };
        if (isStream) {
          // SSE 不能有 content-length，也不能被任何层缓冲
          delete outHeaders['content-length'];
          outHeaders['cache-control'] = 'no-cache, no-transform';
          outHeaders.connection = 'keep-alive';
          outHeaders['x-accel-buffering'] = 'no'; // nginx 类代理的防缓冲开关
          res.writeHead(ures.statusCode || 200, outHeaders);
          res.flushHeaders?.(); // 立刻把头推给浏览器，EventSource 才能进 open
        } else {
          res.writeHead(ures.statusCode || 502, outHeaders);
        }
        if (DEBUG && isSSE) console.log('[dsh-home3d] SSE upstream status', ures.statusCode, 'stream=', isStream);
        ures.pipe(res);
      }
    );
    upstream.on('error', (err) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`[dsh-home3d] 无法连到小家服务 :${port} — ${err.message}`);
    });
    // 客户端断开（切走面板）时也要断开上游，否则 SSE 连接会堆积
    res.on('close', () => {
      if (!res.writableEnded) upstream.destroy();
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

    const rawUrl = req.url || '/';
    // 宿主可能已经剥掉前缀（也有的保留），两种都兼容：
    //   保留了 → '/api/dsh-home3d/events'  → 要 slice
    //   剥掉了 → '/events'                 → 不能 slice
    const target = rawUrl.startsWith(MOUNT)
      ? rawUrl.slice(MOUNT.length) || '/'
      : rawUrl || '/';

    if (DEBUG) {
      console.log(`[dsh-home3d] proxy ${req.method} ${rawUrl} → ${target}`);
    }
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

  /* ---------------------------------------------------------------- */
  /*  真实会话事件 → 小家                                                */
  /*                                                                   */
  /*  宿主每个会话事件都会走到 session/event。这里把主会话的 turn/tool  */
  /*  翻译成小家协议再 POST 过去，小拾就按真实对话走动。                 */
  /*  子会话（subagent）被 isPrimarySession 过滤掉，否则唯一的小拾会在   */
  /*  多个会话之间被拽来拽去。                                          */
  /* ---------------------------------------------------------------- */

  const source = String(config?.source ?? 'dsh'); // 'dsh' | 'off'
  const sessionState = new Map(); // sessionId -> 翻译层累积状态
  let queued = [];
  let flushTimer = null;
  let warnedOnce = false;

  function flush() {
    flushTimer = null;
    const batch = queued;
    queued = [];
    for (const ev of batch) void postEvent(port, ev);
  }

  /** 合并同一 tick 内的多条事件，最多每 120ms 推一批，避免刷爆 SSE。 */
  function schedule(events) {
    if (!events.length) return;
    queued.push(...events);
    if (queued.length > 60) queued = queued.slice(-60); // 防护：不堆积
    if (!flushTimer) flushTimer = setTimeout(flush, 120);
  }

  if (source === 'dsh' && typeof ctx.on === 'function') {
    try {
      const off = ctx.on('session/event', (session, event) => {
        try {
          if (!event || !event.type) return;
          if (!isPrimarySession(session)) return;

          const sid = sessionIdOf(session);
          let st = sessionState.get(sid);
          if (!st) {
            st = {};
            sessionState.set(sid, st);
            // 会话太多时清理最老的，防止无界增长
            if (sessionState.size > 32) {
              const oldest = sessionState.keys().next().value;
              if (oldest !== undefined) sessionState.delete(oldest);
            }
          }

          // 调试开关：DSH_HOME3D_DEBUG=1 打印原始事件，用来核对字段名
          if (process.env.DSH_HOME3D_DEBUG === '1') {
            console.log('[dsh-home3d] session/event', event.type, JSON.stringify(event.data ?? {}).slice(0, 300));
          }

          const out = translate(session, event, st);
          if (out.length) schedule(out);
        } catch (err) {
          if (!warnedOnce) {
            warnedOnce = true;
            console.warn('[dsh-home3d] 会话事件翻译失败（后续同类错误不再提示）:', err?.message ?? err);
          }
        }
      });
      console.log(`[dsh-home3d] 已订阅 session/event，会把真实会话推给小家 (:${port})`);
      ctx.effect(() => () => {
        try {
          off?.();
        } catch {
          /* ignore */
        }
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = null;
        queued = [];
        sessionState.clear();
      }, 'dsh-home3d: session bridge');
    } catch (err) {
      console.warn('[dsh-home3d] 订阅 session/event 失败（小家仍可用，但只显示演示剧本）:', err?.message ?? err);
    }
  }

  // Warm it up at boot so the first panel open is instant.
  void ensure();
}
