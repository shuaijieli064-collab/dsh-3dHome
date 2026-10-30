/**
 * 工具名 → 房间 / 人话短语。
 *
 * 与 src/agents/nav.js 的 TOOL_ROOM 保持一致（那边是浏览器端，这里是宿主端；
 * 两处都改的话记得同步，测试 dsh-home3d/test/smoke.mjs 会校验这份映射不为空）。
 *
 * 房间键：main(客厅) / file(书房) / computer(工具间) / app(厨房) /
 *        browser(飘窗) / search(阁楼)
 */

export const TOOL_ROOM = {
  // 书房：读、查、检索文件
  ops_read_files: 'file',
  ops_grep: 'file',
  ops_glob: 'file',
  ops_inspect_local_file: 'file',
  ops_result: 'file',
  ops_discover_tools: 'file',
  read: 'file',
  write: 'file',
  edit: 'file',
  grep: 'file',
  glob: 'file',
  office: 'file',
  office_docx: 'file',
  office_xlsx: 'file',
  office_pptx: 'file',
  office_render: 'file',
  office_export_pdf: 'file',

  // 工具间：跑命令、系统
  ops_bash: 'computer',
  bash: 'computer',
  shell: 'computer',
  job_list: 'computer',
  job_output: 'computer',
  job_kill: 'computer',
  working_directory: 'computer',
  load_workspace_dependencies: 'computer',

  // 阁楼：联网搜索与信息聚合
  web_search: 'search',
  web_fetch: 'search',
  weknora_search: 'search',
  weknora_ask: 'search',
  weknora_read_document: 'search',
  weknora_list_knowledge_bases: 'search',
  hindsight_search_knowledge_pages: 'search',
  hindsight_read_knowledge_page: 'search',
  hindsight_reflect: 'search',
  hindsight_list_knowledge_pages: 'search',
  hindsight_ingest_document: 'search',

  // 飘窗：浏览器与桌面操作
  browser_navigate: 'browser',
  browser_click: 'browser',
  browser_type: 'browser',
  browser_pointer: 'browser',
  browser_dialog: 'browser',
  browser_download: 'browser',
  browser_prepare: 'browser',
  get_browser_state: 'browser',
  page: 'browser',
  cua_driver_native__click: 'browser',
  cua_driver_native__type_text: 'browser',
  cua_driver_native__get_window_state: 'browser',
  cua_driver_native__get_desktop_state: 'browser',

  // 厨房：调用 App / MCP / 交付物
  skill: 'app',
  plugin_manager: 'app',
  present: 'app',
  render_ui: 'app',
  send_meme: 'app',
  meme_list: 'app',
  meme_update: 'app',
  learn_meme: 'app',
  agnes_media: 'app',

  // 客厅：统筹、任务编排、问人
  todo_write: 'main',
  ask_user_question: 'main',
  create_goal: 'main',
  update_goal: 'main',
  get_goal: 'main',
  exit_plan_mode: 'main',
  subagent: 'main',
  subagent_fork: 'main',
  workflow: 'main',
  agent_teams_create: 'main',
  agent_teams_approve: 'main',
  agent_teams_status: 'main',
  compress: 'main',
  search_context: 'main',
  decompress: 'main',
};

/** 工具名 → 人话短语（气泡与日志用，越短越好读）。 */
export const TOOL_LABEL = {
  ops_read_files: '读文件',
  ops_grep: '找内容',
  ops_glob: '找文件',
  ops_inspect_local_file: '看文件',
  ops_result: '翻结果',
  ops_discover_tools: '查工具',
  read: '读文件',
  write: '写文件',
  edit: '改文件',
  grep: '找内容',
  glob: '找文件',
  ops_bash: '跑命令',
  bash: '跑命令',
  shell: '跑命令',
  job_list: '看任务',
  job_output: '取输出',
  job_kill: '停任务',
  working_directory: '换目录',
  web_search: '联网搜',
  web_fetch: '抓网页',
  weknora_search: '查知识库',
  weknora_ask: '问知识库',
  weknora_read_document: '读文档',
  hindsight_search_knowledge_pages: '翻记忆',
  hindsight_read_knowledge_page: '读记忆页',
  hindsight_reflect: '深想往事',
  hindsight_ingest_document: '记进记忆',
  browser_navigate: '开网页',
  browser_click: '点页面',
  browser_type: '填表单',
  get_browser_state: '看页面',
  page: '看页面',
  cua_driver_native__click: '点桌面',
  cua_driver_native__type_text: '敲键盘',
  cua_driver_native__get_window_state: '看窗口',
  skill: '调技能',
  plugin_manager: '管插件',
  present: '交付',
  render_ui: '画界面',
  send_meme: '发表情',
  meme_list: '找表情',
  learn_meme: '收表情',
  todo_write: '列待办',
  ask_user_question: '等你答',
  create_goal: '立目标',
  update_goal: '更目标',
  get_goal: '看目标',
  exit_plan_mode: '过计划',
  subagent: '派帮手',
  subagent_fork: '派帮手',
  workflow: '编排流程',
  agent_teams_create: '组队',
  compress: '压缩上下文',
  office: '处理文档',
  office_docx: '写 Word',
  office_xlsx: '做表格',
  office_pptx: '做幻灯',
};

/** 前缀规则：映射表没逐个列出的同类工具按前缀归类。 */
const PREFIX_RULES = [
  ['cua_driver_native__', 'browser'],
  ['browser_', 'browser'],
  ['weknora_', 'search'],
  ['hindsight_', 'search'],
  ['agent_teams_', 'main'],
  ['schedule_', 'main'],
  ['meme_', 'app'],
  ['dsh_im_', 'app'],
  ['office_', 'file'],
  ['ops_', 'file'],
];

/** 工具名 → agent 房间键。 */
export function roomForTool(name) {
  if (typeof name !== 'string' || !name) return 'main';
  if (TOOL_ROOM[name]) return TOOL_ROOM[name];
  for (const [p, room] of PREFIX_RULES) {
    if (name.startsWith(p)) return room;
  }
  return 'main';
}
