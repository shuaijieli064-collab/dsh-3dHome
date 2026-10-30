/**
 * dsh-home3d — client half (browser).
 *
 * Delivered as CJS and wrapped by build.mjs in the harness module-loader
 * envelope (`window.__ModuleLoader__.load({ id, factory })`). Registers two
 * slots on the harness shell:
 *
 *   sidebar.panellist  →  one row in the left column ("小家")
 *   main (keyed)       →  the page that replaces the main area while selected
 *
 * The iframe element is a module-level singleton: the shell unmounts a keyed
 * main page whenever you switch away, so re-creating the iframe per mount would
 * reload the whole three.js scene on every panel visit. Keeping the element and
 * re-appending it preserves the browsing context (and the SSE connection).
 */
const ID = 'dsh-home3d';
const PANEL_ID = 'dsh-home3d';
const PANEL_ORDER = 40; // Plugins 0 / market 1 / schedule 10 / board 20 / skill-explorer 30
// Relative, no leading slash: the harness serves the GUI with <base href="./">,
// so a root-absolute path escapes the deployment prefix. The host half proxies
// this prefix to the home server on :5173.
const FRAME_SRC = 'api/dsh-home3d/index.html';

// Resolved through the harness module table, not bundled.
const React = require('react');

exports.name = ID;
exports.inject = ['slots', 'layout'];

let frame = null;

function panelFrame(doc) {
  if (frame && frame.ownerDocument === doc && frame.isConnected !== false) return frame;
  frame = doc.createElement('iframe');
  frame.src = FRAME_SRC;
  frame.title = '马维斯的小家';
  frame.setAttribute('data-dsh-home3d-frame', '');
  frame.setAttribute('allow', 'fullscreen');
  frame.style.cssText =
    'width:100%;height:100%;border:0;display:block;background:transparent;flex:1 1 auto';
  return frame;
}

function HomePanel() {
  return React.createElement('div', {
    ref(el) {
      if (!el) return;
      const next = panelFrame(el.ownerDocument);
      if (el.firstChild !== next) {
        el.textContent = '';
        el.appendChild(next);
      }
    },
    style: { width: '100%', height: '100%', display: 'flex', minHeight: 0, minWidth: 0 },
    'data-dsh-home3d-panel': '',
  });
}

function HomeIcon(props) {
  const size = (props && props.size) || 16;
  const svg = { viewBox: '0 0 16 16', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  return React.createElement(
    'svg',
    svg,
    React.createElement('path', { d: 'M2.2 7.6 8 3.1l5.8 4.5V13a.9.9 0 0 1-.9.9H3.1a.9.9 0 0 1-.9-.9z' }),
    React.createElement('path', { d: 'M6.4 13.9V9.7h3.2v4.2' })
  );
}

exports.apply = function apply(ctx) {
  const log = (...args) => console.log('[dsh-home3d]', ...args);
  const warn = (...args) => console.warn('[dsh-home3d]', ...args);

  if (!React) {
    warn('react 不可用，面板无法注册');
    return;
  }

  // Dictionaries are optional: an unavailable locale service must never take
  // the panel down with it.
  try {
    const locale = ctx.locale;
    if (locale?.register) {
      ctx.effect(
        () => locale.register(ID, { zh: { 'entry.label': '小家' }, en: { 'entry.label': 'Home' } }),
        'dsh-home3d: dictionaries'
      );
    }
  } catch (err) {
    warn('locale 注册失败（忽略）:', err && err.message);
  }

  const slots = ctx.slots;
  if (!slots?.register || !slots?.inject) {
    warn('slots 服务不可用，面板无法注册');
    return;
  }

  const off = [];
  try {
    off.push(
      slots.inject('sidebar.panellist', () =>
        slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: PANEL_ORDER,
            label: () => '小家',
            locale: ID,
          },
          HomeIcon
        )
      )
    );

    off.push(
      slots.inject('main', () =>
        slots.register(
          {
            name: 'main',
            key: PANEL_ID, // keyed, not id — must match the sidebar row's id
            locale: ID,
          },
          HomePanel
        )
      )
    );
    log('面板已注册：sidebar.panellist + main');
  } catch (err) {
    warn('槽位注册失败:', err && err.message);
  }

  ctx.effect(
    () => () => {
      for (const dispose of off.splice(0)) {
        try {
          dispose && dispose();
        } catch {
          /* ignore */
        }
      }
      if (frame?.parentNode) frame.parentNode.removeChild(frame);
      frame = null;
    },
    'dsh-home3d: ui mounts'
  );
};
