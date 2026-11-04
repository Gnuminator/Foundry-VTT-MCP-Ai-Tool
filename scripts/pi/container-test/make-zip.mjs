// Writes a zip of stored (uncompressed) entries, so a test can name an entry any way it likes (zip(1) refuses a "../"
// name). Used by stage24-scenarios.sh:  node make-zip.mjs <out.zip> <name=content> [<name=content> ...]
// A name that ends in "/" is a folder entry (no content).
import { writeFileSync } from 'node:fs';

const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const [out, ...entries] = process.argv.slice(2);
const locals = [];
const centrals = [];
let offset = 0;
for (const entry of entries) {
  const eq = entry.indexOf('=');
  let label = eq < 0 ? entry : entry.slice(0, eq);
  const link = label.startsWith('L:'); // L:<name>=<target> is a symbolic link
  if (link) label = label.slice(2);
  const name = Buffer.from(label);
  const body = Buffer.from(eq < 0 ? '' : entry.slice(eq + 1));
  const crc = crc32(body);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(link ? (3 << 8) | 20 : 20, 4); // 3 = made on Unix, so the attributes below mean a link
  central.writeUInt16LE(20, 6);
  if (link) central.writeUInt32LE((0o120777 << 16) >>> 0, 38);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  locals.push(local, name, body);
  centrals.push(central, name);
  offset += 30 + name.length + body.length;
}
const centralBuf = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);
writeFileSync(out, Buffer.concat([...locals, centralBuf, end]));
