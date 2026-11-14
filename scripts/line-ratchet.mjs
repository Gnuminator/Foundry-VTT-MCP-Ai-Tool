#!/usr/bin/env node
/**
 * Line-count ratchet: source files over 1,000 lines may not grow, and no new file may cross the
 * limit. New code goes into a new file; the existing big files are split later.
 *
 * It counts lines of tracked source files (`.ts .tsx .mjs .js .cjs .css .sh .ps1`, without tests,
 * generated files and dist) and compares them with `scripts/line-baseline.json`:
 * `{ limit, files: { path: lines }, exceptions: [ { file, lines, reason, pr } ] }`.
 *
 *   node scripts/line-ratchet.mjs                         check against the baseline
 *   node scripts/line-ratchet.mjs --update                lower entries, drop files now under the limit
 *   node scripts/line-ratchet.mjs --except <file> "<why>" [--pr <n>]
 *                                                         raise one entry and record the reason
 *
 * `--update` never raises an entry and never adds a file; only `--except` does, and it leaves a
 * reviewable record in `exceptions`. Lines are counted the same on Windows and Linux (`\r` is
 * stripped, a final newline does not count as a line). The very first `--update` (no baseline
 * file yet) seeds the baseline with every file over the limit.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const LIMIT = 1000;
const SOURCE_EXT = /\.(?:ts|tsx|mjs|js|cjs|css|sh|ps1)$/;
const EXCLUDED =
  /(?:^|\/)(?:dist|node_modules|test-support|container-test)\/|\.(?:test|spec|stories|generated)\.[^/]+$/;

/** True for a tracked path the ratchet counts. */
export function isCounted(/** @type {string} */ file) {
  return SOURCE_EXT.test(file) && !EXCLUDED.test(file);
}

/**
 * The `green --quick` step: the ratchet runs when a counted source file or the baseline changed, so
 * CI's `static` group is not the first to find a grown file.
 * @param {string[]} files repo-relative changed paths
 */
export function lineRatchetQuickSteps(files) {
  const hit = files.some(f => isCounted(f) || f === 'scripts/line-baseline.json');
  return hit ? [{ name: 'line-ratchet-quick', cmd: 'npm', args: ['run', 'line:ratchet'] }] : [];
}

