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

  for (const agent of AGENTS) {
    const row = el('li', 'roster-row');
    row.dataset.agent = agent.id;
    row.dataset.state = 'offline';
    row.innerHTML = `
      <span class="dot" style="--dot:${agent.color}"></span>
      <span class="who">
        <b>${agent.name}</b>
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

  function logEvent(ev) {
    if (!ev || !ev.type) return;

    let text = '';
    switch (ev.type) {
      case 'session.start':
        text = '会话开始，主 Agent 已上线';
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
        text = `${AGENT_BY_ID[ev.agent]?.name || ev.agent || 'Agent'} 请求确认 · ${ev.question || ''}`;
        break;
      case 'agent.state': {
        const who = AGENT_BY_ID[ev.agent]?.name || ev.agent || 'Agent';
        const state = STATE_LABEL[ev.state] || ev.state || '';
        text = `${who} → ${state}${ev.task ? ` · ${ev.task}` : ''}${ev.detail ? ` · ${ev.detail}` : ''}`;
        break;
      }
      default:
        text = `${ev.type}${ev.agent ? ` · ${ev.agent}` : ''}`;
    }

    const empty = logList.querySelector('.empty');
    if (empty) empty.remove();

    const item = el('li', 'log-item');
    item.dataset.type = ev.type;
    item.innerHTML = `<time>${nowLabel()}</time><span>${text}</span>`;
    logList.prepend(item);

    logTotal += 1;
    logCount.textContent = String(logTotal);

    while (logList.children.length > MAX_LOG) {
      logList.lastElementChild?.remove();
    }
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

  return {
    logEvent,
    setAgentState,
    applySnapshot,
    resetAgents,
    setConnection,
    setTime,
    setPresetActive,
    setRotateActive,
    setLabelsActive,
    timeLabel: TIME_LABEL,
  };
}
