import * as THREE from 'three';
import { makeToonGradientMap } from './characterTextures.js';

/* ------------------------------------------------------------------ */
/*  Minimal GLB loader — zero dependency, offline.                      */
/*                                                                     */
/*  Scope (intentionally narrow, matches this project's needs):         */
/*    - glTF 2.0 binary (.glb) with a single BIN chunk                  */
/*    - POSITION / NORMAL / TEXCOORD_0 attributes + indices             */
/*    - pbrMetallicRoughness.baseColorFactor as the only material input */
/*    - embedded baseColorTexture / normalTexture (PNG/JPEG in BIN)     */
/*    - node hierarchy with TRS (incl. parented pivots / empties)       */
/*    - skins: SkinnedMesh + Bone 层级 + inverseBindMatrices            */
/*      （关节由代码直接驱动 bone.rotation，不需要解析 AnimationClip）  */
/*                                                                     */
/*  Deliberately NOT supported (and unnecessary here):                  */
/*    - Draco / meshopt / KTX2 compressed assets                        */
/*    - metallicRoughnessTexture (MeshToonMaterial 不吃金属粗糙度贴图)   */
/*    - external image URIs (只支持 GLB 内嵌贴图)                        */
/*    - morph targets / Draco / meshopt / KTX2                          */
/*                                                                     */
/*  Pass `gradientMap` to keep the house's toon look; we rebuild every  */
/*  material as MeshToonMaterial so the model matches the rest.         */
/* ------------------------------------------------------------------ */

const COMP_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const CTOR = {
  5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
  5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
};
const ITEM_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const NORM_MAX = { 5121: 255, 5123: 65535, 5120: 127, 5122: 32767 };

let GRAD = null;
function gradientMap() {
  if (!GRAD) GRAD = makeToonGradientMap();
  return GRAD;
}

