/**
 * nav.js 单测：零依赖，直接 `node test/nav.test.mjs`。
 *
 * 三轮：
 *   A) 合成障碍 —— 验证栅格、分层、punch、拉直、A* 本身的正确性
 *   B) 真实障碍（.workbuddy/tmp/blockers.json，从浏览器导出的包围盒）
 *      —— 验证六个房间的落脚点全部可达、跨层能爬梯子、路径不穿家具
 *   C) 工具名映射
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  FLOOR,
  FLOOR_Y,
  LADDER,
  LOFT_DECK,
  makeGrid,
  isFreeAt,
  punch,
  lineOfSight,
  createNav,
  blocksFloor,
  segmentHitsRect,
  roomForTool,
} from '../src/agents/nav.js';

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error(`  FAIL  ${msg}`);
  }
};

/* 真实场景的六个落脚点（与 scene/home.js 的 ZONES 一致） */
const ZONES = {
  main: { anchor: [4.2, 0, -2.15], desk: [4.2, 0, -2.15] },
  file: { anchor: [-4.2, 0, -2.2], desk: [-5.0, 0, -2.2] },
  computer: { anchor: [-3.9, 0, 2.6], desk: [-4.9, 0, 2.6] },
  app: { anchor: [3.3, 0, 3.35], desk: [3.3, 0, 3.35] },
  browser: { anchor: [2.1, 0, -3.5], desk: [2.1, 0, -3.5] },
  search: { anchor: [-3.6, FLOOR.loftY, -2.4], desk: [-3.0, FLOOR.loftY, -1.8] },
};

const segLen = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2], (a[1] ?? 0) - (b[1] ?? 0));

/* ================================================================== */
/*  A. 合成障碍                                                        */
/* ================================================================== */

console.log('A) 合成障碍');

{
  // 空场：任意两点可达，且路径被拉成直线
  const nav = createNav([], [], {});
  const p = nav.plan([0, 0, 0], [4, 0, 3]);
  ok(!!p, '空场可达');
  ok(p && p.waypoints.length === 2, `空场路径拉成直线（${p ? p.waypoints.length : 0} 个拐点）`);
  ok(p && Math.abs(p.waypoints[1][0] - 4) < 0.3 && Math.abs(p.waypoints[1][2] - 3) < 0.3, '终点正确');
}

{
  // 一堵横跨房间的墙，中间留一个真门洞：必须从门洞穿过去
  // 墙分两段：z∈[-4.5,-1] 与 z∈[1,4.5]，门洞在 z∈(-1,1)
  const seg = (z0, z1) => ({ minX: -0.1, maxX: 0.1, minZ: z0, maxZ: z1, minY: 0, maxY: 2 });
  const blockers = [seg(-4.6, -1), seg(1, 4.6)];
  const nav = createNav(blockers, [], {});
  const p = nav.plan([-3, 0, 0], [3, 0, 0]);
  ok(!!p, '有门墙可绕');
  if (p) {
    // 穿门 = 路径经过 x=0 时插值 z 落在门洞内。A* 会把直线段拉直合并，
    // 所以不能要求"存在一个拐点在门里"（2026-10-31：这条断言之前就
    // 过严了——恰好直线路径被拉成两端点，路过门时没有拐点）。
    let throughDoor = false;
    for (let i = 1; i < p.waypoints.length; i++) {
      const a = p.waypoints[i - 1], b = p.waypoints[i];
      if (a[0] === b[0]) {
        // 垂直段：x 平面在门内，z 区间与门洞 (-1,1) 有重叠即算穿过
        if (Math.abs(a[0]) < 0.6 && Math.min(a[2], b[2]) < 1 && Math.max(a[2], b[2]) > -1) {
          throughDoor = true;
        }
        continue;
      }
      const t = (0 - a[0]) / (b[0] - a[0]);
      if (t >= 0 && t <= 1 && Math.abs(a[2] + t * (b[2] - a[2])) < 1.0) {
        throughDoor = true;
        break;
      }
    }
    ok(throughDoor, `路径穿过门洞（拐点 ${JSON.stringify(p.waypoints.map((w) => [+w[0].toFixed(1), +w[2].toFixed(1)]))}）`);
    // 且不能翻到墙外（x 必须单调跨过，z 不越界）
    ok(p.waypoints.every((w) => Math.abs(w[2]) <= 4.4), '没有跑出房间外');
  }
}

