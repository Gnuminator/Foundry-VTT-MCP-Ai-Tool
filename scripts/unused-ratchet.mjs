#!/usr/bin/env node
/**
 * Unused-code ratchet (pick R12): knip (config in `knip.json`) counts unused files, exports and
 * exported types per workspace; the count may not go up against `scripts/unused-baseline.json`.
 *
 *   node scripts/unused-ratchet.mjs            check against the baseline
 *   node scripts/unused-ratchet.mjs --update   lower the baseline to the current counts
 *
 * `--update` refuses to raise any count; `--allow-increase` together with `--update` is only for
 * a reviewed, deliberate exception. Same shape as scripts/lint-ratchet.mjs. A new file nothing
 * imports, or a new export nothing uses, fails here: delete it, use it, or add the real entry
 * point to `knip.json`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(repoRoot, 'scripts', 'unused-baseline.json');
const KINDS = ['files', 'exports', 'types'];

/** Count knip's JSON report per "<workspace>: <kind>". Workspace = first path segment(s). */
export function countReport(report) {
  // A knip release that renames these would otherwise read as "nothing unused" and pass.
  if (!Array.isArray(report?.files) || !Array.isArray(report?.issues)) {
    throw new Error('unused-ratchet: the knip report has no `files` and `issues` arrays (format changed?)');
  }
  const counts = {};
  const bump = (file, kind, n) => {
    if (n === 0) return;
    const parts = file.split('/');
    const ws = parts[0] === 'packages' ? parts.slice(0, 2).join('/') : parts[0];
    const key = `${ws}: ${kind}`;
    counts[key] = (counts[key] ?? 0) + n;
  };
  for (const file of report.files ?? []) bump(file, 'files', 1);
  for (const issue of report.issues ?? []) {
    for (const kind of KINDS) {
      if (kind !== 'files') bump(issue.file, kind, (issue[kind] ?? []).length);
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

/** Compare current counts with the baseline: which keys went up, which went down. */
export function compare(baseRules, current) {
  const increases = [];
  const decreases = [];
  for (const key of new Set([...Object.keys(baseRules), ...Object.keys(current)])) {
    const was = baseRules[key] ?? 0;
    const now = current[key] ?? 0;
    if (now > was) increases.push(`  ${key}: ${was} -> ${now} (+${now - was})`);
    else if (now < was) decreases.push(`  ${key}: ${was} -> ${now} (-${was - now})`);
  }
  return { increases, decreases };
}

const sum = counts => Object.values(counts).reduce((a, b) => a + b, 0);

function runKnip() {
  const knip = path.join(repoRoot, 'node_modules', 'knip', 'bin', 'knip.js');
  let out;
  try {
    out = execFileSync(process.execPath, [knip, '--reporter', 'json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // knip exits 1 when it finds issues; the report is still on stdout.
    out = err.stdout;
    if (!out) throw err;
  }
  return JSON.parse(out);
}

function main() {
  const update = process.argv.includes('--update');
  const allowIncrease = process.argv.includes('--allow-increase');
  const current = countReport(runKnip());
  const total = sum(current);
  const hasBaseline = existsSync(baselinePath);
  const baseline = hasBaseline ? JSON.parse(readFileSync(baselinePath, 'utf8')) : { total: 0, counts: {} };
  if (hasBaseline && (typeof baseline.counts !== 'object' || baseline.counts === null)) {
    console.error('unused-ratchet: scripts/unused-baseline.json has no `counts` object.');
    process.exit(1);
  }
  const { increases, decreases } = compare(baseline.counts ?? {}, current);

  if (update) {
    if (hasBaseline && increases.length > 0 && !allowIncrease) {
      console.error('unused-ratchet: refusing to raise the baseline:');
      console.error(increases.join('\n'));
      process.exit(1);
    }
    writeFileSync(baselinePath, `${JSON.stringify({ total, counts: current }, null, 2)}\n`);
    console.log(`unused-ratchet: baseline written (${total} unused files, exports and types).`);
    return;
  }
  if (increases.length > 0) {
    console.error(`unused-ratchet: unused code went up (baseline ${baseline.total}, now ${total}):`);
    console.error(increases.join('\n'));
    console.error('Delete or use the new code (run `npx knip` to see it), or add a real entry point to knip.json.');
    process.exit(1);
  }
  console.log(`unused-ratchet: OK, ${total} unused (baseline ${baseline.total}).`);
  if (decreases.length > 0) {
    console.log('Counts went down; lock them in with `npm run unused:ratchet -- --update`:');
    console.log(decreases.join('\n'));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
