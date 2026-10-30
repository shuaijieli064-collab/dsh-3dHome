/**
 * Server-Sent Events bridge.
 *
 * The page is fully usable without a server (demo mode). When it is served by
 * `server.mjs`, it subscribes to `/events` and forwards normalized events to
 * the HUD — and later to the 3D agent characters.
 */
export function connectBridge({ onEvent, onStatus }) {
  const canStream = location.protocol === 'http:' || location.protocol === 'https:';

  if (!canStream) {
    onStatus('demo');
    window.marvisOffice = {
      push: (ev) => onEvent(typeof ev === 'string' ? JSON.parse(ev) : ev),
    };
    return { close() {} };
  }

  let source = null;
  let closed = false;
  let failures = 0;
  // 一旦真连上过、或收到过真实事件，就永不降级到演示剧本：
  // 假事件混进日志比"暂时没画面"糟糕得多。
  let everLive = false;

  function handle(eventName) {
    source.addEventListener(eventName, (e) => {
      try {
        const data = JSON.parse(e.data);
        everLive = true;
        onEvent(eventName === 'snapshot' ? { type: 'snapshot', ...data } : data);
      } catch (err) {
        console.warn('[marvis-home] bad event payload', err);
      }
    });
  }

  function open() {
    if (closed) return;
    onStatus('connecting');
    // Relative on purpose: the page is also served under a proxy prefix when it
    // runs as a DSH panel (.../api/dsh-home3d/index.html), where a root-absolute
    // "/events" would escape the prefix and never reach the server.
    source = new EventSource('events');

    source.addEventListener('open', () => {
      failures = 0;
      everLive = true;
      onStatus('live');
    });

    handle('snapshot');
    handle('state');

    source.addEventListener('ping', () => {});

    source.onerror = () => {
      if (closed) return;
      failures += 1;

      // 真连上过的：SSE 断线只是暂时的，继续显示"连接中"并自动重连，
      // 绝不切演示剧本（否则假事件会盖掉真实会话）。
      if (everLive) {
        onStatus('connecting');
        return;
      }

      if (failures >= 3) {
        // 从来没连上过：说明可能真的没起服务，退一步用本地演示，保证画面不空。
        source.close();
        onStatus('demo');
      } else {
        onStatus('connecting');
      }
    };
  }

  open();

  window.marvisOffice = {
    push: (ev) => onEvent(typeof ev === 'string' ? JSON.parse(ev) : ev),
  };

  return {
    close() {
      closed = true;
      source?.close();
    },
  };
}
