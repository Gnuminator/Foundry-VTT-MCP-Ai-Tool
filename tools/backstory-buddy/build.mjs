#!/usr/bin/env node
/**
 * Build the "Foundry backstory buddy" skill (I-182): a full, self-contained skill zip that installs
 * next to the player D&D helper. SKILL.md and pages from this folder only; no campaign text.
 *
 *   node tools/backstory-buddy/build.mjs              build into tools/backstory-buddy/dist/
 *   node tools/backstory-buddy/build.mjs --out <dir>  build somewhere else (tests)
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { write } from '../gm-coach/build.mjs';

export const SKILL_NAME = 'foundry-backstory-buddy';
/** The only tools the skill may name (a subset of the player set). */
export const BUDDY_TOOLS = [
  'get-my-character',
  'get-my-handouts',
  'find-book-entries',
  'get-book-entry',
];

const here = path.dirname(fileURLToPath(import.meta.url));

/** @returns {Map<string, string>} published path inside the skill folder -> content */
export function collectFiles() {
  const files = new Map();
  files.set('SKILL.md', readFileSync(path.join(here, 'SKILL.md'), 'utf8'));
  const pagesDir = path.join(here, 'pages');
  for (const name of readdirSync(pagesDir)
    .filter(n => n.endsWith('.md'))
    .sort()) {
    files.set(`references/${name}`, readFileSync(path.join(pagesDir, name), 'utf8'));
  }
  return files;
}

/** Build the skill folder and zip into `outDir`. */
export function build(outDir) {
  return write(outDir, SKILL_NAME, collectFiles());
}

/**
 * Terms in `text` that a player must not see, compared case-insensitively.
 * @param {string} text
 * @param {readonly string[]} terms
 */
export function findDeniedTerms(text, terms) {
  const lower = text.toLowerCase();
  return terms.filter(t => lower.includes(t.toLowerCase()));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  const outDir = i > -1 ? path.resolve(process.argv[i + 1]) : path.join(here, 'dist');
  const { zipFile, files } = build(outDir);
  console.log(`backstory-buddy: ${files.size} files -> ${zipFile}`);
}
