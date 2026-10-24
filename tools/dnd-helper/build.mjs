#!/usr/bin/env node
/**
 * Build the "Foundry D&D helper" skill (I-152 step 1) for a player's own Claude account: SKILL.md
 * and the working pages from this folder plus two public player guides, as a folder and as the zip
 * claude.ai takes (Customize, Skills). Uses the zip writer of the GM coach build.
 *
 *   references/          the pages in tools/dnd-helper/pages (flows, checklists, plan-note format)
 *   references/player/   docs/player make-a-character and join (the public click-through guides)
 *
 * No book or campaign text goes in. The Claude Desktop project instructions are
 * tools/dnd-helper/project-instructions.md (paste into the project, not part of the zip).
 *
 *   node tools/dnd-helper/build.mjs              build into tools/dnd-helper/dist/
 *   node tools/dnd-helper/build.mjs --out <dir>  build somewhere else (tests)
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zip } from '../gm-coach/build.mjs';

export const SKILL_NAME = 'foundry-dnd-helper';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');

/** Public player guides copied under references/player/. */
export const PLAYER_PAGES = ['make-a-character.md', 'join.md'];

/**
 * Files of the skill: published path inside the skill folder -> content.
 * @returns {Map<string, string>}
 */
export function collectFiles() {
  const files = new Map();
  files.set('SKILL.md', readFileSync(path.join(here, 'SKILL.md'), 'utf8'));
  const pagesDir = path.join(here, 'pages');
  for (const name of readdirSync(pagesDir)
    .filter(n => n.endsWith('.md'))
    .sort()) {
    files.set(`references/${name}`, readFileSync(path.join(pagesDir, name), 'utf8'));
  }
  for (const name of PLAYER_PAGES) {
    files.set(
      `references/player/${name}`,
      readFileSync(path.join(repo, 'docs', 'player', name), 'utf8')
    );
  }
  return files;
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
    `dnd-helper: ${files.size} files, ${Math.round(bytes / 1024)} KB of text -> ${zipFile}`
  );
}
