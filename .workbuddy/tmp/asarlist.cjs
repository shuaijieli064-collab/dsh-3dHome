const fs = require('fs');
const p = 'D:/dsh-desktop/DSH NEXT/resources/app.asar';
const fd = fs.openSync(p, 'r');
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const size = head.readUInt32LE(12);
const buf = Buffer.alloc(size);
fs.readSync(fd, buf, 0, size, 16);
fs.closeSync(fd);
const header = JSON.parse(buf.toString('utf8'));
const names = [];
(function walk(node, prefix) {
  for (const k of Object.keys(node.files || {})) {
    const f = node.files[k];
    const full = prefix + '/' + k;
    if (f.files) walk(f, full);
    else names.push(full);
  }
})(header, '');
console.log('total', names.length);
console.log(names.filter((n) => /^(\/lib|\/cli|\/out)?\/(lib|cli|bin)/.test(n)).slice(0, 60).join('\n'));
console.log('--- cli/bootstrap keyword ---');
console.log(names.filter((n) => /cli|bootstrap|command/i.test(n)).slice(0, 40).join('\n'));
