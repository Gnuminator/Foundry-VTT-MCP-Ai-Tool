#!/usr/bin/env node
/**
 * Rewrites docs/reference/tools.md from the tool catalog (I-081).
 *
 * The page is rendered by packages/mcp-server/src/tool-reference.ts. The tool
 * classes are built with the test helper's stub dependencies, so this runs the
 * reference test with UPDATE_TOOL_REFERENCE=1 instead of a separate entry
 * point. CI runs the same test without the variable and fails on a stale page.
 *
 *   npm run docs:tools
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const result = spawnSync('npx vitest run src/tool-reference.test.ts', {
  cwd: path.join(repoRoot, 'packages', 'mcp-server'),
  env: { ...process.env, UPDATE_TOOL_REFERENCE: '1', CI: 'true' },
  shell: true,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
