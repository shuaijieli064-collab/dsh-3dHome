import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/*  骨骼姿态动画                                                       */
/*                                                                     */
/*  设计要点                                                           */
/*  1. 旋转全部按「世界轴」描述（axis + angle），不用猜 Blender 骨骼的  */
/*     局部轴向。实现上把世界旋转换算到该骨的父空间：                  */
/*       local = parentWorld⁻¹ · Q(worldAxis, angle) · parentWorld      */
/*       bone.quaternion = local · restLocal                           */
/*  2. 每根骨固定两个通道（主/次），状态切换时对角度做指数阻尼插值，   */
/*     所以任何状态切到任何状态都不会跳变。                            */
/*  3. 整体位移、朝向、弹跳、躺姿 pitch 仍由 controller 负责，这里只   */
/*     管躯干与四肢。                                                  */
/* ------------------------------------------------------------------ */

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);

/* 每根骨的两个默认通道（角度为 0 即不动） */
const CHANNELS = {
  Hips: [AX, AY],
  Spine: [AX, AZ],
  Chest: [AX, AZ],
  Neck: [AX, AZ],
  Head: [AX, AZ],
  Hair: [AX, AZ],
  Shoulder_L: [AZ, AX],
  Shoulder_R: [AZ, AX],
  UpperArm_L: [AX, AZ],
  UpperArm_R: [AX, AZ],
  Forearm_L: [AX, AZ],
  Forearm_R: [AX, AZ],
  Hand_L: [AX, AZ],
  Hand_R: [AX, AZ],
  Thigh_L: [AX, AZ],
  Thigh_R: [AX, AZ],
  Shin_L: [AX, AZ],
  Shin_R: [AX, AZ],
  Foot_L: [AX, AZ],
  Foot_R: [AX, AZ],
};

/* ------------------------------------------------------------------ */
/*  姿态表                                                             */
/*  每个姿态返回 { 骨名: [主通道角度, 次通道角度] }。                  */
/*  t 为秒，用于周期性动作；ctx 提供 moving/climbing/walkSpeed 等。    */
/*                                                                     */
/*  符号约定（世界坐标：+z 为正面，+x 为角色左侧）：                  */
/*    绕 X 负角 = 摆向前（+z）；绕 X 正角 = 摆向后                    */
/*    绕 Z 正角 = 摆向 +x（左）；绕 Z 负角 = 摆向 -x（右）            */
/*    绕 Y     = 扭转                                                  */
/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2;

function walkCycle(t, speed = 1) {
  return t * 8.5 * (speed || 1);
}

