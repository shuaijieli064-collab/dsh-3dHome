/**
 * 真实会话 → 小家事件协议 的翻译层。
 *
 * 宿主（DSH）通过 ctx.on('session/event', (session, event) => …) 推送会话事件。
 * 本模块把那些内部事件翻译成 server.mjs 认识的协议（README 的 8 态），
 * 再 POST 到 http://127.0.0.1:<port>/event。
 *
 * 关键映射（依据 dsh-pet 在同版本宿主上的实证）：
 *   turn/start          → agent.state main planning
 *   tool/call           → agent.state <房间> working  （task = 工具名的人话）
 *   ask_user_question   → agent.state main waiting_confirm
 *   approval/asked      → agent.state <房间> waiting_confirm
 *   tool/result         → agent.state <房间> thinking（保持当前房间）
 *   turn/end ok         → agent.state main done
 *   turn/end 异常       → agent.state main error
 *   todo/write          → 刷新当前任务文本
 *   子会话（subagent）   → 忽略，否则会跟主会话抢角色
 */
import { TOOL_ROOM, roomForTool, TOOL_LABEL } from './tool-map.mjs';

const MAX_ARG_LEN = 42;

/** 宿主事件里的会话 id。 */
export function sessionIdOf(session) {
  return String(session?.header?.id ?? session?.id ?? 'unknown');
}

/**
 * 只处理主会话：子代理（subagent / delegationDepth > 0）的事件会让
 * 唯一的小拾在多个会话间来回跑，且语义上也不是"爸爸的会话"。
 */
export function isPrimarySession(session) {
  const header = session?.header;
  if (!header || typeof header !== 'object') return true;
  if (header.origin === 'subagent') return false;
  const depth = header.delegationDepth;
  if (typeof depth === 'number' && Number.isFinite(depth) && depth > 0) return false;
  return true;
}

/** 会话标题（给 task 文本用），拿不到就用兜底。 */
export function sessionTitle(session, fallback = '当前会话') {
  const h = session?.header;
  return String(h?.title ?? h?.name ?? session?.title ?? fallback);
}

/** 工具名 → 人话短语，用于气泡/日志。 */
export function toolLabel(name) {
  if (!name) return '干活';
  if (TOOL_LABEL[name]) return TOOL_LABEL[name];
  // 粗略剥前缀，至少比裸工具名好读
  return String(name).replace(/^(ops_|cua_driver_native__|browser_|weknora_|hindsight_|agent_teams_)/, '');
}

