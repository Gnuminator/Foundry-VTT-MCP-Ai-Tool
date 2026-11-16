// Runs the module bundle in esbuild watch mode for sync-module.ps1 -Watch and exits as soon as that
// pwsh is gone, so a hard kill of the watch (TaskStop, a closed window) never leaves a build
// behind that keeps rewriting dist/.
//
//   node module-watch-child.mjs <parent pid> <module folder>
//
// A save that does not bundle (a syntax error, a missing import) writes nothing and esbuild prints
// the error; type errors are not checked here (`npm run typecheck` and CI do that).
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { context } from 'esbuild';

const [parentPid, moduleDir] = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const { moduleBuildOptions } = await import(
  pathToFileURL(path.join(here, '..', '..', 'packages', 'foundry-module', 'build-options.mjs')).href
);

setInterval(() => {
  try {
    process.kill(Number(parentPid), 0);
  } catch (err) {
    if (err.code === 'ESRCH') process.exit(0);
  }
}, 1000);

const ctx = await context({ ...moduleBuildOptions(path.resolve(moduleDir)), logLevel: 'info' });
await ctx.watch();
console.log('watching the module sources');
