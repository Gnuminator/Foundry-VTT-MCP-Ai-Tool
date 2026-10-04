#!/usr/bin/env node
/**
 * Changelog fragments (D-089): each lane PR adds its CHANGELOG entry as its own small file in
 * `changelog.d/` instead of editing CHANGELOG.md, so two PRs never touch the same lines and no
 * upkeep PR is needed. This script checks the fragments and folds them into "## Unreleased".
 *
 *   node scripts/changelog-fold.mjs --check     validate every fragment (CI runs this)
 *   node scripts/changelog-fold.mjs --dry-run   print the folded "Unreleased" section, write nothing
 *   node scripts/changelog-fold.mjs             fold the fragments into CHANGELOG.md, delete them
 *
 * A fragment is one or more sections, each a `### Heading` line followed by bullets (`- ...`,
 * wrapped lines indented by two spaces). A section whose heading already exists under
 * "## Unreleased" is appended to the end of that section; a new heading becomes a new section at
 * the end of "Unreleased". Fragments are folded in file-name order. `changelog.d/README.md` explains
 * the format and is never folded.
 */
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fragmentDir = path.join(repoRoot, 'changelog.d');
const changelogPath = path.join(repoRoot, 'CHANGELOG.md');
const check = process.argv.includes('--check');
const dryRun = process.argv.includes('--dry-run');

const UNRELEASED = '## Unreleased';

/** @returns {string[]} fragment file names, sorted */
function fragmentFiles() {
  return readdirSync(fragmentDir)
    .filter(name => name.endsWith('.md') && name.toLowerCase() !== 'readme.md')
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Parse one fragment into sections, or return the problems found.
 * @param {string} name
 * @param {string} text
 * @returns {{ sections: Array<{ heading: string, lines: string[] }>, errors: string[] }}
 */
function parseFragment(name, text) {
  const errors = [];
  const sections = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let current = null;
  lines.forEach((line, index) => {
    const where = `${name}:${index + 1}`;
    if (line.startsWith('### ')) {
      current = { heading: line.trimEnd(), lines: [] };
      sections.push(current);
    } else if (/^#{1,2} |^#{4,} /.test(line)) {
      errors.push(`${where}: only "### " headings belong in a fragment`);
    } else if (line.trim() === '') {
      if (current) current.lines.push('');
    } else if (!current) {
      errors.push(`${where}: text before the first "### " heading`);
    } else {
      current.lines.push(line.trimEnd());
    }
  });
  if (sections.length === 0 && errors.length === 0) errors.push(`${name}: no "### " section`);
  for (const section of sections) {
    while (section.lines.length && section.lines[0] === '') section.lines.shift();
    while (section.lines.length && section.lines.at(-1) === '') section.lines.pop();
    if (!section.lines.some(line => line.startsWith('- '))) {
      errors.push(`${name}: "${section.heading}" has no bullet ("- ...")`);
    }
  }
  return { sections, errors };
}

/**
 * Fold sections into the "Unreleased" block of the changelog.
 * @param {string} changelog
 * @param {Array<{ heading: string, lines: string[] }>} sections
 */
function fold(changelog, sections) {
  const eol = changelog.includes('\r\n') ? '\r\n' : '\n';
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const start = lines.indexOf(UNRELEASED);
  if (start < 0) throw new Error(`CHANGELOG.md has no "${UNRELEASED}" heading`);
  let end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  if (end < 0) end = lines.length;
  const block = lines.slice(start + 1, end);
  for (const section of sections) {
    const at = block.indexOf(section.heading);
    if (at >= 0) {
      let stop = block.findIndex((line, i) => i > at && line.startsWith('### '));
      if (stop < 0) stop = block.length;
      while (stop > at + 1 && block[stop - 1] === '') stop--;
      block.splice(stop, 0, ...section.lines);
    } else {
      while (block.length && block.at(-1) === '') block.pop();
      block.push('', section.heading, '', ...section.lines);
    }
  }
  while (block.length && block.at(-1) === '') block.pop();
  const result = [...lines.slice(0, start + 1), ...block, '', ...lines.slice(end)];
  return { text: result.join(eol), unreleased: [UNRELEASED, ...block].join('\n') };
}

const files = fragmentFiles();
const parsed = files.map(name =>
  parseFragment(name, readFileSync(path.join(fragmentDir, name), 'utf8'))
);
const errors = parsed.flatMap(p => p.errors);
if (errors.length) {
  console.error(`changelog-fold: ${errors.length} problem(s) in changelog.d/:`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}
if (check) {
  console.log(`changelog-fold: OK, ${files.length} fragment(s) in changelog.d/.`);
  process.exit(0);
}
if (files.length === 0) {
  console.log('changelog-fold: no fragments to fold.');
  process.exit(0);
}

const { text, unreleased } = fold(
  readFileSync(changelogPath, 'utf8'),
  parsed.flatMap(p => p.sections)
);
if (dryRun) {
  console.log(unreleased);
  process.exit(0);
}
writeFileSync(changelogPath, text);
for (const name of files) unlinkSync(path.join(fragmentDir, name));
console.log(`changelog-fold: folded ${files.length} fragment(s) into CHANGELOG.md "Unreleased".`);