/** Lines of a text: split on `\n` after stripping `\r`; a trailing newline adds no line. */
export function countLines(/** @type {string} */ text) {
  if (text === '') return 0;
  const lines = text.replace(/\r/g, '').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

/**
 * Compare current counts with a baseline. Only files over the limit matter.
 * @param {Record<string, number>} counts every counted file
 * @param {{ limit?: number, files?: Record<string, number> }} baseline
 */
export function evaluate(counts, baseline) {
  const limit = baseline.limit ?? LIMIT;
  const files = baseline.files ?? {};
  /** @type {string[]} */ const failures = [];
  /** @type {string[]} */ const lowered = [];
  for (const [file, lines] of Object.entries(counts)) {
    if (lines <= limit) continue;
    const was = files[file];
    if (was === undefined) {
      failures.push(`  ${file}: ${lines} lines, over the ${limit} limit and not in the baseline`);
    } else if (lines > was) {
      failures.push(`  ${file}: ${was} -> ${lines} (+${lines - was})`);
    }
  }
  for (const [file, was] of Object.entries(files)) {
    const now = counts[file] ?? 0;
    if (now <= limit) lowered.push(`  ${file}: ${was} -> ${now} (under the limit, removed)`);
    else if (now < was) lowered.push(`  ${file}: ${was} -> ${now} (-${was - now})`);
  }
  return { failures, lowered };
}

/** The baseline after `--update`: entries only go down, files under the limit drop out. */
export function lowerBaseline(
  /** @type {Record<string, number>} */ counts,
  /** @type {{ limit?: number, files?: Record<string, number>, exceptions?: unknown[] }} */ baseline
) {
  const limit = baseline.limit ?? LIMIT;
  /** @type {Record<string, number>} */ const files = {};
  for (const [file, was] of Object.entries(baseline.files ?? {})) {
    const now = counts[file];
    if (now === undefined || now <= limit) continue;
    files[file] = Math.min(was, now);
  }
  return { limit, files: sortKeys(files), exceptions: baseline.exceptions ?? [] };
}

/** The baseline after `--except <file> "<reason>"`: sets that entry to the current count. */
export function addException(
  /** @type {Record<string, number>} */ counts,
  /** @type {{ limit?: number, files?: Record<string, number>, exceptions?: unknown[] }} */ baseline,
  /** @type {string} */ file,
  /** @type {string} */ reason,
  /** @type {string} */ pr = ''
) {
  const limit = baseline.limit ?? LIMIT;
  const lines = counts[file];
  if (lines === undefined) throw new Error(`${file} is not a counted source file`);
  if (!reason.trim()) throw new Error('an exception needs a reason');
  const files = { ...(baseline.files ?? {}) };
  if (lines <= limit)
    throw new Error(
      `${file} is ${lines} lines, at or under the ${limit} limit: no exception needed`
    );
  files[file] = lines;
  const exceptions = [...(baseline.exceptions ?? []), { file, lines, reason: reason.trim(), pr }];
  return { limit, files: sortKeys(files), exceptions };
}

function sortKeys(/** @type {Record<string, number>} */ o) {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}

function currentCounts(/** @type {string} */ repoRoot) {
  const tracked = execFileSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(isCounted);
  /** @type {Record<string, number>} */ const counts = {};
  for (const file of tracked) {
    const full = path.join(repoRoot, file);
    if (!existsSync(full)) continue; // deleted in the working tree
    counts[file] = countLines(readFileSync(full, 'utf8'));
  }
  return counts;
}

function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const baselinePath = path.join(repoRoot, 'scripts', 'line-baseline.json');
  const args = process.argv.slice(2);
  const counts = currentCounts(repoRoot);
  const baseline = existsSync(baselinePath)
    ? JSON.parse(readFileSync(baselinePath, 'utf8'))
    : { limit: LIMIT, files: {}, exceptions: [] };
  const write = (/** @type {object} */ b) =>
    writeFileSync(baselinePath, `${JSON.stringify(b, null, 2)}\n`);

  const exceptAt = args.indexOf('--except');
  if (exceptAt >= 0) {
    const file = (args[exceptAt + 1] ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
    const reason = args[exceptAt + 2] ?? '';
    const prAt = args.indexOf('--pr');
    const pr = prAt >= 0 ? (args[prAt + 1] ?? '') : '';
    try {
      if (!file || file.startsWith('--'))
        throw new Error('usage: --except <file> "<reason>" [--pr <n>]');
      if (reason.startsWith('--')) throw new Error('the reason must come right after the file');
      if (pr && !/^\d+$/.test(pr)) throw new Error('--pr takes a number');
      write(addException(counts, baseline, file, reason, pr));
    } catch (error) {
      console.error(`line-ratchet: ${error instanceof Error ? error.message : error}`);
      process.exit(2);
    }
    console.log(`line-ratchet: exception recorded for ${file} (${counts[file]} lines).`);
    return;
  }

  if (args.includes('--update')) {
    if (!existsSync(baselinePath)) {
      const files = sortKeys(
        Object.fromEntries(Object.entries(counts).filter(([, n]) => n > LIMIT))
      );
      write({ limit: LIMIT, files, exceptions: [] });
      console.log(`line-ratchet: baseline created (${Object.keys(files).length} files).`);
      return;
    }
    const next = lowerBaseline(counts, baseline);
    write(next);
    console.log(
      `line-ratchet: baseline written (${Object.keys(next.files).length} files over ${next.limit}).`
    );
    const grew = Object.entries(counts)
      .filter(([f, n]) => n > (next.files[f] ?? next.limit) && f in (baseline.files ?? {}))
      .map(([f]) => f);
    if (grew.length)
      console.log(
        `line-ratchet: --update never raises an entry; still over the baseline: ${grew.join(', ')}`
      );
    return;
  }

  const { failures, lowered } = evaluate(counts, baseline);
  if (failures.length > 0) {
    console.error('line-ratchet: source files over the limit grew or appeared:');
    console.error(failures.join('\n'));
    console.error(
      'Move the new code to a new file, or add an exception with a reason: ' +
        'node scripts/line-ratchet.mjs --except <file> "<reason>"'
    );
    process.exit(1);
  }
  console.log(
    `line-ratchet: OK, ${Object.keys(baseline.files ?? {}).length} files over ${baseline.limit ?? LIMIT} lines, none grew.`
  );
  if (lowered.length > 0) {
    console.log('Files shrank; lock it in with `npm run line:ratchet -- --update`:');
    console.log(lowered.join('\n'));
  }
}

// Fail toward running: any start whose script file has this file's name is the check itself, even if
// the path spelling differs (drive-letter case, symlink); an import from a test has another name.
const started = process.argv[1] ? path.basename(process.argv[1]).toLowerCase() : '';
if (started === path.basename(fileURLToPath(import.meta.url)).toLowerCase()) main();
