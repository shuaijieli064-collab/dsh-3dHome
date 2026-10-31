import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/*  小拾混合动画系统（2026-10-31 新模型整体替换）                       */
/*                                                                     */
/*  新模型：Mixamo 骨架的贴图成品（src/scene/assets/xiaoshi_rigged.glb，*/
/*  5.4MB），自带 2.47s 烘焙走路循环 walk_relaxed（原地走，步幅实测      */
/*  0.34 模型单位 = 每周期 2 步）。动画分两层：                         */
/*                                                                     */
/*    · 烘焙层  走路时整身播放 walk_relaxed。clip 时间由控制器按实际    */
/*              行进距离推进的 gaitPhase 换算而来：gaitPhase 每 2π =    */
/*              一个跨步步幅（controller 用 0.374m = 0.34×1.1 归一化），*/
/*              恰好对应烘焙动画的一个完整周期 → 位移与脚步严格同步，   */
/*              不滑步。腿/裙摆的走路表现直接来自官方动画，解决旧版     */
/*              「程序摆腿牵扯裙子」的问题。                            */
/*                                                                     */
/*    · 程序化层  站立/打字/炒菜/倚窗/思考/坐/躺等 11 个姿态。沿用原    */
/*              「世界轴姿态权重叠加」框架：姿态表按新骨架骨骼名重写，  */
/*              新骨架肘/腕/踝/锁骨独立可动，动作比旧两段式整臂细腻。   */
/*                                                                     */
/*  两层按权重 slerp 混合：走路淡入淡出（≈0.5s 阻尼），切换不跳变。     */
/*  rest 姿态 = 烘焙 clip 第 0 帧（自然站姿），程序化姿态都叠加在它上面。*/
/* ------------------------------------------------------------------ */

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);

/* 每根骨的两个世界轴通道（角度 0 = 不动）。轴的选择沿用旧骨架的角色分类：*/
/* 躯干/颈头 = 前后俯仰(X)+侧倾(Z)；臂类 = 侧展(Z)+前后摆(X)；腿 = X+Z。  */
const CHANNELS = {
  Pelvis: [AX, AY],
  Spine1: [AX, AZ],
  Spine2: [AX, AZ],
  Spine3: [AX, AZ],
  Neck: [AX, AZ],
  Head: [AX, AZ],
  L_Collar: [AZ, AX],
  R_Collar: [AZ, AX],
  L_Shoulder: [AX, AZ],
  R_Shoulder: [AX, AZ],
  L_Elbow: [AX, AZ],
  R_Elbow: [AX, AZ],
  L_Wrist: [AX, AZ],
  R_Wrist: [AX, AZ],
  L_Hip: [AX, AZ],
  R_Hip: [AX, AZ],
  L_Knee: [AX, AZ],
  R_Knee: [AX, AZ],
  L_Ankle: [AX, AZ],
  R_Ankle: [AX, AZ],
  L_Foot: [AX, AZ],
  R_Foot: [AX, AZ],
};

/* 旧骨架 → 新骨架的角色映射注释（姿态表按此翻译）：                     */
/*   Hips→Pelvis  Spine→Spine1  Chest→Spine2  Hair→(无，去掉)           */
/*   Shoulder_L→L_Collar  UpperArm_L→L_Shoulder  Forearm_L→L_Elbow      */
/*   Hand_L→L_Wrist  Thigh_L→L_Hip  Shin_L→L_Knee  Foot_L→L_Foot        */

/* 实测步幅（模型单位/步，bind 空间）：tools/measure_walk_stride.mjs     */
const BAKED_STRIDE = 0.34;

/* 手臂骨集合：烘焙 walk_relaxed 的摆臂弱、3× 速率下观感差（2026-10-31
   用户反馈「手臂摆动不好」），所以手臂不交给烘焙轨道——走路时由程序化
   交互摆臂接管（与 gaitPhase 锁相，幅度可调），腿/躯干/头仍用烘焙。 */
const ARM_BONES = new Set([
  'L_Collar', 'R_Collar',
  'L_Shoulder', 'R_Shoulder',
  'L_Elbow', 'R_Elbow',
  'L_Wrist', 'R_Wrist',
]);