export async function loadGLB(url, opts = {}) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} 加载失败: ${url}`);
  const buf = await res.arrayBuffer();

  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('不是有效的 GLB 文件');
  if (dv.getUint32(4, true) !== 2) throw new Error('只支持 glTF 2.0');

  let offset = 12;
  const jsonLen = dv.getUint32(offset, true);
  offset += 4;
  const jsonType = dv.getUint32(offset, true);
  offset += 4;
  if (jsonType !== 0x4e4f534a) throw new Error('GLB 第一个 chunk 必须是 JSON');
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, offset, jsonLen)));
  offset += jsonLen;
  offset = (offset + 3) & ~3;

  let bin = null;
  if (offset + 8 <= buf.byteLength) {
    const binLen = dv.getUint32(offset, true);
    const binType = dv.getUint32(offset + 4, true);
    offset += 8;
    if (binType === 0x004e4942) bin = buf.slice(offset, offset + binLen);
  }
  if (!bin) throw new Error('GLB 缺少 BIN 数据块');

  return await buildScene(gltf, bin, opts);
}

async function buildScene(gltf, bin, opts) {
  const bufferViews = gltf.bufferViews || [];

  /* ---- 贴图管线：GLB 内嵌 image（PNG/JPEG）→ THREE.Texture ---- */
  const images = gltf.images || [];
  const samplers = gltf.samplers || [];
  const textures = gltf.textures || [];
  const texCache = new Map();
  const FILTER = {
    9728: THREE.NearestFilter, 9729: THREE.LinearFilter,
    9984: THREE.NearestMipmapNearestFilter, 9985: THREE.LinearMipmapNearestFilter,
    9986: THREE.NearestMipmapLinearFilter, 9987: THREE.LinearMipmapLinearFilter,
  };
  const WRAP = {
    33071: THREE.ClampToEdgeWrapping,
    33648: THREE.MirroredRepeatWrapping,
    10497: THREE.RepeatWrapping,
  };

  async function getTexture(ti) {
    if (ti == null || !textures[ti]) return null;
    if (texCache.has(ti)) return texCache.get(ti);
    const promise = (async () => {
      const tdef = textures[ti];
      const img = images[tdef.source];
      if (!img || img.bufferView == null) return null; // 只支持内嵌贴图
      const bv = bufferViews[img.bufferView];
      const blob = new Blob(
        [new Uint8Array(bin, bv.byteOffset || 0, bv.byteLength)],
        { type: img.mimeType || 'image/png' }
      );
      const bitmap = await createImageBitmap(blob);
      const tex = new THREE.Texture(bitmap);
      tex.flipY = false; // glTF UV 原点在左上，与 three 默认相反
      tex.anisotropy = 4;
      tex.needsUpdate = true;
      const s = samplers[tdef.sampler];
      if (s) {
        if (s.magFilter != null && FILTER[s.magFilter]) tex.magFilter = FILTER[s.magFilter];
        if (s.minFilter != null && FILTER[s.minFilter]) tex.minFilter = FILTER[s.minFilter];
        if (s.wrapS != null && WRAP[s.wrapS]) tex.wrapS = WRAP[s.wrapS];
        if (s.wrapT != null && WRAP[s.wrapT]) tex.wrapT = WRAP[s.wrapT];
      }
      return tex;
    })();
    texCache.set(ti, promise);
    return promise;
  }

  function readAccessor(i) {
    const a = gltf.accessors[i];
    const bv = bufferViews[a.bufferView];
    const compType = a.componentType;
    const itemSize = ITEM_SIZE[a.type];
    const compBytes = COMP_BYTES[compType];
    const Ctor = CTOR[compType];
    const count = a.count;
    const baseOffset = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const stride = bv.byteStride || itemSize * compBytes;
    const out = new Ctor(count * itemSize);
    const view = new DataView(bin);
    const normalized = a.normalized && compType !== 5126;
    const max = NORM_MAX[compType] || 1;
    for (let k = 0; k < count; k++) {
      const o = baseOffset + k * stride;
      for (let c = 0; c < itemSize; c++) {
        const addr = o + c * compBytes;
        let val;
        switch (compType) {
          case 5126: val = view.getFloat32(addr, true); break;
          case 5125: val = view.getUint32(addr, true); break;
          case 5123: val = view.getUint16(addr, true); break;
          case 5121: val = view.getUint8(addr); break;
          case 5122: val = view.getInt16(addr, true); break;
          case 5120: val = view.getInt8(addr); break;
          default: val = 0;
        }
        if (normalized) val = val / max;
        out[k * itemSize + c] = val;
      }
    }
    return { array: out, itemSize };
  }

  function buildGeometry(prim) {
    const geo = new THREE.BufferGeometry();
    const pos = readAccessor(prim.attributes.POSITION);
    geo.setAttribute('position', new THREE.BufferAttribute(pos.array, pos.itemSize));
    if (prim.attributes.NORMAL !== undefined) {
      const n = readAccessor(prim.attributes.NORMAL);
      geo.setAttribute('normal', new THREE.BufferAttribute(n.array, n.itemSize));
    } else {
      geo.computeVertexNormals();
    }
    if (prim.attributes.TEXCOORD_0 !== undefined) {
      const uv = readAccessor(prim.attributes.TEXCOORD_0);
      geo.setAttribute('uv', new THREE.BufferAttribute(uv.array, uv.itemSize));
    }
    if (prim.indices !== undefined) {
      const idx = readAccessor(prim.indices);
      geo.setIndex(new THREE.BufferAttribute(idx.array, 1));
    }
    // 蒙皮属性（JOINTS_0 可能是 ubyte/ushort，WEIGHTS_0 是 float 或归一化整型）
    if (prim.attributes.JOINTS_0 !== undefined) {
      const j = readAccessor(prim.attributes.JOINTS_0);
      geo.setAttribute('skinIndex', new THREE.BufferAttribute(j.array, j.itemSize));
    }
    if (prim.attributes.WEIGHTS_0 !== undefined) {
      const w = readAccessor(prim.attributes.WEIGHTS_0);
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(w.array, w.itemSize));
    }
    return geo;
  }

  async function makeMaterial(mi) {
    const m = gltf.materials && mi != null ? gltf.materials[mi] : null;
    const pbr = (m && m.pbrMetallicRoughness) || {};
    const color = new THREE.Color(0xffffff);
    const bcf = pbr.baseColorFactor;
    if (bcf) color.setRGB(bcf[0], bcf[1], bcf[2]);
    const baseTex = await getTexture(pbr.baseColorTexture && pbr.baseColorTexture.index);
    if (baseTex) baseTex.colorSpace = THREE.SRGBColorSpace;
    const normTex = await getTexture(m && m.normalTexture && m.normalTexture.index);
    const mat = new THREE.MeshToonMaterial({
      color,
      gradientMap: gradientMap(),
      map: baseTex || null,
      normalMap: normTex || null,
      transparent: m && m.alphaMode === 'BLEND',
      side: THREE.DoubleSide, // 演示几何体绕序不敏感；也避免卡通角色背面穿帮
    });
    mat.name = (m && m.name) || `mat${mi}`;
    mat.userData.gltfName = mat.name;
    return mat;
  }

  // 预构建本 GLB 用到的全部材质（贴图解码是异步的，须在搭节点前完成）
  const usedMats = new Set();
  for (const mesh of gltf.meshes || []) {
    for (const prim of mesh.primitives) usedMats.add(prim.material ?? null);
  }
  const matCache = new Map();
  for (const mi of usedMats) matCache.set(mi, await makeMaterial(mi));

  function applyTRS(obj, def) {
    if (def.matrix) {
      obj.matrix.fromArray(def.matrix);
      obj.matrix.decompose(obj.position, obj.quaternion, obj.scale);
      obj.matrixAutoUpdate = false;
    } else {
      if (def.translation) obj.position.fromArray(def.translation);
      if (def.rotation) obj.quaternion.fromArray(def.rotation);
      if (def.scale) obj.scale.fromArray(def.scale);
    }
  }

  const root = new THREE.Group();
  root.name = 'GLBRoot';
  const nodes = {};
  const nodeObjs = {};
  const pendingSkins = [];

  // 被 skin.joints 引用的节点要建成 Bone（而不是普通 Group），
  // three 的蒙皮靠 bone.matrixWorld * inverseBindMatrix 计算。
  const jointNodes = new Set();
  for (const s of gltf.skins || []) {
    for (const j of s.joints || []) jointNodes.add(j);
  }

  function buildNode(index, parent) {
    const def = gltf.nodes[index];
    const obj = jointNodes.has(index) ? new THREE.Bone() : new THREE.Group();
    obj.name = def.name || `node${index}`;
    applyTRS(obj, def);
    nodeObjs[index] = obj;

    if (def.mesh !== undefined) {
      const meshDef = gltf.meshes[def.mesh];
      for (const prim of meshDef.primitives) {
        const mesh = new THREE.Mesh(buildGeometry(prim), matCache.get(prim.material ?? null));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        obj.add(mesh);
        if (def.skin !== undefined && prim.attributes.JOINTS_0 !== undefined) {
          pendingSkins.push({ mesh, skin: def.skin });
        }
      }
    }
    if (def.name) nodes[def.name] = obj;
    parent.add(obj);
    if (def.children) for (const c of def.children) buildNode(c, obj);
    return obj;
  }

  const sceneDef = gltf.scenes && gltf.scenes[gltf.scene || 0];
  const rootNodes = sceneDef
    ? sceneDef.nodes
    : (gltf.nodes || []).map((_, i) => i);
  for (const n of rootNodes) buildNode(n, root);

  // 树搭完再绑蒙皮：此时 bone.matrixWorld 才是 rest pose 的世界矩阵，
  // 与 inverseBindMatrix 相乘为单位阵 → 静止时零变形。
  root.updateMatrixWorld(true);
  bindSkins();

  function bindSkins() {
    for (const { mesh, skin: si } of pendingSkins) {
      const s = (gltf.skins || [])[si];
      if (!s) continue;
      try {
        const bones = (s.joints || []).map((i) => nodeObjs[i]).filter(Boolean);
        if (!bones.length) throw new Error('skin.joints 全部缺失');
        const inv = s.inverseBindMatrices != null ? readAccessor(s.inverseBindMatrices) : null;
        const fromFile = [];
        const fromRest = [];
        let fileDev = 0;
        for (let i = 0; i < bones.length; i++) {
          const mf = new THREE.Matrix4();
          // glTF 矩阵是列主序，与 THREE.Matrix4 内部一致，可直接 fromArray
          if (inv && inv.itemSize === 16) mf.fromArray(inv.array, i * 16);
          else mf.copy(bones[i].matrixWorld).invert();
          fromFile.push(mf);
          const mr = new THREE.Matrix4().copy(bones[i].matrixWorld).invert();
          fromRest.push(mr);
          // 文件里的 IBM 乘上静止世界矩阵应当≈单位阵；偏差大说明两边空间不一致
          const chk = new THREE.Matrix4().copy(bones[i].matrixWorld).multiply(mf);
          const e = chk.elements;
          for (let k = 0; k < 16; k++) {
            const d = Math.abs(e[k] - (k % 5 === 0 ? 1 : 0));
            if (d > fileDev) fileDev = d;
          }
        }
        // 用静止姿态自己算的 IBM：静止时 bone.matrixWorld · IBM 恒等于单位阵，
        // 从数学上保证「不动画 = 与原始模型逐顶点一致」。
        const boneInverses = fileDev > 1e-3 ? fromRest : fromFile;
        if (fileDev > 1e-3) {
          console.warn(
            `[glb] 文件的 inverseBindMatrix 与本解析器节点空间不一致（最大偏差 ${fileDev.toFixed(4)}），` +
              '改用静止姿态重算，保证静止零变形。'
          );
        }
        const skeleton = new THREE.Skeleton(bones, boneInverses);

        const skinned = new THREE.SkinnedMesh(mesh.geometry, mesh.material);
        skinned.name = mesh.name || 'SkinnedMesh';
        skinned.castShadow = mesh.castShadow;
        skinned.receiveShadow = mesh.receiveShadow;
        skinned.position.copy(mesh.position);
        skinned.quaternion.copy(mesh.quaternion);
        skinned.scale.copy(mesh.scale);
        skinned.matrixAutoUpdate = mesh.matrixAutoUpdate;
        skinned.frustumCulled = false; // 蒙皮包围盒不随骨骼更新，直接关剔除
        mesh.parent.add(skinned);
        mesh.parent.remove(mesh);
        root.updateMatrixWorld(true);
        skinned.bind(skeleton, skinned.matrixWorld.clone());
      } catch (err) {
        // 绑不上就保持刚性 Mesh，功能降级但不出错
        console.warn('[glb] 蒙皮绑定失败，回退为刚性网格：', err);
      }
    }
  }

  return { scene: root, nodes };
}
