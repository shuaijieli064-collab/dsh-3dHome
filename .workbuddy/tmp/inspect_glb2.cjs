const fs = require('fs');
const file = process.argv[2];
const buf = fs.readFileSync(file);
let off = 12;
let json = null, binLen = 0;
while (off < buf.length) {
  const chunkLen = buf.readUInt32LE(off);
  const chunkType = buf.readUInt32LE(off + 4);
  if (chunkType === 0x4E4F534A) json = JSON.parse(buf.subarray(off+8, off+8+chunkLen).toString('utf8'));
  else if (chunkType === 0x004E4942) binLen = chunkLen;
  off += 8 + chunkLen;
}
console.log('bin chunk bytes:', binLen);
console.log('images:', JSON.stringify(json.images||[], null, 0).slice(0,300));
console.log('textures:', JSON.stringify(json.textures||[]).slice(0,300));
console.log('samplers:', JSON.stringify(json.samplers||[]).slice(0,200));
console.log('materials full:', JSON.stringify(json.materials||[], null, 2).slice(0,1500));
console.log('bufferViews:', JSON.stringify((json.bufferViews||[]).map(b=>({b:b.buffer,o:b.byteOffset,l:b.byteLength}))));
console.log('accessors types:', JSON.stringify((json.accessors||[]).map(a=>({t:a.type,c:a.componentType,ct:a.count,mm:a.min&&a.max?
  [a.min.map(x=>Math.round(x*100)/100),a.max.map(x=>Math.round(x*100)/100)]:null}))));
