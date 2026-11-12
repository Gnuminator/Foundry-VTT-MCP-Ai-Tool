#!/usr/bin/env node
/**
 * Mutation ratchet for the safety core (guarded writes): runs Stryker with
 * `stryker.core.config.mjs` and fails when the score is below the committed baseline
 * (`scripts/mutation-baseline.json`).
 *
 *   node scripts/mutation-ratchet.mjs                  run Stryker, check against the baseline
 *   node scripts/mutation-ratchet.mjs --update         run, then raise the baseline to the new score
 *   node scripts/mutation-ratchet.mjs --report-only    skip the run, read reports/mutation/mutation.json
 *
 * `--update` only raises the floor and refuses to lower it. The score is Stryker's total score:
 * (killed + timeout) / (killed + timeout + survived + no coverage); ignored mutants and compile
 * errors are left out. A drop of up to TOLERANCE points is run-to-run noise (timeouts).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE_PATH = path.join(repoRoot, 'scripts', 'mutation-baseline.json');
export const REPORT_PATH = path.join(repoRoot, 'reports', 'mutation', 'mutation.json');
export const TOLERANCE = 0.5;

const DETECTED = new Set(['Killed', 'Timeout']);
const UNDETECTED = new Set(['Survived', 'NoCoverage']);

/** Score (percent, 2 decimals) and counts from a Stryker mutation-testing-elements report. */
export function scoreOf(report) {
  let detected = 0;
  let undetected = 0;
  for (const file of Object.values(report.files ?? {})) {
    for (const mutant of file.mutants ?? []) {
      if (DETECTED.has(mutant.status)) detected++;
      else if (UNDETECTED.has(mutant.status)) undetected++;
    }
  }
  const total = detected + undetected;
  if (total === 0) throw new Error('The Stryker report holds no mutants');
  return { score: Math.round((detected / total) * 10000) / 100, detected, undetected };
}

/** What to do with `current` against `baseline` (null: none yet). */
export function decide(current, baseline, update) {
  if (baseline === null) {
    return update
      ? { ok: true, write: true, message: `baseline created at ${current}%` }
      : { ok: false, write: false, message: 'no baseline yet: run with --update to create it' };
  }
  if (current < baseline - TOLERANCE) {
    return {
      ok: false,
      write: false,
      message: `score ${current}% dropped below the baseline ${baseline}% (tolerance ${TOLERANCE})`,
    };
  }
  if (update && current > baseline) {
    return { ok: true, write: true, message: `baseline raised from ${baseline}% to ${current}%` };
  }
  if (update && current < baseline) {
    return {
      ok: true,
      write: false,
      message: `--update never lowers: baseline stays ${baseline}%`,
    };
  }
  return { ok: true, write: false, message: `score ${current}% holds the baseline ${baseline}%` };
}

/** A baseline file's score, or null when the file is missing or holds no numeric score. */
export function baselineScore(baseline) {
  return typeof baseline?.score === 'number' && Number.isFinite(baseline.score)
    ? baseline.score
    : null;
}

/**
 * A mutant count far from the baseline's means the run measured something else (a `mutate` entry
 * matching nothing, many mutants turned into errors): the score alone would hide that.
 */
export const COUNT_TOLERANCE = 0.1;
export function countDrift(mutants, baselineMutants) {
  if (typeof baselineMutants !== 'number' || baselineMutants <= 0) return null;
  const change = Math.abs(mutants - baselineMutants) / baselineMutants;
  return change > COUNT_TOLERANCE
    ? `${mutants} mutants against ${baselineMutants} in the baseline (more than ${COUNT_TOLERANCE * 100}% apart); check the mutate list, then run with --update`
    : null;
}

function dirtySource() {
  const status = spawnSync('git', ['status', '--porcelain', '--', 'packages', 'shared'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return status.status === 0 ? status.stdout.trim() : 'git status failed';
}

async function main() {
  const args = process.argv.slice(2);
  const update = args.includes('--update');
  if (!args.includes('--report-only')) {
    const { default: config } = await import(
      pathToFileURL(path.join(repoRoot, 'stryker.core.config.mjs')).href
    );
    const missing = config.mutate.filter(file => !existsSync(path.join(repoRoot, file)));
    if (missing.length > 0) {
      console.error(`mutation-ratchet: mutate entries match no file: ${missing.join(', ')}`);
      process.exit(1);
    }
    // In-place mode rewrites the mutated files and puts them back; a dirty tree would lose edits.
    const dirty = dirtySource();
    if (dirty) {
      console.error(`mutation-ratchet: commit or discard your changes first:\n${dirty}`);
      process.exit(1);
    }
    // shared/src/usage-catalog.generated.ts is gitignored and shared/src/index.ts imports it.
    const catalog = spawnSync(process.execPath, ['scripts/usage-catalog.mjs'], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
    if (catalog.status !== 0) {
      console.error('mutation-ratchet: the usage catalogue could not be generated');
      process.exit(1);
    }
    const run = spawnSync('npx', ['stryker', 'run', 'stryker.core.config.mjs'], {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (run.status !== 0) {
      console.error(`mutation-ratchet: Stryker exited with ${run.status}`);
      process.exit(1);
    }
    const left = dirtySource();
    if (left) {
      console.error(`mutation-ratchet: Stryker left changes in the source:\n${left}`);
      process.exit(1);
    }
  }
  if (!existsSync(REPORT_PATH)) {
    console.error(`mutation-ratchet: no report at ${REPORT_PATH}`);
    process.exit(1);
  }
  const { score, detected, undetected } = scoreOf(JSON.parse(readFileSync(REPORT_PATH, 'utf8')));
  const stored = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : null;
  const baseline = baselineScore(stored);
  const drift =
    baseline === null || update ? null : countDrift(detected + undetected, stored.mutants);
  if (drift) {
    console.error(`mutation-ratchet: ${drift}`);
    process.exit(1);
  }
  const result = decide(score, baseline, update);
  if (result.write) {
    writeFileSync(
      BASELINE_PATH,
      `${JSON.stringify({ score, mutants: detected + undetected }, null, 2)}\n`
    );
  }
  const line = `mutation-ratchet: ${result.message} (${detected} detected, ${undetected} not)`;
  if (result.ok) console.log(line);
  else {
    console.error(line);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
