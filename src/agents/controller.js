/**
 * 住客控制器 —— 让唯一的模型化小拾在屋里走动、按会话状态摆姿态。
 *
 * 模型是单网格刚性网格（无命名部件、无蒙皮），所以所有"动作"都是对角色
 * 根节点的整体变换：位移、转身、步伐弹跳、摇摆、缩身。读状态靠姿态 +
 * 头顶气泡（ui/bubble.js），不靠手脚。
 *
 * 寻路用 agents/nav.js 的占用栅格 A*；障碍盒从已建好的房屋场景运行时推导
 * （deriveBlockers），按 y 分层，所以阁楼地板不会挡住楼下、地毯不会被当墙。
 */
import * as THREE from 'three';
import { createModeledCharacter } from '../scene/characterModel.js';
import { createNav } from './nav.js';

/** 状态优先级：多 Agent 并发上报时，取"最重要"的那个来演。 */
export const PRIORITY = {
  waiting_confirm: 60,
  error: 50,
  working: 40,
  planning: 35,
  thinking: 30,
  done: 20,
  walking: 15,
  idle: 10,
};

/** 这些状态是中断/收尾，无论当前在干什么都立刻生效。 */
const ALWAYS_ACCEPT = new Set(['done', 'error', 'waiting_confirm']);

/** 降级抑制：避免 tool/result 把刚建立的 working 一闪抹掉。 */
export function acceptTransition(cur, next, ageSec) {
  if (cur === next) return true; // 同状态：只刷新任务文本
  if (ALWAYS_ACCEPT.has(next)) return true;
  if (next === 'working' || next === 'planning') return true; // 新调用/新一轮总生效
  if (next === 'thinking') return cur !== 'working' || ageSec > 2.5;
  if (next === 'idle') return cur === 'done' || cur === 'error' || ageSec > 6;
  return PRIORITY[next] > PRIORITY[cur];
}

/**
 * 这个坐标算谁的房间：取最近的 zone 锚点。比手写坐标边界稳，
 * 因为房间归属本来就该跟着 ZONES 走，改锚点不用动这里。
 * 跨层只在同层内比较（阁楼的事实在阁楼，不会被楼下锚点抢走）。
 */
export function zoneOf(point, zones) {
  const y = point[1];
  let best = null;
  let bd = Infinity;
  for (const [key, z] of Object.entries(zones || {})) {
    const a = z.anchor;
    if (!a) continue;
    if (Math.abs(a[1] - y) > 1.5) continue;
    const d = Math.hypot(a[0] - point[0], a[2] - point[2]);
    if (d < bd) {
      bd = d;
      best = key;
    }
  }
  return best;
}

const DEFAULTS = {
  scale: 1.0, // 屋里的 Q 版身材；展示台上是 1.6
  walkSpeed: 1.25, // m/s
  climbSpeed: 0.6,
  home: 'living', // 默认落脚点（客厅）
  idleDwell: [4, 9], // 漫游驻留秒数区间
  roamZones: ['main', 'browser', 'app'], // 空闲时在客厅/飘窗/厨房之间晃
  /** 已在路上时，多久才允许改道。真实会话里工具调用可能比走路快，
   *  没有这个冷却，小拾会在两个房间之间来回抽搐。 */
  repathCooldown: 2.2,
};

/** 不挡路的物件：按名字剔掉装饰性/细到不值得绕的东西。 */
const IGNORED_NAMES = /dust|mote|label|bubble|light|shadow/i;

