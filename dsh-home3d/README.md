# dsh-home3d

把「马维斯的小家」3D 场景装进 **DeepSeek Harness 桌面端**：左侧栏多一行「小家」，点开后主内容区整页渲染小屋，再点会话切回去。

不需要提前开服务——插件的 host 半区会在 DSH 启动时拉起 `node server.mjs --demo`，并把它挂到 DSH 自己的 web server 上做同源反代。

## 它是怎么工作的

一个 DSH bundle 有**两个半区**：

| 半区 | 文件 | 运行环境 | 干什么 |
| --- | --- | --- | --- |
| host | `lib/index.js`（ESM） | Electron 主进程 | 拉起 / 复用 `:5173` 的小家服务；注册 `/api/dsh-home3d` 前缀路由做反代 |
| client | `lib/client.js`（CJS，包在 `window.__ModuleLoader__.load` 里） | 浏览器 | 注册两个槽位：`sidebar.panellist`（左侧行）和 `main`（主区 keyed 页面），页面里放一个 iframe |

iframe 指向**同源相对地址** `api/dsh-home3d/index.html`（不带前导斜杠，这样即使 DSH 部署在子路径下也不跑偏），host 再把它代理到 `127.0.0.1:5173`。同源是绕开 CSP 的关键——页面里的 SSE（`events`）也走同一个前缀。

面板切走时 shell 会卸载 keyed 页面，所以 iframe 元素是**模块级单例**，切回来只是重新 append，不会重新加载 three.js 场景、不会断 SSE。

## 构建与自测

```bash
cd dsh-home3d
node build.mjs        # 零依赖：src/ → lib/index.js + lib/client.js
node test/smoke.mjs   # 不需要 DSH 就能跑通的冒烟测试
```

冒烟测试会真的起一个 http server 挂上 host 的路由，验证 `GET /`、`/styles.css`、`/health`、SSE 透传，以及「端口没人监听时自动 spawn」「完全起不来时返回 503 提示」；client 半区则用假的 module loader / React / slots 验证槽位注册与 iframe 复用。

## 安装到 DSH

目标 profile 是 **desktop**（配置在 `C:\Users\lsj\.dsh\profiles\desktop`）。

### 一键（推荐）

```powershell
cd D:\A_Items\学习\3d小家\dsh-home3d
node install.mjs              # 安装
node install.mjs --check      # 只看状态
node install.mjs --remove     # 卸载
```

它做的事：备份 profile → 调 DSH 自己的 CLI（`dsh plugin --profile desktop add link:…`）→ 把 `dsh-home3d` 写进 `dsh.profile.bundles`。

### 手动敲官方命令

```powershell
dsh plugin --profile desktop add link:D:/A_Items/学习/3d小家/dsh-home3d
```

DSH 的 `plugin` 子命令只是把参数转发给 profile 目录里的 pnpm，所以**它不负责启用**：装完还要把包名加进 `package.json` 的 `dsh.profile.bundles`（`dependencies` 决定「装了什么」，`bundles` 决定「加载哪些」，两者不等价——profile 里就有 5 个包装了但没启用）。

> CLI 只在 DSH 自带的终端里能直接用（依赖 `DSH_DESKTOP_APP_EXECUTABLE` / `DSH_DESKTOP_DSH_BOOTSTRAP`）。在普通终端里可以用 `install.mjs`，它会自己定位 `DSH NEXT.exe` 和 `app.asar/lib/desktop-cli.js`。

### 网络前提（本机踩过的坑）

pnpm 加包会**重新解析整个 profile 的依赖树**，所以已有依赖的下载地址必须都能访问：

- `registry.npmjs.org` —— 本机默认走 `http://127.0.0.1:59898` 代理时返回 `000`（连不上）
- `codeload.github.com` —— profile 里有 2 个 GitHub tarball 依赖（`dsh-our-free-model`、`dsh-feiyu-mood`），pnpm 走那个代理时 `tunnel error`

表现是 `dsh plugin add` 报 `Failed to resolve dependency: …dsh-our-free-model`。**这不是本插件的问题**。

