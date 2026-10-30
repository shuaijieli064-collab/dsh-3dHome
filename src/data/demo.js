/**
 * Demo timeline used both by `node server.mjs --demo` and by the page when it
 * is opened without a server. Kept as plain data so it can be imported from
 * Node and the browser without changes.
 */
export const DEMO_SCRIPT = [
  {
    delay: 0,
    event: { type: 'session.start', session: 'demo-0001' },
  },
  {
    delay: 700,
    event: {
      type: 'agent.state',
      agent: 'main',
      state: 'planning',
      task: '整理上个月的合同',
      detail: '拆成 3 个步骤',
    },
  },
  {
    delay: 1400,
    event: {
      type: 'task.start',
      id: 't-demo',
      title: '整理上个月的合同',
      steps: ['检索合同', '阅读条款', '汇总成表'],
    },
  },
  {
    delay: 2200,
    event: {
      type: 'agent.state',
      agent: 'file',
      state: 'working',
      task: '检索合同',
      progress: 0.18,
      detail: '扫描 /Documents',
    },
  },
  {
    delay: 3200,
    event: {
      type: 'agent.state',
      agent: 'file',
      state: 'working',
      task: '检索合同',
      progress: 0.52,
      detail: '命中 7 个候选文件',
    },
  },
  {
    delay: 4200,
    event: {
      type: 'agent.state',
      agent: 'search',
      state: 'thinking',
      task: '核对签约方信息',
      detail: '比对 2 个来源',
    },
  },
  {
    delay: 5200,
    event: {
      type: 'agent.state',
      agent: 'search',
      state: 'working',
      task: '核对签约方信息',
      progress: 0.6,
    },
  },
  {
    delay: 6200,
    event: {
      type: 'agent.state',
      agent: 'file',
      state: 'done',
      task: '检索合同',
      progress: 1,
      detail: '找到 3 份合同',
    },
  },
  {
    delay: 7000,
    event: {
      type: 'confirm.request',
      id: 't-demo',
      agent: 'computer',
      question: '要把汇总表写入 D:\\合同\\2026-09 吗？',
    },
  },
  {
    delay: 7200,
    event: {
      type: 'agent.state',
      agent: 'computer',
      state: 'waiting_confirm',
      task: '写入汇总表',
    },
  },
  {
    delay: 9000,
    event: {
      type: 'agent.state',
      agent: 'computer',
      state: 'working',
      task: '写入汇总表',
      progress: 0.35,
    },
  },
  {
    delay: 10400,
    event: {
      type: 'agent.state',
      agent: 'computer',
      state: 'done',
      task: '写入汇总表',
      progress: 1,
    },
  },
  {
    delay: 11000,
    event: {
      type: 'agent.state',
      agent: 'app',
      state: 'working',
      task: '生成 Excel',
      progress: 0.7,
    },
  },
  {
    delay: 12200,
    event: {
      type: 'agent.state',
      agent: 'app',
      state: 'done',
      task: '生成 Excel',
      progress: 1,
      detail: '合同汇总.xlsx',
    },
  },
  {
    delay: 13000,
    event: {
      type: 'agent.state',
      agent: 'main',
      state: 'done',
      task: '整理上个月的合同',
      progress: 1,
    },
  },
  {
    delay: 13800,
    event: { type: 'task.done', id: 't-demo', title: '整理上个月的合同' },
  },
  {
    delay: 15200,
    event: {
      type: 'agent.state',
      agent: 'browser',
      state: 'idle',
      detail: '在飘窗晒太阳',
    },
  },
  {
    delay: 16000,
    event: { type: 'session.end' },
  },
];
