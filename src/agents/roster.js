/**
 * Agent roster — the single source of truth for who lives in the house.
 * The 3D characters are not built yet; the HUD already renders this list
 * so the data plumbing can be verified end to end.
 */
export const AGENTS = [
  {
    id: 'main',
    name: 'Marvis',
    label: '主 Agent',
    room: '客厅',
    zone: 'main',
    color: '#c2603f',
    role: '总指挥 · 拆解与调度',
  },
  {
    id: 'file',
    name: 'File Agent',
    label: '文件管家',
    room: '书房',
    zone: 'file',
    color: '#d9a24b',
    role: '检索 · 阅读 · 生成',
  },
  {
    id: 'computer',
    name: 'Computer Agent',
    label: '系统专员',
    room: '工具间',
    zone: 'computer',
    color: '#7f8fa6',
    role: '系统 · 硬件 · 命令',
  },
  {
    id: 'app',
    name: 'App Agent',
    label: '应用专员',
    room: '厨房',
    zone: 'app',
    color: '#8fae7d',
    role: '调用 App · MCP',
  },
  {
    id: 'browser',
    name: 'Browser Agent',
    label: '网页专员',
    room: '飘窗',
    zone: 'browser',
    color: '#6f9fc4',
    role: '网页 · 抓取 · 交互',
  },
  {
    id: 'search',
    name: 'Search Agent',
    label: '搜索专家',
    room: '阁楼',
    zone: 'search',
    color: '#a98bc4',
    role: '联网 · 聚合 · 引用',
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