/* 走路摆臂表（t/gaitPhase → 各手臂骨 [X 前后摆, Z 侧展]）。符号约定：
   绕 X 负角 = 摆向前(+z)。腿相位 L_Hip=-sin(p)（s>0 左腿前摆），对侧臂
   与腿同向 → 左腿前时左臂应后摆（正角），右臂前摆（负角）。肘保持微弯，
   手臂后摆时肘更弯（自然摆臂形态）。 */
function armSwingPose(t, ctx) {
  const p = ctx && ctx.gaitPhase != null ? ctx.gaitPhase : t * 9;
  const s = Math.sin(p);
  const c = Math.cos(p);
  return {
    L_Collar: [0.05, 0],
    R_Collar: [-0.05, 0],
    L_Shoulder: [s * 0.42, 0.03],
    R_Shoulder: [-s * 0.42, -0.03],
    L_Elbow: [-0.24 - Math.max(0, s) * 0.2, 0],
    R_Elbow: [-0.24 - Math.max(0, -s) * 0.2, 0],
    L_Wrist: [c * 0.08, 0],
    R_Wrist: [-c * 0.08, 0],
  };
}

/* ------------------------------------------------------------------ */
/*  姿态表                                                             */
/*  rest = 烘焙 clip 第 0 帧的自然站姿（手臂已自然下垂），所以各姿态    */
/*  只需「相对站姿的增量」，幅度普遍比旧表小一档。符号约定不变：        */
/*    绕 X 负角 = 摆向前(+z)；绕 Z 正角 = 摆向 +x(左侧)；绕 Y = 扭转。  */
/*    左侧骨用正角，右侧骨镜像用负角。                                  */
/* ------------------------------------------------------------------ */