export function createResident({ scene, home, zones, palette, opts = {} }) {
  const cfg = { ...DEFAULTS, ...opts };

  let character = null;
  let ready = false;
  let failed = null;

  /** @type {Array<{minX,maxX,minZ,maxZ,minY,maxY,name:string}>} */
  let blockers = [];
  let navi = createNav([], [], cfg);

  const pos = new THREE.Vector3(0, 0, 0);
  const yaw = { current: 0, target: 0 };

  const nav = {
    waypoints: null, // [[x,y,z], ...]
    leg: 0, // 正在前往的 waypoint 下标
    legT: 0,
    climbing: false,
    target: null,
    targetZone: null,
    wantsDesk: false,
    pathStartedAt: 0,
    arriveState: null,
    pending: null, // 冷却期挂起的改道请求 {agent,state,ev}，冷却一过兑现
  };

  const act = {
    state: 'idle',
    agent: null, // 当前状态归属的 agent 键（同状态换人必须重新寻路）
    task: null,
    detail: null,
    progress: null,
    since: 0,
    dwellUntil: 0,
    pulse: 0, // done / error 的一次性动画计时
  };

  /* ---------------------------------------------------------------- */
  /*  加载角色                                                          */
  /* ---------------------------------------------------------------- */

  const loading = createModeledCharacter(palette)
    .then((ch) => {
      character = ch;
      character.scale.setScalar(cfg.scale);
      scene.add(character);
      ready = true;
      return true;
    })
    .catch((err) => {
      failed = err;
      console.error('[resident] 小拾模型加载失败，屋里不会有人：', err);
      return false;
    });

  /* ---------------------------------------------------------------- */
  /*  障碍推导                                                          */
  /* ---------------------------------------------------------------- */

  const box = new THREE.Box3();

  function deriveBlockers() {
    const out = [];
    home.group.updateMatrixWorld(true);

    for (const child of home.group.children) {
      if (child.userData?.noBlock) continue;
      if (IGNORED_NAMES.test(child.name || '')) continue;

      let hasMesh = false;
      child.traverse((o) => {
        if (o.isMesh) hasMesh = true;
      });
      if (!hasMesh) continue;

      box.setFromObject(child);
      if (!Number.isFinite(box.min.x)) continue;
      // 太薄的（地毯、地垫）踩得过去，不算障碍
      if (box.max.y - box.min.y < 0.05) continue;

      out.push({
        minX: box.min.x,
        maxX: box.max.x,
        minZ: box.min.z,
        maxZ: box.max.z,
        minY: box.min.y,
        maxY: box.max.y,
        name: child.name || child.type,
      });
    }

    blockers = out;
    navi = createNav(blockers, Object.values(zones || {}), cfg);
    return { blockers, stats: navi.stats };
  }

  /* ---------------------------------------------------------------- */
  /*  寻路                                                             */
  /* ---------------------------------------------------------------- */

  function walkTo(point, zoneKey, wantsDesk = false) {
    if (!ready) return false;
    const plan = navi.plan([pos.x, pos.y, pos.z], point);
    if (!plan || !plan.waypoints || plan.waypoints.length < 2) {
      console.warn('[resident] 无路可达，留在原地', point);
      return false;
    }
    nav.targetZone = zoneKey || null;
    nav.wantsDesk = !!wantsDesk;
    nav.waypoints = plan.waypoints;
    nav.leg = 1; // 0 是起点自己
    nav.legT = 0;
    nav.target = point;
    nav.pending = null; // 新计划已出，挂起的旧改道作废
    nav.pathStartedAt = performance.now() / 1000;
    return true;
  }

  function setAct(name, { task, detail, progress, agent } = {}) {
    act.state = name;
    if (agent !== undefined) act.agent = agent;
    act.task = task ?? null;
    act.detail = detail ?? null;
    act.progress = progress ?? null;
    act.pulse = 0;
    act.since = performance.now() / 1000;
  }

  /* ---------------------------------------------------------------- */
  /*  事件入口                                                          */
  /* ---------------------------------------------------------------- */

  function onEvent(ev) {
    if (!ev || !ev.type) return;

    if (ev.type === 'snapshot') {
      const agents = ev.agents || {};
      let best = null;
      for (const [k, v] of Object.entries(agents)) {
        const p = PRIORITY[v?.state] ?? 0;
        if (p > 0 && (!best || p > best.p)) best = { k, v, p };
      }
      // 恢复现场：直接落位，不演 30 秒走路
      if (best) applyAgentState(best.k, best.v.state, best.v, { teleport: true });
      else setAct('idle');
      return;
    }

    if (ev.type === 'session.end') {
      setAct('idle');
      act.agent = null;
      nav.waypoints = null;
      nav.pending = null;
      act.dwellUntil = 0;
      return;
    }

    if (ev.type === 'confirm.request' && ev.agent) {
      applyAgentState(ev.agent, 'waiting_confirm', { task: ev.question });
      return;
    }
    if (ev.type === 'task.error' && ev.agent) {
      applyAgentState(ev.agent, 'error', { task: ev.message });
      return;
    }
    if (ev.type === 'agent.state' && ev.agent) {
      applyAgentState(ev.agent, ev.state, ev);
    }
  }

  function applyAgentState(agent, state, ev = {}, extra = {}) {
    if (!ready) return;
    const z = zones?.[agent];
    if (!z) return;

    const task = ev.task || ev.question || ev.message || null;
    const detail = ev.detail || null;
    const progress = typeof ev.progress === 'number' ? ev.progress : null;

    const next = PRIORITY[state] !== undefined ? state : 'idle';
    const ageSec = act.since ? performance.now() / 1000 - act.since : 999;

    // 并发防抖：一个角色一次只演一件最重要的事。
    // 同 agent 的状态流转永远生效（她就是在演这个 agent 的会话）；
    // 换 agent 时只允许更高优先级（或中断类 done/error/waiting_confirm、
    // 或当前空闲）来打断——两个同时 working 的 agent 若互相抢占，
    // 小拾会在两个房间之间被拽来拽去（repathCooldown 也压不住）。
    const curKey = nav.waypoints && nav.arriveState ? nav.arriveState : act.state;
    const effCur = PRIORITY[curKey] ?? PRIORITY.idle;
    const sameAgent = act.agent === agent;
    if (!sameAgent && !ALWAYS_ACCEPT.has(next)) {
      const curIdle = act.state === 'idle' && !nav.waypoints;
      if (!curIdle && PRIORITY[next] <= effCur) return;
    }

    if (extra.teleport) {
      const spot = z.desk || z.anchor;
      pos.fromArray(spot);
      nav.waypoints = null;
      nav.pending = null;
      nav.target = spot;
      character.position.copy(pos);
      setAct(next === 'walking' ? 'idle' : next, { task, detail, progress, agent });
      return;
    }

    // 同一 agent 的同状态：只刷新任务文本与进度，不重新寻路。
    // 换了 agent（如 File 工作中 → Search 工作中）必须往下走重新寻路。
    const wantsDeskNext = next === 'working' || next === 'planning';
    const sameSpot =
      act.agent === agent &&
      (!nav.waypoints || (nav.targetZone === agent && nav.wantsDesk === wantsDeskNext));
    if ((act.state === next || (act.state === 'walking' && nav.arriveState === next)) && sameSpot) {
      act.task = task ?? act.task;
      act.detail = detail ?? act.detail;
      act.progress = progress ?? act.progress;
      return;
    }
    if (!acceptTransition(act.state, next, ageSec)) return;

    // 目的地策略：只有「去某房间干活/盘算」才值得跑动。
    // 想想、出错、等确认这类是原地状态，犯不着为它们穿过整个屋子。
    const wantsDesk = wantsDeskNext;
    const wantPos = wantsDesk ? z.desk : z.anchor;

    const alreadyThere =
      !nav.waypoints &&
      Math.hypot(pos.x - wantPos[0], pos.z - wantPos[2]) < 0.6 &&
      Math.abs(pos.y - wantPos[1]) < 1;

    if (alreadyThere) {
      setAct(next, { task, detail, progress, agent });
      return;
    }

    // 正在路上：先把最新任务挂上（信息不丢），是否改道看冷却
    if (nav.waypoints) {
      act.task = task ?? act.task;
      act.detail = detail ?? act.detail;
      act.progress = progress ?? act.progress;
      if (ALWAYS_ACCEPT.has(next)) nav.arriveState = next;

      const sameDestination = nav.targetZone === agent && nav.wantsDesk === wantsDesk;
      if (sameDestination) {
        // 同一目的地只是换个说法 → 绝不改道，但最新意图要在到达时兑现
        nav.arriveState = next;
        return;
      }
      const sinceRepath = performance.now() / 1000 - nav.pathStartedAt;
      if (sinceRepath < cfg.repathCooldown) {
        // 跨目的地但太密集 → 先走完这段，冷却一过立刻兑现改道
        nav.pending = { agent, state: next, ev: { task, detail, progress } };
        return;
      }
    } else if (!wantsDesk) {
      // 原地状态且不在移动中：就地演，不跑动
      setAct(next, { task, detail, progress, agent });
      return;
    }

    const moved = walkTo(wantPos, agent, wantsDesk);
    if (moved) {
      const carry = { task: task ?? act.task, detail, progress, agent };
      if (ALWAYS_ACCEPT.has(next)) {
        setAct(next, carry); // 中断类状态：边走边在气泡上体现
        nav.arriveState = next;
      } else {
        setAct('walking', carry);
        nav.arriveState = next;
      }
    } else {
      setAct(next, { task, detail, progress, agent });
    }
  }

  /* ---------------------------------------------------------------- */
  /*  每帧                                                              */
  /* ---------------------------------------------------------------- */

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();

  function advance(dt) {
    const wps = nav.waypoints;
    if (!wps || nav.leg >= wps.length) {
      nav.waypoints = null;
      return false;
    }
    const from = wps[nav.leg - 1];
    const to = wps[nav.leg];
    a.fromArray(from);
    b.fromArray(to);
    const segLen = a.distanceTo(b);
    const climbing = Math.abs(b.y - a.y) > 0.5;
    nav.climbing = climbing;
    const speed = climbing ? cfg.climbSpeed : cfg.walkSpeed;

    nav.legT += (dt * speed) / Math.max(segLen, 1e-3);
    if (nav.legT >= 1) {
      nav.legT = 0;
      nav.leg += 1;
      pos.copy(b);
      if (nav.leg >= wps.length) {
        nav.waypoints = null;
        return false;
      }
      return true;
    }
    pos.lerpVectors(a, b, nav.legT);
    return true;
  }

  /** 空闲漫游：在几个生活点之间晃，到点驻留几秒。 */
  function pickRoamTarget(t) {
    if (t < act.dwellUntil) return;
    const spots = (cfg.roamZones || []).map((k) => zones?.[k]?.anchor).filter(Boolean);
    const point = spots.length ? spots[Math.floor(Math.random() * spots.length)] : [0, 0, 0];
    if (walkTo(point, 'main', false)) {
      setAct('walking', {});
      nav.arriveState = 'idle';
    } else {
      act.dwellUntil = t + 3; // 暂时无路，过会儿再试
    }
  }

  function pose(t, dt) {
    if (!character) return;
    const wps = nav.waypoints;
    const moving = !!wps;

    // 朝向：走路时看前进方向，站定时缓缓侧向观众
    if (moving && nav.leg < wps.length) {
      const from = wps[nav.leg - 1];
      const to = wps[nav.leg];
      const dx = to[0] - from[0];
      const dz = to[2] - from[2];
      if (dx || dz) yaw.target = Math.atan2(dx, dz);
    } else if (act.state === 'working' || act.state === 'planning') {
      yaw.target = Math.PI * 0.12;
    }
    const k = 1 - Math.pow(0.001, dt); // 指数平滑，与帧率无关
    let diff = yaw.target - yaw.current;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    yaw.current += diff * k;

    let yOff = 0;
    let roll = 0;
    let pitch = 0;
    let sx = 1;
    let sy = 1;

    if (moving) {
      const cadence = nav.climbing ? 6 : 8.5;
      yOff = Math.abs(Math.sin(t * cadence)) * 0.022;
      roll = Math.sin(t * cadence * 0.5) * 0.035;
      if (nav.climbing) pitch = -0.12;
    } else {
      switch (act.state) {
        case 'working':
          yOff = Math.sin(t * 9) * 0.006;
          pitch = 0.055;
          roll = Math.sin(t * 2.1) * 0.012;
          break;
        case 'planning':
          roll = Math.sin(t * 1.1) * 0.05;
          pitch = -0.03;
          break;
        case 'thinking':
          roll = 0.13 + Math.sin(t * 0.8) * 0.03;
          yOff = Math.sin(t * 1.4) * 0.008;
          break;
        case 'waiting_confirm': {
          const p = (t * 1.6) % 1;
          yOff = p < 0.35 ? Math.sin((p / 0.35) * Math.PI) * 0.085 : 0;
          roll = Math.sin(t * 5) * 0.02;
          break;
        }
        case 'done': {
          act.pulse += dt;
          const p = Math.min(act.pulse / 0.55, 1);
          const s = Math.sin(p * Math.PI * 2) * (1 - p) * 0.09;
          sy = 1 + s;
          sx = 1 - s * 0.6;
          yOff = Math.max(s, 0) * 0.35;
          if (p >= 1) {
            setAct('idle');
            act.dwellUntil = t + 1.5;
          }
          break;
        }
        case 'error': {
          act.pulse += dt;
          const settle = Math.min(act.pulse / 0.8, 1);
          sy = 1 - 0.06 * settle;
          sx = 1 + 0.03 * settle;
          pitch = 0.09 * settle;
          yOff = -0.01 * settle;
          break;
        }
        default:
          yOff = Math.sin(t * 1.5) * 0.008;
          roll = Math.sin(t * 0.6) * 0.015;
      }
    }

    character.position.set(pos.x, pos.y + yOff, pos.z);
    character.rotation.set(pitch, yaw.current, roll);
    character.scale.set(cfg.scale * sx, cfg.scale * sy, cfg.scale);
  }

  function update(t, dt) {
    if (!ready) return;
    // 冷却期挂起的改道：冷却一过立刻兑现，不能静默丢掉
    if (nav.waypoints && nav.pending) {
      const nowP = performance.now() / 1000;
      if (nowP - nav.pathStartedAt >= cfg.repathCooldown) {
        const p = nav.pending;
        nav.pending = null;
        applyAgentState(p.agent, p.state, p.ev);
      }
    }
    if (nav.waypoints) {
      advance(dt);
      if (!nav.waypoints) {
        // 到达：把走路期间攒下的语义兑现成动作
        nav.pending = null;
        const after = nav.arriveState || 'idle';
        nav.arriveState = null;
        setAct(after, { task: act.task, detail: act.detail, progress: act.progress });
        act.dwellUntil =
          t + cfg.idleDwell[0] + Math.random() * (cfg.idleDwell[1] - cfg.idleDwell[0]);
      }
    } else if (act.state === 'idle' || act.state === 'walking') {
      pickRoamTarget(t);
    }
    pose(t, dt);
  }

  /* ---------------------------------------------------------------- */
  /*  对外                                                              */
  /* ---------------------------------------------------------------- */

  return {
    loading,
    get ready() {
      return ready;
    },
    get error() {
      return failed;
    },
    get object() {
      return character;
    },
    onEvent,
    update,
    deriveBlockers,
    get blockers() {
      return blockers;
    },
    get nav() {
      return navi;
    },
    getState() {
      return {
        state: act.state,
        task: act.task,
        detail: act.detail,
        progress: act.progress,
        walking: !!nav.waypoints,
        climbing: !!nav.climbing,
        pos: [pos.x, pos.y, pos.z],
        zone: zoneOf([pos.x, pos.y, pos.z], zones),
        target: nav.target,
        targetZone: nav.targetZone,
        pathLeft: nav.waypoints ? nav.waypoints.length - nav.leg : 0,
      };
    },
    /** 气泡投影要用的头顶世界坐标。 */
    getHeadPoint(out) {
      const v = out || new THREE.Vector3();
      return v.set(pos.x, pos.y + 1.15 * cfg.scale, pos.z);
    },
    /** 身体中心（跟随镜头的锚点，比头顶稳）。 */
    getBodyPoint(out) {
      const v = out || new THREE.Vector3();
      return v.set(pos.x, pos.y + 0.55 * cfg.scale, pos.z);
    },
    teleport(point) {
      pos.fromArray(point);
      nav.waypoints = null;
      nav.target = point;
      if (character) character.position.copy(pos);
    },
    /** 供调试/测试：直接下个状态。 */
    forceState: setAct,
    dispose() {
      if (!character) return;
      character.parent?.remove(character);
      character.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          if (m?.map) m.map.dispose?.();
          m?.dispose?.();
        });
      });
      character = null;
      ready = false;
    },
  };
}
