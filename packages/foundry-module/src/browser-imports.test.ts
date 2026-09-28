/**
 * The module's build runs in the browser as plain ES modules, where a bare
 * specifier like `@gnuminator/shared` cannot be resolved: one runtime import
 * of it stops the whole module from loading (found live in M2). Type-only
 * imports are fine, TypeScript drops them. Values the module needs from the
 * shared contract are mirrored locally and pinned by a contract test.
 */
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('.', import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'test-support') out.push(...sourceFiles(path));
    } else if (/\.ts$/.test(entry.name) && !/\.(test|spec)\.ts$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

/** Every import/export statement (or dynamic import) that names a bare `@gnuminator/*` package. */
function runtimePackageImports(code: string): string[] {
  const statements = code.match(/^\s*(?:import|export)\b[^;]*?['"]@gnuminator\/[^'"]+['"]/gm) ?? [];
  const dynamic = code.match(/\bimport\(\s*['"]@gnuminator\/[^'"]+['"]\s*\)/g) ?? [];
  return [
    ...statements.map(s => s.trim()).filter(s => !/^(?:import|export)\s+type\b/.test(s)),
    ...dynamic,
  ];
}

describe('browser-loadable module build', () => {
  it('finds the module sources', () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(20);
  });

  it('has no runtime import of a workspace package', () => {
    const offenders = sourceFiles(SRC).flatMap(file =>
      runtimePackageImports(readFileSync(file, 'utf8')).map(
        statement => `${relative(SRC, file)}: ${statement.replace(/\s+/g, ' ')}`
      )
    );
    expect(offenders).toEqual([]);
  });

  it('flags value imports and allows type-only ones', () => {
    expect(runtimePackageImports("import { A } from '@gnuminator/shared';")).toHaveLength(1);
    expect(
      runtimePackageImports("import {\n  type A,\n  B,\n} from '@gnuminator/shared';")
    ).toHaveLength(1);
    expect(runtimePackageImports("export { A } from '@gnuminator/shared';")).toHaveLength(1);
    expect(runtimePackageImports("const m = await import('@gnuminator/shared');")).toHaveLength(1);
    expect(runtimePackageImports("import type { A } from '@gnuminator/shared';")).toEqual([]);
    expect(
      runtimePackageImports("import type {\n  A,\n  B,\n} from '@gnuminator/shared';")
    ).toEqual([]);
    expect(runtimePackageImports('// see @gnuminator/shared WEBRTC_LIMITS')).toEqual([]);
  });
});