const POSES = {
  /* 站立待机：呼吸（脊柱三级波浪）+ 整头微点头/歪头 */
  idle(t) {
    const b = Math.sin(t * 1.6);
    return {
      Spine1: [b * 0.012, Math.sin(t * 0.55) * 0.015],
      Spine2: [b * 0.01, 0],
      Spine3: [b * 0.008, 0],
      Neck: [Math.sin(t * 0.8) * 0.03, Math.sin(t * 0.5) * 0.04],
      Head: [Math.sin(t * 0.8 + 0.4) * 0.035, Math.sin(t * 0.5) * 0.05],
    };
  },

  /* 走路兜底：仅当烘焙 clip 缺失时可见（有 clip 时被烘焙层完全覆盖，
     但仍保留——无 clip 的退化版也能演）。幅度照旧版。 */
  walk(t, ctx) {
    const p = ctx && ctx.gaitPhase != null ? ctx.gaitPhase : t * 9;
    const s = Math.sin(p);
    const c = Math.cos(p);
    return {
      L_Hip: [-s * 0.5, 0],
      R_Hip: [s * 0.5, 0],
      L_Knee: [Math.max(0, s) * 0.55, 0],
      R_Knee: [Math.max(0, -s) * 0.55, 0],
      L_Foot: [c * 0.12, 0],
      R_Foot: [-c * 0.12, 0],
    };
  },

  /* 爬梯：只演腿（上半身交由控制器 pitch），步距更短。烘焙走路不适用
     于爬梯（竖直攀爬），所以爬梯时烘焙权重归零、这里接管。 */
  climb(t, ctx) {
    const p = ctx && ctx.gaitPhase != null ? ctx.gaitPhase : t * 6;
    const s = Math.sin(p);
    return {
      L_Hip: [-s * 0.6, 0],
      R_Hip: [s * 0.6, 0],
      L_Knee: [Math.max(0, s) * 0.7, 0],
      R_Knee: [Math.max(0, -s) * 0.7, 0],
    };
  },

  /* 坐姿：大腿前抬、小腿折回（幅度沿用旧表——裙摆盖腿，转大只会扯裙）*/
  sit() {
    return {
      Pelvis: [0, 0],
      L_Hip: [-0.95, 0.06],
      R_Hip: [-0.95, -0.06],
      L_Knee: [1.15, 0],
      R_Knee: [1.15, 0],
      L_Foot: [-0.2, 0],
      R_Foot: [-0.2, 0],
    };
  },

  /* 打字（站姿）：身体前倾 0.14 + 低头 0.11 盯屏幕。新骨架福利：     */
  /* 锁骨耸肩 + 肘弯 0.5 抬臂悬在「桌面上」，双腕交替轻敲（旧版只有    */
  /* 整臂通道，打字只能靠整只手画弧；现在有腕关节 = 真正的手指敲击感）。*/
  type(t) {
    const s = Math.sin(t * 11);
    return {
      Spine1: [0.14 + s * 0.008, 0],
      Spine2: [0.06, 0],
      Spine3: [0.03, 0],
      Neck: [0.07, 0],
      Head: [0.11, 0],
      L_Collar: [0.12, 0],
      R_Collar: [-0.12, 0],
      L_Shoulder: [0.1, 0],
      R_Shoulder: [0.1, 0],
      L_Elbow: [-0.5 + s * 0.05, 0.04],
      R_Elbow: [-0.5 - s * 0.05, -0.04],
      L_Wrist: [s * 0.28, 0],
      R_Wrist: [-s * 0.28, 0],
    };
  },

  /* 炒菜翻炒：头歪向锅。左手端锅（肘弯托底），右腕大圈颠锅 */
  stir(t) {
    const a = t * 5;
    const s = Math.sin(a);
    const c = Math.cos(a);
    return {
      Spine1: [0.08, 0.06],
      Spine2: [0.05, 0.05],
      Spine3: [0.02, 0.02],
      Neck: [0.08, -0.04],
      Head: [0.12, -0.06],
      L_Collar: [0.18, 0],
      L_Shoulder: [-0.28, 0],
      L_Elbow: [-0.55, 0.06],
      L_Wrist: [0, 0.12],
      R_Collar: [-0.15, 0],
      R_Shoulder: [-0.18 + s * 0.06, 0],
      R_Elbow: [-0.42 + c * 0.1, -0.05],
      R_Wrist: [Math.sin(a + 1) * 0.4, -0.08],
    };
  },

  /* 倚窗眺望：躯干后仰 + 头后仰（颈后「上扬」是眺望的可读信号）*/
  lean(t) {
    const b = Math.sin(t * 0.9);
    return {
      Spine1: [-0.14, 0.04],
      Spine2: [-0.08, 0.03],
      Spine3: [-0.04, 0.02],
      Neck: [-0.1, b * 0.03],
      Head: [-0.16, b * 0.05],
      L_Collar: [0.1, 0],
      R_Collar: [-0.1, 0],
      L_Elbow: [-0.18 + b * 0.02, 0.02],
      R_Elbow: [-0.18 - b * 0.02, -0.02],
    };
  },

  /* 盘算：头歪左 0.24（歪头=思考的通用语言），左手指尖轻捻 */
  planning(t) {
    const b = Math.sin(t * 1.1);
    return {
      Spine1: [0.05, b * 0.04],
      Spine2: [0.03, 0],
      Neck: [0.03, 0.1],
      Head: [0.05, 0.24],
      L_Collar: [0.12, -0.04],
      L_Shoulder: [-0.1, 0],
      L_Elbow: [-0.4 + b * 0.05, 0.05],
      L_Wrist: [Math.max(0, Math.sin(t * 4)) * 0.2, 0.08],
      R_Collar: [0, 0],
      R_Shoulder: [0.02, 0],
      R_Elbow: [-0.08, -0.03],
    };
  },

  /* 思考 = 盘算镜像（头歪右 0.28） */
  thinking(t) {
    const b = Math.sin(t * 1.1);
    return {
      Spine1: [0.05, -b * 0.03],
      Spine2: [0.03, 0],
      Neck: [0.03, -0.1],
      Head: [0.03, -0.28],
      R_Collar: [0.12, 0.04],
      R_Shoulder: [-0.1, 0],
      R_Elbow: [-0.4 + b * 0.05, -0.05],
      R_Wrist: [Math.max(0, Math.sin(t * 4)) * 0.2, -0.08],
      L_Collar: [0, 0],
      L_Shoulder: [0.02, 0],
      L_Elbow: [-0.08, 0.03],
    };
  },

  /* 等待确认：身体轻晃 + 头小幅摆动，锁骨轻微起伏（呼吸加重）*/
  waiting_confirm(t) {
    const s = Math.sin(t * 3.2);
    return {
      Spine1: [0.06, s * 0.03],
      Spine2: [0.03, 0],
      Neck: [-0.05, s * 0.03],
      Head: [-0.06, s * 0.04],
      L_Collar: [0.08 + 0.03 * s, 0],
      R_Collar: [-0.08 - 0.03 * s, 0],
      L_Elbow: [-0.12, 0.02],
      R_Elbow: [-0.12, -0.02],
    };
  },

  /* 完成：整个上半身后仰舒气，头后仰，锁骨小幅弹跳，双腕轻甩 */
  done(t) {
    const s6 = Math.sin(t * 6);
    const s8 = Math.sin(t * 8);
    return {
      Spine1: [-0.24 + 0.04 * s6, 0],
      Spine2: [-0.1, 0],
      Spine3: [-0.04, 0],
      Neck: [-0.1, 0],
      Head: [-0.18, 0],
      L_Collar: [0.16 + 0.04 * s8, 0],
      R_Collar: [-0.16 - 0.04 * s8, 0],
      L_Shoulder: [-0.08 + 0.05 * s6, 0],
      R_Shoulder: [-0.08 + 0.05 * s6, 0],
      L_Elbow: [-0.2, 0.03],
      R_Elbow: [-0.2, -0.03],
      L_Wrist: [0.14 * s8, 0],
      R_Wrist: [0.14 * s8, 0],
    };
  },

  /* 出错：躯干前倾 0.2 + 深低头 0.38——身体整体「垮」下去 */
  error(t) {
    return {
      Spine1: [0.16, 0],
      Spine2: [0.1, 0],
      Spine3: [0.05, 0],
      Neck: [0.12, 0],
      Head: [0.3, 0],
      L_Collar: [-0.05, -0.04],
      R_Collar: [-0.05, 0.04],
      L_Elbow: [-0.1, 0],
      R_Elbow: [-0.1, 0],
    };
  },

  /* 躺姿（demo 专用）：root 给真·仰卧（绕脚底转 -90°），四肢放松 */
  lie(t) {
    const b = Math.sin(t * 1.2);
    return {
      root: { pitch: -Math.PI / 2, y: 0.42 },
      Spine1: [0, 0],
      Neck: [0.02, 0],
      Head: [0.02, 0],
      L_Collar: [0.14, 0],
      R_Collar: [-0.14, 0],
      L_Shoulder: [-0.1, 0],
      R_Shoulder: [-0.1, 0],
      L_Elbow: [-0.3 + b * 0.02, 0],
      R_Elbow: [-0.3 - b * 0.02, 0],
      L_Hip: [-0.08, 0.04],
      R_Hip: [-0.08, -0.04],
      L_Knee: [0.12, 0],
      R_Knee: [0.12, 0],
      L_Foot: [-0.15, 0],
      R_Foot: [-0.15, 0],
    };
  },
};

