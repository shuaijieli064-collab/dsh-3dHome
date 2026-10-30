#!/usr/bin/env node
// Install (or uninstall) the dsh-home3d bundle through DSH's own CLI.
//
//   node install.mjs                install into the `desktop` profile
//   node install.mjs --profile web  install into another profile
//   node install.mjs --remove       remove bundle + package
//   node install.mjs --check        verify installation state only
//
// Everything DSH-facing goes through the official launcher entry
// (`dsh plugin --profile <name> add/remove`), i.e. the same code path DSH uses
// when you install a plugin from its own UI. The only thing this script does
// on top is registering the bundle in `dsh.profile.bundles` (the "enabled"
// roster), which the CLI has no subcommand for.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const PKG = path.dirname(fileURLToPath(import.meta.url));
const NAME = 'dsh-home3d';
const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const has = (n) => args.includes(n);
const PROFILE = flag('--profile', 'desktop');
const MODE = has('--remove') ? 'remove' : has('--check') ? 'check' : 'install';

const say = (s) => console.log(s);
const fail = (s) => {
  console.error('× ' + s);
  process.exit(1);
};

// ---------------------------------------------------------------- locate DSH
// The launcher is an Electron binary + a bootstrap script inside app.asar.
// DSH's own `dsh.cmd` only works inside its integrated terminal (it relies on
// DSH_DESKTOP_* env vars), so we resolve the two paths ourselves and run the
// very same command line.
function locateDsh() {
  const candidates = [];
  const bases = ['D:/dsh-desktop', 'C:/Program Files', path.join(os.homedir(), 'AppData/Local/Programs')];
  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    for (const dir of fs.readdirSync(base)) {
      if (!/dsh/i.test(dir)) continue;
      const exe = path.join(base, dir, `${dir}.exe`);
      if (fs.existsSync(exe)) candidates.push(exe);
    }
  }
  // Fall back to the running process, which is always authoritative.
  if (!candidates.length && process.platform === 'win32') {
    const ps = spawnSync('powershell', [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='DSH NEXT.exe'\" | Select-Object -First 1 -ExpandProperty ExecutablePath",
    ], { encoding: 'utf8' });
    const p = (ps.stdout || '').trim().split(/\r?\n/)[0];
    if (p && fs.existsSync(p)) candidates.push(p);
  }
  for (const exe of candidates) {
    const asar = path.join(path.dirname(exe), 'resources', 'app.asar');
    const boot = path.join(asar, 'lib', 'desktop-cli.js');
    // app.asar is a virtual archive; the bootstrap is only reachable through
    // Electron's patched fs, so we test the asar header instead.
    if (fs.existsSync(asar) && fs.readFileSync(asar).subarray(0, 4).readUInt32LE(0) === 4) {
      return { exe, boot };
    }
  }
  return null;
}

function dsh(dshArgs) {
  const bin = locateDsh();
  if (!bin) fail('找不到 DSH Desktop 主程序（DSH NEXT.exe）。请确认它已安装，或手动设置 DSH_HOME。');
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    DSH_HOME: HOME,
    DSH_DESKTOP_PROFILE_DIRECTORY: path.join(HOME, 'profiles', PROFILE),
    DSH_DESKTOP_DEFAULT_PROFILE: PROFILE,
    GIT_TERMINAL_PROMPT: '0',
    // Lockfiles written before pnpm 11.21 can record git deps as SSH remotes,
    // which needs a GitHub key. Rewrite them to HTTPS for this run only —
    // nothing on the machine is modified.
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'url.https://github.com/.insteadOf',
    GIT_CONFIG_VALUE_0: 'git@github.com:',
  };
  // A local http(s)_proxy frequently can't reach registry.npmjs.org (returns
  // 000) while a direct connection works, so drop it unless asked to keep it.
  if (!has('--keep-proxy')) {
    for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']) delete env[k];
  }
  say(`$ dsh ${dshArgs.join(' ')}`);
  const r = spawnSync(bin.exe, ['--expose-internals', bin.boot, ...dshArgs], {
    env,
    encoding: 'utf8',
    stdio: 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) fail(String(r.error.message));
  return r.status === 0;
}

