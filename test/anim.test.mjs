/**
 * 小拾混合动画系统数值断言：零依赖，`node test/anim.test.mjs`。
 *
 * 2026-10-31 整体替换：新小拾 = Mixamo 骨架贴图成品 GLB
 * （src/scene/assets/xiaoshi_rigged.glb，自带 2.467s 烘焙走路循环
 * walk_relaxed，原地走，每周期 2 步，步幅实测 0.34 模型单位）。
 * 动画分两层：
 *   · 烘焙层  走路时整身播放 walk_relaxed，clip 时间由 ctx.gaitPhase
 *             （距离驱动）换算：gaitPhase 每 2π = 一个跨步步幅 = 一个
 *             clip 周期 → 位移与脚步严格锁死，不滑步。
 *   · 程序化层  站立/打字/炒菜/倚窗/思考/坐/躺等姿态按新骨架（肘/腕/
 *              踝独立关节）重写，rest = 烘焙 clip 第 0 帧（自然站姿）。
 *
 * 断言（骨架直接从真实 GLB 解析构建，不是硬编码副本）：
 *   1. 烘焙层真的在动：walk 一个周期内脚踝摆幅 ≥ 0.1（clip 没静死）
 *   2. 步态锁相：gaitPhase 不动时腿随时间不动；相位变腿型变（距离驱动）
 *   3. 周期闭合：gaitPhase=0 与 2π 的姿态一致（clip 循环无缝）
 *   4. rest = clip 第 0 帧：加载即站姿，不是 T-pose 云手
 *   5. 全姿态采样无 NaN（姿态表对新骨架的键全部有效）
 *   6. lie 的整身翻转（root pitch -90° + 抬高 0.42）确实应用到根节点
 *   7. 走路摆臂：双臂反相交互摆动、双手前后行程可见（手臂骨剥离烘焙层、
 *      程序化摆臂接管——2026-10-31 用户反馈的回归锁定）
 *
 * 载入方式：characterAnim.js `import 'three'` 是裸名（浏览器侧由
 * importmap/vendor 解析）。测试里读源码把该行替换成 vendor three 的
 * 绝对 file URL，再以 dataURL 模块动态导入 —— 保证测的是生产代码本身。
 */
import fs from 'node:fs';

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error(`  FAIL  ${msg}`);
  }
};

/* ---------------- 载入生产代码（three 裸名 → vendor file URL） ---------------- */

const VENDOR = new URL('../vendor/three/three.module.js', import.meta.url).href;
const src = fs.readFileSync(new URL('../src/scene/characterAnim.js', import.meta.url), 'utf8');
const patched = src.replace(`import * as THREE from 'three';`, `import * as THREE from ${JSON.stringify(VENDOR)};`);
if (patched === src) {
  console.error('characterAnim.js 的 three import 行没匹配到，检查 import 语句写法');
  process.exit(1);
}
const { createBoneAnimator } = await import('data:text/javascript;base64,' + Buffer.from(patched).toString('base64'));

const THREE = await import(VENDOR);

/* ---------------- 从真实 GLB 构建骨架 + 动画 clip ---------------- */

const GLB_PATH = new URL('../src/scene/assets/xiaoshi_rigged.glb', import.meta.url);
const glbBuf = fs.readFileSync(GLB_PATH);
const jsonLen = glbBuf.readUInt32LE(12);
const gltf = JSON.parse(glbBuf.slice(20, 20 + jsonLen).toString('utf8'));

const joints = gltf.skins[0].joints;
const skinRoots = joints.filter((j) => {
  const def = gltf.nodes[j];
  return !(def.children || []).some((c) => joints.includes(c));
});

const armature = new THREE.Group();
armature.name = 'XiaoshiRig';
const boneByIndex = new Map();
for (const j of joints) {
  const def = gltf.nodes[j];
  const b = new THREE.Bone();
  b.name = def.name || `joint${j}`;
  if (def.translation) b.position.fromArray(def.translation);
  if (def.rotation) b.quaternion.fromArray(def.rotation);
  if (def.scale) b.scale.fromArray(def.scale);
  boneByIndex.set(j, b);
}
for (const j of joints) {
  const def = gltf.nodes[j];
  const b = boneByIndex.get(j);
  const parentJoint = joints.find((k) => (gltf.nodes[k].children || []).includes(j));
  if (parentJoint != null) boneByIndex.get(parentJoint).add(b);
  else armature.add(b);
}
armature.updateMatrixWorld(true);
const scene = new THREE.Scene();
scene.add(armature);

