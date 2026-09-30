#!/usr/bin/env node
/**
 * Em-dash ratchet: the project never uses em dashes (U+2014) in text it writes, so the count of
 * existing ones may only go down.
 *
 * It counts em dashes per tracked text file (from `git ls-files`), skips `docs/history/**`
 * (history is never rewritten), lockfiles and binary files, and compares each file with the
 * committed baseline (`scripts/em-dash-baseline.json`). A file whose count rises, or a new file
 * with any em dash, fails the run.
 *
 *   node scripts/em-dash-guard.mjs            check against the baseline
 *   node scripts/em-dash-guard.mjs --update   lower the baseline to the current counts
 *
 * `--update` refuses to raise any count; pass `--allow-increase` together with `--update` only for
 * a reviewed, deliberate exception.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const EM_DASH = String.fromCharCode(0x2014);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(repoRoot, 'scripts', 'em-dash-baseline.json');
const update = process.argv.includes('--update');
const allowIncrease = process.argv.includes('--allow-increase');

const EXCLUDED_PREFIXES = ['docs/history/'];
const EXCLUDED_FILES = new Set(['package-lock.json', 'scripts/em-dash-baseline.json']);
const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|ico|mp3|wav|ogg|flac|mp4|webm|mov|woff2?|ttf|otf|pdf|zip|exe)$/i;

const tracked = execFileSync('git', ['ls-files', '-z'], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
  .split('\0')
  .filter(Boolean);

/** @type {Record<string, number>} */
const current = {};
let total = 0;
for (const file of tracked) {
  if (EXCLUDED_FILES.has(file) || BINARY_EXT.test(file)) continue;
  if (EXCLUDED_PREFIXES.some(prefix => file.startsWith(prefix))) continue;
  const fullPath = path.join(repoRoot, file);
  if (!existsSync(fullPath)) continue; // deleted in the working tree
  const text = readFileSync(fullPath, 'utf8');
  if (text.includes('\0')) continue; // binary
  const count = text.split(EM_DASH).length - 1;
  if (count > 0) {
    current[file] = count;
    total += count;
  }
}
const sortedCurrent = Object.fromEntries(
  Object.entries(current).sort(([a], [b]) => a.localeCompare(b))
);

const hasBaseline = existsSync(baselinePath);
const baseline = hasBaseline
  ? JSON.parse(readFileSync(baselinePath, 'utf8'))
  : { total: 0, files: {} };
const baseFiles = baseline.files ?? {};

const increases = [];
const decreases = [];
for (const file of new Set([...Object.keys(baseFiles), ...Object.keys(sortedCurrent)])) {
  const was = baseFiles[file] ?? 0;
  const now = sortedCurrent[file] ?? 0;
  if (now > was) increases.push(`  ${file}: ${was} -> ${now} (+${now - was})`);
  else if (now < was) decreases.push(`  ${file}: ${was} -> ${now} (-${was - now})`);
}

if (update) {
  if (hasBaseline && increases.length > 0 && !allowIncrease) {
    console.error('em-dash-guard: refusing to raise the baseline:');
    console.error(increases.join('\n'));
    console.error('Replace the new em dashes, or pass --allow-increase for a reviewed exception.');
    process.exit(1);
  }
  writeFileSync(baselinePath, `${JSON.stringify({ total, files: sortedCurrent }, null, 2)}\n`);
  console.log(
    `em-dash-guard: baseline written (${total} em dashes in ${Object.keys(sortedCurrent).length} files).`
  );
  process.exit(0);
}

if (increases.length > 0) {
  console.error(`em-dash-guard: em dashes went up (baseline ${baseline.total}, now ${total}):`);
  console.error(increases.join('\n'));
  console.error(
    'Use a colon, comma, parentheses or a full stop instead. The baseline only goes down.'
  );
  process.exit(1);
}

console.log(`em-dash-guard: OK, ${total} em dashes (baseline ${baseline.total}).`);
if (decreases.length > 0) {
  console.log('Counts went down; lock them in with `npm run emdash:ratchet -- --update`:');
  console.log(decreases.join('\n'));
}
