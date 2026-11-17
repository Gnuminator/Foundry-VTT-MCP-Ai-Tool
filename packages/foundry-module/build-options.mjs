/**
 * esbuild options for the module bundle. Foundry loads `dist/main.js` as a plain ES module in the
 * browser, where a bare specifier such as `@gnuminator/shared` cannot be resolved, so the build
 * bundles every import (and the lazy `import('./x.js')` calls) into that one file. The watch
 * script of `sync-module.ps1 -Watch` and the browser-imports test reuse these options.
 */
import path from 'node:path';

/** @param {string} moduleDir the folder holding src/ (packages/foundry-module). */
export function moduleBuildOptions(moduleDir) {
  return {
    entryPoints: [path.join(moduleDir, 'src', 'main.ts')],
    outfile: path.join(moduleDir, 'dist', 'main.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    sourcemap: true,
    legalComments: 'none',
    logLevel: 'warning',
  };
}
