import * as THREE from 'three';
import { loadGLB } from './glbLoader.js';
import { makeFaceTexture } from './characterTextures.js';
import { createBoneAnimator } from './characterAnim.js';

/* ================================================================== */
/*  模型化角色 · 配置区                                                */
/*                                                                     */
/*  这条路线用 Blender 按三视图手建的 GLB 替换程序化小人，目标是尽量   */
/*  100% 还原设定图，同时保留现有 tick() 动画（呼吸/眨眼/鲸尾/呆毛/鳍）*/
/*  与换色板。改动集中在本文件的配置常量，建模规范见                   */
/*  src/scene/assets/建模与命名规范.txt。                               */
/* ================================================================== */

/* 模型 URL 是硬性依赖：现在只有模型化这一条路线，程序化小拾已删除。 */
/* 优先用带骨骼的版本（tools/rig_xiaoshi.py 产出）；它缺失或解析失败时 */
/* 自动回退到刚性单网格版，功能降级但页面不出错。                     */
export const CHARACTER_MODEL_URL = './src/scene/assets/xiaoshi_rigged.glb';
const CHARACTER_MODEL_FALLBACK = './src/scene/assets/xiaoshi.glb';

/* 小拾.glb 的 node_0 自带 Rx(90°)（Blender 导出时已转成 Y-up），实测   */
/* 包围盒 y:-0.42~0.31 / z:-1.14~0 是几何原始空间；节点转正后身高 1.14。 */
/* 因此不再额外转正；若换成未转正的导出，把这里改成 Math.PI / 2。       */
const MODEL_UP_FIX = 0;
/* 朝向微调（弧度）：若发现背对/侧对相机，改这里。                     */
const MODEL_YAW = 0;

/* 模型归一化目标高度：与程序化小拾一致（脚底 y=0，头顶 ≈1.10）。      */
const MODEL_TARGET_HEIGHT = 1.10;

/* 动画部件对应的节点名（在 Blender 里给对象取这些名字）。             */
const NODE_NAMES = {
  head: 'Head',
  dress: 'Dress',
  ahoge: 'Ahoge',
  tail: 'Tail',
  finL: 'Fin_L',
  finR: 'Fin_R',
};

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
/*  Face decal — 与程序化版完全相同的 Canvas 表情系统（线稿级质感）。  */
/*  模型头部需落在 y≈0.78、正面 z≈+0.30 附近，贴图才能对齐。           */
/* ------------------------------------------------------------------ */

