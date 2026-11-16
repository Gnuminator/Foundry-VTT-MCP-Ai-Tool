/** Bundles src/main.ts into dist/main.js (see build-options.mjs). Type checking is `tsc --noEmit`. */
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { moduleBuildOptions } from './build-options.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// A stale per-file tsc build from before the bundle would otherwise ship beside it.
rmSync(path.join(here, 'dist'), { recursive: true, force: true });
await build(moduleBuildOptions(here));