/* ------------------------------------------------------------------ */
/*  动画器                                                             */
/*  姿态权重交叉淡入（沿用旧框架）：每个姿态独立权重 w∈[0,1]，指数阻尼  */
/*  逼近目标，切换任何↔任何都不跳变。烘焙层在此之上按 treated 权重与   */
/*  程序化结果 slerp。                                                 */
/* ------------------------------------------------------------------ */

const SMOOTH_BASE = 0.004; // 权重阻尼时基：settle ≈ -3/ln(base) ≈ 0.6s
const _X_AXIS = new THREE.Vector3(1, 0, 0); // root pitch 旋转轴（世界 X）
const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();
const _qC = new THREE.Quaternion();
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _sV = new THREE.Vector3();

/* clip 采样：LINEAR 插值（解析器已剔除其他插值方式） */
function sampleQuatAt(track, t, out) {
  const { times, values } = track;
  const last = times.length - 1;
  if (t <= times[0]) return out.set(values[0], values[1], values[2], values[3]);
  if (t >= times[last]) {
    const o = last * 4;
    return out.set(values[o], values[o + 1], values[o + 2], values[o + 3]);
  }
  let i = last;
  for (let k = 1; k < times.length; k++) if (times[k] > t) { i = k - 1; break; }
  const a = (t - times[i]) / (times[i + 1] - times[i]);
  const o1 = i * 4, o2 = o1 + 4;
  _qA.set(values[o1], values[o1 + 1], values[o1 + 2], values[o1 + 3]);
  _qB.set(values[o2], values[o2 + 1], values[o2 + 2], values[o2 + 3]);
  return out.copy(_qA).slerp(_qB, a);
}

function sampleVecAt(track, t, out) {
  const { times, values, size } = track;
  const n = size === 3 ? 3 : 4;
  const last = times.length - 1;
  if (t <= times[0]) return out.fromArray(values, 0);
  if (t >= times[last]) return out.fromArray(values, last * n);
  let i = last;
  for (let k = 1; k < times.length; k++) if (times[k] > t) { i = k - 1; break; }
  const a = (t - times[i]) / (times[i + 1] - times[i]);
  _sV.fromArray(values, i * n);
  const nxt = new THREE.Vector3().fromArray(values, (i + 1) * n);
  return out.copy(_sV).lerp(nxt, a);
}