function makeFaceCap(width, height, radius, seg = 30) {
  const geo = new THREE.PlaneGeometry(width, height, seg, seg);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = Math.sqrt(Math.max(radius * radius - x * x - y * y, 0.0004));
    pos.setZ(i, z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

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
/*  构建模型化角色                                                     */
/* ------------------------------------------------------------------ */

export async function createModeledCharacter(palette = DEFAULT_PALETTE, opts = {}) {
  const url = opts.url || CHARACTER_MODEL_URL;
  if (!url) throw new Error('CHARACTER_MODEL_URL 未设置，无法加载模型');

  let loaded;
  try {
    loaded = await loadGLB(url);
  } catch (err) {
    console.warn('[character] 骨骼版加载失败，回退刚性单网格版：', err);
    loaded = await loadGLB(opts.fallback || CHARACTER_MODEL_FALLBACK);
  }
  const { scene: root, nodes } = loaded;

  // Z-up 转正 + 朝向微调：包一层 holder，归一化/朝向都在 holder 上做。
  if (MODEL_UP_FIX) root.rotation.x = MODEL_UP_FIX;
  const holder = new THREE.Group();
  holder.add(root);
  holder.rotation.y = MODEL_YAW;
  normalizeToHeight(holder, MODEL_TARGET_HEIGHT);
  applyPalette(holder, palette);

  // 表情贴片：仅当模型带 Head 命名节点（按规范建模）时挂载；
  // 贴图成品模型（如单网格小拾.glb，自带画好的脸）跳过，避免贴错位置。
  let faceMat = null;
  const hasHead = !!nodes[NODE_NAMES.head];
  if (hasHead) {
    faceMat = new THREE.MeshBasicMaterial({
      map: makeFaceTexture('normal'),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const face = new THREE.Mesh(makeFaceCap(0.44, 0.34, 0.296), faceMat);
    face.position.set(0, 0.78, 0);
    face.renderOrder = 2;
    holder.add(face);
  }

  // 可选描边
  for (const name of OUTLINE_NODES) {
    const o = nodes[name];
    if (o) addOutline(o);
  }

  // 记录动画基准姿态，tick 在其基础上叠加，保留作者摆姿
  const animated = {};
  for (const key of Object.keys(NODE_NAMES)) {
    const n = nodes[NODE_NAMES[key]];
    if (n) animated[key] = { rot: n.rotation.clone(), scaleY: n.scale.y };
  }

  const blinkState = { next: 2.2, until: 0 };
  let current = 'normal';

  function setExpression(name = 'normal') {
    current = name;
    if (!faceMat) return;
    blinkState.until = 0;
    faceMat.map = makeFaceTexture(name);
    faceMat.needsUpdate = true;
  }

  // 骨骼动画器：模型带骨骼时才有（刚性版自动降级为空）
  let animator = null;
  try {
    animator = createBoneAnimator(root);
    if (!animator.debug.boneCount) animator = null;
  } catch (err) {
    console.warn('[character] 骨骼动画器初始化失败，退回整体动作：', err);
    animator = null;
  }
  if (animator) {
    console.info(`[character] 骨骼就绪：${animator.debug.boneCount} 根骨`);
  }

  function tick(t) {
    const dress = animated.dress;
    if (dress) nodes[NODE_NAMES.dress].scale.y = dress.scaleY * (1 + Math.sin(t * 1.6) * 0.012);

    const ahoge = animated.ahoge;
    if (ahoge) {
      const n = nodes[NODE_NAMES.ahoge];
      n.rotation.z = ahoge.rot.z - 0.55 + Math.sin(t * 1.9) * 0.16;
      n.rotation.x = ahoge.rot.x + 0.15 + Math.cos(t * 1.3) * 0.07;
    }

    const tail = animated.tail;
    if (tail) {
      const n = nodes[NODE_NAMES.tail];
      n.rotation.z = tail.rot.z + Math.sin(t * 0.9) * 0.06;
      n.rotation.x = tail.rot.x + Math.sin(t * 0.7) * 0.045;
    }

    const finL = animated.finL;
    const finR = animated.finR;
    if (finL) nodes[NODE_NAMES.finL].rotation.x = finL.rot.x + Math.sin(t * 1.1) * 0.03;
    if (finR) nodes[NODE_NAMES.finR].rotation.x = finR.rot.x + Math.sin(t * 1.1 + 0.5) * 0.03;

    if (faceMat && current === 'normal') {
      if (t > blinkState.until && t > blinkState.next) {
        blinkState.until = t + 0.11;
        blinkState.next = t + 2.4 + Math.random() * 2.6;
        faceMat.map = makeFaceTexture('closed');
        faceMat.needsUpdate = true;
      } else if (blinkState.until !== 0 && t > blinkState.until) {
        blinkState.until = 0;
        faceMat.map = makeFaceTexture(current);
        faceMat.needsUpdate = true;
      }
    }
  }

  holder.userData.animate = tick;
  holder.userData.setExpression = setExpression;
  holder.currentExpression = 'normal';
  setExpression('normal');
  if (animator) {
    holder.userData.bones = animator.bones;
    holder.userData.animator = animator;
    // boneTick 由住客控制器每帧调用（整体位移仍归控制器管）
    holder.userData.boneTick = (t, dt, ctx) => animator.tick(t, dt, ctx);
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