/* clip：与 glbLoader.buildAnimations 相同的结构（rotation/translation 轨道，
   LINEAR 采样）。测试自带一个最小实现，保证转动/平移数组可直接复用生产
   采样函数的输入格式。 */
function buildClips() {
  const clips = [];
  for (const adef of gltf.animations || []) {
    const tracks = {};
    let duration = 0;
    for (const ch of adef.channels || []) {
      const tdef = gltf.nodes[ch.target && ch.target.node];
      if (!tdef || !tdef.name) continue;
      if (ch.target.path !== 'rotation' && ch.target.path !== 'translation') continue;
      const smp = adef.samplers[ch.sampler];
      if (!smp || (smp.interpolation && smp.interpolation !== 'LINEAR')) continue;
      const tA = gltf.accessors[smp.input];
      const vA = gltf.accessors[smp.output];
      const bvT = gltf.bufferViews[tA.bufferView];
      const bvV = gltf.bufferViews[vA.bufferView];
      const BINO = 20 + jsonLen + 8;
      const times = new Float32Array(glbBuf.buffer.slice(
        BINO + (bvT.byteOffset || 0) + (tA.byteOffset || 0),
        BINO + (bvT.byteOffset || 0) + (tA.byteOffset || 0) + tA.count * 4));
      const values = new Float32Array(glbBuf.buffer.slice(
        BINO + (bvV.byteOffset || 0) + (vA.byteOffset || 0),
        BINO + (bvV.byteOffset || 0) + (vA.byteOffset || 0) + vA.count * (vA.type === 'SCALAR' ? 1 : vA.type === 'VEC3' ? 3 : 4) * 4));
      tracks[tdef.name] = tracks[tdef.name] || {};
      tracks[tdef.name][ch.target.path] = { times, values, size: vA.type === 'SCALAR' ? 1 : vA.type === 'VEC3' ? 3 : 4 };
      duration = Math.max(duration, times[times.length - 1] || 0);
    }
    if (duration > 0) clips.push({ name: adef.name || 'clip', duration, tracks });
  }
  return clips;
}
const clips = buildClips();
const bakedClip = clips.find((c) => c.name === 'walk_relaxed') || clips[0];
ok(!!bakedClip, 'GLB 里没解析出动画 clip（walk_relaxed 缺失）');
ok(!!bakedClip && bakedClip.duration > 2.0 && bakedClip.duration < 3.0,
  `walk_relaxed 时长 ${bakedClip && bakedClip.duration} 不在 2~3s（模型换过？）`);

const animator = createBoneAnimator(armature, { clips });
if (!animator.debug.boneCount) {
  console.error('动画器没找到骨骼，骨架重建失败');
  process.exit(1);
}
ok(animator.debug.boneCount >= 22, `骨骼数 ${animator.debug.boneCount} < 22（Mixamo 骨架应 22 根）`);
ok(animator.debug.bakedClip === 'walk_relaxed', `烘焙 clip 名 ${animator.debug.bakedClip} ≠ walk_relaxed`);

/* ---------------- 测量工具 ---------------- */

const ANKLE_OFF = new THREE.Vector3(0, 0.03, 0);
function worldPoint(boneName, localOff) {
  const b = animator.bones[boneName];
  if (!b) return null;
  b.updateWorldMatrix(true, false);
  return b.localToWorld(localOff.clone());
}
const ankleL = () => worldPoint('L_Ankle', ANKLE_OFF);
const ankleR = () => worldPoint('R_Ankle', ANKLE_OFF);

/** 让姿态权重收敛（settle≈0.6s），返回 {L,R} 踝位置 */
function settlePose(t0, ctx) {
  for (let i = 0; i <= 144; i++) animator.tick(t0 + i / 60, 1 / 60, ctx);
  return { L: ankleL(), R: ankleR() };
}

/* ---------------- 1+3. 烘焙层：摆幅与步态锁相 ---------------- */

