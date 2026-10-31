/**
 * 屋内导航 —— 占用栅格 A*，纯数据 + 纯函数，不依赖 THREE，Node 里可直接单测。
 *
 * 为什么是栅格而不是手放节点图：屋里家具很密（104 个包围盒），12 个手放
 * 节点 + 直线边在这种密度下必然碎裂——屋中心到客厅的直线一定穿过沙发或
 * 落地灯，边一剪就成孤岛。栅格逐格判断可走，任何有空隙的通道都能找到。
 *
 * 房屋结构：屋内没有内墙（只有后墙 z=-4.5、左墙 x=-6，前/右两侧是切口），
 * 所以楼下是一整块通铺。阁楼是另一层，只能靠梯子上下。
 *
 * 坐标系与场景一致：+x 向右、+z 向镜头、y 是高度。
 */

/* ------------------------------------------------------------------ */
/*  房屋常量（与 scene/home.js 的 HOUSE / ZONES 对齐）                  */
/* ------------------------------------------------------------------ */

export const FLOOR = {
  minX: -6,
  maxX: 6,
  minZ: -4.5,
  maxZ: 4.5,
  loftY: 2.9,
};

/** 梯子：home.js 里 position (-1.95, 0, 0.5)、rotation.x = -0.28、高 3.05。
 *  顶端实测约 (-1.95, 2.93, -0.34)，正好落在阁楼前栏杆的断口内。 */
export const LADDER = {
  foot: [-1.95, 0, 1.05],
  top: [-1.95, FLOOR.loftY, -0.62],
};

/** 两个楼层键。 */
export const FLOOR_Y = [0, FLOOR.loftY];

/**
 * 阁楼楼板的实际范围（home.js：box(4.8,0.16,4.2) @ (-3.6, loftY-0.08, -2.4)）。
 * 站在阁楼层上，只有这块板子（加梯口）踩得实；板子以外是楼下的空间，
 * 不裁掉的话小拾会在虚空上散步。
 */
export const LOFT_DECK = { minX: -6.0, maxX: -1.2, minZ: -4.5, maxZ: -0.3 };

/* ------------------------------------------------------------------ */
/*  障碍判定                                                           */
/* ------------------------------------------------------------------ */

/**
 * 这个盒子是否挡住站在 floorY 层的人。
 *
 * 分层规则：
 *   - 顶面要高出脚底一个台阶以上（maxY > y + 0.12）——地毯、薄垫踩得过去；
 *   - 底面要低于头顶（minY < y + 1.15）——阁楼地板、吊灯不会挡住楼下走动。
 * 同一份障碍表因此能同时服务楼下与阁楼两层。
 */
export function blocksFloor(r, floorY) {
  // 没给 y 信息 → 保守当作障碍（手写障碍盒、旧数据都走这条）
  if (r.maxY === undefined && r.minY === undefined) return true;
  const top = r.maxY ?? r.minY;
  const bottom = r.minY ?? r.maxY;
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return true;
  return top > floorY + 0.12 && bottom < floorY + 1.15;
}

/** 线段 AB 是否与轴对齐矩形相交（Liang–Barsky 裁剪 + 端点在内部）。 */
export function segmentHitsRect(ax, az, bx, bz, r) {
  if ((ax >= r.minX && ax <= r.maxX && az >= r.minZ && az <= r.maxZ) ||
      (bx >= r.minX && bx <= r.maxX && az >= r.minZ && az <= r.maxZ)) {
    return true;
  }

  const dx = bx - ax;
  const dy = bz - az;
  let t0 = 0;
  let t1 = 1;

  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const r2 = q / p;
    if (p < 0) {
      if (r2 > t1) return false;
      if (r2 > t0) t0 = r2;
    } else {
      if (r2 < t0) return false;
      if (r2 < t1) t1 = r2;
    }
    return true;
  };

  if (!clip(-dx, ax - r.minX)) return false;
  if (!clip(dx, r.maxX - ax)) return false;
  if (!clip(-dy, az - r.minZ)) return false;
  if (!clip(dy, r.maxZ - az)) return false;
  return t1 > t0;
}