/** 从工具参数里挑一条最能说明"在干什么"的短文本。 */
export function argHint(args) {
  if (args == null) return null;
  let obj = args;
  if (typeof args === 'string') {
    try {
      obj = JSON.parse(args);
    } catch {
      return clip(args, MAX_ARG_LEN);
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  for (const key of ['description', 'query', 'pattern', 'path', 'command', 'task', 'prompt', 'url', 'name']) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return clip(v, MAX_ARG_LEN);
    if (Array.isArray(v) && v.length && typeof v[0] === 'string') return clip(v.join(' '), MAX_ARG_LEN);
  }
  return null;
}

function clip(s, n) {
  const chars = Array.from(String(s).trim().replace(/\s+/g, ' '));
  return chars.length > n ? `${chars.slice(0, n).join('')}…` : chars.join('');
}

/** turn/end 的 reason.kind → 我们的状态。 */
export function turnEndState(reasonKind) {
  const k = String(reasonKind || '');
  if (!k || /ok|complete|success|done|end_turn/i.test(k)) return 'done';
  if (/abort|cancel|interrupt/i.test(k)) return 'idle';
  if (/error|fail|exceed|limit/i.test(k)) return 'error';
  return 'done';
}

/**
 * todo/write 里正在做的那一条 → task 文本（同 dsh-pet 的 currentTaskFromTodo）。
 */
export function currentTaskFromTodo(event) {
  const todos = Array.isArray(event?.data?.todos) ? event.data.todos : [];
  let cur = todos.find((t) => t?.status === 'in_progress');
  if (!cur) cur = todos.find((t) => t?.status === 'pending');
  const content = String(cur?.content ?? '').trim();
  return content ? clip(content, 40) : null;
}

/**
 * 把宿主事件翻译成小家协议事件（可能是 null = 不关心）。
 *
 * @param {object} session 宿主会话对象
 * @param {object} event   session/event 的载荷
 * @param {object} state   跨事件累积的会话状态（本函数会读写它）
 * @returns {object[]} 0..n 条协议事件
 */
export function translate(session, event, state = {}) {
  const type = event?.type;
  if (!type) return [];
  if (!isPrimarySession(session)) return [];

  const sid = sessionIdOf(session);
  const out = [];
  const title = sessionTitle(session);
  const curTool = state.currentTool || null;
  const curRoom = state.currentRoom || 'main';

  // 新会话第一次发事件时，补一条 session.start
  if (state.sessionId !== sid) {
    state.sessionId = sid;
    state.startedAt = Date.now();
    out.push({ type: 'session.start', session: sid, title });
    out.push({
      type: 'agent.state',
      agent: 'main',
      state: 'idle',
      task: title,
      detail: '会话接入',
    });
  }

  switch (type) {
    case 'turn/start': {
      state.turnStartedAt = Date.now();
      state.currentTool = null;
      state.currentRoom = 'main';
      out.push({
        type: 'agent.state',
        agent: 'main',
        state: 'planning',
        task: title,
        detail: '开始新一轮',
      });
      break;
    }

    case 'user/message': {
      const text = userTextOf(event);
      if (text) {
        out.push({
          type: 'agent.state',
          agent: 'main',
          state: 'planning',
          task: clip(text, 40),
          detail: '收到你的话',
        });
      }
      break;
    }

    case 'tool/call': {
      const name = String(event?.data?.name ?? '');
      state.currentTool = name;
      const room = roomForTool(name);
      state.currentRoom = room;
      const hint = argHint(event?.data?.arguments);

      if (name === 'ask_user_question' || name === 'ask_user_question') {
        out.push({
          type: 'agent.state',
          agent: 'main',
          state: 'waiting_confirm',
          task: hint || '等你回答',
        });
      } else {
        out.push({
          type: 'agent.state',
          agent: room,
          state: 'working',
          task: toolLabel(name),
          detail: hint || undefined,
        });
      }
      break;
    }

    case 'tool/result': {
      const room = state.currentRoom || 'main';
      out.push({
        type: 'agent.state',
        agent: room,
        state: 'thinking',
        task: toolLabel(curTool),
        detail: event?.data?.error ? '这一步出问题' : '处理结果',
      });
      break;
    }

    case 'approval/asked':
    case 'question/requested': {
      const hint = argHint(event?.data) || '需要你点头';
      out.push({
        type: 'agent.state',
        agent: state.currentRoom || 'main',
        state: 'waiting_confirm',
        task: clip(hint, 40),
      });
      break;
    }

    case 'todo/write': {
      const task = currentTaskFromTodo(event);
      if (task) {
        state.lastTodo = task;
        out.push({
          type: 'agent.state',
          agent: state.currentRoom || 'main',
          state: 'working',
          task,
        });
      }
      break;
    }

    case 'agent/error': {
      out.push({
        type: 'agent.state',
        agent: state.currentRoom || 'main',
        state: 'error',
        task: clip(String(event?.data?.message ?? '出错了'), 40),
      });
      break;
    }

    case 'turn/end': {
      const kind = event?.data?.reason?.kind ?? event?.data?.reason;
      const next = turnEndState(kind);
      const dur = state.turnStartedAt ? (Date.now() - state.turnStartedAt) / 1000 : 0;
      state.turnStartedAt = 0;
      state.currentTool = null;
      state.currentRoom = 'main';
      out.push({
        type: 'agent.state',
        agent: 'main',
        state: next,
        task: state.lastTodo || title,
        detail: dur > 0 ? `用时 ${dur.toFixed(1)}s` : undefined,
      });
      break;
    }

    default:
      return [];
  }

  return out;
}

/** user/message 的正文（不同版本字段名不同，尽量都试一遍）。 */
function userTextOf(event) {
  const d = event?.data;
  if (!d) return null;
  const direct = d.text ?? d.content ?? d.message;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  if (Array.isArray(direct)) {
    const joined = direct
      .map((p) => (typeof p === 'string' ? p : p?.text || ''))
      .join(' ')
      .trim();
    if (joined) return joined;
  }
  if (Array.isArray(d.parts)) {
    const joined = d.parts
      .map((p) => (typeof p === 'string' ? p : p?.text || ''))
      .join(' ')
      .trim();
    if (joined) return joined;
  }
  return null;
}

export { TOOL_ROOM, TOOL_LABEL, roomForTool };
