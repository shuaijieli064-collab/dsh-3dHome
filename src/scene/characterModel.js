import * as THREE from 'three';
import { loadGLB } from './glbLoader.js';
import { createBoneAnimator } from './characterAnim.js';

/* ================================================================== */
/*  模型化角色 · 配置区                                                */
/*                                                                     */
/*  2026-10-31 整体替换：新小拾 = Mixamo 骨架贴图成品                   */
/*  （xiaoshi_rigged.glb，5.4MB，自带 walk_relaxed 烘焙走路）。         */
/*  单网格单材质，自带画好的脸 → 无表情贴片/眨眼，无可命名部件          */
/*  （Dress/Ahoge/Tail/Fin 不存在），旧 tick 部件动画整体退役。         */
/*  动画全部交给 characterAnim.js 的混合动画器（烘焙走路+程序化姿态）。 */
/* ================================================================== */

/* 模型 URL 是硬性依赖：现在只有模型化这一条路线，程序化小拾已删除。 */
/* 路径沿用旧文件名（直接覆盖），调用方无感知。                       */
export const CHARACTER_MODEL_URL = './src/scene/assets/xiaoshi_rigged.glb';

/* 新模型自身就是 Y-up（Mixamo 导出），无需转正。若未来换未转正的导出，*/
/* 把这里改成 Math.PI / 2。                                            */
const MODEL_UP_FIX = 0;
/* 朝向微调（弧度）：若发现背对/侧对相机，改这里。Mixamo 导出惯常脸朝   */
/* +z，预期为 0；demo.html 实测后校准。                                 */
const MODEL_YAW = 0;

/* 模型归一化目标高度：脚底 y=0，头顶 ≈1.10（与旧版一致，屋子尺度不变）。*/
const MODEL_TARGET_HEIGHT = 1.10;

/* 反向壳描边：填节点名（如 ['Head','Hair','Dress']）。要求这些网格的   */
/* 几何体原点在其自身中心，否则描边会错位。默认关闭，先确认模型再开。   */
const OUTLINE_NODES = [];
const OUTLINE_COLOR = 0x372e3e;

/* 材质名 → 调色板键。Blender 里给材质取这些名字即可被换色板接管。     */
/* 未列出的材质颜色保持 GLB 内置 baseColorFactor。                      */
const MATERIAL_ROLES = {
  mat_hair: 'hair',
  mat_hair_tip: 'tip',
  mat_dress: 'dress',
  mat_sleeve: 'sleeve',
  mat_fin: 'fin',
  mat_fin_light: 'finLight',
  mat_whale: 'whale', // 字符串十六进制，如 '#8fb6e2'
  mat_skin: 'skin',
  mat_lace: 'lace',
  mat_gold: 'gold',
};

/* 与程序化小拾一致的默认调色板（仅当调用方未传入时兜底）。            */
export const DEFAULT_PALETTE = {
  hair: 0x2a3f7e, tip: 0x5fb4dd, dress: 0x2e4470, sleeve: 0x273a63,
  fin: 0x5f8fd6, finLight: 0x9fd0f2, whale: '#8fb6e2',
};

const SKIN = 0xffeadf;
const LACE = 0xfbf7ef;
const GOLD = 0xd0a04b;

/* ------------------------------------------------------------------ */
/*  工具                                                               */
/* ------------------------------------------------------------------ */

function normalizeToHeight(root, target) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const s = target / Math.max(size.y, 1e-4);
  root.scale.multiplyScalar(s);
  // 重新计算缩放后的包围盒，把脚底压到 y=0，XZ 居中。
  const box2 = new THREE.Box3().setFromObject(root);
  root.position.x -= (box2.min.x + box2.max.x) / 2;
  root.position.z -= (box2.min.z + box2.max.z) / 2;
  root.position.y -= box2.min.y;
}

function applyPalette(root, palette) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of materials) {
      const role = MATERIAL_ROLES[mat.userData.gltfName];
      if (!role) continue;
      if (role === 'skin') mat.color.setHex(SKIN);
      else if (role === 'lace') mat.color.setHex(LACE);
      else if (role === 'gold') mat.color.setHex(GOLD);
      else {
        const v = palette[role];
        if (typeof v === 'string') mat.color.set(v);
        else if (typeof v === 'number') mat.color.setHex(v);
      }
    }
  });
}

function addOutline(obj) {
  obj.traverse((m) => {
    if (!m.isMesh || !m.geometry) return;
    const o = new THREE.Mesh(
      m.geometry,
      new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide })
    );
    o.position.copy(m.position);
    o.quaternion.copy(m.quaternion);
    o.scale.copy(m.scale).multiplyScalar(1.05);
    m.parent.add(o);
  });
}

function disposeObject(root) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => m?.dispose());
    }
  });
}

/* ------------------------------------------------------------------ */
/*  蒙皮重绑定                                                          */
/*  glbLoader 在「刚加载、未归一化」时固化 boneInverses/bindMatrix。     */
/*  之后 rig 上任何静态变换（归一化缩放/脚底对零/展示台 1.6 倍）都会被   */
/*  蒙皮叠加两次——实测小人脚悬空 0.56 m、头 1.63 m（2026-10-31）。     */
/*  three 蒙皮的约定：boneInverses + bindMatrix 必须与静止渲染的世界    */
/*  快照一致（静止时 skinMatrix=I → 顶点恒等）。所以在**最终静止摆位    */
/*  定型后**重算一遍即可；之后的运行时动态（走/姿态）走相对变换，安全。 */
/* ------------------------------------------------------------------ */

export function rebindSkinnedMeshes(root) {
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (o.isSkinnedMesh && o.skeleton) {
      o.skeleton.calculateInverses();
      o.bind(o.skeleton, o.matrixWorld.clone());
    }
  });
}

