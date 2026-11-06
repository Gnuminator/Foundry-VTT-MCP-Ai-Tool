#!/usr/bin/env node
// Runs the TypeScript 7 compiler (the `typescript7` npm alias) with the given arguments in the
// current directory. typescript-eslint stays on the `typescript` 6.x package until it supports 7.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const tsc = join(dirname(require.resolve('typescript7/package.json')), 'bin', 'tsc');
const r = spawnSync(process.execPath, [tsc, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