第二个坑：这两个 git 依赖的 lockfile 记录是 **SSH remote**（pnpm 11.21 之前写下的），直连时 git 要 GitHub 私钥，本机没有就 `Permission denied (publickey)`。

`node install.mjs` 两条都处理了：清掉代理环境变量，并只针对本次进程注入 `url.https://github.com/.insteadOf=git@github.com:`（git 配置不落盘）。手写命令的话：

```bash
env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY \
  GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=url.https://github.com/.insteadOf GIT_CONFIG_VALUE_0=git@github.com: \
  GIT_TERMINAL_PROMPT=0 \
  <dsh> --expose-internals <app.asar>/lib/desktop-cli.js plugin --profile desktop install
```

依赖已声明时用 `install` 而不是 `add`：前者复用 lockfile，不会重新解析整棵树，快得多也更不容易翻车。

`--offline` 也不行：本机缓存是 pnpm v11 布局，DSH 用的是 pnpm 12，需要重填。

### 手动等效安装（网络实在不通时）

三步，结果与 pnpm 装完一致：

1. `package.json`：`dependencies` 加 `"dsh-home3d": "link:D:/A_Items/学习/3d小家/dsh-home3d"`，`dsh.profile.bundles` 加 `"dsh-home3d"`（**UTF-8 无 BOM**，BOM 会让宿主解析整份 profile 失败）
2. `pnpm-lock.yaml` 的 `importers['.'].dependencies` 按字母序插入两项（保持 specifier/version 一致，避免启动时校验不一致）：

   ```yaml
         dsh-home3d:
           specifier: link:D:/A_Items/学习/3d小家/dsh-home3d
           version: link:D:/A_Items/学习/3d小家/dsh-home3d
   ```

3. 建目录联接（`nodeLinker: hoisted`，pnpm 也是这么放 link 依赖的）：

   ```powershell
   New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-home3d" -Target "D:\A_Items\学习\3d小家\dsh-home3d"
   ```

### 最后一步：完全退出 DSH 再启动

**刷新页面没用**——client bundle 是 app 启动时解析的，必须从托盘彻底退出再开。

启动后可以先用这条命令确认加载器认了这个 bundle，不用等界面：

```powershell
dsh --profile desktop --dump-config    # 输出里应出现 dsh-home3d
```

## 回滚

```powershell
node install.mjs --remove
```

或手动：删 `node_modules\dsh-home3d` 联接、从 `package.json` 的两处和 `pnpm-lock.yaml` 里去掉 `dsh-home3d`。备份在 `dsh-home3d/.dsh-backup/`（按时间戳命名）。同样要完全退出再启动。

## 出问题怎么查

- **左侧没有「小家」这一行** → client 半区没加载。看 `C:\Users\lsj\.dsh\logs\desktop-next-*.jsonl` 里有没有 `dsh-home3d`；确认 `lib/client.js` 存在、junction 指对了。
- **行在但点开白板** → host 没起来或代理不通。日志里找 `[dsh-home3d]`，正常会打印 `reusing the home server` 或 `home server is up`。面板空白时直接在浏览器打开 `<DSH 地址>/api/dsh-home3d/health`，能看到 `{"ok":true}` 就说明代理是通的。
- **场景出来了但一直「连接中」** → SSE 没通。确认 `src/bridge.js` 里是相对地址 `new EventSource('events')`（已经是了，被改成绝对路径会失效）。
- **改了 client 代码** → `node build.mjs` 后**完全退出 DSH 再开**；改了 host 代码同理。

## 还没实测的点

槽位名（`sidebar.panellist` / `main`）、`ctx.layout` 服务名、以及 iframe 是否会被宿主 CSP 拦，都是从你机器上已装的同类插件（`dsh-client-ui-skill-explorer`、`dshmarket`、`dsh-im`）源码里比对出来的，**第一次真机启动才算验证完**。如果侧栏行不出来，多半是服务名对不上，把 `src/client.js` 的 `exports.inject` 调整一下即可。
