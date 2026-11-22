#!/usr/bin/env node
// @ts-check
/**
 * Test typecheck ratchet. The package builds exclude test files, so a test that drifts from the
 * code it tests would never show in `npm run typecheck`. Each workspace has a `tsconfig.test.json`
 * (its sources plus its tests, no emit); this script runs it and counts the errors per workspace
 * and per TS code against `scripts/typecheck-tests-baseline.json`. A count that rises, or a code
 * that is new to a workspace, fails. The real mismatches (TS2339, TS2304, TS2345, TS2322, TS2769)
 * are held at 0 in every workspace; the rest (mostly TS18046 from mocked `unknown` values) can
 * only go down.
 *
 *   node scripts/typecheck-tests-ratchet.mjs            check against the baseline
 *   node scripts/typecheck-tests-ratchet.mjs --verbose  also print every compiler error
 *   node scripts/typecheck-tests-ratchet.mjs --update  lower the baseline (never raises it)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(repoRoot, 'scripts', 'typecheck-tests-baseline.json');

export const WORKSPACES = [
  'shared',
  'packages/mcp-server',
  'packages/foundry-module',
  'packages/cogm-dashboard',
  'packages/discord-bot',
  'packages/obsidian-plugin',
];
export const STRICT_CODES = ['TS2339', 'TS2304', 'TS2345', 'TS2322', 'TS2769'];

/**
 * @param {string} output compiler output
 * @returns {Record<string, number>} errors per TS code
 */
export function countByCode(output) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const m of output.matchAll(/error (TS\d+):/g)) {
    const code = /** @type {string} */ (m[1]);
    counts[code] = (counts[code] ?? 0) + 1;
  }
  return counts;
}

/**
 * @param {Record<string, Record<string, number>>} current per workspace, per code
 * @param {Record<string, Record<string, number>>} baseline
 * @returns {string[]} one line per rise
 */
export function evaluate(current, baseline) {
  /** @type {string[]} */
  const problems = [];
  for (const [ws, codes] of Object.entries(current)) {
    for (const [code, n] of Object.entries(codes)) {
      const allowed = baseline[ws]?.[code] ?? 0;
      if (n > allowed) problems.push(`${ws}: ${code} ${allowed} -> ${n}`);
    }
  }
  return problems;
}

/** @param {string} ws */
function run(ws) {
  const args = [
    path.join(repoRoot, 'scripts', 'tsc7.mjs'),
    '-p',
    'tsconfig.test.json',
    '--noEmit',
    '--pretty',
    'false',
  ];
  if (ws !== 'shared') args.push('--customConditions', 'development');
  if (ws === 'packages/foundry-module') args.push('--types', 'jquery,node');
  const r = spawnSync(process.execPath, args, {
    cwd: path.join(repoRoot, ws),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
}

function main() {
  const update = process.argv.includes('--update');
  /** @type {Record<string, Record<string, number>>} */
  const current = {};
  for (const ws of WORKSPACES) {
    const out = run(ws);
    if (process.argv.includes('--verbose')) process.stdout.write(out);
    current[ws] = countByCode(out);
    if (Object.keys(current[ws] ?? {}).length === 0 && /error/i.test(out)) {
      console.error(out);
      console.error(`typecheck-tests: ${ws} failed without a TS error code (see above).`);
      process.exit(1);
    }
  }
  /** @type {Record<string, Record<string, number>>} */
  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : {};
  const total = Object.values(current).reduce(
    (a, c) => a + Object.values(c).reduce((x, y) => x + y, 0),
    0
  );

  if (update) {
    /** @type {Record<string, Record<string, number>>} */
    const next = {};
    for (const [ws, codes] of Object.entries(current)) {
      for (const [code, n] of Object.entries(codes)) {
        const old = baseline[ws]?.[code];
        if (old !== undefined && n > old) {
          console.error(`typecheck-tests: refusing to raise ${ws} ${code} ${old} -> ${n}`);
          process.exit(1);
        }
        (next[ws] ??= {})[code] = n;
      }
    }
    writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`typecheck-tests: baseline written (${total} errors).`);
    return;
  }

  const problems = evaluate(current, baseline);
  for (const ws of WORKSPACES) {
    for (const code of STRICT_CODES) {
      const n = current[ws]?.[code] ?? 0;
      if (n > 0 && !problems.some(p => p.startsWith(`${ws}: ${code} `)))
        problems.push(`${ws}: ${code} ${n} (real mismatch, must be 0)`);
    }
  }
  if (problems.length > 0) {
    console.error(`typecheck-tests: test typecheck errors rose:\n  ${problems.join('\n  ')}`);
    console.error(
      'Run `node scripts/typecheck-tests-ratchet.mjs --verbose` for the list; fix the test or the code.'
    );
    process.exit(1);
  }
  console.log(`typecheck-tests: OK (${total} errors, none above the baseline).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
