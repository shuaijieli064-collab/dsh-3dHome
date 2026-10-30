import { AGENTS, AGENT_BY_ID, STATE_LABEL } from '../agents/roster.js';

const MAX_LOG = 40;

const TIME_LABEL = { day: '白天', dusk: '黄昏', night: '夜晚' };

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

function nowLabel() {
  const d = new Date();
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

export function initHUD() {
  const rosterList = document.getElementById('roster-list');
  const logList = document.getElementById('log-list');
  const logCount = document.getElementById('log-count');
  const livePill = document.getElementById('live-pill');
  const liveText = livePill.querySelector('span');
  const timeSwitch = document.getElementById('time-switch');
  const dock = document.getElementById('dock');
  const rotateBtn = document.getElementById('rotate-btn');
  const labelsBtn = document.getElementById('labels-btn');

  const rows = new Map();

  /* ---- 面板折叠：把视野让给 3D 场景 ---- */
  const foldables = [
    { panel: document.querySelector('.roster'), btn: document.getElementById('roster-fold'), key: 'roster' },
    { panel: document.querySelector('.log'), btn: document.getElementById('log-fold'), key: 'log' },
  ];

  for (const f of foldables) {
    if (!f.panel || !f.btn) continue;
    // 记住上次的选择（刷新后不被重置）
    try {
      const saved = localStorage.getItem(`home3d:fold:${f.key}`);
      if (saved !== null) f.panel.dataset.collapsed = saved;
    } catch {
      /* 隐私模式忽略 */
    }

    const setCollapsed = (on) => {
      f.panel.dataset.collapsed = on ? 'true' : 'false';
      f.btn.setAttribute('aria-label', on ? '展开面板' : '收起面板');
      try {
        localStorage.setItem(`home3d:fold:${f.key}`, on ? 'true' : 'false');
      } catch {
        /* ignore */
      }
    };

    // 点按钮切换；收起状态下点整块面板也能展开
    f.btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setCollapsed(f.panel.dataset.collapsed !== 'true');
    });
    f.panel.addEventListener('click', () => {
      if (f.panel.dataset.collapsed === 'true') setCollapsed(false);
    });

    setCollapsed(f.panel.dataset.collapsed === 'true');
  }

  for (const agent of AGENTS) {
    const row = el('li', 'roster-row');
    row.dataset.agent = agent.id;
    row.dataset.state = 'offline';
    row.innerHTML = `
      <span class="dot" style="--dot:${agent.color}"></span>
      <span class="who">
        <b>${agent.name} · ${agent.label}</b>
        <em>${agent.room} · ${agent.role}</em>
      </span>
      <span class="state">${STATE_LABEL.offline}</span>
      <span class="bar"><i></i></span>
    `;
    rosterList.appendChild(row);
    rows.set(agent.id, {
      row,
      state: row.querySelector('.state'),
      bar: row.querySelector('.bar i'),
    });
  }

  let logTotal = 0;

  // 同房间的重复状态会刷屏（真实会话里每条 tool/call + tool/result 都会来
  // 一对）。这里合并：同一 agent 同一状态、且文本没变的，只在原地改时间戳。
  const logIndex = new Map(); // key -> li
  const LOG_MERGE_MS = 6000;

  function pushLog(ev, text, key) {
    const empty = logList.querySelector('.empty');
    if (empty) empty.remove();

    // 可合并的一条：还在窗口内就更新它
    const prev = key && logIndex.get(key);
    if (prev && prev.isConnected && Date.now() - prev.dataset.at < LOG_MERGE_MS) {
      prev.querySelector('span').textContent = text;
      prev.dataset.at = String(Date.now());
      prev.querySelector('time').textContent = nowLabel();
      logList.prepend(prev); // 挪到最前
      return;
    }

    const item = el('li', 'log-item');
    item.dataset.type = ev.type;
    item.dataset.at = String(Date.now());
    if (ev.__demo === true) item.dataset.demo = 'true';
    item.innerHTML = `<time>${nowLabel()}</time><span>${text}</span>`;
    logList.prepend(item);
    if (key) logIndex.set(key, item);

    logTotal += 1;
    logCount.textContent = String(logTotal);

    while (logList.children.length > MAX_LOG) {
      const gone = logList.lastElementChild;
      if (!gone) break;
      for (const [k, v] of logIndex) if (v === gone) logIndex.delete(k);
      gone.remove();
    }
  }

  /** 清掉演示剧本留下的记录：真会话一到，假的就不该留在日志里。 */
  function clearDemoLogs() {
    let removed = 0;
    for (const item of [...logList.querySelectorAll('.log-item[data-demo="true"]')]) {
      item.remove();
      removed += 1;
    }
    if (removed) {
      logTotal = Math.max(0, logTotal - removed);
      logCount.textContent = String(logTotal);
      for (const [k, v] of logIndex) if (!v.isConnected) logIndex.delete(k);
    }
    return removed;
  }

  function logEvent(ev) {
    if (!ev || !ev.type) return;

    let text = '';
    let key = null;
    switch (ev.type) {
      case 'session.start':
        text = `会话开始${ev.title ? ` · ${ev.title}` : ''}`;
        break;
      case 'session.end':
        text = '会话结束，住客回到空闲';
        break;
      case 'task.start':
        text = `任务开始 · ${ev.title || ev.id || ''}`;
        break;
      case 'task.step':
        text = `步骤 · ${ev.label || ev.step || ''}`;
        break;
      case 'task.done':
        text = `任务完成 · ${ev.title || ev.id || ''}`;
        break;
      case 'task.error':
        text = `任务出错 · ${ev.message || ev.id || ''}`;
        break;
      case 'confirm.request':
        text = `小拾在${AGENT_BY_ID[ev.agent]?.room || '屋里'}等确认 · ${ev.question || ''}`;
        break;
      case 'agent.state': {
        const meta = AGENT_BY_ID[ev.agent];
        // 屋里只有小拾一个人，日志里用「小拾 · 房间」区分她在哪干活
        const who = meta ? `小拾 · ${meta.room}` : ev.agent || '小拾';
        const state = STATE_LABEL[ev.state] || ev.state || '';
        const body = ev.task ? ` · ${ev.task}` : '';
        const extra = ev.detail ? ` · ${ev.detail}` : '';

        // 闲聊噪音不记：thinking/idle 的反复切换没有信息量
        if (ev.state === 'thinking' || (ev.state === 'idle' && !ev.task)) return;

        text = `${who} → ${state}${body}${extra}`;
        // 同一 agent 同一状态 → 允许合并
        key = `agent:${ev.agent}:${ev.state}`;
        break;
      }
      default:
        text = `${ev.type}${ev.agent ? ` · ${ev.agent}` : ''}`;
    }

    pushLog(ev, text, key);
  }

  function setAgentState(id, state, meta = {}) {
    const entry = rows.get(id);
    if (!entry) return;

    const next = typeof state === 'string' && state ? state : 'idle';
    const label = STATE_LABEL[next] || next;
    entry.row.dataset.state = next;
    entry.state.textContent = label;

    const detail = [meta.task, meta.detail].filter(Boolean).join(' · ');
    entry.row.title = detail || label;

    const progress = typeof meta.progress === 'number' ? meta.progress : 0;
    entry.bar.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
  }

  function applySnapshot(snapshot) {
    if (!snapshot) return;
    if (snapshot.agents && typeof snapshot.agents === 'object') {
      for (const [id, state] of Object.entries(snapshot.agents)) {
        if (typeof state === 'string') {
          setAgentState(id, state);
        } else if (state && typeof state === 'object') {
          setAgentState(id, state.state || 'idle', state);
        }
      }
    }

    // First snapshot after a page load also backfills the log, so a refresh
    // does not look like nothing ever happened.
    if (logTotal === 0 && Array.isArray(snapshot.recent)) {
      for (const ev of snapshot.recent) logEvent(ev);
    }
  }

  function resetAgents() {
    for (const id of rows.keys()) {
      setAgentState(id, 'offline');
    }
  }

  function setConnection(status) {
    livePill.dataset.status = status;
    const map = {
      live: 'LIVE',
      demo: 'DEMO',
      connecting: '连接中',
      offline: '离线',
    };
    liveText.textContent = map[status] || status.toUpperCase();
  }

  function setTime(mode) {
    document.body.dataset.time = mode;
    for (const btn of timeSwitch.querySelectorAll('button')) {
      btn.classList.toggle('is-active', btn.dataset.time === mode);
    }
  }

  function setPresetActive(name) {
    for (const btn of dock.querySelectorAll('button')) {
      btn.classList.toggle('is-active', btn.dataset.preset === name);
    }
  }

  function setRotateActive(on) {
    rotateBtn.classList.toggle('is-active', on);
  }

  function setLabelsActive(on) {
    labelsBtn.classList.toggle('is-active', on);
  }

  function setFollowActive(on) {
    const btn = document.getElementById('follow-btn');
    if (btn) btn.classList.toggle('is-active', on);
  }

  return {
    logEvent,
    clearDemoLogs,
    setAgentState,
    applySnapshot,
    resetAgents,
    setConnection,
    setTime,
    setPresetActive,
    setRotateActive,
    setLabelsActive,
    setFollowActive,
    timeLabel: TIME_LABEL,
  };
}