export function createBoneAnimator(root, opts = {}) {
  const bones = {};
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (o.isBone && o.name) bones[o.name] = o;
  });

  /* ---------- 烘焙 clip 就绪 ---------- */
  const clips = opts.clips || [];
  const bakedClip =
    clips.find((c) => c.name === 'walk_relaxed') || clips[0] || null;

  /* rest 姿态：优先烘焙 clip 第 0 帧（自然站姿），没有 clip 才用 bind */
  const rest = new Map();          // bone → rest 局部四元数
  const restPos = new Map();       // bone → rest 局部平移（Pelvis 用）
  const parentWorld = new Map();   // bone → 父级 rest 世界四元数
  const bakedTracks = new Map();   // bone → { rotation?, translation? }

  // 先把第一帧姿态写到骨骼（让 rest 与首帧一致），再捕获 rest/父级世界旋转
  for (const name in bones) {
    const b = bones[name];
    const tr = bakedClip && bakedClip.tracks[name];
    if (tr) {
      if (tr.rotation) sampleQuatAt(tr.rotation, 0, b.quaternion);
      if (tr.translation) sampleVecAt(tr.translation, 0, b.position);
      bakedTracks.set(b, tr);
    }
  }
  root.updateMatrixWorld(true);
  for (const name in bones) {
    const b = bones[name];
    rest.set(b, b.quaternion.clone());
    restPos.set(b, b.position.clone());
    const p = b.parent;
    parentWorld.set(
      b,
      p ? p.getWorldQuaternion(new THREE.Quaternion()).clone() : new THREE.Quaternion()
    );
  }

  const names = Object.keys(bones);
  const weights = {};
  const POSE_NAMES = Object.keys(POSES);
  for (const pn of POSE_NAMES) weights[pn] = 0;
  weights.idle = 1;

  let bakedW = 0; // 烘焙走路权重
  let armW = 0; // 走路程序化摆臂权重（手臂骨不吃烘焙轨道）
  let poseName = 'idle';
  let _basePos = null;
  let _baseQuat = null;
  const debug = {
    poseName: 'idle',
    boneCount: names.length,
    bakedClip: bakedClip ? bakedClip.name : null,
    bakedW: 0,
    armW: 0,
    rootPose: { pitch: 0, y: 0 },
  };

  /* 面向外面的步幅标定（世界单位）。characterModel 会挂到 userData 上，
     controller 用来替代写死的 0.5m 步长。 */
  const worldScale = root.getWorldScale(_vA.set(0, 0, 0).setScalar(1)).y || root.getWorldScale(new THREE.Vector3()).y;
  const metrics = {
    stride: BAKED_STRIDE * worldScale,      // 一步的世界长度
    cycleDuration: bakedClip ? bakedClip.duration : 0,
  };

  function resolvePose(ctx) {
    const st = ctx.state || 'idle';
    if (ctx.climbing) return 'climb';
    if (ctx.moving) return bakedClip ? 'idle' /* 程序化层让位给烘焙层 */ : 'walk';
    if (ctx.pose) return ctx.pose;
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
    const main = resolvePose(ctx);
    debug.poseName = main;
    poseName = main;

    /* ---- 程序化姿态权重 ---- */
    const targets = { [main]: 1 };
    if (ctx.seated) targets.sit = 1;
    const wk = 1 - Math.pow(SMOOTH_BASE, Math.min(dt, 0.1));
    for (const pn of POSE_NAMES) {
      const tv = targets[pn] ? 1 : 0;
      let w = weights[pn] + (tv - weights[pn]) * wk;
      if (w < 1e-4) w = 0;
      weights[pn] = w;
    }
    const active = [];
    for (const pn of POSE_NAMES) {
      if (weights[pn] > 1e-3) active.push([weights[pn], POSES[pn](t, ctx)]);
    }

    /* ---- 烘焙层权重：走路(非爬梯)且 clip 存在时 → 1 ---- */
    const bakedTarget = ctx.moving && !ctx.climbing && bakedClip ? 1 : 0;
    bakedW += (bakedTarget - bakedW) * wk;
    if (bakedW < 1e-4) bakedW = 0;
    debug.bakedW = bakedW;

    /* ---- 摆臂权重：走路(非爬梯) → 1，同款阻尼（起步/停步手臂不跳变）---- */
    const armTarget = ctx.moving && !ctx.climbing ? 1 : 0;
    armW += (armTarget - armW) * wk;
    if (armW < 1e-4) armW = 0;
    debug.armW = armW;

    /* clip 时间：优先 gaitPhase（距离驱动，脚不滑步）；无则 t 自然速率 */
    let clipT = 0;
    if (bakedClip) {
      const d = bakedClip.duration;
      if (ctx.gaitPhase != null && ctx.moving) {
        clipT = ((ctx.gaitPhase % (Math.PI * 2)) / (Math.PI * 2)) * d;
      } else {
        clipT = t % d;
      }
    }

    /* ---- 每根骨：程序化姿态 → rest 叠加，再与烘焙采样 slerp ---- */
    const swing = armW > 1e-3 ? armSwingPose(t, ctx) : null;
    debug.armSwing = swing
      ? { p: +(ctx.gaitPhase ?? t * 9).toFixed(2), shL: +swing.L_Shoulder[0].toFixed(3), shR: +swing.R_Shoulder[0].toFixed(3) }
      : null;
    for (const n of names) {
      const bone = bones[n];
      let a = 0, b2 = 0;
      for (const [w, pose] of active) {
        const pv = pose[n];
        if (pv) { a += w * (pv[0] || 0); b2 += w * (pv[1] || 0); }
      }
      /* 摆臂增量叠加：走路时手臂由程序化接管（与步态锁相、双臂交互） */
      if (swing) {
        const sv = swing[n];
        if (sv) { a += armW * (sv[0] || 0); b2 += armW * (sv[1] || 0); }
      }
      compose(bone, n, a, b2);
      const tr = bakedTracks.get(bone);
      /* 手臂骨不吃烘焙轨道（摆臂已在上面接管，且 clip 摆臂弱、快放观感差） */
      if (tr && tr.rotation && bakedW > 1e-4 && !ARM_BONES.has(n)) {
        sampleQuatAt(tr.rotation, clipT, _qB);
        bone.quaternion.slerp(_qB, bakedW);
      }
    }

    /* Pelvis 平移（髋部起伏）：与旋转同样按 bakedW 混合 */
    for (const n of names) {
      const bone = bones[n];
      const tr = bakedTracks.get(bone);
      if (tr && tr.translation && bakedW > 1e-4) {
        const rp = restPos.get(bone);
        sampleVecAt(tr.translation, clipT, _vB);
        bone.position.set(
          rp.x + (_vB.x - rp.x) * bakedW,
          rp.y + (_vB.y - rp.y) * bakedW,
          rp.z + (_vB.z - rp.z) * bakedW
        );
      }
    }

    /* ---- root pitch/y（lie 仰卧等姿态自带的整体翻转）---- */
    let rp = 0, ry = 0;
    for (const [w, pose] of active) {
      if (pose.root) {
        rp += w * (pose.root.pitch || 0);
        ry += w * (pose.root.y || 0);
      }
    }
    if (!_basePos) {
      _basePos = root.position.clone();
      _baseQuat = root.quaternion.clone();
    }
    root.quaternion.copy(_baseQuat).multiply(_qB.setFromAxisAngle(_X_AXIS, rp));
    root.position.set(_basePos.x, _basePos.y + ry, _basePos.z);
    debug.rootPose = { pitch: rp, y: ry };
  }

  function reset() {
    for (const pn of POSE_NAMES) weights[pn] = (pn === 'idle') ? 1 : 0;
    bakedW = 0;
    armW = 0;
    for (const n of names) {
      const bone = bones[n];
      bone.quaternion.copy(rest.get(bone));
      bone.position.copy(restPos.get(bone));
    }
    if (_basePos) {
      root.position.copy(_basePos);
      root.quaternion.copy(_baseQuat);
    }
    debug.rootPose = { pitch: 0, y: 0 };
  }

  /* 取某根骨的世界坐标（交互定位用） */
  function boneWorld(name) {
    const b = bones[name];
    if (!b) return null;
    b.updateWorldMatrix(true, false);
    return new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
  }

  return {
    tick, reset, bones, boneWorld, metrics, debug,
    has: (n) => !!bones[n],
    get poseName() { return poseName; },
  };
}
