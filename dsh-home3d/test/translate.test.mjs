/**
 * 翻译层单测：把宿主会话事件 → 小家协议。
 * 直接 `node test/translate.test.mjs`，零依赖。
 */
import { translate, isPrimarySession, roomForTool, toolLabel, argHint, turnEndState, currentTaskFromTodo } from '../src/translate.mjs';

let pass = 0;
let fail = 0;
const ok = (c, m) => {
  if (c) pass += 1;
  else {
    fail += 1;
    console.error(`  FAIL  ${m}`);
  }
};

function session(id = 'sid-1', extra = {}) {
  return { header: { id, ...extra } };
}

/* 1. 子会话过滤 */
{
  ok(isPrimarySession(session()) === true, '普通会话算主会话');
  ok(isPrimarySession({ header: { id: 'x', origin: 'subagent' } }) === false, 'subagent 会话被过滤');
  ok(isPrimarySession({ header: { id: 'x', delegationDepth: 2 } }) === false, 'delegationDepth>0 被过滤');
  ok(isPrimarySession(null) === true, '拿不到 session 时保守放行');
}

/* 2. 首事件补 session.start */
{
  const st = {};
  const out = translate(session('abc'), { type: 'turn/start' }, st);
  ok(out.some((e) => e.type === 'session.start' && e.session === 'abc'), '首事件补 session.start');
  ok(st.sessionId === 'abc', 'state 记住 sessionId');
  const kinds = out.filter((e) => e.type === 'agent.state').map((e) => e.state);
  ok(kinds.includes('planning'), `turn/start → planning（实际 ${kinds.join(',')}）`);
}

/* 3. 工具调用分房间 */
{
  const cases = [
    ['ops_grep', 'file'],
    ['ops_bash', 'computer'],
    ['web_search', 'search'],
    ['browser_navigate', 'browser'],
    ['send_meme', 'app'],
    ['todo_write', 'main'],
    ['totally_unknown', 'main'],
  ];
  for (const [tool, want] of cases) {
    const st = {};
    const out = translate(session('s'), { type: 'tool/call', data: { name: tool, arguments: { description: '干活中' } } }, st);
    const ev = out.find((e) => e.type === 'agent.state' && e.state === 'working');
    ok(!!ev && ev.agent === want, `${tool} → ${want}（实际 ${ev ? ev.agent : 'none'}）`);
    ok(st.currentRoom === want, `${tool} 之后 currentRoom=${want}`);
  }
}

/* 4. 工具名 → 人话 + 参数提示 */
{
  ok(toolLabel('ops_bash') === '跑命令', 'ops_bash 人话');
  ok(toolLabel('web_fetch') === '抓网页', 'web_fetch 人话');
  ok(toolLabel('weird_tool_xyz').length > 0, '未知工具有兜底文本');
  const hint = argHint({ path: 'D:/src/main.js' });
  ok(hint === 'D:/src/main.js', `path 被当成提示（${hint}）`);
  ok(argHint('not json') === 'not json', '非 JSON 参数原样截断');
  const long = argHint({ query: 'x'.repeat(80) });
  ok(long.length < 60 && long.endsWith('…'), `长文本被截断（${long.length}）`);
}

/* 5. 问用户 → waiting_confirm */
{
  const st = {};
  const out = translate(session('s'), { type: 'tool/call', data: { name: 'ask_user_question', arguments: { questions: [{ question: '要删吗' }] } } }, st);
  ok(out.some((e) => e.state === 'waiting_confirm'), 'ask_user_question → waiting_confirm');
}

/* 6. turn/end 的三种结局 */
{
  ok(turnEndState('ok') === 'done', 'ok → done');
  ok(turnEndState('complete') === 'done', 'complete → done');
  ok(turnEndState('') === 'done', '空 → done');
  ok(turnEndState('error') === 'error', 'error → error');
  ok(turnEndState('user_cancelled') === 'idle', '用户取消 → idle');
}

{
  const st = { sessionId: 's', currentRoom: 'file', currentTool: 'ops_grep', turnStartedAt: Date.now() - 5000, lastTodo: '整理合同' };
  const out = translate(session('s'), { type: 'turn/end', data: { reason: { kind: 'ok' } } }, st);
  const ev = out.filter((e) => e.type === 'agent.state').pop(); // 取本轮最后一条
  ok(ev && ev.state === 'done', `turn/end ok → done（${ev?.state}）`);
  ok(ev && ev.agent === 'main', '收尾回到主 Agent（客厅）');
  ok(ev && /用时/.test(ev.detail || ''), `带用时信息（${ev?.detail}）`);
  ok(ev && ev.task === '整理合同', `任务文本沿用 todo（${ev?.task}）`);
}

/* 7. todo 进度覆盖任务文本 */
{
  const ev = currentTaskFromTodo({
    data: { todos: [{ content: 'a', status: 'completed' }, { content: '检索合同', status: 'in_progress' }] },
  });
  ok(ev === '检索合同', `in_progress 优先（${ev}）`);
  const ev2 = currentTaskFromTodo({ data: { todos: [{ content: 'pending 项', status: 'pending' }] } });
  ok(ev2 === 'pending 项', '没有 in_progress 时用 pending');
  ok(currentTaskFromTodo({ data: {} }) === null, '空 todo → null');
}

/* 8. 子会话事件不产生任何东西 */
{
  const out = translate({ header: { id: 'sub', origin: 'subagent' } }, { type: 'tool/call', data: { name: 'ops_bash' } }, {});
  ok(out.length === 0, '子会话零输出');
}

/* 9. 一次完整轮次的顺序 */
{
  const st = {};
  const seq = [];
  const s = session('full');
  seq.push(...translate(s, { type: 'turn/start' }, st));
  seq.push(...translate(s, { type: 'tool/call', data: { name: 'ops_grep', arguments: { pattern: 'TODO' } } }, st));
  seq.push(...translate(s, { type: 'tool/result', data: { ok: true } }, st));
  seq.push(...translate(s, { type: 'turn/end', data: { reason: { kind: 'ok' } } }, st));
  const states = seq.filter((e) => e.type === 'agent.state').map((e) => `${e.agent}:${e.state}`);
  console.log('  完整轮次：', states.join(' → '));
  ok(states.length >= 4, `完整轮次产生 ${states.length} 次状态变化`);
  ok(states[0] === 'main:placeholder' || states.includes('main:planning'), '开头是 planning');
  ok(states.includes('file:working'), '工具调用进了书房');
  ok(states[states.length - 1] === 'main:done', '收尾是 done');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'HAS FAILURES'}  pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
