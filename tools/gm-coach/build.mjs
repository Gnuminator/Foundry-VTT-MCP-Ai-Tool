#!/usr/bin/env node
/**
 * Build the "Foundry GM coach" skill for the GM's own Claude account (D-097): SKILL.md from this
 * folder plus reference pages, as a folder and as the zip claude.ai takes (Customize, Skills).
 *
 *   references/foundry/  the Foundry 14 / dnd5e 6 UI pages of .claude/skills/foundry-core-ui,
 *                        without the parts that only serve automation and our test server
 *   references/gm/       docs/gm (the GM guides, the same pages as the dashboard help)
 *   references/player/   docs/player (so the coach can help players too)
 *
 * No campaign or book text goes in: only those three sources, all in the public repo.
 *
 *   node tools/gm-coach/build.mjs              build into tools/gm-coach/dist/
 *   node tools/gm-coach/build.mjs --out <dir>  build somewhere else (tests, the docs site)
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

export const SKILL_NAME = 'foundry-gm-coach';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');

/** Where each reference folder comes from. */
export const SOURCES = [
  { from: '.claude/skills/foundry-core-ui/reference', to: 'references/foundry', clean: true },
  { from: 'docs/gm', to: 'references/gm', clean: false },
  { from: 'docs/player', to: 'references/player', clean: false },
];

/** Sections of the Foundry pages that only serve automation, our test server or the page's author. */
export const DROPPED_SECTIONS = [
  'Driving it from automation',
  'Safety in the test world',
  'Verification checklist',
  'Sources',
];

/**
 * A Foundry reference page without the dropped `## ` sections and without "Source:" / "Sources:"
 * paragraphs (local file paths of the code the page was read from).
 * @param {string} text
 */
export function cleanReferencePage(text) {
  const out = [];
  let skipping = false;
  let inSources = false;
  for (const line of text.split(/\r?\n/)) {
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) {
      skipping = DROPPED_SECTIONS.some(name => heading[1].trim().startsWith(name));
      inSources = false;
    }
    if (skipping) continue;
    if (/^(- )?Sources?:/.test(line)) {
      inSources = true;
      continue;
    }
    if (inSources) {
      // A Sources paragraph runs to the next blank line, heading or bullet.
      if (line.trim() === '' || /^(#|- )/.test(line)) inSources = false;
      else continue;
    }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * The front matter of SKILL.md: `name` and `description`.
 * @param {string} text
 */
export function frontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const fields = Object.fromEntries(
    m[1]
      .split(/\r?\n/)
      .map(line => /^(\w+):\s*(.*)$/.exec(line))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.trim()])
  );
  return { name: fields.name, description: fields.description };
}

/**
 * Files of the skill: published path inside the skill folder -> content.
 * @returns {Map<string, string>}
 */
export function collectFiles() {
  const files = new Map();
  files.set('SKILL.md', readFileSync(path.join(here, 'SKILL.md'), 'utf8'));
  for (const source of SOURCES) {
    const dir = path.join(repo, source.from);
    for (const name of readdirSync(dir)
      .filter(n => n.endsWith('.md'))
      .sort()) {
      const text = readFileSync(path.join(dir, name), 'utf8');
      files.set(`${source.to}/${name}`, source.clean ? cleanReferencePage(text) : text);
    }
  }
  return files;
}

/** DOS date and time for the zip entries: a fixed date, so a build is the same byte for byte. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/**
 * A zip (deflate) of the given entries; names use forward slashes.
 * @param {Array<{name: string, data: Buffer}>} entries
 */
export function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const packed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + packed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/**
 * Build the skill folder and zip into `outDir`.
 * @param {string} outDir
 * @returns {{folder: string, zipFile: string, files: Map<string, string>}}
 */
export function build(outDir) {
  const files = collectFiles();
  const folder = path.join(outDir, SKILL_NAME);
  rmSync(folder, { recursive: true, force: true });
  for (const [name, text] of files) {
    const target = path.join(folder, ...name.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  const zipFile = path.join(outDir, `${SKILL_NAME}.zip`);
  const entries = [...files].map(([name, text]) => ({
    name: `${SKILL_NAME}/${name}`,
    data: Buffer.from(text, 'utf8'),
  }));
  writeFileSync(zipFile, zip(entries));
  return { folder, zipFile, files };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  const outDir = i > -1 ? path.resolve(process.argv[i + 1]) : path.join(here, 'dist');
  const { zipFile, files } = build(outDir);
  const bytes = [...files.values()].reduce((n, t) => n + Buffer.byteLength(t), 0);
  console.log(
    `gm-coach: ${files.size} files, ${Math.round(bytes / 1024)} KB of text -> ${zipFile}`
  );
}