const CLIP = bakedClip.duration;
const CYC = Math.PI * 2; // gaitPhase 一个周期 = clip 一个周期
{
  // 走一个完整周期，脚踝在 z（前后）上的行程必须明显
  settlePose(0, { moving: true, gaitPhase: 0 });
  let zmin = Infinity, zmax = -Infinity;
  let t = 0;
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const phase = (i / steps) * CYC;
    t += 1 / 60;
    animator.tick(t, 1 / 60, { moving: true, gaitPhase: phase });
    const a = ankleL();
    zmin = Math.min(zmin, a.z); zmax = Math.max(zmax, a.z);
  }
  const swing = zmax - zmin;
  ok(swing > 0.1, `walk 脚踝摆幅 ${swing.toFixed(3)} < 0.1（烘焙层没在动？）`);
  console.log(`  walk 脚踝摆幅 z=${swing.toFixed(3)}（烘焙层生效）`);
}

{
  // 步态锁相：gaitPhase 不变时，时间流逝不得移动腿；相位变化必须改变腿型
  settlePose(0, { moving: true, gaitPhase: 0 });
  animator.tick(5.0, 1 / 60, { moving: true, gaitPhase: 0 });
  const a = ankleL().clone();
  animator.tick(9.0, 1 / 60, { moving: true, gaitPhase: 0 }); // 4s 过去，相位没动
  const b = ankleL();
  ok(a.distanceTo(b) < 0.01, `walk 腿随全局 t 移动 ${a.distanceTo(b).toFixed(3)}（clip 时间必须只跟 gaitPhase 走）`);
  animator.tick(9.0, 1 / 60, { moving: true, gaitPhase: CYC / 4 });
  const c = ankleL();
  ok(c.distanceTo(b) > 0.02, 'walk gaitPhase 变了腿型没变（步态锁相失效）');
  console.log('  walk 步态锁相（距离驱动）通过');
}

{
  // 周期闭合：gaitPhase=2π 的姿态应回到 0 的位置（clip 循环无缝）
  animator.tick(1.0, 1 / 60, { moving: true, gaitPhase: 0 });
  const a = ankleL().clone();
  animator.tick(1.0 + CYC / CYC, 1 / 60, { moving: true, gaitPhase: CYC });
  const b = ankleL();
  ok(a.distanceTo(b) < 0.02, `walk 周期闭合偏差 ${a.distanceTo(b).toFixed(3)}（clip 起止点姿态不一致）`);
  console.log('  walk 周期闭合（gaitPhase 0 ≡ 2π）通过');
}

/* ---------------- 4. rest = clip 第 0 帧（加载即站姿） ---------------- */

{
  animator.reset();
  armature.updateMatrixWorld(true);
  const stance = ankleL().clone();
  // bind（T-pose）的踝位置与 clip 第 0 帧应有差异（否则 rest 没接管）
  const hips = animator.bones.Pelvis;
  const pelvisOff = hips.position.clone();
  ok(hipSnap(bakedClip, 0).distanceTo(pelvisOff) < 1e-3,
    'Pelvis rest 平移 ≠ clip 第 0 帧（rest 没有从站姿接管）');
  ok(Math.abs(stance.z) + Math.abs(stance.x) < 0.6,
    `rest 站姿踝位置 (${stance.x.toFixed(2)},${stance.z.toFixed(2)}) 离正下太远（像云手不像站姿）`);
  console.log(`  rest=clip[0]（站姿接管）通过  踝=(${stance.x.toFixed(3)},${stance.y.toFixed(3)},${stance.z.toFixed(3)})`);
}
function hipSnap(clip, t) {
  const tr = clip.tracks.Pelvis && clip.tracks.Pelvis.translation;
  if (!tr) return new THREE.Vector3();
  const i = tr.times.findIndex((v) => v >= t);
  const o = Math.max(0, i) * tr.size;
  return new THREE.Vector3().fromArray(tr.values, o);
}

/* ---------------- 5. 全姿态采样无 NaN ---------------- */