const POSES = {
  /* 站桩：呼吸 + 微晃 */
  idle(t) {
    const b = Math.sin(t * 1.6);
    return {
      Spine: [b * 0.02, Math.sin(t * 0.55) * 0.02],
      Chest: [b * 0.015, 0],
      Head: [Math.sin(t * 0.8) * 0.04, Math.sin(t * 0.5) * 0.05],
      Hair: [Math.sin(t * 0.9 + 0.6) * 0.03, Math.sin(t * 0.7) * 0.02],
      UpperArm_L: [Math.sin(t * 1.1) * 0.03, 0.04 + b * 0.02],
      UpperArm_R: [Math.sin(t * 1.1 + 0.4) * 0.03, -0.04 - b * 0.02],
      Forearm_L: [0.05, 0],
      Forearm_R: [0.05, 0],
    };
  },

  /* 走路：四肢交替摆动 */
  walk(t, ctx) {
    const p = walkCycle(t, ctx && ctx.walkSpeed ? ctx.walkSpeed / 1.1 : 1);
    const s = Math.sin(p);
    const c = Math.cos(p);
    return {
      Hips: [0, s * 0.05],
      Spine: [0.05, -s * 0.04],
      Chest: [0.03, s * 0.03],
      Head: [-0.02, -s * 0.03],
      Hair: [s * 0.05, 0],
      UpperArm_L: [-s * 0.42, 0.05],
      UpperArm_R: [s * 0.42, -0.05],
      Forearm_L: [-0.18 + s * 0.1, 0],
      Forearm_R: [-0.18 - s * 0.1, 0],
      Thigh_L: [-s * 0.5, 0],
      Thigh_R: [s * 0.5, 0],
      Shin_L: [Math.max(0, s) * 0.55, 0],
      Shin_R: [Math.max(0, -s) * 0.55, 0],
      Foot_L: [c * 0.1, 0],
      Foot_R: [-c * 0.1, 0],
    };
  },

  /* 爬梯：身体前倾、双臂上举交替、高抬腿 */
  climb(t) {
    const p = t * 6;
    const s = Math.sin(p);
    return {
      Spine: [0.16, 0],
      Chest: [0.08, s * 0.05],
      Head: [-0.25, 0],
      UpperArm_L: [-2.0 - s * 0.25, 0.12],
      UpperArm_R: [-2.0 + s * 0.25, -0.12],
      Forearm_L: [-0.35, 0],
      Forearm_R: [-0.35, 0],
      Thigh_L: [-s * 0.6, 0],
      Thigh_R: [s * 0.6, 0],
      Shin_L: [Math.max(0, s) * 0.7, 0],
      Shin_R: [Math.max(0, -s) * 0.7, 0],
    };
  },

  /* 坐姿：大腿前抬、小腿折回（幅度刻意收敛——chibi 的腿几乎全被裙摆 */
  /* 盖住，转太大只会把裙摆扯出褶皱，收益却看不见）。其余由子姿态叠加 */
  sit() {
    return {
      Hips: [0, 0],
      Thigh_L: [-0.95, 0.06],
      Thigh_R: [-0.95, -0.06],
      Shin_L: [1.15, 0],
      Shin_R: [1.15, 0],
      Foot_L: [-0.2, 0],
      Foot_R: [-0.2, 0],
    };
  },

  /* 打字（坐姿叠加） */
  type(t) {
    const s = Math.sin(t * 11);
    return {
      Spine: [0.16, 0],
      Chest: [0.06, 0],
      Head: [0.2, 0],
      Hair: [0.05, 0],
      UpperArm_L: [-0.55, 0.12],
      UpperArm_R: [-0.55, -0.12],
      Forearm_L: [-1.15, 0.1],
      Forearm_R: [-1.15, -0.1],
      Hand_L: [s * 0.12, 0],
      Hand_R: [-s * 0.12, 0],
    };
  },

  /* 炒菜翻炒（站姿）：右手画圈，左手叉腰 */
  stir(t) {
    const a = t * 5;
    return {
      Spine: [0.06, 0.05],
      Chest: [0.04, 0.05],
      Head: [0.1, -0.05],
      UpperArm_L: [-0.5, 0.45],
      Forearm_L: [-1.7, 0.2],
      UpperArm_R: [-0.95 + Math.sin(a) * 0.12, -0.3],
      Forearm_R: [-0.8 + Math.cos(a) * 0.2, -0.25],
      Hand_R: [Math.sin(a + 1) * 0.3, 0],
    };
  },

  /* 倚窗眺望 */
  lean(t) {
    const b = Math.sin(t * 0.9);
    return {
      Spine: [-0.1, 0.03],
      Chest: [-0.06, 0.03],
      Head: [-0.18, b * 0.04],
      Hair: [0.08, b * 0.03],
      UpperArm_L: [-0.75, 0.3],
      UpperArm_R: [-0.75, -0.3],
      Forearm_L: [-0.9, 0.1],
      Forearm_R: [-0.9, -0.1],
    };
  },

  /* 盘算 / 思考：歪头 + 托腮 */
  planning(t) {
    const b = Math.sin(t * 1.1);
    return {
      Spine: [0.04, b * 0.03],
      Head: [0.06, 0.16],
      Hair: [0.03, -0.05],
      UpperArm_L: [-0.3, 0.12],
      Forearm_L: [-2.1, 0.25],
      UpperArm_R: [0.1, -0.1],
      Forearm_R: [-0.35, -0.1],
    };
  },

  thinking(t) {
    const p = POSES.planning(t);
    p.Head = [0.02, 0.22];
    return p;
  },

  /* 等待确认：双臂微张、身体微微前倾（小跳由 controller 的 yOff 给） */
  waiting_confirm(t) {
    const s = Math.sin(t * 3.2);
    return {
      Spine: [0.05, 0],
      Head: [-0.05, s * 0.05],
      UpperArm_L: [-0.35, 0.3 + s * 0.06],
      UpperArm_R: [-0.35, -0.3 - s * 0.06],
      Forearm_L: [-0.5, 0],
      Forearm_R: [-0.5, 0],
    };
  },

  /* 完成：双臂上举欢呼 */
  done(t) {
    const s = Math.sin(t * 8);
    return {
      Spine: [-0.06, 0],
      Head: [-0.12, 0],
      UpperArm_L: [-2.4, 0.45],
      UpperArm_R: [-2.4, -0.45],
      Forearm_L: [-0.3, 0],
      Forearm_R: [-0.3, 0],
      Hand_L: [s * 0.2, 0],
      Hand_R: [-s * 0.2, 0],
    };
  },

  /* 出错：垂头、双臂下垂 */
  error(t) {
    return {
      Spine: [0.14, 0],
      Chest: [0.1, 0],
      Head: [0.3, 0],
      Hair: [0.12, 0],
      UpperArm_L: [0.05, 0.02],
      UpperArm_R: [0.05, -0.02],
      Forearm_L: [-0.1, 0],
      Forearm_R: [-0.1, 0],
    };
  },

  /* 躺姿（整体 pitch 由 controller 给），四肢放松 */
  lie(t) {
    const b = Math.sin(t * 1.2);
    return {
      Spine: [0, 0],
      Head: [0.05, 0.1],
      Hair: [0.05, 0],
      UpperArm_L: [-0.25, 0.35],
      UpperArm_R: [-0.25, -0.35],
      Forearm_L: [-0.5 + b * 0.04, 0],
      Forearm_R: [-0.5 - b * 0.04, 0],
      Thigh_L: [-0.12, 0.05],
      Thigh_R: [-0.12, -0.05],
      Shin_L: [0.2, 0],
      Shin_R: [0.2, 0],
    };
  },
};