// ------------------------------------------------------------------- profile
const profileDir = path.join(HOME, 'profiles', PROFILE);
const pkgPath = path.join(profileDir, 'package.json');
if (!fs.existsSync(pkgPath)) fail(`profile 不存在：${pkgPath}`);

const readPkg = () => JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const writePkg = (p) => fs.writeFileSync(pkgPath, JSON.stringify(p, null, 2) + '\n');

function backup() {
  const dir = path.join(PKG, '.dsh-backup');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const f of ['package.json', 'pnpm-lock.yaml', 'cordis.patch.yml']) {
    const src = path.join(profileDir, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, `${stamp}-${f}`));
  }
  say(`· 已备份 profile 到 ${path.relative(PKG, dir)}`);
}

function isLinked() {
  const link = path.join(profileDir, 'node_modules', NAME);
  if (!fs.existsSync(link)) return false;
  try {
    return fs.realpathSync(link) === fs.realpathSync(PKG);
  } catch {
    return false;
  }
}

function inBundles() {
  const p = readPkg();
  return (p.dsh?.profile?.bundles || []).includes(NAME);
}

function addBundle() {
  const p = readPkg();
  const list = (p.dsh ||= {}).profile ||= {};
  list.bundles ||= [];
  if (!list.bundles.includes(NAME)) list.bundles.push(NAME);
  writePkg(p);
  say(`· 已加入 dsh.profile.bundles（当前 ${list.bundles.length} 个）`);
}

function removeBundle() {
  const p = readPkg();
  const list = p.dsh?.profile?.bundles;
  if (list) p.dsh.profile.bundles = list.filter((b) => b !== NAME);
  writePkg(p);
  say('· 已从 dsh.profile.bundles 移除');
}

// ---------------------------------------------------------------------- main
if (MODE === 'check') {
  say(`profile      : ${PROFILE} (${profileDir})`);
  say(`node_modules : ${isLinked() ? '已链接到 ' + PKG : '缺失'}`);
  say(`bundles      : ${inBundles() ? '已启用' : '未启用'}`);
  const p = readPkg();
  say(`dependencies : ${p.dependencies?.[NAME] || '未声明'}`);
  process.exit(0);
}

function declared() {
  return Boolean(readPkg().dependencies?.[NAME]);
}

if (MODE === 'install') {
  backup();
  if (!isLinked()) {
    // `add` re-resolves the whole profile tree, so it needs network for every
    // existing dependency. If the dependency is already declared, `install`
    // reuses the lockfile and is both faster and safer.
    const verb = declared() ? 'install' : 'add';
    const args = ['plugin', '--profile', PROFILE, verb];
    if (verb === 'add') args.push(`link:${PKG.replace(/\\/g, '/')}`);
    const ok = dsh(args);
    if (!ok) fail(`${verb} 失败，profile 未改动（可用 .dsh-backup 里的备份恢复）。常见原因见 README「网络前提」。`);
  } else {
    say('· node_modules 链接已存在，跳过 pnpm 安装');
  }
  if (!isLinked()) fail('pnpm 报告成功但 node_modules/dsh-home3d 未指向本目录，请检查 pnpm 输出');
  addBundle();
  say('');
  say('✓ 安装完成。可以先不重启就确认加载器认了它：');
  say(`    dsh --profile desktop --dump-config | findstr home3d`);
  say('然后：完全退出 DSH Desktop（托盘图标也要退）再启动 —— 只刷新页面不会加载新的 client bundle。');
  say('  启动后左侧栏应多出「小家」一行；若没有，看 ~/.dsh/logs 里 dsh-home3d 相关报错。');
  process.exit(0);
}

// remove
removeBundle();
if (isLinked()) {
  const ok = dsh(['plugin', '--profile', PROFILE, 'remove', NAME]);
  if (!ok) fail('dsh plugin remove 失败');
} else {
  say('· node_modules 中已无链接，跳过 pnpm 卸载');
}
say('');
say('✓ 已移除。同样需要完全退出 DSH Desktop 再启动。');
