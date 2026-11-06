#!/usr/bin/env node
// Runs the TypeScript 7 compiler (the `typescript7` npm alias) with the given arguments in the
// current directory. typescript-eslint stays on the `typescript` 6.x package until it supports 7.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
let tsc;
try {
  tsc = join(dirname(require.resolve('typescript7/package.json')), 'bin', 'tsc');
} catch {
  console.error('tsc7: the typescript7 package is not installed here; run npm ci at the repo root.');
  process.exit(1);
}
const r = spawnSync(process.execPath, [tsc, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