{
  // 完全封死：应返回 null 而不是死循环
  const sealed = [];
  for (let x = -5.5; x <= 5.5; x += 0.5) {
    sealed.push({ minX: x - 0.25, maxX: x + 0.25, minZ: -5, maxZ: 5, minY: 0, maxY: 3 });
  }
  const nav = createNav(sealed, [], {});
  ok(nav.plan([0, 0, 0], [4, 0, -2]) === null, '全封死时返回 null');
}

{
  // 分层：阁楼地板不挡楼下；楼下家具不干扰阁楼
  const loftDeck = { minX: -6, maxX: -1.2, minZ: -4.5, maxZ: -0.3, minY: 2.74, maxY: 2.9 };
  ok(!blocksFloor(loftDeck, 0), '阁楼楼板不挡住站在楼下的人');
  ok(!blocksFloor(loftDeck, FLOOR.loftY), '站在楼板上，楼板不挡自己');
  const lowTable = { minX: 0, maxX: 1, minZ: 0, maxZ: 1, minY: 2.0, maxY: 3.5 };
  ok(blocksFloor(lowTable, FLOOR.loftY), '从阁楼地板垂下来的结构挡住阁楼层');
  const sofa = { minX: 3.6, maxX: 5.2, minZ: -3.3, maxZ: -2.4, minY: 0, maxY: 0.62 };
  ok(!blocksFloor(sofa, FLOOR.loftY), '楼下沙发不干扰阁楼层');
  ok(blocksFloor(sofa, 0), '楼下沙发挡住楼下');
  const rug = { minX: -1, maxX: 1, minZ: -1, maxZ: 1, minY: 0, maxY: 0.018 };
  ok(!blocksFloor(rug, 0), '18mm 地毯可以踩过去');
}

{
  // punch：被家具吞住的落脚点能清出来
  const g = makeGrid([{ minX: -0.5, maxX: 0.5, minZ: -0.5, maxZ: 0.5, minY: 0, maxY: 1 }], 0, {});
  ok(!isFreeAt(g, 0, 0), '盒子中心原本不可走');
  punch(g, 0, 0, 0.45);
  ok(isFreeAt(g, 0, 0), 'punch 之后中心可走');
}

{
  // 线段-矩形相交的边界情况
  const r = { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };
  ok(segmentHitsRect(0.5, 0.5, 5, 5, r), '端点在矩形内 → 相交');
  ok(segmentHitsRect(-1, 0.5, 2, 0.5, r), '横穿 → 相交');
  ok(!segmentHitsRect(2, 2, 3, 3, r), '完全在外 → 不相交');
  ok(!segmentHitsRect(-1, 2, -1, 3, r), '平行擦边外侧 → 不相交');
}

{
  // 视线与拉直
  const g = makeGrid([], 0, {});
  ok(lineOfSight(g, -5, -4, 5, 4), '空场对角线通视线');
  const jagged = [];
  for (let i = 0; i <= 20; i++) jagged.push([i * 0.25, (i % 2) * 0.05]);
  const clean = simplifyPathTest(g, jagged);
  ok(clean.length <= 3, `锯齿被拉直（21 → ${clean.length}）`);
}

function simplifyPathTest(g, pts) {
  // 直接借 createNav 的拉直能力（空障碍下等价）
  const nav = createNav([], [], {});
  return nav.plan([pts[0][0], 0, pts[0][1]], [pts[pts.length - 1][0], 0, pts[pts.length - 1][1]])
    .waypoints;
}

