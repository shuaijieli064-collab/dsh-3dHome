// 生成一个"按命名规范"的演示 GLB，用于端到端验证模型化路线。
// 几何体是简化版（球/锥/柱/三角），但节点名、材质名完全符合
// src/scene/assets/建模与命名规范.txt，因此能直接被 characterModel.js 的
// tick() 动画、换色板、Canvas 表情系统接住。
//
// 运行： node scripts/gen-demo-glb.mjs
// 输出： src/scene/assets/xiaoshi_demo.glb

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../src/scene/assets/xiaoshi_demo.glb');

/* ---------------- 几何体生成（局部坐标，枢轴在原点） ---------------- */

function sphere(r, seg = 18) {
  const positions = [], indices = [];
  for (let i = 0; i <= seg; i++) {
    const phi = Math.PI * i / seg;
    for (let j = 0; j <= seg; j++) {
      const th = 2 * Math.PI * j / seg;
      positions.push(Math.sin(phi) * Math.cos(th) * r, Math.cos(phi) * r, Math.sin(phi) * Math.sin(th) * r);
    }
  }
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j, b = a + 1, c = a + (seg + 1), d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  return { positions, indices };
}

// 截头锥（裙身/尾杆），顶在 y=0，底在 y=botY
function truncatedCone(topR, botY, botR, seg = 24, topY = 0) {
  const positions = [], indices = [];
  for (let j = 0; j <= seg; j++) {
    const th = 2 * Math.PI * j / seg;
    positions.push(Math.cos(th) * topR, topY, Math.sin(th) * topR);
  }
  const topCount = seg + 1;
  for (let j = 0; j <= seg; j++) {
    const th = 2 * Math.PI * j / seg;
    positions.push(Math.cos(th) * botR, botY, Math.sin(th) * botR);
  }
  for (let j = 0; j < seg; j++) {
    const t0 = j, t1 = j + 1, b0 = topCount + j, b1 = topCount + j + 1;
    indices.push(t0, b0, t1, t1, b0, b1);
  }
  // 顶盖（裙腰小圆盘）
  const capCenter = positions.length / 3; positions.push(0, topY, 0);
  const capStart = positions.length / 3;
  for (let j = 0; j <= seg; j++) {
    const th = 2 * Math.PI * j / seg;
    positions.push(Math.cos(th) * topR, topY, Math.sin(th) * topR);
  }
  for (let j = 0; j < seg; j++) indices.push(capCenter, capStart + j, capStart + j + 1);
  return { positions, indices };
}

// 圆锥（呆毛），底在 y=0，尖在 y=h
function cone(h, R, seg = 16) {
  const positions = [], indices = [];
  positions.push(0, h, 0);
  for (let j = 0; j <= seg; j++) {
    const th = 2 * Math.PI * j / seg;
    positions.push(Math.cos(th) * R, 0, Math.sin(th) * R);
  }
  for (let j = 0; j < seg; j++) indices.push(0, j + 1, j + 2);
  return { positions, indices };
}

function tailGeo() {
  const a = truncatedCone(0.05, -0.34, 0.05, 12); // 尾杆
  const positions = [...a.positions], indices = [...a.indices];
  // 鲸尾水平尾鳍（在尾杆底端）
  const C = positions.length / 3; positions.push(0, -0.34, 0);
  const L = positions.length / 3; positions.push(-0.20, -0.34, 0.20);
  const F = positions.length / 3; positions.push(0, -0.34, -0.34);
  const R = positions.length / 3; positions.push(0.20, -0.34, 0.20);
  indices.push(C, L, F, C, F, R);
  return { positions, indices };
}

function finGeo(right) {
  const s = right ? -1 : 1; // 右鳍向 -x，左鳍向 +x
  return { positions: [0, 0.06, 0, 0, -0.06, 0, s * 0.20, 0, 0.05], indices: [0, 2, 1] };
}

/* ---------------- 组装部件（节点名 + 枢轴 translation + 材质名） ---------------- */

const matIndex = { mat_skin: 0, mat_dress: 1, mat_hair: 2, mat_fin: 3, mat_fin_light: 4 };

const parts = [
  { name: 'Head', material: 'mat_skin', translation: [0, 0.90, 0], geo: sphere(0.20, 18) },
  { name: 'Dress', material: 'mat_dress', translation: [0, 0.74, 0], geo: truncatedCone(0.12, -0.46, 0.36, 24) },
  { name: 'Ahoge', material: 'mat_hair', translation: [0, 1.00, 0], geo: cone(0.16, 0.045, 16) },
  { name: 'Tail', material: 'mat_fin', translation: [0, 0.42, -0.12], geo: tailGeo() },
  { name: 'Fin_L', material: 'mat_fin_light', translation: [0.19, 0.86, 0], geo: finGeo(false) },
  { name: 'Fin_R', material: 'mat_fin_light', translation: [-0.19, 0.86, 0], geo: finGeo(true) },
];

/* ---------------- 打包 GLB ---------------- */

const bufferViews = [], accessors = [], meshDefs = [], nodes = [], binChunks = [];
let byteOffset = 0;

function align4() {
  if (byteOffset % 4 !== 0) {
    const pad = 4 - (byteOffset % 4);
    binChunks.push(new Uint8Array(pad));
    byteOffset += pad;
  }
}

