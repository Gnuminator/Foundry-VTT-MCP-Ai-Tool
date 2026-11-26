#!/usr/bin/env node
/**
 * Rewrites docs/reference/tools.md (the index) and docs/reference/tools/<set>.md (one page per
 * set) from the tool catalog (I-081).
 *
 * The pages are rendered by packages/mcp-server/src/tool-reference.ts. The tool
 * classes are built with the test helper's stub dependencies, so this runs the
 * reference test with UPDATE_TOOL_REFERENCE=1 instead of a separate entry
 * point. CI runs the same test without the variable and fails on a stale page.
 *
 *   npm run docs:tools             rewrite the pages
 *   npm run docs:tools -- --check  exit non-zero when a page is stale; writes nothing
 *
 * TOOL_REFERENCE_DIR points both modes at another docs/reference folder (the script test).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const env = { ...process.env, CI: 'true' };
// The vitest run starts in packages/mcp-server, so a relative folder is made absolute here.
if (env.TOOL_REFERENCE_DIR) env.TOOL_REFERENCE_DIR = path.resolve(env.TOOL_REFERENCE_DIR);
if (check) delete env.UPDATE_TOOL_REFERENCE;
else env.UPDATE_TOOL_REFERENCE = '1';

const result = spawnSync('npx vitest run src/tool-reference.test.ts', {
  cwd: path.join(repoRoot, 'packages', 'mcp-server'),
  env,
  shell: true,
  stdio: 'inherit',
});
if (check && result.status !== 0)
  console.error(
    'docs:tools --check: check failed (usually a stale page). Run `npm run docs:tools`; if it fails again, read the output above.'
  );
process.exit(result.status ?? 1);