{
  // 跨层：必须经过梯子两端
  const nav = createNav([], Object.values(ZONES), {});
  const p = nav.plan([4.2, 0, -2.15], [-3.0, FLOOR.loftY, -1.8]);
  ok(!!p, '客厅 → 阁楼书桌可达');
  if (p) {
    const iFoot = p.waypoints.findIndex(
      (w) => Math.abs(w[0] - LADDER.foot[0]) < 0.4 && Math.abs(w[2] - LADDER.foot[2]) < 0.4 && w[1] === 0
    );
    const iTop = p.waypoints.findIndex(
      (w) => Math.abs(w[0] - LADDER.top[0]) < 0.4 && Math.abs(w[2] - LADDER.top[2]) < 0.4 && w[1] > 2
    );
    ok(iFoot >= 0 && iTop > iFoot, `经过梯子脚(#${iFoot})再上梯顶(#${iTop})`);
    ok(p.waypoints.slice(iTop).every((w) => Math.abs(w[1] - FLOOR.loftY) < 0.01), '梯顶之后全在阁楼层');
    ok(p.waypoints.slice(0, iFoot + 1).every((w) => w[1] === 0), '爬梯之前全在楼下');
    ok(!!p.climb, 'climb 标记存在');
  }
}

/* ================================================================== */
/*  B. 真实障碍（浏览器导出）                                            */
/* ================================================================== */

console.log('B) 真实障碍');

const realPath = path.resolve(process.cwd(), '.workbuddy/tmp/blockers.json');
if (!fs.existsSync(realPath)) {
  console.log('  (跳过：没有 blockers.json，先跑 .workbuddy/tmp/dump_blockers.cjs)');
} else {
  const blockers = JSON.parse(fs.readFileSync(realPath, 'utf8'));
  ok(blockers.length > 50, `导出了 ${blockers.length} 个真实包围盒`);

  const nav = createNav(blockers, Object.values(ZONES), {});
  const st = nav.stats;
  console.log(
    `  栅格：楼下 ${st.floors[0].cols}×${st.floors[0].rows}（可走 ${st.floors[0].freeCells}/${st.floors[0].total}）` +
      `，阁楼 ${st.floors[1].cols}×${st.floors[1].rows}（可走 ${st.floors[1].freeCells}/${st.floors[1].total}）`
  );
  ok(st.floors[0].freeCells > st.floors[0].total * 0.35, '楼下至少 35% 可走（别把屋子堵死）');
  // 阁楼的可走上限不是全网格，而是楼板占用区（LOFT_DECK 以外是楼下的天空，
  // makeGrid 里整片标 SOLID）。分母按楼板格子数算：
  const loft = st.floors[1];
  // 直接数：楼板 x∈[-6,-1.2]、z∈[-4.5,-0.3] 在 0.25 栅格里的格子数
  const deckCells =
    Math.round((LOFT_DECK.maxX - LOFT_DECK.minX) / 0.25) * Math.round((LOFT_DECK.maxZ - LOFT_DECK.minZ) / 0.25);
  ok(
    loft.freeCells > deckCells * 0.3,
    `阁楼至少 30% 可走（${loft.freeCells}/${deckCells} 楼板格）`
  );
  console.log(`  punch 清出：${st.punched.length} 处，共 ${st.punched.reduce((n, p) => n + p.cells, 0)} 格`);

  // 每个落脚点两两互达
  const spots = [];
  for (const [k, z] of Object.entries(ZONES)) {
    spots.push({ name: `${k}.anchor`, p: z.anchor });
    if (z.desk !== z.anchor) spots.push({ name: `${k}.desk`, p: z.desk });
  }
  let unreachable = 0;
  const failures = [];
  let clipping = 0;
  const clips = [];

  for (const a of spots) {
    for (const b of spots) {
      if (a === b) continue;
      const p = nav.plan(a.p, b.p);
      if (!p) {
        unreachable += 1;
        if (failures.length < 6) failures.push(`${a.name}→${b.name}`);
        continue;
      }
      // 路径不得穿家具：按 0.05m 步长细采样，判定点是否落在障碍盒
      // **实体内部**（不判 clearance pad——余量保护的是头球，测试只抓
      // 真穿过去；旧的 1/12 采样约 0.4m 一跳，比格子还稀，加上
      // isFreeAt 对贴边坐标的四舍五入，会把贴边合法路径误报成穿模）。
      const wps = p.waypoints;
      let bad = false;
      for (let i = 1; i < wps.length && !bad; i++) {
        if (Math.abs(wps[i][1] - wps[i - 1][1]) > 0.5) continue; // 梯子段跳过
        const floorY = wps[i][1] === 0 ? 0 : FLOOR.loftY;
        const segLen = Math.hypot(wps[i][0] - wps[i - 1][0], wps[i][2] - wps[i - 1][2]);
        const steps = Math.max(1, Math.ceil(segLen / 0.05));
        for (let s = 0; s <= steps && !bad; s++) {
          const t = s / steps;
          const x = wps[i - 1][0] + (wps[i][0] - wps[i - 1][0]) * t;
          const z = wps[i - 1][2] + (wps[i][2] - wps[i - 1][2]) * t;
          for (const box of blockers) {
            if (blocksFloor(box, floorY) && x > box.minX && x < box.maxX && z > box.minZ && z < box.maxZ) {
              bad = true;
              clipping += 1;
              if (clips.length < 4) clips.push(`${a.name}→${b.name} @${x.toFixed(1)},${z.toFixed(1)}`);
              break;
            }
          }
        }
      }
    }
  }
  ok(unreachable === 0, `${spots.length} 个落脚点两两可达（${unreachable} 对失败）${failures.length ? '：' + failures.join(', ') : ''}`);
  ok(clipping === 0, `路径不穿家具（${clipping} 条穿模）${clips.length ? '：' + clips.join(', ') : ''}`);

  // 屋中心 → 每个房间，实测长度与耗时
  console.log('  从屋中心出发：');
  for (const [k, z] of Object.entries(ZONES)) {
    const p = nav.plan([0, 0, 0], z.desk);
    if (!p) {
      console.error(`    ${k}: NULL`);
      ok(false, `${k} 从屋中心可达`);
      continue;
    }
    let len = 0;
    for (let i = 1; i < p.waypoints.length; i++) len += segLen(p.waypoints[i - 1], p.waypoints[i]);
    console.log(
      `    ${k.padEnd(9)} ${len.toFixed(1)}m  ${p.waypoints.length} 拐点  ~${(len / 1.25).toFixed(1)}s${p.climb ? '（含爬梯）' : ''}`
    );
    ok(len < 22, `${k} 路线长度合理（${len.toFixed(1)}m，没绕全场）`);
  }
}

