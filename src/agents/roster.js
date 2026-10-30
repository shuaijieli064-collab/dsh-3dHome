/**
 * 住客名单 —— 屋里只有一位住客：**小拾**。
 *
 * 六个 id 不是六个不同的人，而是小拾的六个工作位置（对应六个房间）。
 * 会话里某个工具在跑，她就在那个房间干活；换个工具就走去下一个房间。
 * id 必须保持不变：controller 用 id 查 ZONES 拿房间锚点。
 */
export const AGENTS = [
  {
    id: 'main',
    name: '小拾',
    label: '统筹',
    room: '客厅',
    zone: 'main',
    color: '#c2603f',
    role: '拆解 · 调度 · 汇报',
  },
  {
    id: 'file',
    name: '小拾',
    label: '管家',
    room: '书房',
    zone: 'file',
    color: '#d9a24b',
    role: '检索 · 阅读 · 生成',
  },
  {
    id: 'computer',
    name: '小拾',
    label: '系统',
    room: '工具间',
    zone: 'computer',
    color: '#7f8fa6',
    role: '跑命令 · 看系统',
  },
  {
    id: 'app',
    name: '小拾',
    label: '应用',
    room: '厨房',
    zone: 'app',
    color: '#8fae7d',
    role: '调 App · 用 MCP',
  },
  {
    id: 'browser',
    name: '小拾',
    label: '网页',
    room: '飘窗',
    zone: 'browser',
    color: '#6f9fc4',
    role: '开网页 · 抓取 · 点按',
  },
  {
    id: 'search',
    name: '小拾',
    label: '联网',
    room: '阁楼',
    zone: 'search',
    color: '#a98bc4',
    role: '搜索 · 聚合 · 引用',
  },
];

export const AGENT_BY_ID = Object.fromEntries(AGENTS.map((a) => [a.id, a]));

export const STATE_LABEL = {
  offline: '待接入',
  idle: '空闲',
  planning: '规划中',
  walking: '前往中',
  working: '工作中',
  thinking: '思考中',
  waiting_confirm: '等待确认',
  done: '已完成',
  error: '出错',
};

export const AGENT_STATES = Object.keys(STATE_LABEL);