/* ------------------------------------------------------------------ */
/*  动画器                                                             */
/* ------------------------------------------------------------------ */

const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();
const _qC = new THREE.Quaternion();

export function createBoneAnimator(root, opts = {}) {
  const bones = {};
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (o.isBone && o.name) bones[o.name] = o;
  });

  const rest = new Map();       // bone → rest 局部四元数
  const parentWorld = new Map(); // bone → 父级 rest 世界四元数（用于世界轴换算）
  for (const name in bones) {
    const b = bones[name];
    rest.set(b, b.quaternion.clone());
    const p = b.parent;
    parentWorld.set(b, p ? p.getWorldQuaternion(new THREE.Quaternion()).clone() : new THREE.Quaternion());
  }

  const names = Object.keys(bones);
  const cur = {};   // 骨名 → [主角度, 次角度]（当前值，阻尼逼近目标）
  const tgt = {};
  for (const n of names) { cur[n] = [0, 0]; tgt[n] = [0, 0]; }

  const has = (n) => !!bones[n];
  let poseName = 'idle';
  const debug = { poseName: 'idle', boneCount: names.length };

  /* 状态 → 姿态（含坐姿叠加） */
  function resolvePose(ctx) {
    const st = ctx.state || 'idle';
    if (ctx.climbing) return 'climb';
    if (ctx.moving) return 'walk';
    if (ctx.pose) return ctx.pose; // 显式指定（坐姿等）
    switch (st) {
      case 'working': return 'type';
      case 'planning': return 'planning';
      case 'thinking': return 'thinking';
      case 'waiting_confirm': return 'waiting_confirm';
      case 'done': return 'done';
      case 'error': return 'error';
      default: return 'idle';
    }
  }

  function compose(bone, name, a, b) {
    bone.quaternion.copy(rest.get(bone));
    const ch = CHANNELS[name] || [AX, AZ];
    const pw = parentWorld.get(bone);
    if (Math.abs(a) > 1e-4) {
      _qA.copy(pw).invert()
        .multiply(_qB.setFromAxisAngle(ch[0], a))
        .multiply(_qC.copy(pw));
      bone.quaternion.premultiply(_qA);
    }
    if (Math.abs(b) > 1e-4) {
      _qA.copy(pw).invert()
        .multiply(_qB.setFromAxisAngle(ch[1], b))
        .multiply(_qC.copy(pw));
      bone.quaternion.premultiply(_qA);
    }
  }

  function tick(t, dt, ctx = {}) {
    if (!names.length) return;
    poseName = resolvePose(ctx);
    debug.poseName = poseName;
    const fn = POSES[poseName] || POSES.idle;
    const pose = fn(t, ctx) || {};

    // 坐姿基底（若调用方要求坐着，先铺 sit 再叠加当前姿态）
    const seated = !!ctx.seated;
    const k = 1 - Math.pow(0.0015, Math.min(dt, 0.1)); // 指数阻尼
    for (const n of names) {
      const p = pose[n];
      let a = p ? p[0] || 0 : 0;
      let b = p ? p[1] || 0 : 0;
      if (seated && !p) {
        const sp = POSES.sit()[n];
        if (sp) { a = sp[0] || 0; b = sp[1] || 0; }
      }
      tgt[n][0] = a;
      tgt[n][1] = b;
      cur[n][0] += (tgt[n][0] - cur[n][0]) * k;
      cur[n][1] += (tgt[n][1] - cur[n][1]) * k;
      compose(bones[n], n, cur[n][0], cur[n][1]);
    }
  }

  function reset() {
    for (const n of names) {
      cur[n][0] = 0; cur[n][1] = 0;
      bones[n].quaternion.copy(rest.get(bones[n]));
    }
  }

  /* 取某根骨的世界坐标（交互定位用，例如手到桌面的距离） */
  const _v = new THREE.Vector3();
  function boneWorld(name) {
    const b = bones[name];
    if (!b) return null;
    b.updateWorldMatrix(true, false);
    return _v.setFromMatrixPosition(b.matrixWorld).clone();
  }

  return { tick, reset, bones, boneWorld, has, debug, get poseName() { return poseName; } };
}