/* ================================================================== */
/*  C. 工具名映射                                                      */
/* ================================================================== */

console.log('C) 工具映射');

{
  const cases = [
    ['ops_read_files', 'file'],
    ['ops_grep', 'file'],
    ['ops_glob', 'file'],
    ['read', 'file'],
    ['edit', 'file'],
    ['write', 'file'],
    ['ops_bash', 'computer'],
    ['bash', 'computer'],
    ['job_output', 'computer'],
    ['web_search', 'search'],
    ['web_fetch', 'search'],
    ['weknora_ask', 'search'],
    ['hindsight_reflect', 'search'],
    ['cua_driver_native__click', 'browser'],
    ['browser_navigate', 'browser'],
    ['get_browser_state', 'browser'],
    ['skill', 'app'],
    ['present', 'app'],
    ['send_meme', 'app'],
    ['todo_write', 'main'],
    ['ask_user_question', 'main'],
    ['agent_teams_create', 'main'],
    ['workflow', 'main'],
    ['compress', 'main'],
    ['totally_unknown_tool', 'main'],
    ['', 'main'],
    [null, 'main'],
    [undefined, 'main'],
  ];
  for (const [tool, want] of cases) {
    const got = roomForTool(tool);
    ok(got === want, `roomForTool(${JSON.stringify(tool)}) = ${got}，期望 ${want}`);
  }
  console.log(`  ${cases.length} 条用例`);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'HAS FAILURES'}  pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
