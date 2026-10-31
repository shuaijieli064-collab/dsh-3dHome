# 小拾的小家 · Xiaoshi Home

把 AI Agent 的会话状态，安放进一间温馨的小屋。

屋里只住着一位——**小拾**。你在 DSH 里干活，她就跟着工具调用在六个房间之间走动：读文件去书房、跑命令去工具间、联网搜去阁楼、开网页去飘窗、调 App 去厨房、统筹调度留在客厅。头顶气泡写着她正在干什么。

当前版本已完成：**房屋场景、家具、灯光、镜头、HUD、实时事件管道、小拾进屋（栅格寻路 + 爬梯 + 状态机 + 气泡）**，以及**真接 DSH 会话事件**。

房屋与家具全部为程序化建模 + 程序化 Canvas 贴图；角色「小拾」用 Blender 手建的 GLB（见[角色 · 小拾](#角色--小拾)）。所有资源都在仓库内（`vendor/three/` + `src/scene/assets/`），**无需联网**，也不需要 `npm install`。

---

## 快速开始

### 方式一：双击 `start.bat`（推荐）

Windows 下双击 `start.bat`：它会用演示剧本启动本地服务，并自动打开 <http://localhost:5173>。右上角显示 `LIVE`。

> 直接双击 `index.html` **不行**：浏览器不允许 `file://` 加载 ES Module。请走本地服务。

### 方式二：命令行 + 演示剧本

```bash
npm run demo        # 等价于 node server.mjs --demo
```

### 方式三：命令行 + 真实事件

```bash
npm start           # 等价于 node server.mjs
```

页面会等待真实事件。用 CLI 试一条：

```bash
node scripts/push-event.mjs '{"type":"agent.state","agent":"file","state":"working","task":"检索合同","progress":0.4}'
```

> 无需 `npm install`，只用 Node 内置模块（Node 18+）。three.js 及其 addons 已本地化（`vendor/three/`），完全离线可用。

---

## 房间与 Agent 的对应

| 房间 | Agent | 在这个家里负责 |
| --- | --- | --- |
| 客厅 | 主 Agent · Marvis | 拆解任务、调度、汇总 |
| 书房 | File Agent | 检索、阅读、生成文件 |
| 工具间 | Computer Agent | 系统、硬件、命令 |
| 厨房 | App Agent | 调用 App / MCP |
| 飘窗 | Browser Agent | 网页、抓取、交互 |
| 阁楼 | Search Agent | 联网搜索、信息聚合 |

`src/scene/home.js` 里的 `ZONES` 给出了每个房间的锚点和工位坐标，后续做小人寻路时直接复用。

---

## 事件协议

浏览器通过 SSE 订阅 `GET /events`，服务端保留最近 300 条事件和当前状态快照。断线重连会先收到 `snapshot`。

### 1. Agent 状态（核心）

```json
{
  "type": "agent.state",
  "agent": "file",
  "state": "working",
  "task": "扫描发票文件夹",
  "progress": 0.4,
  "detail": "第 12/30 张"
}
```

`agent` 取值：`main` / `file` / `computer` / `app` / `browser` / `search`

`state` 取值：

| state | 含义 | 之后的 3D 表现 |
| --- | --- | --- |
| `idle` | 空闲 | 在屋里漫游、喝咖啡 |
| `planning` | 规划中 | 走到客厅黑板前 |
| `walking` | 前往中 | 沿路径走向工位 |
| `working` | 工作中 | 在工位打字 / 翻文件 |
| `thinking` | 思考中 | 原地托腮、气泡 |
| `waiting_confirm` | 等待确认 | 举手 + 问号气泡 |
| `done` | 已完成 | 伸懒腰 + 对勾 |
| `error` | 出错 | 抱头 + 感叹号 |

### 2. 任务生命周期

```json
{ "type": "session.start", "session": "abc" }
{ "type": "task.start", "id": "t1", "title": "整理合同", "steps": ["检索", "阅读", "汇总"] }
{ "type": "task.step", "id": "t1", "agent": "file", "label": "检索合同" }
{ "type": "confirm.request", "id": "t1", "agent": "computer", "question": "要删除这 3 个文件吗？" }
{ "type": "task.done", "id": "t1", "title": "整理合同" }
{ "type": "task.error", "id": "t1", "agent": "file", "message": "权限不足" }
{ "type": "session.end" }
```

### 3. 接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/events` | SSE 事件流（`snapshot` / `state`） |
| `POST` | `/event` | 推送一条事件 |
| `GET` | `/state` | 当前各 Agent 状态 + 最近 50 条事件 |
| `GET` | `/health` | 健康检查 |

---

## 接入 DeepSeek Harness

**已经真接了**，不是示意。`dsh-home3d` 的 host 半区订阅宿主的 `ctx.on('session/event')`，把小家协议事件直接 POST 到 `:5173/event`，所以小拾跟着爸爸的真实会话走动。

### 事件映射（`dsh-home3d/src/translate.mjs`）

| 宿主事件 | 小家的反应 |
| --- | --- |
| `turn/start` | 主 Agent 在客厅 `planning`（任务=会话标题） |
| `user/message` | 客厅 `planning`（任务=你说的话，截 40 字） |
| `tool/call` | 按工具分房间 `working`（见下表），气泡显示人话 + 参数提示 |
| `tool/result` | 当前房间 `thinking` |
| `ask_user_question` / `approval/asked` / `question/requested` | `waiting_confirm`（小跳等你点头） |
| `todo/write` | 用 `in_progress` 那条 todo 覆盖任务文本 |
| `turn/end` | `done`（带用时）/ `error` / `idle`（按 `reason.kind`） |
| `agent/error` | `error` |

**子会话过滤**：`header.origin === 'subagent'` 或 `delegationDepth > 0` 的事件一律丢弃。只有一个住客，不能让子代理把她拽来拽去。

### 工具 → 房间（`dsh-home3d/src/tool-map.mjs`）

| 房间 | 工具 |
| --- | --- |
| 书房 `file` | `ops_read_files` `ops_grep` `ops_glob` `read` `write` `edit` `office_*` … |
| 工具间 `computer` | `ops_bash` `bash` `job_*` `working_directory` … |
| 阁楼 `search` | `web_search` `web_fetch` `weknora_*` `hindsight_*` … |
| 飘窗 `browser` | `browser_*` `cua_driver_native__*` `get_browser_state` `page` |
| 厨房 `app` | `skill` `present` `render_ui` `send_meme` `meme_*` … |
| 客厅 `main` | `todo_write` `ask_user_question` `subagent` `workflow` `agent_teams_*` … |

未命中的工具按前缀兜底（`ops_`→书房、`browser_`→飘窗…），最后回客厅。

### 推送策略

同 tick 内的事件合批，最多每 **120 ms** 推一次，队列上限 60 条；POST 超时 1.2 s，失败静默——小家没起或挂了都不能影响宿主。

### 调试

```powershell
$env:DSH_HOME3D_DEBUG=1   # 打印每条原始 session/event，核对字段名用
```

### 生效前提

`dsh-home3d` 是 DSH bundle，host/client 半区**只在启动时解析**——改完必须**完全退出 DSH（含托盘）再启动**，刷新页面不够。启动后日志里应出现：

```
[dsh-home3d] 已订阅 session/event，会把真实会话推给小家 (:5173)
```

插件拉起服务默认**静默**（不跑演示剧本），否则假事件会和真事件打架；想单看剧本用 `config.demo = true` 或手动 `node server.mjs --demo`。

### 装成 DSH 桌面端插件（左侧栏「小家」）

`dsh-home3d/` 是一个完整的 DeepSeek Harness bundle：左侧栏多一行「小家」，点开后主内容区整页渲染小屋，插件会自己拉起 `server.mjs` 并做同源反代。构建、安装、回滚步骤见 [`dsh-home3d/README.md`](dsh-home3d/README.md)。

```bash
cd dsh-home3d && node build.mjs && node test/smoke.mjs && node test/translate.test.mjs
```

`src/bridge.js` 里的 SSE 地址是相对路径 `events`（不是 `/events`），这是为了让页面在插件的 `/api/dsh-home3d` 代理前缀下也能连上——改成绝对路径会让面板一直显示「连接中」。

---

## 角色 · 小拾

首位 Agent 小人的单体展示，位于房屋右前方的木质展示台（`#character` 预设直达）。

**模型化是唯一路线**：小拾是带 Mixamo 骨架的贴图成品（`src/scene/assets/xiaoshi_rigged.glb`，2026-10-31 整体替换旧手建模型），由仓库自研的极简 GLB 解析器加载（已支持蒙皮与烘焙动画轨道）。**程序化拼装版（`createCharacter`）已删除**。房屋与家具仍是程序化建模，只有角色走模型。

**当前模型实测**：5.4 MB，单网格单材质，4.0 万顶点，Mixamo 骨架 22 骨，自带 2.47 s 烘焙走路循环 `walk_relaxed`（原地走，步幅 0.34 模型单位），脸直接画在贴图上。归一化后台上身高 1.76 m（含 `scale 1.6`），脚底落在台面 `y=0.09`。

**移动动画约定（2026-10-31 随新骨架重写）**：`characterAnim.js` 分两层按权重
slerp 混合，切换不跳变——

- **烘焙层**：走路时整身播放自带的 `walk_relaxed`，clip 时间由 controller 按
  **实际行进距离**推进的 `ctx.gaitPhase` 换算（每 2π = 一个步幅 0.374 m，恰为
  烘焙周期），位移与脚步严格锁相，速度变化和拐角都不会滑步；腿/裙摆走路表现
  全部来自官方动画。
- **程序化层**：11 个姿态（idle/type/stir/lean/sit/planning/thinking/waiting_confirm/
  done/error/climb 等）按新 Mixamo 骨架重写，肘/腕/踝/锁骨独立可动；rest =
  烘焙 clip 第 0 帧自然站姿。

爬梯时烘焙 clip 不适用（竖直攀爬），烘焙权重归零、由程序化 `climb` 接管。
`nav.js` 的寻路余量不变：`clearance 0.34`、`punchRadius 0.45`。

**节点层级与蒙皮约定（2026-10-31 修复「穿地板」）**：`createModeledCharacter`
返回 `holder > rig > GLB root` 三层——holder 只承担**世界摆位**（住客控制器每帧
覆盖其 position/scale/rotation），归一化（1.10 身高 + 脚底对零 + 朝向）固化在
内层 rig 上，绝不能放 holder（会被覆盖抹掉）。蒙皮的 boneInverses/bindMatrix
必须与静止渲染的世界快照一致：rig 定型后、以及调用方改完最终摆位（展示台
1.6 倍 / demo.html）后调 `rebindSkinnedMeshes`（holder 上有 `userData.rebind`）
重新固化，否则蒙皮双重变换——新模型 GLB 原点在身体中心（脚 y=-0.5、头 y=+0.5），
曾实测小人半截陷进地板。换模型后脚底不贴地时，先查这两条。

**文件分工**：

| 文件 | 内容 |
| --- | --- |
| `src/scene/characterModel.js` | 加载 GLB → 归一化到 1.10 身高 → 换色 → 挂动画；`loadModelIntoStage` 注入展示台 |
| `src/scene/characterAnim.js` | 混合动画器：烘焙走路层 + 11 个程序化姿态（世界轴姿态权重叠加）两层 slerp |
| `src/scene/glbLoader.js` | 零依赖极简 GLB 解析器（几何 + 材质 + 内嵌贴图 + 节点层级；已支持蒙皮与 LINEAR 烘焙动画轨道；不支持 Draco） |
| `src/scene/characters.js` | 展示台 `buildCharacterStage`（台座 + 名牌 + 聚光/补光）+ 6 套住客调色板 `CHAR_PALETTES` |
| `src/scene/characterTextures.js` | Canvas 贴图：toon 色阶图、表情贴片（规范模型才用）、木质名牌 |

**换模型**：新 GLB 覆盖 `src/scene/assets/xiaoshi_rigged.glb` 即可，或改 `characterModel.js` 顶部的 `CHARACTER_MODEL_URL`。建模规范仍见 `src/scene/assets/建模与命名规范.txt`。

**动画能力（当前模型）**：自带 Mixamo 骨架 → 混合动画器全量生效（烘焙走路 + 程序化姿态，见上文约定）。模型自带画好的脸 → 无表情贴片/眨眼，`setExpression` 保留为无害空接口；无可命名装饰部件（Dress/Ahoge/Tail/Fin 不存在），展示台只剩整体轻转。

**表情接口**（仅规范模型有效，单网格模型调用是空操作）：

```
character.userData.setExpression('normal' | 'smile' | 'surprised' | 'closed')
```

浏览器控制台调试入口：

```js
window.homeScene.home.characterStage.character.userData.setExpression('smile')
```

**加载失败不再静默**：`loadModelIntoStage` 失败会重试 2 次（间隔 1.5 s），仍失败则打 `console.error`（带模型路径）并让台子空着。因为没有程序化兜底了——**台子空 = 模型没加载上**，看控制台第一条 error 就知道原因。

**亮相动画**：台子 `tick` 委托给当前 `stage.userData.character.userData.animate`，再叠加左右轻转；舞台聚光与补光自定义为灯组（`isLamp`），夜晚模式不受房屋灯光变暗影响。

**6 套住客调色板**：`CHAR_PALETTES` 按 `marvis/file/computer/app/browser/search` 预留。注意：对当前这个贴图模型**不生效**（材质名不是 `mat_*`，`applyPalette` 匹配不到角色），只有按规范重建的模型才会被换色。后续小人进屋时按房间取色。

### 模型瘦身（已完成 2026-10-31）

旧 `xiaoshi.glb`（80 MB）与根目录 `小拾.glb` 已删除，整体替换为 5.4 MB 的 `xiaoshi_rigged.glb`，首屏不再卡模型下载，且动画从「无」升级为「烘焙走路 + 骨骼姿态」。

---

## 场景约定（摆位规则）

- **家具统一缩到 0.7（2026-10-31）**：房屋壳体永远原样（12×9 m），`home.js` 里
  `group` 直接子节点（家具组）统一乘 `FURNITURE_SCALE = 0.7`。判据是
  `userData.noFurn`——地板/墙/窗/阁楼楼板/栏杆/立柱/梯子/窗帘/贴墙灯串都算壳体，
  标了就不缩。给壳体加新件时**必须记得标 `noFurn`**；给上架小件（灯、书、餐具）
  摆位时用 `dock(item, host)` 登记，缩放 pass 会按宿主重新落位，否则宿主缩小后
  小件会浮空。贴墙家具缩放后由吸附逻辑重新贴回墙面，不留缝。
- **橱柜一律朝屋内**：厨房在 `+x` / `+z` 两个切口边上，柜门、把手、冰箱门、水龙头都朝向房间内部；切口那一侧是柜背。看厨房请从屋内看（`2.2, 3.9, 0.6`），从屋外只能看到柜背。
- **没有天花板，所以没有吊灯**：全屋照明由落地灯（`floorLamp`）、台灯（`tableLamp`）、壁炉与串灯承担，灯必须落在台面或地面上，不许悬空。
- **没有房梁**：立面只保留墙、踢脚与阁楼栏杆，屋顶方向不放任何横梁/椽木。
- **厨房识别度**：`kitchenCounter` 的 `splash` 选项会生成一段瓷砖挡水板（复用 `makeTileTexture`）+ 挂杆挂钩；水槽是台面开洞后的真实凹陷盆，不是贴在台面上的板。
- **软装补齐**：每个功能区都要有「使用痕迹」，不留整块空地。客厅壁炉配柴筐（`logBasket`）与火具架（`fireTools`），沙发背搭毯（`throwBlanket`）；餐厅有地毯 + 三套餐位（`placeSetting`）；工具间洞洞板挂满工具、台面配工作灯与零件罐；阁楼床有床头板（`headboard`）、床尾搭毯、墙上小画与阅读坐垫。
- **地毯要「托住家具」**：`rug(w, d, rotation, variant)` 的第 4 个参数是配色版本（0 陶土菱格 / 1 鼠尾草条纹 / 2 石板蓝格纹 / 3 赭黄菱格），四块地毯不再共用同一张贴图。地毯是有 18 mm 厚度的实体块并带短边流苏，不是零厚度贴片——贴片一贴地就丢边，且会和其他平铺物共面闪烁。摆位规则：椅子/桌子/沙发的前腿必须落在地毯上，地毯不外溢到墙里、不与门口地垫或另一块地毯相交。
- **地垫与地毯分层**：门口地垫（`entryMat`）是暖色椰棕块，压在地毯外、并与其留出 15 cm 以上间隙；所有平铺物高度各不相同，避免 z-fighting。
- **挂杆上要挂东西**：`kitchenCounter` 的 `rail` 抬到台面上方 33 cm（瓷砖中部），杆上挂折叠茶巾（双面布 + 折边 + 色带）和一把木铲；调料罐移到水槽左侧，不再挡在挂杆下方。
- **能开门的柜子前面要留净空**：冰箱（`fridge`）是真能开的——上下两扇门各挂在一个铰链 Group 上，`fridge().userData.setOpen(rad, which?)` 可驱动（`which` 取 `'top'` / `'bottom'`）。所以它不能塞进墙角：门宽 0.78 m，门前必须留 ≥ 0.9 m 净空，否则门板会撞上对面柜体。冰箱沿 `+x` 切口摆在侧台北端 `(5.68, 0, 0.98)`、门朝 `-x`，侧台相应缩短到 2.15 m；开门扫掠区落在空地上，90° 全开时用包围盒实测碰撞 hits 为空。腾出来的东南角补了一盆小绿植。

---

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `1` – `7` | 全景 / 客厅 / 厨房 / 书房 / 工具间 / 阁楼 / 小拾 |
| `R` | 自动环绕 |
| `L` | 显示 / 隐藏房间标签 |
| `D` / `U` / `N` | 白天 / 黄昏 / 夜晚 |

拖动旋转，滚轮缩放，点击房间标签飞过去。

### 镜头直达（深链）

URL 加 `#预设名` 直接进入某个镜头，方便截图、演示和调试：

```
http://localhost:5173/#overview     # 全景
http://localhost:5173/#living       # 客厅
http://localhost:5173/#kitchen      # 厨房
http://localhost:5173/#study        # 书房
http://localhost:5173/#workshop     # 工具间
http://localhost:5173/#loft          # 阁楼
http://localhost:5173/#character     # 小拾展示台
```

所有预设都在 `src/scene/home.js` 的 `CAMERA_PRESETS` 里，改坐标即可调整取景。

> 小技巧：把相机标低（y < 3.6）看楼下时，房间标签会自动做遮挡剔除——
> 被阁楼楼板挡住的「书房」标签会隐藏，不会悬浮在楼板上。

---

## 目录结构

```
index.html                 页面与 HUD 骨架
styles.css                 玻璃拟态 UI、昼夜主题
package.json               "type": "module"，让 Node 直接读 src 下的 ES Module
start.bat                  Windows 一键启动（演示剧本 + 打开浏览器）
server.mjs                 零依赖 Node 服务（静态 + SSE + 事件接收）
scripts/push-event.mjs     命令行推送测试
vendor/three/              three.js r160 本地副本（核心 + OrbitControls + RoundedBoxGeometry）
src/
  main.js                  渲染循环、镜头飞行、事件分发
  bridge.js                SSE 连接与断线降级
  scene/
    home.js                房屋、房间、家具摆放、灯光、镜头预设
    props.js               程序化家具库（沙发、壁炉、橱柜…）
    textures.js            程序化贴图（木地板、地毯、墙面、窗外风景）
    characters.js          展示台（台座/名牌/舞台灯）+ 6 套住客调色板
    characterModel.js      模型化小拾：加载 GLB → 归一化 → 换色 → 动画
    characterAnim.js       混合动画器：烘焙走路 + 程序化姿态两层混合
    glbLoader.js           零依赖极简 GLB 解析器（几何/材质/内嵌贴图/节点/蒙皮/动画）
    characterTextures.js   Canvas 贴图（toon 色阶、表情贴片、名牌）
    assets/xiaoshi_rigged.glb  小拾模型（Mixamo 骨架贴图成品，5.4 MB，自带烘焙走路）
    assets/建模与命名规范.txt  换模型时的节点/材质命名要求
  ui/
    hud.js                 住客名册、会话日志、状态徽标
    labels.js              房间标签投影（带遮挡剔除，被楼板挡住自动隐藏）
  agents/
    roster.js              Agent 名单与状态字典
    controller.js          住客控制器：事件 → 状态机 → 寻路/姿态/气泡
    nav.js                 占用栅格 A*（两层楼 + 梯子，Node 可单测）
  data/
    demo.js                演示剧本（服务端与浏览器共用）
refs/                      参考图放这里（见 refs/README.md）
```

---

## 下一步

- [x] 首位 Agent 小人「小拾」（Blender 手建 GLB，已进屋，展示台停用）
- [x] 小拾进屋：事件 → 状态机 → 栅格 A* 寻路 → 行走/爬梯 → 工位姿态 → 气泡
- [x] 点击小人聚焦、跟随镜头（`F` 键或工具栏「跟随小拾」）
- [x] 并发防抖：同优先级事件不打断当前活动，高优先级/中断类才抢占（冷却期改道挂起重试）
- [x] 接真实 DSH 会话事件（`dsh-home3d/src/translate.mjs`，替换演示剧本）
- [x] 家具统一缩放 0.7（壳体不动 + 贴墙吸附 + 架上小件 dock 重落位）+ 新骨架动画体系：烘焙走路锁相 + 11 程序化姿态（2026-10-31）
- [x] 面板可折叠、不挡视野（住客/日志，折叠状态记忆在 localStorage）
- [x] 会话日志防刷屏（thinking 不记，同 agent 同状态 6s 内合并）
- [x] 小拾模型瘦身（2026-10-31 整体替换为 5.4 MB Mixamo 骨架成品，旧 80 MB 已删）
- [ ] 6 个住客小人换色进屋（换色需按 `建模与命名规范.txt` 重建模型，当前贴图模型不吃调色板）