/** 线段是否穿过任何障碍盒（ignore 里的下标跳过）。 */
export function segmentBlocked(ax, az, bx, bz, blockers, clearance = 0, floorY = 0, ignore = null) {
  const skip = ignore && ignore.length ? new Set(ignore) : null;
  for (let i = 0; i < blockers.length; i++) {
    if (skip && skip.has(i)) continue;
    const r = blockers[i];
    if (!blocksFloor(r, floorY)) continue;
    const pad = {
      minX: r.minX - clearance,
      maxX: r.maxX + clearance,
      minZ: r.minZ - clearance,
      maxZ: r.maxZ + clearance,
    };
    if (segmentHitsRect(ax, az, bx, bz, pad)) return true;
  }
  return false;
}

/** 哪些盒子包含这个点（按楼层过滤），返回下标数组。 */
export function containingIndices(p, blockers, floorY = p[1], clearance = 0) {
  const out = [];
  for (let i = 0; i < blockers.length; i++) {
    const r = blockers[i];
    if (!blocksFloor(r, floorY)) continue;
    if (
      p[0] >= r.minX - clearance &&
      p[0] <= r.maxX + clearance &&
      p[2] >= r.minZ - clearance &&
      p[2] <= r.maxZ + clearance
    ) {
      out.push(i);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  栅格                                                               */
/* ------------------------------------------------------------------ */

const NAV_DEFAULTS = {
  cell: 0.25, // 格子边长（米）：12×9 的房间 → 48×36 = 1728 格，A* 微秒级
  // 2026-10-31：家具统一缩到 0.7 后走廊相对变宽，余量按小拾实际身形放宽——
  // 她的头球直径 0.66（半径 0.33），旧值 0.22 会让头蹭到家具。
  clearance: 0.34, // 角色半径余量
  punchRadius: 0.45, // 落脚点小幅清空的半径（只处理"压在家具边缘"的情况）
  minOpenCells: 40, // 落脚点所在连通块至少这么大才算开阔（≈2.5 m²）
  attachRings: 12, // 吸附搜索最多外扩几格（3m）
};

const FREE = 0;
const SOLID = 1;
const PUNCH = 2; // 落脚点挖出来的通道：A* 可走，但只算局部豁免

const keyOf = (c, r) => r * 10000 + c;

/**
 * 为某一楼层建占用栅格。
 * 格子三态：FREE 可走 / SOLID 家具挡死 / PUNCH 落脚点豁免通道。
 */
export function makeGrid(blockers, floorY, opts = {}) {
  const cfg = { ...NAV_DEFAULTS, ...opts };
  const { cell, clearance } = cfg;
  const minX = FLOOR.minX + 0.1; // 别贴墙站
  const minZ = FLOOR.minZ + 0.1;
  const maxX = FLOOR.maxX - 0.1;
  const maxZ = FLOOR.maxZ - 0.1;

  const cols = Math.max(1, Math.floor((maxX - minX) / cell) + 1);
  const rows = Math.max(1, Math.floor((maxZ - minZ) / cell) + 1);
  const blocked = new Uint8Array(cols * rows);

  // 只保留挡这一层的盒子，并按角色半径外扩
  const solid = [];
  for (const r of blockers) {
    if (!blocksFloor(r, floorY)) continue;
    solid.push({
      minX: r.minX - clearance,
      maxX: r.maxX + clearance,
      minZ: r.minZ - clearance,
      maxZ: r.maxZ + clearance,
    });
  }

  let blockedCount = 0;
  // 阁楼层只在楼板（加梯口）上踩得实，板外是楼下空间 → 一律视为不可走
  const deck = floorY > 1 ? LOFT_DECK : null;
  const landing = floorY > 1 ? { minX: LADDER.top[0] - 0.6, maxX: LADDER.top[0] + 0.6, minZ: LADDER.top[2] - 0.6, maxZ: LADDER.top[2] + 0.6 } : null;

  for (let row = 0; row < rows; row++) {
    const z = minZ + row * cell;
    for (let col = 0; col < cols; col++) {
      const x = minX + col * cell;
      const i = row * cols + col;
      if (deck) {
        const onDeck = (x >= deck.minX && x <= deck.maxX && z >= deck.minZ && z <= deck.maxZ) ||
          (x >= landing.minX && x <= landing.maxX && z >= landing.minZ && z <= landing.maxZ);
        if (!onDeck) {
          blocked[i] = SOLID;
          blockedCount += 1;
          continue;
        }
      }
      for (const s of solid) {
        if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) {
          blocked[i] = SOLID;
          blockedCount += 1;
          break;
        }
      }
    }
  }

  return {
    cols,
    rows,
    cell,
    minX,
    minZ,
    maxX,
    maxZ,
    floorY,
    blocked,
    blockedCount,
    total: cols * rows,
    cfg,
    blockers, // 原始障碍盒：punch 的"实体内部不许洗"要用
  };
}

const gx = (grid, x) => Math.round((x - grid.minX) / grid.cell);
const gz = (grid, z) => Math.round((z - grid.minZ) / grid.cell);
const wx = (grid, col) => grid.minX + col * grid.cell;
const wz = (grid, row) => grid.minZ + row * grid.cell;

/** A* 可走 = 非 SOLID（FREE 与 PUNCH 都算）。 */
export function isFree(grid, col, row) {
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return false;
  return grid.blocked[row * grid.cols + col] !== SOLID;
}

/** 世界坐标是否可站。 */
export function isFreeAt(grid, x, z) {
  return isFree(grid, gx(grid, x), gz(grid, z));
}

/**
 * 以 (x,z) 为圆心小幅清出落脚点。
 *
 * 为什么需要清：房间锚点常压在家具包围盒的边缘上（「书房工位」贴着书桌），
 * 而包围盒是保守估计——桌面以下的空隙都算在盒子里，人站进去合法。
 * 半径刻意很小（一格多），只处理"压边"，不把整件家具洗空。
 *
 * 洗开规则（2026-10-31 收紧）：
 *   - 半径到锚点 ≤ 0.3 m 的核心区：格子里藏在家具实体内部也照洗
 *     （「站在书桌位」本来就依赖包围盒的保守性）；
 *   - 0.3 m 以外只敢洗「pad 边缘环」——实体内部深处不许洗。否则相邻两个
 *     锚点的圆盘会在夹在中间的小件家具（椅子/墩子）内部连通出一条假隧道，
 *     A* 就真的从家具正中穿过去。
 */
export function punch(grid, x, z, r) {
  const c0 = gx(grid, x);
  const r0 = gz(grid, z);
  const span = Math.max(1, Math.ceil((r + grid.cell) / grid.cell));
  const raw = grid.blockers || [];
  const floorY = grid.floorY ?? 0;
  const CORE = 0.3; // 锚点核心半径：实体内部也允许洗开
  let cleared = 0;
  for (let dr = -span; dr <= span; dr++) {
    for (let dc = -span; dc <= span; dc++) {
      const col = c0 + dc;
      const row = r0 + dr;
      if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) continue;
      const i = row * grid.cols + col;
      if (grid.blocked[i] !== SOLID) continue;
      // 用格心到锚点的真实距离判定，而不是格数圆盘——格数盘在对角线上
      // 能洗到 (span+0.5)×cell，比声明的半径大
      const px = wx(grid, col);
      const pz = wz(grid, row);
      const d = Math.hypot(px - x, pz - z);
      if (d > r) continue;
      if (d > CORE && isDeepInterior(raw, floorY, px, pz)) continue;
      grid.blocked[i] = PUNCH;
      grid.blockedCount -= 1;
      cleared += 1;
    }
  }
  return cleared;
}

/** 点是否深藏在家具实体内部（严格内部，不含贴边）。 */
function isDeepInterior(raw, floorY, x, z) {
  for (const b of raw) {
    if (!blocksFloor(b, floorY)) continue;
    if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return true;
  }
  return false;
}

/**
 * 连通块标注：给每个非 SOLID 格打上块号，并统计大小。
 * 用来判断某个落脚点是不是"与世隔绝的小口袋"。
 */
export function labelComponents(grid) {
  const { cols, rows, blocked } = grid;
  const label = new Int32Array(cols * rows).fill(-1);
  const sizes = [];
  let next = 0;
  const stack = [];

  for (let i = 0; i < blocked.length; i++) {
    if (blocked[i] === SOLID || label[i] >= 0) continue;
    stack.length = 0;
    stack.push(i);
    label[i] = next;
    let n = 0;
    while (stack.length) {
      const cur = stack.pop();
      n += 1;
      const c = cur % cols;
      const r = (cur - c) / cols;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const ni = nr * cols + nc;
        if (blocked[ni] === SOLID || label[ni] >= 0) continue;
        label[ni] = next;
        stack.push(ni);
      }
    }
    sizes.push(n);
    next += 1;
  }
  return { label, sizes };
}

