// 实测 model-rigged.glb（现 xiaoshi_rigged.glb）烘焙走路动画的步幅。
// 方法：对 L/R_Hip→Knee→Ankle 链做简易 FK（忽略 bind 旋转，与 Euler 无关，
// 只用四元数动画通道），取踝关节世界 XZ 轨迹的摆动距离 ≈ 单步跨距。
// 用法：node tools/measure_walk_stride.mjs <glb路径>
import fs from 'node:fs';

const path = process.argv[2] || 'src/scene/assets/xiaoshi_rigged.glb';
const buf = fs.readFileSync(path);
const chunkLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + chunkLen).toString('utf8'));
const anim = json.animations[0];
const nodes = json.nodes;
const BINO = 20 + chunkLen + 8;

const readTrack = (smp) => {
  const tAcc = json.accessors[smp.input];
  const vAcc = json.accessors[smp.output];
  const mk = (a, n) => {
    const bv = json.bufferViews[a.bufferView];
    const off = BINO + (bv.byteOffset || 0) + (a.byteOffset || 0);
    return new Float32Array(buf.buffer.slice(off, off + a.count * n * 4));
  };
  return { times: mk(tAcc, 1), values: mk(vAcc, 4) };
};

const rot = {};
anim.channels.forEach((c) => {
  if (c.target.path === 'rotation') rot[nodes[c.target.node].name] = readTrack(anim.samplers[c.sampler]);
});

function sample(tr, t) {
  const { times, values } = tr;
  if (t <= times[0]) return values.slice(0, 4);
  if (t >= times[times.length - 1]) return values.slice(-4);
  let i = times.length - 1;
  for (let k = 1; k < times.length; k++) if (times[k] > t) { i = k - 1; break; }
  const a = (t - times[i]) / (times[i + 1] - times[i]);
  const o1 = i * 4, o2 = o1 + 4;
  return [
    values[o1] + (values[o2] - values[o1]) * a,
    values[o1 + 1] + (values[o2 + 1] - values[o1 + 1]) * a,
    values[o1 + 2] + (values[o2 + 2] - values[o1 + 2]) * a,
    values[o1 + 3] + (values[o2 + 3] - values[o1 + 3]) * a,
  ];
}

const identity = nodes.map((n, i) => ({ ...n, i }));
const nameNode = (nm) => identity.find((n) => n.name === nm);

function qmul(a, b) {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}
function qrot(q, v) {
  const { w, x, y, z } = q;
  const tx = 2 * (y * v.z - z * v.y);
  const ty = 2 * (z * v.x - x * v.z);
  const tz = 2 * (x * v.y - y * v.x);
  return {
    x: v.x + w * tx + (y * tz - z * ty),
    y: v.y + w * ty + (z * tx - x * tz),
    z: v.z + w * tz + (x * ty - y * tx),
  };
}

const CLIP = anim.samplers.reduce((m, s) => Math.max(m, json.accessors[s.input].max[0]), 0);

function ankle(names, t) {
  // 世界位置：p = Σ 逐级旋转后的累计平移（父旋转在前，本地平移随后）
  let acc = { x: 0, y: 0, z: 0, w: 1 };
  let p = { x: 0, y: 0, z: 0 };
  const parts = names.map((nm) => nameNode(nm));
  for (let k = 0; k < parts.length; k++) {
    const def = parts[k];
    const local = def.translation || [0, 0, 0];
    p = { x: p.x + local[0], y: p.y + local[1], z: p.z + local[2] };
    const q = rot[def.name] ? sample(rot[def.name], t) : [0, 0, 0, 1];
    const qr = qrot(acc, p);
    p = qr;
    acc = qmul(acc, { x: q[0], y: q[1], z: q[2], w: q[3] });
  }
  return p;
}

const L = ['Pelvis', 'L_Hip', 'L_Knee', 'L_Ankle'];
const N = 60;
let xl = ankle(L, 0), xr = ankle(L, CLIP);
let pathLen = 0, prev = xl, zmin = 9, zmax = -9;
const pts = [];
for (let k = 0; k <= N; k++) {
  const t = (k / N) * CLIP;
  const a = ankle(L, t);
  pathLen += Math.hypot(a.x - prev.x, a.z - prev.z);
  prev = a;
  zmin = Math.min(zmin, a.z); zmax = Math.max(zmax, a.z);
  if (k % 5 === 0) pts.push({ t: +t.toFixed(2), x: +a.x.toFixed(3), z: +a.z.toFixed(3), y: +a.y.toFixed(3) });
}
console.log(`clip 时长: ${CLIP.toFixed(3)}s（每周期 2 步）`);
console.log(`左踝 XZ 路径长/周期: ${pathLen.toFixed(3)}  首尾直线距离: ${Math.hypot(xl.x - xr.x, xl.z - xr.z).toFixed(4)}`);
console.log(`左踝 z 摆动范围: ${zmin.toFixed(3)} ~ ${zmax.toFixed(3)} => 摆距 ${+(zmax - zmin).toFixed(3)}`);
console.log(`原地走估步幅(摆距半个来回≈每步): ${+(((zmax - zmin) / 2)).toFixed(3)} ~ ${+((Math.max(pathLen/2, zmax - zmin)/2)).toFixed(3)}`);
console.log('采样点:');
for (const p of pts) console.log(JSON.stringify(p));
