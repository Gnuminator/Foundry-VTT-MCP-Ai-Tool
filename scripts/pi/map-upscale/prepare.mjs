// PC side of the sharper-maps Pi run (backlog map-upscale-pi, stage 34): builds the two small files stage 34 needs from the
// licensed material that stays on this PC, so no scene name, map name or number of the book is ever in the repo.
//
//   node scripts/pi/map-upscale/prepare.mjs --maps <dir> --switch <switch.json> --scale <scale.json> --out <dir>
//
//   --maps    the folder with the 2x map files (jpg), for example C:\FoundryTest\data\Data\assets\strahd-maps-2x-us
//   --switch  JSON { "<original src in the scenes>": "<file name in --maps>" }
//   --scale   JSON { size: [{ name, from: [w, h], to: [w, h] }], grid: [{ name, from: {...}, to: {...} }] }
//   --out     where to write data.js (the DATA constant for map-upscale-scenes.js) and manifest.sha256
//   --folder  the Foundry Data folder the maps go to on the Pi (default assets/strahd-maps-2x)
//
// It refuses a file name that is not a plain name, a missing, empty or non-JPEG map, a switch with two originals pointing
// at one file, and a scale entry without both sides. Prints the commands to copy the files to the Pi. Writes only into --out.
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.jpe?g$/;
const FOLDER = /^assets\/[a-z0-9][a-z0-9._-]*$/;

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file)
      .on('data', d => h.update(d))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

/** Checks the inputs and returns { data, files }: the DATA object and the sorted list of map file names. Throws on a bad input. */
export function buildData({ switchMap, scale, folder, mapsDir }) {
  if (!FOLDER.test(folder)) throw new Error(`--folder must look like assets/name (got ${folder})`);
  const entries = Object.entries(switchMap ?? {});
  if (!entries.length) throw new Error('the switch file has no entries');
  const targets = new Set();
  const data = { switch: {}, size: [], grid: [] };
  for (const [from, file] of entries) {
    if (
      typeof from !== 'string' ||
      !from ||
      from.startsWith('/') ||
      from.includes('..') ||
      from.includes('\\')
    )
      throw new Error(`odd original path in the switch file: ${from}`);
    if (typeof file !== 'string' || !PLAIN_NAME.test(file))
      throw new Error(`odd map file name for ${from}: ${file}`);
    if (targets.has(file)) throw new Error(`two originals point at the same map file: ${file}`);
    targets.add(file);
    const full = path.join(mapsDir, file);
    if (!existsSync(full) || !statSync(full).isFile()) throw new Error(`no map file ${full}`);
    if (statSync(full).size < 1024) throw new Error(`map file ${full} is empty or too small`);
    const head = readFileSync(full).subarray(0, 3);
    if (!(head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff))
      throw new Error(`${full} is not a JPEG`);
    data.switch[from] = `${folder}/${file}`;
  }
  for (const s of scale?.size ?? []) {
    const ok = a =>
      Array.isArray(a) && a.length === 2 && a.every(n => Number.isInteger(n) && n > 0);
    if (!s.name || !ok(s.from) || !ok(s.to))
      throw new Error(`bad size entry: ${JSON.stringify(s)}`);
    data.size.push({ name: s.name, from: s.from, to: s.to });
  }
  for (const g of scale?.grid ?? []) {
    const obj = o => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length > 0;
    if (!g.name || !obj(g.from) || !obj(g.to))
      throw new Error(`bad grid entry: ${JSON.stringify(g)}`);
    data.grid.push({ name: g.name, from: g.from, to: g.to });
  }
  return { data, files: [...targets].sort() };
}

export function dataJs(data) {
  return `const DATA = ${JSON.stringify(data, null, 1)};\n`;
}

function parseArgs(argv) {
  const o = { folder: 'assets/strahd-maps-2x' };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    if (
      !['--maps', '--switch', '--scale', '--out', '--folder'].includes(k) ||
      argv[i + 1] === undefined
    )
      throw new Error(`unknown or incomplete option ${k}`);
    o[k.slice(2)] = argv[i + 1];
  }
  for (const k of ['maps', 'switch', 'scale', 'out'])
    if (!o[k]) throw new Error(`--${k} is required`);
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const { data, files } = buildData({
    switchMap: JSON.parse(readFileSync(o.switch, 'utf8')),
    scale: JSON.parse(readFileSync(o.scale, 'utf8')),
    folder: o.folder,
    mapsDir: o.maps,
  });
  const lines = [];
  for (const f of files) lines.push(`${await sha256File(path.join(o.maps, f))}  ${f}`);
  mkdirSync(o.out, { recursive: true });
  writeFileSync(path.join(o.out, 'data.js'), dataJs(data));
  writeFileSync(path.join(o.out, 'manifest.sha256'), `${lines.join('\n')}\n`);
  console.log(
    `${files.length} maps, ${data.size.length} size fixes, ${data.grid.length} grid fixes -> ${o.out} (data.js, manifest.sha256)`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(e => {
    console.error(`prepare: ${e.message}`);
    process.exit(1);
  });
}