const POSES = [
  ['idle', {}],
  ['type', { state: 'working' }],
  ['stir', { state: 'working', pose: 'stir' }],
  ['lean', { pose: 'lean' }],
  ['planning', { state: 'planning' }],
  ['thinking', { state: 'thinking' }],
  ['waiting_confirm', { state: 'waiting_confirm' }],
  ['done', { state: 'done' }],
  ['error', { state: 'error' }],
  ['climb', { moving: true, climbing: true, gaitPhase: 1.2 }],
];
console.log('程序化姿态 NaN 巡检');
for (const [name, ctx] of POSES) {
  settlePose(0.7, ctx);
  let nan = false;
  for (const key in animator.bones) {
    const q = animator.bones[key].quaternion;
    if (![q.x, q.y, q.z, q.w].every(Number.isFinite)) nan = true;
    const p = animator.bones[key].position;
    if (![p.x, p.y, p.z].every(Number.isFinite)) nan = true;
  }
  ok(!nan, `${name}: 骨骼变换出现 NaN（姿态表键错位或采样越界）`);
  ok(animator.poseName === name, `${name}: 解析出的主姿态是 ${animator.poseName}？`);
}
console.log(`  ${POSES.length} 个姿态全部有限且被正确解析`);

/* ---------------- 6. lie：整身翻转应用到根节点 ---------------- */

{
  settlePose(0.5, { pose: 'lie' });
  const e = new THREE.Euler().setFromQuaternion(armature.quaternion, 'XYZ');
  const rotX = e.x;
  ok(Math.abs(rotX + Math.PI / 2) < 0.02,
    `lie 的 root pitch=${rotX.toFixed(3)} ≠ -π/2（翻转没应用或分量混入 Y/Z）`);
  ok(Math.abs(armature.position.y - 0.42) < 0.02,
    `lie 的 root 抬高 y=${armature.position.y.toFixed(3)} ≠ 0.42（身体陷进地板）`);
  console.log(`  lie  rootPitch=${rotX.toFixed(3)}  rootY=${armature.position.y.toFixed(3)}`);
}

/* ---------------- 7. 走路摆臂：双臂交互（反相）且行程可见 ---------------- */

{
  // 预热：armW/姿态权重收敛到 1（settle ≈0.6s），然后采一个完整步态周期。
  // 量「手 − 肩」的前后(z)偏移：肩随躯干起伏，相减抵掉呼吸/髋部平移的共模。
  settlePose(0, { moving: true, gaitPhase: 0 });
  const ORIGIN = new THREE.Vector3();
  const steps = 64;
  const zL = [];
  const zR = [];
  let t = 10;
  for (let i = 0; i < steps; i++) {
    t += 1 / 60;
    animator.tick(t, 1 / 60, { moving: true, gaitPhase: (i / steps) * CYC });
    const off = (sh, wr) => worldPoint(wr, ORIGIN).z - worldPoint(sh, ORIGIN).z;
    zL.push(off('L_Shoulder', 'L_Wrist'));
    zR.push(off('R_Shoulder', 'R_Wrist'));
  }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const mL = mean(zL);
  const mR = mean(zR);
  let cov = 0;
  let varL = 0;
  let varR = 0;
  for (let i = 0; i < steps; i++) {
    const dl = zL[i] - mL;
    const dr = zR[i] - mR;
    cov += dl * dr;
    varL += dl * dl;
    varR += dr * dr;
  }
  cov /= steps;
  varL /= steps;
  varR /= steps;
  const p2pL = Math.max(...zL) - Math.min(...zL);
  const p2pR = Math.max(...zR) - Math.min(...zR);
  ok(varL > 1e-6 && varR > 1e-6, `摆臂方差为 0（varL=${varL.toExponential(2)} varR=${varR.toExponential(2)}，手臂没在动）`);
  ok(cov < 0, `双臂前后摆协方差 ${cov.toExponential(2)} ≥ 0（左右同相，不是交互摆臂）`);
  ok(p2pL > 0.02 && p2pR > 0.02, `摆臂峰峰值不足 L=${p2pL.toFixed(3)} R=${p2pR.toFixed(3)}（< 0.02 看不出来）`);
  console.log(`  摆臂  cov=${cov.toExponential(2)}  峰峰值 L=${p2pL.toFixed(3)} R=${p2pR.toFixed(3)}`);
}

/* ---------------- print metrics ---------------- */

console.log(`  步幅标定（世界单位/步，归一化前）= ${animator.metrics.stride.toFixed(3)}`);

/* ---------------- 结果 ---------------- */

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