/**
 * 落脚点修正：把「被家具夹死的锚点」吸附到附近真正开阔的位置。
 *
 * 客厅锚点就是这种情况：它被沙发、茶几、落地灯围成一个 1.75 m² 的口袋，
 * 与大厅之间只剩 0.18 m 的缝——比角色还窄，硬挖隧道等于拆家具。
 * 与其骗自己说那里能站人，不如承认锚点选得偏了，就近挪到开口处。
 *
 * @returns {{x:number,z:number,moved:boolean,cells:number}|null}
 */
export function openSpot(grid, x, z, comp, cfg = NAV_DEFAULTS) {
  const { cols, rows, cell } = grid;
  const minOpen = cfg.minOpenCells ?? 40;
  const rings = cfg.attachRings ?? 12;

  const c0 = gx(grid, x);
  const r0 = gz(grid, z);

  const quality = (col, row) => {
    if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
    const i = row * cols + col;
    if (grid.blocked[i] === SOLID) return null;
    const lab = comp.label[i];
    if (lab < 0) return null;
    return { cells: comp.sizes[lab], col, row };
  };

  const here = quality(c0, r0);
  if (here && here.cells >= minOpen) {
    return { x: wx(grid, here.col), z: wz(grid, here.row), moved: false, cells: here.cells };
  }

  let best = null;
  let bestD = Infinity;
  for (let ring = 1; ring <= rings; ring++) {
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue;
        const q = quality(c0 + dc, r0 + dr);
        if (!q || q.cells < minOpen) continue;
        const d = Math.hypot(dc, dr);
        if (d < bestD) {
          bestD = d;
          best = q;
        }
      }
    }
    if (best) break; // 逐圈外扩，第一圈找到的就是最近的
  }

  if (!best) {
    // 附近没有开阔地：退回原处（哪怕是个口袋），至少还能站，只是进不去
    return here
      ? { x: wx(grid, here.col), z: wz(grid, here.row), moved: false, cells: here.cells }
      : null;
  }
  return { x: wx(grid, best.col), z: wz(grid, best.row), moved: true, cells: best.cells };
}

