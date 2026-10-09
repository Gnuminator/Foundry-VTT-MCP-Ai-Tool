#!/usr/bin/env node
/**
 * Lint ratchet: ESLint errors fail, and warnings may only go down.
 *
 * CI used to run `eslint --quiet`, which hides warnings, so nothing stopped the
 * warning count from growing. This script lints the repo exactly like
 * `npm run lint` (`eslint .`, flat config in `eslint.config.mjs`), fails on any error, and compares
 * the warning count per rule with the committed baseline
 * (`scripts/lint-baseline.json`). A rule whose count rises (or a rule that is
 * new to the baseline) fails the run.
 *
 *   node scripts/lint-ratchet.mjs            check against the baseline
 *   node scripts/lint-ratchet.mjs --update   lower the baseline to the current counts
 *
 * `--update` refuses to raise any count; pass `--allow-increase` together with
 * `--update` only for a reviewed, deliberate exception.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { ESLint } = require('eslint');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(repoRoot, 'scripts', 'lint-baseline.json');
const update = process.argv.includes('--update');
const allowIncrease = process.argv.includes('--allow-increase');

const eslint = new ESLint({ cwd: repoRoot });
const results = await eslint.lintFiles(['.']);

const errorResults = ESLint.getErrorResults(results);
if (errorResults.length > 0) {
  const formatter = await eslint.loadFormatter('stylish');
  console.error(await formatter.format(errorResults));
  console.error('lint-ratchet: ESLint errors found (see above).');
  process.exit(1);
}

/** @type {Record<string, number>} */
const current = {};
let total = 0;
for (const result of results) {
  for (const message of result.messages) {
    if (message.severity !== 1) continue;
    const rule = message.ruleId ?? '(no rule)';
    current[rule] = (current[rule] ?? 0) + 1;
    total++;
  }
}
const sortedCurrent = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));

const hasBaseline = existsSync(baselinePath);
const baseline = hasBaseline
  ? JSON.parse(readFileSync(baselinePath, 'utf8'))
  : { total: 0, rules: {} };
const baseRules = baseline.rules ?? {};

const increases = [];
const decreases = [];
for (const rule of new Set([...Object.keys(baseRules), ...Object.keys(sortedCurrent)])) {
  const was = baseRules[rule] ?? 0;
  const now = sortedCurrent[rule] ?? 0;
  if (now > was) increases.push(`  ${rule}: ${was} -> ${now} (+${now - was})`);
  else if (now < was) decreases.push(`  ${rule}: ${was} -> ${now} (-${was - now})`);
}

if (update) {
  if (hasBaseline && increases.length > 0 && !allowIncrease) {
    console.error('lint-ratchet: refusing to raise the baseline:');
    console.error(increases.join('\n'));
    console.error('Fix the new warnings, or pass --allow-increase for a reviewed exception.');
    process.exit(1);
  }
  writeFileSync(baselinePath, `${JSON.stringify({ total, rules: sortedCurrent }, null, 2)}\n`);
  console.log(`lint-ratchet: baseline written (${total} warnings).`);
  process.exit(0);
}

if (increases.length > 0) {
  console.error(`lint-ratchet: warnings went up (baseline ${baseline.total}, now ${total}):`);
  console.error(increases.join('\n'));
  console.error('Fix the new warnings. The baseline only goes down (npm run lint:ratchet -- --update).');
  process.exit(1);
}

console.log(`lint-ratchet: OK, 0 errors, ${total} warnings (baseline ${baseline.total}).`);
if (decreases.length > 0) {
  console.log('Counts went down; lock them in with `npm run lint:ratchet -- --update`:');
  console.log(decreases.join('\n'));
}
