/**
 * Demo timeline used both by `node server.mjs --demo` and by the page when it
 * is opened without a server. Kept as plain data so it can be imported from
 * Node and the browser without changes.
 *
 * 节奏按「小拾真的要走过去」排：屋里跨房约 7–10 秒（含爬梯），所以相邻两次
 * 换房间的事件之间留足时间，否则她永远在路上，看不出在干活。
 * 一轮约 62 秒。
 */
export const DEMO_SCRIPT = [
  {
    delay: 0,
    event: { type: 'session.start', session: 'demo-0001' },
  },

  /* 客厅：主 Agent 拆解任务（本就在客厅，就地演） */
  {
    delay: 800,
    event: {
      type: 'agent.state',
      agent: 'main',
      state: 'planning',
      task: '整理上个月的合同',
      detail: '拆成 3 个步骤',
    },
  },
  {
    delay: 1600,
    event: {
      type: 'task.start',
      id: 't-demo',
      title: '整理上个月的合同',
      steps: ['检索合同', '阅读条款', '核对金额'],
    },
  },

  /* 客厅 → 书房：取文件 */
  {
    delay: 4200,
    event: {
      type: 'agent.state',
      agent: 'file',
      state: 'working',
      task: '检索合同',
      detail: '扫描 /Documents',
      progress: 0.05,
    },
  },
  {
    delay: 12000,
    event: {
      type: 'agent.state',
      agent: 'file',
      state: 'working',
      task: '检索合同',
      detail: '第 12/30 份',
      progress: 0.42,
    },
  },
  {
    delay: 16500,
    event: {
      type: 'agent.state',
      agent: 'file',
      state: 'working',
      task: '阅读条款',
      detail: '比对违约条款差异',
      progress: 0.68,
    },
  },

  /* 书房 → 工具间：跑校验脚本 */
  {
    delay: 20500,
    event: {
      type: 'agent.state',
      agent: 'computer',
      state: 'working',
      task: '跑校验脚本',
      detail: 'node verify.mjs',
      progress: 0.1,
    },
  },
  {
    delay: 26000,
    event: {
      type: 'confirm.request',
      id: 't-demo',
      agent: 'computer',
      question: '要删除这 3 个重复文件吗？',
    },
  },
  {
    delay: 26200,
    event: {
      type: 'agent.state',
      agent: 'computer',
      state: 'waiting_confirm',
      task: '要删除这 3 个重复文件吗？',
    },
  },
  {
    delay: 31000,
    event: {
      type: 'agent.state',
      agent: 'computer',
      state: 'working',
      task: '清理重复文件',
      detail: '已删除 3 个',
      progress: 0.9,
    },
  },

  /* 工具间 → 阁楼：查行业基准（要爬梯子，路上最久） */
  {
    delay: 35000,
    event: {
      type: 'agent.state',
      agent: 'search',
      state: 'working',
      task: '查行业基准价',
      detail: '联网检索 12 个来源',
      progress: 0.15,
    },
  },
  {
    delay: 45000,
    event: {
      type: 'agent.state',
      agent: 'search',
      state: 'thinking',
      task: '汇总基准区间',
      detail: '三个来源互相矛盾',
    },
  },

  /* 阁楼 → 客厅：汇报 */
  {
    delay: 49500,
    event: {
      type: 'agent.state',
      agent: 'main',
      state: 'working',
      task: '汇总成表',
      detail: '写入 合同汇总.xlsx',
      progress: 0.75,
    },
  },
  {
    delay: 56000,
    event: {
      type: 'agent.state',
      agent: 'main',
      state: 'done',
      task: '整理上个月的合同',
      detail: '3 步全部完成',
      progress: 1,
    },
  },
  {
    delay: 57200,
    event: { type: 'task.done', id: 't-demo', title: '整理上个月的合同' },
  },

  /* 收工：飘窗晒太阳 */
  {
    delay: 59000,
    event: {
      type: 'agent.state',
      agent: 'browser',
      state: 'idle',
      detail: '在飘窗晒太阳',
    },
  },
  {
    delay: 61000,
    event: { type: 'session.end' },
  },
];
