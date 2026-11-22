/**
 * The module runs in the browser as the plain ES module `dist/main.js`, where a bare specifier
 * like `@gnuminator/shared` cannot be resolved: one left in the output stops the whole module from
 * loading (found live in M2). The build bundles every import into that one file; this builds it in
 * memory and checks that no import is left over.
 */
import { fileURLToPath } from 'node:url';
import { build, type BuildOptions } from 'esbuild';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs build options without type declarations
import { moduleBuildOptions } from '../build-options.mjs';

const MODULE_DIR = fileURLToPath(new URL('..', import.meta.url));

/** Import specifiers left in bundled code (static, re-export and dynamic). */
function importSpecifiers(code: string): string[] {
  const found: string[] = [];
  for (const m of code.matchAll(
    /(?:^|[\s;}])(?:import|export)\b[^;'"`]*?\bfrom\s*["']([^"']+)["']/g
  ))
    found.push(m[1]);
  for (const m of code.matchAll(/(?:^|[\s;}])import\s*["']([^"']+)["']/g)) found.push(m[1]);
  for (const m of code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) found.push(m[1]);
  // A module specifier never holds white space; text that does is a string inside bundled code
  // (the JavaScript parser the macro forge bundles has error messages that mention "import").
  return found.filter(specifier => !/\s/.test(specifier));
}

describe('browser-loadable module build', () => {
  it('bundles main.js with no import left to resolve', async () => {
    const result = await build({
      ...(moduleBuildOptions(MODULE_DIR) as BuildOptions),
      write: false,
      sourcemap: false,
      outfile: 'main.js',
    });
    const code = result.outputFiles[0].text;
    expect(code.length).toBeGreaterThan(10_000);
    expect(importSpecifiers(code)).toEqual([]);
  }, 60_000);

  it('finds leftover imports', () => {
    expect(importSpecifiers("import { A } from '@gnuminator/shared';")).toEqual([
      '@gnuminator/shared',
    ]);
    expect(importSpecifiers("export * from './x.js';")).toEqual(['./x.js']);
    expect(importSpecifiers("const m = await import('./y.js');")).toEqual(['./y.js']);
    expect(importSpecifiers('const a = 1; // import me from home')).toEqual([]);
    expect(importSpecifiers('throw new Error("import x from "+a+", 6: ")')).toEqual([]);
  });
});