/* ------------------------------------------------------------------ */
/*  构建模型化角色                                                     */
/* ------------------------------------------------------------------ */

export async function createModeledCharacter(palette = DEFAULT_PALETTE, opts = {}) {
  const url = opts.url || CHARACTER_MODEL_URL;
  if (!url) throw new Error('CHARACTER_MODEL_URL 未设置，无法加载模型');

  let loaded;
  try {
    loaded = await loadGLB(url);
  } catch (err) {
    /* 旧的双文件回退（xiaoshi.glb）已删除：加载失败必须暴露，           */
    /* 上层 loadModelIntoStage 有重试与显式报错。                        */
    throw err;
  }
  const { scene: root, nodes, animations } = loaded;

  // 朝向与归一化固化到**内层 rig**：住客控制器与展示台会（每帧）覆盖
  // holder 的 position/scale/rotation——那是「世界摆位」。归一化若放在
  // holder 上会被覆盖抹掉：新模型 GLB 原点在身体中心（脚 y=-0.5、头
  // y=+0.5），修正失效后小人半截身子陷进地板（2026-10-31 实测修复）。
  if (MODEL_UP_FIX) root.rotation.x = MODEL_UP_FIX;
  const rig = new THREE.Group();
  rig.add(root);
  rig.rotation.y = MODEL_YAW;
  normalizeToHeight(rig, MODEL_TARGET_HEIGHT);
  const holder = new THREE.Group();
  holder.add(rig);
  applyPalette(holder, palette);

  // rig 定型（归一化已写入）→ 重算蒙皮 bind 快照，静止渲染零变形。
  // 运行时调用方若再改 holder 摆位（展示台 1.6 倍等），摆完调
  // holder.userData.rebind() 再固化一次即可。
  rebindSkinnedMeshes(holder);
  holder.userData.rebind = () => rebindSkinnedMeshes(holder);

  // 可选描边（新模型为单网格整体贴图，默认关闭；OUTLINE_NODES 需网格节点名）
  for (const name of OUTLINE_NODES) {
    const o = nodes[name];
    if (o) addOutline(o);
  }

  /* 表情系统退役：新模型自带画好的脸（单网格贴图），无 Head 网格节点
     可挂贴片。setExpression 保留为无害空接口，避免调用方炸掉。 */

  function setExpression(name = 'normal') {
    /* 无表情贴片：贴图成品模型的脸画在贴图里，运行时不可换。 */
  }

  // 混合动画器：烘焙走路 clip + 程序化姿态（新 Mixamo 骨架）
  let animator = null;
  try {
    animator = createBoneAnimator(root, { clips: animations || [] });
    if (!animator.debug.boneCount) animator = null;
  } catch (err) {
    console.warn('[character] 骨骼动画器初始化失败，退回整体动作：', err);
    animator = null;
  }
  if (animator) {
    console.info(
      `[character] 骨骼就绪：${animator.debug.boneCount} 根骨` +
      (animator.debug.bakedClip ? `，烘焙走路「${animator.debug.bakedClip}」已挂载` : '')
    );
  }

  function tick(t) {
    /* 新模型无可命名部件（Dress/Ahoge/Tail/Fin 不存在），也没有表情
       贴片可眨。整体动作已由 boneTick（混合动画器）掌管，这里保留
       空实现维持 userData.animate 接口。 */
  }

  holder.userData.animate = tick;
  holder.userData.setExpression = setExpression;
  holder.currentExpression = 'normal';
  if (animator) {
    holder.userData.bones = animator.bones;
    holder.userData.animator = animator;
    // boneTick 由住客控制器每帧调用（整体位移仍归控制器管）
    holder.userData.boneTick = (t, dt, ctx) => animator.tick(t, dt, ctx);
    // 步幅标定（世界单位/步）供控制器对齐位移与脚步（不滑步）
    holder.userData.gait = animator.metrics;
  }

  return holder;
}

/* ------------------------------------------------------------------ */
/*  把模型化角色换进展示台。                                            */
/*  模型是唯一路线（程序化小拾已删除），所以加载失败必须显式报错，      */
/*  并在网络抖动时自动重试；重试全部用尽后返回 false 并打出带模型路径的 */
/*  console.error，让控制台一眼看出「台子上为什么是空的」。              */
/* ------------------------------------------------------------------ */

const LOAD_RETRY_DELAY = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function loadModelIntoStage(stage, palette = DEFAULT_PALETTE, opts = {}) {
  const { retries = 2, retryDelay = LOAD_RETRY_DELAY } = opts;
  if (!CHARACTER_MODEL_URL) {
    console.error('[character] CHARACTER_MODEL_URL 未设置：程序化小拾已移除，台子上不会有人。');
    return false;
  }
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const character = await createModeledCharacter(palette);
      const old = stage.userData.character;
      const scale = stage.userData.charScale ?? 1.6;
      character.scale.multiplyScalar(scale);
      character.position.y = 0.09;
      stage.add(character);
      rebindSkinnedMeshes(character); // 台上最终摆位定型后再固化蒙皮快照
      stage.userData.character = character;
      if (old) {
        stage.remove(old);
        disposeObject(old);
      }
      console.info('[character] 已加载模型化小拾：', CHARACTER_MODEL_URL);
      return true;
    } catch (err) {
      if (attempt < retries) {
        console.warn(
          `[character] 模型加载失败，${retryDelay}ms 后重试 (${attempt + 1}/${retries})：`,
          err
        );
        await sleep(retryDelay);
        continue;
      }
      console.error(
        `[character] 模型加载失败，展示台为空。检查 ${CHARACTER_MODEL_URL} 是否存在、服务端是否支持 .glb 与 Range 请求：`,
        err
      );
      return false;
    }
  }
  return false;
}
