#!/usr/bin/env node
/**
 * Build the "Foundry prep ritual" skill: one self-contained SKILL.md (no reference pages), as a
 * folder and a zip like the GM coach's. It reads and plans through existing prep tools only; the
 * test (build.test.mjs) fails when a tool it names is renamed.
 *
 *   node tools/prep-ritual/build.mjs              build into tools/prep-ritual/dist/
 *   node tools/prep-ritual/build.mjs --out <dir>  build somewhere else
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { write } from '../gm-coach/build.mjs';

export const SKILL_NAME = 'foundry-prep-ritual';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @returns {Map<string, string>} */
export function collectFiles() {
  return new Map([['SKILL.md', readFileSync(path.join(here, 'SKILL.md'), 'utf8')]]);
}

/** @param {string} outDir */
export function build(outDir) {
  return write(outDir, SKILL_NAME, collectFiles());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  const outDir = i > -1 ? path.resolve(process.argv[i + 1]) : path.join(here, 'dist');
  const { zipFile, files } = build(outDir);
  console.log(`prep-ritual: ${files.size} file -> ${zipFile}`);
}