/**
 * 两点之间是否视线可达（路径拉直用）。
 *
 * 比 A* 的 isFree 严格：中间采样点必须是 FREE，PUNCH 不算。否则落脚点挖出
 * 的通道会让它误判「能穿过沙发内部」，拉直后的路径直接切进家具。
 * 两端各豁免约 2 格——落脚点自己通常就在 PUNCH 里。
 */
export function lineOfSight(grid, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return true;
  // 端点豁免：落脚点自己常在 PUNCH 里，但不许超过整段的 1/4
  const exempt = Math.min(grid.cell * 2.2, len * 0.25);
  const steps = Math.max(1, Math.ceil(len / (grid.cell * 0.5)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const along = len * t;
    if (along < exempt || len - along < exempt) continue; // 端点豁免段
    const x = ax + dx * t;
    const z = az + dz * t;
    const col = gx(grid, x);
    const row = gz(grid, z);
    if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return false;
    if (grid.blocked[row * grid.cols + col] !== FREE) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/*  A*                                                                 */
/* ------------------------------------------------------------------ */

const NEIGHBORS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, 1.4142],
  [1, -1, 1.4142],
  [-1, 1, 1.4142],
  [-1, -1, 1.4142],
];

/**
 * 栅格 A*。入参/出参都是世界坐标 [x, z]。
 * 起终点若落在障碍里，就近吸附到可走格（而不是直接判失败）。
 */
export function aStarGrid(grid, from, to) {
  const s = snapFree(grid, from[0], from[1]);
  const t = snapFree(grid, to[0], to[1]);
  if (!s || !t) return null;

  const cols = grid.cols;
  const start = s.row * cols + s.col;
  const goal = t.row * cols + t.col;
  if (start === goal) return [[wx(grid, s.col), wz(grid, s.row)]];

  const g = new Map([[start, 0]]);
  const f = new Map([[start, h(start)]]);
  const came = new Map();
  const open = new Set([start]);
  const closed = new Set();

  function h(node) {
    const nc = node % cols;
    const nr = (node - nc) / cols;
    return Math.hypot(nc - t.col, nr - t.row) * grid.cell;
  }

  while (open.size) {
    let cur = -1;
    let best = Infinity;
    for (const n of open) {
      const v = f.get(n) ?? Infinity;
      if (v < best) {
        best = v;
        cur = n;
      }
    }
    if (cur < 0) return null;
    if (cur === goal) return reconstructGrid(came, cur, cols, grid);

    open.delete(cur);
    closed.add(cur);
    const cc = cur % cols;
    const cr = (cur - cc) / cols;

    for (const [dc, dr, cost] of NEIGHBORS) {
      const nc = cc + dc;
      const nr = cr + dr;
      if (!isFree(grid, nc, nr)) continue;
      // 斜走不许夹在两个障碍之间穿墙角
      if (dc && dr) {
        if (!isFree(grid, cc + dc, cr) || !isFree(grid, cc, cr + dr)) continue;
      }
      const ni = nr * cols + nc;
      if (closed.has(ni)) continue;
      const tentative = (g.get(cur) ?? Infinity) + cost * grid.cell;
      if (tentative < (g.get(ni) ?? Infinity)) {
        came.set(ni, cur);
        g.set(ni, tentative);
        f.set(ni, tentative + h(ni));
        open.add(ni);
      }
    }
  }
  return null;
}

function reconstructGrid(came, end, cols, grid) {
  const out = [];
  let n = end;
  while (n !== undefined) {
    const c = n % cols;
    const r = (n - c) / cols;
    out.unshift([wx(grid, c), wz(grid, r)]);
    n = came.get(n);
  }
  return out;
}

/**
 * 找一个离 (x,z) 最近的可走格，但不超过 maxDist。
 *
 * 上限很重要：没有它，一个深埋在家具里的坐标会被吸附到几米外的空地，
 * 于是 plan() 报告"成功"，实际把人瞬移走 —— 宁可返回 null 让调用方
 * 换目标点，也不能假装走到了。
 */
export function snapFree(grid, x, z, maxDist = 1.6) {
  const c0 = gx(grid, x);
  const r0 = gz(grid, z);
  if (isFree(grid, c0, r0)) return { col: c0, row: r0 };
  const maxRing = Math.min(Math.max(grid.cols, grid.rows), Math.ceil(maxDist / grid.cell));
  for (let ring = 1; ring <= maxRing; ring++) {
    let best = null;
    let bestD = Infinity;
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue;
        if (!isFree(grid, c0 + dc, r0 + dr)) continue;
        const d = dc * dc + dr * dr;
        if (d < bestD) {
          bestD = d;
          best = { col: c0 + dc, row: r0 + dr };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/** 路径拉直：用视线把栅格锯齿合并成少量拐点，走起来才自然。 */
export function simplifyPath(grid, pts) {
  if (!pts || pts.length < 3) return pts ? pts.slice() : [];
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    for (; j > i + 1; j--) {
      if (lineOfSight(grid, pts[i][0], pts[i][1], pts[j][0], pts[j][1])) break;
    }
    out.push(pts[j]);
    i = j;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  导航器（两层 + 梯子）                                               */
/* ------------------------------------------------------------------ */

/**
 * 用障碍盒建导航器。
 *
 * @param {Array} blockers 推导好的障碍盒（含 y）
 * @param {Object|Array} zonePoints 落脚点：{key:{anchor,desk}} 或 [{anchor,desk}]
 *        这些点会被小幅清空并吸附到附近开阔处，修正结果见返回值的 spots
 * @param {Object} opts
 */
export function createNav(blockers, zonePoints = [], opts = {}) {
  const cfg = { ...NAV_DEFAULTS, ...opts };
  const grids = {};
  const punched = [];
  const adjusted = {}; // key.field -> [x,y,z] 修正后的落脚点
  const byOriginal = new Map(); // 原始坐标 -> 修正后的落脚点
  const ptKey = (p) => `${p[0].toFixed(3)},${(p[1] ?? 0).toFixed(3)},${p[2].toFixed(3)}`;
  const entries = Array.isArray(zonePoints)
    ? zonePoints.map((z, i) => [`z${i}`, z])
    : Object.entries(zonePoints || {});

  for (const y of FLOOR_Y) {
    const g = makeGrid(blockers, y, cfg);

    // 1) 先把所有落脚点小幅清出站位
    const spots = [];
    for (const [key, z] of entries) {
      if (z.anchor && Math.abs(z.anchor[1] - y) < 1) spots.push({ key, field: 'anchor', p: z.anchor });
      if (z.desk && Math.abs(z.desk[1] - y) < 1) spots.push({ key, field: 'desk', p: z.desk });
    }
    const lad = y === 0 ? LADDER.foot : LADDER.top;
    spots.push({ key: '__ladder', field: y === 0 ? 'foot' : 'top', p: lad });

    for (const s of spots) {
      const n = punch(g, s.p[0], s.p[2], cfg.punchRadius);
      if (n > 0) punched.push({ y, at: [+s.p[0].toFixed(2), +s.p[2].toFixed(2)], cells: n });
    }

    // 2) 再按连通块把"口袋里的锚点"吸附到附近开阔处
    const comp = labelComponents(g);
    for (const s of spots) {
      const open = openSpot(g, s.p[0], s.p[2], comp, cfg);
      if (!open) continue;
      const point = [open.x, y, open.z];
      if (s.key !== '__ladder') {
        const id = `${s.key}.${s.field}`;
        adjusted[id] = point;
        // 匹配要用**原始**坐标去查，吸附后的位置可能已经挪开一米多
        byOriginal.set(ptKey(s.p), point);
      }
      if (open.moved) {
        punched.push({
          y,
          snapped: `${s.key}.${s.field}`,
          from: [+s.p[0].toFixed(2), +s.p[2].toFixed(2)],
          to: [+open.x.toFixed(2), +open.z.toFixed(2)],
          cells: open.cells,
        });
      }
    }

    g.comp = comp;
    grids[y] = g;
  }

  /** 落脚点若被修正过，返回吸附后的坐标。 */
  function resolvePoint(p) {
    const hit = byOriginal.get(ptKey(p));
    if (hit) return { point: hit, snapped: true };
    return { point: p, snapped: false };
  }

  /** 规划一条从 from[x,y,z] 到 to[x,y,z] 的路线。 */
  function plan(from, to) {
    // 起终点都过一遍落脚点修正：终点解析保证"目标就是开阔处"；起点解析
    // 修复「起点是原始 zone 坐标、被 openSpot 挪走了」的场景——直接从原始
    // 坐标规划会以口袋起手（A* 出不来），而agent实际站位早已是修正后的点。
    const fromAdj = resolvePoint(from);
    const fromFixed = fromAdj.point;
    const fromY = nearestFloor(fromFixed[1]);
    const toAdj = resolvePoint(to);
    const toFixed = toAdj.point;
    const toY = nearestFloor(toFixed[1]);

    if (fromY === toY) {
      const g = grids[fromY];
      const raw = aStarGrid(g, [fromFixed[0], fromFixed[2]], [toFixed[0], toFixed[2]]);
      if (!raw) return null;
      const pts = simplifyPath(g, raw);
      return { waypoints: pts.map(([x, z]) => [x, fromY, z]), climb: null, snapped: toAdj.snapped };
    }

    // 跨层：走到梯子口 → 爬梯 → 另一层走到终点
    const up = fromY < toY;
    const low = grids[0];
    const high = grids[FLOOR.loftY];

    // 方向决定先走哪层：上 = 楼下走到梯脚，爬上去，阁楼走到终点；
    //               下 = 阁楼走到梯顶，爬下来，楼下走到终点。
    const legA = up
      ? aStarGrid(low, [fromFixed[0], fromFixed[2]], [LADDER.foot[0], LADDER.foot[2]])
      : aStarGrid(high, [fromFixed[0], fromFixed[2]], [LADDER.top[0], LADDER.top[2]]);
    const legB = up
      ? aStarGrid(high, [LADDER.top[0], LADDER.top[2]], [toFixed[0], toFixed[2]])
      : aStarGrid(low, [LADDER.foot[0], LADDER.foot[2]], [toFixed[0], toFixed[2]]);
    if (!legA || !legB) return null;

    const a = simplifyPath(up ? low : high, legA).map(([x, z]) => [x, up ? 0 : FLOOR.loftY, z]);
    const b = simplifyPath(up ? high : low, legB).map(([x, z]) => [x, up ? FLOOR.loftY : 0, z]);
    const gate = up ? [[...LADDER.foot], [...LADDER.top]] : [[...LADDER.top], [...LADDER.foot]];

    return {
      waypoints: [...a, ...gate, ...b],
      climb: { footIndex: a.length, up },
      snapped: toAdj.snapped,
    };
  }

  function nearestFloor(y) {
    let best = FLOOR_Y[0];
    let bd = Infinity;
    for (const f of FLOOR_Y) {
      const d = Math.abs(f - y);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  return {
    grids,
    plan,
    config: cfg,
    /** 被修正过的落脚点（吸附到开阔处后的坐标）。 */
    spots: adjusted,
    resolvePoint,
    stats: {
      punched,
      floors: FLOOR_Y.map((y) => ({
        y,
        cols: grids[y].cols,
        rows: grids[y].rows,
        freeCells: grids[y].total - grids[y].blockedCount,
        total: grids[y].total,
      })),
    },
    isFreeAt(point) {
      const g = grids[nearestFloor(point[1])];
      return isFreeAt(g, point[0], point[2]);
    },
  };
}

/* ------------------------------------------------------------------ */
/*  真实工具名 → 房间                                                  */
/* ------------------------------------------------------------------ */

/**
 * 会话里的工具名映射到 ZONES 的 agent 键。前缀匹配优先，未命中回 main
 * （主 Agent 在客厅统筹，任何不认识的调用都算它在指挥）。
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

  // 工具间：跑命令、系统
  ops_bash: 'computer',
  bash: 'computer',
  shell: 'computer',
  job_list: 'computer',
  job_output: 'computer',
  job_kill: 'computer',
  working_directory: 'computer',

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

  // 飘窗：浏览器与桌面操作
  browser_navigate: 'browser',
  browser_click: 'browser',
  browser_type: 'browser',
  get_browser_state: 'browser',
  page: 'browser',
  cua_driver_native__click: 'browser',
  cua_driver_native__type_text: 'browser',

  // 厨房：调用 App / MCP / 交付物
  skill: 'app',
  plugin_manager: 'app',
  present: 'app',
  render_ui: 'app',
  send_meme: 'app',
  meme_list: 'app',
  learn_meme: 'app',

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
  compress: 'main',
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
  ['ops_', 'file'],
];

/** 工具名 → agent 键（main/file/computer/app/browser/search）。 */
export function roomForTool(name) {
  if (typeof name !== 'string' || !name) return 'main';
  if (TOOL_ROOM[name]) return TOOL_ROOM[name];
  for (const [p, room] of PREFIX_RULES) {
    if (name.startsWith(p)) return room;
  }
  return 'main';
}
