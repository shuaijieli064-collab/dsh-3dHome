const fs = require('fs');
const path = require('path');

const file = process.argv[2];
const buf = fs.readFileSync(file);
if (buf.readUInt32LE(0) !== 0x46546C67) { console.log('NOT A GLB'); process.exit(1); }
const version = buf.readUInt32LE(4);
const length = buf.readUInt32LE(8);
console.log('GLB version', version, 'total length', length, 'bytes', buf.length);

let off = 12;
let json = null;
while (off < buf.length) {
  const chunkLen = buf.readUInt32LE(off);
  const chunkType = buf.readUInt32LE(off + 4);
  const data = buf.subarray(off + 8, off + 8 + chunkLen);
  if (chunkType === 0x4E4F534A) { // JSON
    json = JSON.parse(data.toString('utf8'));
  }
  off += 8 + chunkLen;
}
if (!json) { console.log('NO JSON CHUNK'); process.exit(1); }

console.log('--- nodes (name / mesh / children) ---');
(json.nodes || []).forEach((n, i) => {
  console.log(`#${i} name="${n.name || ''}" mesh=${n.mesh ?? '-'} children=${(n.children||[]).join(',')}`);
});
console.log('--- meshes (name / primitives material) ---');
(json.meshes || []).forEach((m, i) => {
  const prims = (m.primitives || []).map(p => `mat=${p.material}`).join(' | ');
  console.log(`#${i} name="${m.name || ''}" ${prims}`);
});
console.log('--- materials (name) ---');
(json.materials || []).forEach((mm, i) => {
  console.log(`#${i} name="${mm.name || ''}"`);
});
console.log('--- animations ---', (json.animations||[]).map(a=>a.name));
console.log('--- accessors count ---', (json.accessors||[]).length);
