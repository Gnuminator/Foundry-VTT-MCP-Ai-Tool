#!/usr/bin/env node
/**
 * Build the "Foundry D&D helper" skill (I-152 step 1) for a player's own Claude account: SKILL.md
 * and the working pages from this folder plus two public player guides, as a folder and as the zip
 * claude.ai takes (Customize, Skills). Uses the zip writer of the GM coach build.
 *
 *   references/          the pages in tools/dnd-helper/pages (flows, checklists, plan-note format)
 *   references/player/   docs/player make-a-character and join (the public click-through guides)
 *
 * No Foundry rules markup or campaign text goes in, and the pages are capped in size. The Claude
 * Desktop project instructions for the GM edition are tools/dnd-helper/project-instructions.md
 * (paste into the project, not part of the zip); the player edition has none.
 *
 *   node tools/dnd-helper/build.mjs              build into tools/dnd-helper/dist/
 *   node tools/dnd-helper/build.mjs --out <dir>  build somewhere else (tests)
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zip } from '../gm-coach/build.mjs';

export const SKILL_NAME = 'foundry-dnd-helper';
export const PLAYER_SKILL_NAME = 'foundry-dnd-helper-player';

/** The tools of the read-only `player` set: the only tools the player edition may name. */
export const PLAYER_TOOLS = [
  'get-my-character',
  'get-my-level-up-options',
  'search-books',
  'find-book-entries',
  'get-book-entry',
];

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
    // The screenshots are not in the skill: drop the image lines so no link is left dangling.
    const text = readFileSync(path.join(repo, 'docs', 'player', name), 'utf8');
    files.set(
      `references/player/${name}`,
      text.replace(/^[ \t]*!\[[^\]]*\]\([^)]*\)[ \t]*\r?\n\r?\n?/gm, '')
    );
  }
  return files;
}

/**
 * Replace each [from, to] pair in `text`; throws when a pair no longer matches, so a change to the
 * GM page cannot silently leave a GM tool name in the player edition.
 * @param {string} text
 * @param {Array<[string, string]>} pairs
 * @param {string} label
 */
function swap(text, pairs, label) {
  let out = text;
  for (const [from, to] of pairs) {
    if (!out.includes(from)) throw new Error(`player edition: "${from}" not found in ${label}`);
    out = out.split(from).join(to);
  }
  return out;
}

/**
 * Files of the player edition: the same flows with the tool names of the `player` set. Level-up and
 * rules question are written for it (tools/dnd-helper/player/pages); creation and sheet check are
 * the GM pages with their tool names swapped; the plan note and the public guides are shared.
 * @returns {Map<string, string>}
 */
export function collectPlayerFiles() {
  const files = collectFiles();
  const read = f => readFileSync(path.join(here, 'player', f), 'utf8');
  files.set('SKILL.md', read('SKILL.md'));
  files.set('references/level-up.md', read('pages/level-up.md'));
  files.set('references/rules-question.md', read('pages/rules-question.md'));
  files.set(
    'references/character-creation.md',
    swap(
      files.get('references/character-creation.md'),
      [
        ['## 2. Look up options (connector, core set)', '## 2. Look up options (player connector)'],
        [
          '1. `list-compendium-packs` once to see which books are installed. The Actor Studio lists are\n   usually limited by the GM to the 2024 PHB module, so offer only choices that exist there.\n2. For each candidate class, species and background, `search-compendium` the exact name, then\n   `get-compendium-item` for the entry.',
          '1. The Actor Studio lists are usually limited by the GM to the 2024 PHB module, so offer only\n   choices that exist there.\n2. For each candidate class, species and background, `find-book-entries` the exact name, then\n   `get-book-entry` for the entry.',
        ],
        ['look it up with\n   `search-compendium`;', 'look it up with\n   `find-book-entries`;'],
        ['with `get-character`,', 'with `get-my-character`,'],
      ],
      'character-creation'
    )
  );
  files.set(
    'references/sheet-check.md',
    swap(
      files.get('references/sheet-check.md'),
      [
        [
          '1. `list-characters` to find the actor (ask which one if several), then `get-character`.',
          '1. `get-my-character` (ask which character if the player has several).',
        ],
        [
          '3. For one feature or spell in doubt, `get-character-entity` or `search-character-items`.',
          '3. For one feature or spell in doubt, find it under spells, features or inventory in the `get-my-character` result. If it is not listed there, say the tool does not show it and ask the player to open that item on the sheet.',
        ],
        ['`get-compendium-item`', '`find-book-entries` and `get-book-entry`'],
      ],
      'sheet-check'
    )
  );
  return files;
}

/** Write one skill (folder and zip) under `outDir`. */
function write(outDir, skillName, files) {
  const folder = path.join(outDir, skillName);
  rmSync(folder, { recursive: true, force: true });
  for (const [name, text] of files) {
    const target = path.join(folder, ...name.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  const zipFile = path.join(outDir, `${skillName}.zip`);
  const entries = [...files].map(([name, text]) => ({
    name: `${skillName}/${name}`,
    data: Buffer.from(text, 'utf8'),
  }));
  writeFileSync(zipFile, zip(entries));
  return { folder, zipFile, files };
}

/**
 * Build the skill folder and zip into `outDir`.
 * @param {string} outDir
 * @returns {{folder: string, zipFile: string, files: Map<string, string>}}
 */
export function build(outDir) {
  return write(outDir, SKILL_NAME, collectFiles());
}

/** Build the player edition (folder and zip) into `outDir`. */
export function buildPlayer(outDir) {
  return write(outDir, PLAYER_SKILL_NAME, collectPlayerFiles());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  const outDir = i > -1 ? path.resolve(process.argv[i + 1]) : path.join(here, 'dist');
  for (const { zipFile, files } of [build(outDir), buildPlayer(outDir)]) {
    const bytes = [...files.values()].reduce((n, t) => n + Buffer.byteLength(t), 0);
    console.log(
      `dnd-helper: ${files.size} files, ${Math.round(bytes / 1024)} KB of text -> ${zipFile}`
    );
  }
}