parts.forEach((p, i) => {
  align4();
  const posArr = new Float32Array(p.geo.positions);
  const posBV = bufferViews.length, posAcc = accessors.length;
  bufferViews.push({ buffer: 0, byteOffset, byteLength: posArr.byteLength, target: 34962 });
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < p.geo.positions.length; k += 3)
    for (let c = 0; c < 3; c++) {
      const v = p.geo.positions[k + c];
      if (v < min[c]) min[c] = v;
      if (v > max[c]) max[c] = v;
    }
  accessors.push({ bufferView: posBV, componentType: 5126, count: posArr.length / 3, type: 'VEC3', min, max });
  binChunks.push(posArr);
  byteOffset += posArr.byteLength;

  align4();
  let idx = p.geo.indices;
  if (idx.length % 2 !== 0) idx = idx.concat(0); // uint16 需偶数长度（4 字节对齐）
  const idxArr = new Uint16Array(idx);
  const idxBV = bufferViews.length, idxAcc = accessors.length;
  bufferViews.push({ buffer: 0, byteOffset, byteLength: idxArr.byteLength, target: 34963 });
  accessors.push({ bufferView: idxBV, componentType: 5123, count: idxArr.length, type: 'SCALAR' });
  binChunks.push(idxArr);
  byteOffset += idxArr.byteLength;

  meshDefs.push({ primitives: [{ attributes: { POSITION: posAcc }, indices: idxAcc, material: matIndex[p.material] }] });
  nodes.push({ name: p.name, translation: p.translation, mesh: i });
});

const materials = [
  { name: 'mat_skin', pbrMetallicRoughness: { baseColorFactor: [1, 0.92, 0.87, 1] } },
  { name: 'mat_dress', pbrMetallicRoughness: { baseColorFactor: [0.18, 0.27, 0.44, 1] } },
  { name: 'mat_hair', pbrMetallicRoughness: { baseColorFactor: [0.16, 0.25, 0.49, 1] } },
  { name: 'mat_fin', pbrMetallicRoughness: { baseColorFactor: [0.37, 0.56, 0.84, 1] } },
  { name: 'mat_fin_light', pbrMetallicRoughness: { baseColorFactor: [0.62, 0.82, 0.95, 1] } },
];

const gltf = {
  asset: { version: '2.0', generator: '3d小家 demo generator' },
  scene: 0,
  scenes: [{ nodes: nodes.map((_, i) => i) }],
  nodes,
  meshes: meshDefs,
  materials,
  buffers: [{ byteLength: byteOffset }],
  bufferViews,
  accessors,
};

// JSON chunk
let jsonStr = JSON.stringify(gltf);
while (jsonStr.length % 4 !== 0) jsonStr += ' '; // pad with space (0x20)
const jsonBuf = new TextEncoder().encode(jsonStr);

// BIN chunk
align4();
const binLen = byteOffset;
const binBuf = new Uint8Array(binLen);
let w = 0;
for (const c of binChunks) { binBuf.set(new Uint8Array(c.buffer, c.byteOffset, c.byteLength), w); w += c.byteLength; }

const total = 12 + (8 + jsonBuf.length) + (8 + binBuf.length);
const out = new Uint8Array(total);
const dv = new DataView(out.buffer);
let o = 0;
dv.setUint32(o, 0x46546c67, true); o += 4;     // glTF magic
dv.setUint32(o, 2, true); o += 4;              // version
dv.setUint32(o, total, true); o += 4;          // total length
dv.setUint32(o, jsonBuf.length, true); o += 4; // JSON chunk length
dv.setUint32(o, 0x4e4f534a, true); o += 4;     // JSON chunk type
out.set(jsonBuf, o); o += jsonBuf.length;
dv.setUint32(o, binBuf.length, true); o += 4;  // BIN chunk length
dv.setUint32(o, 0x004e4942, true); o += 4;     // BIN chunk type
out.set(binBuf, o); o += binBuf.length;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);
console.log(`已生成演示模型：${OUT}`);
console.log(`大小 ${out.length} 字节，部件：${parts.map((p) => p.name).join(', ')}`);

/* ---------------- 自校验：从磁盘读回，确认解析器能读到 ---------------- */
{
  const buf = new Uint8Array(readFileSync(OUT));
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = dv.getUint32(0, true);
  if (magic !== 0x46546c67) throw new Error('GLB magic 不匹配');
  if (dv.getUint32(4, true) !== 2) throw new Error('GLB 版本非 2.0');
  const jl = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(buf.slice(20, 20 + jl)));
  const names = json.nodes.map((n) => n.name).sort();
  const expect = ['Ahoge', 'Dress', 'Fin_L', 'Fin_R', 'Head', 'Tail'].sort();
  const okNames = JSON.stringify(names) === JSON.stringify(expect);
  const okAccessors = json.accessors.every((a) => a.type === 'VEC3' || a.type === 'SCALAR');
  const okBounds = json.accessors.every((a) => a.type !== 'VEC3' || (a.min && a.max));
  console.log(`自校验：节点名 ${okNames ? 'OK' : 'FAIL ' + names.join(',')}｜存取器 ${okAccessors ? 'OK' : 'FAIL'}｜包围盒 ${okBounds ? 'OK' : 'FAIL'}`);
  if (!okNames || !okAccessors || !okBounds) process.exit(1);
}
