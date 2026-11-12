import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as viaPackage from '@gnuminator/shared';
import * as viaSource from '../../../shared/src/index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('@gnuminator/shared in tests', () => {
  it('resolves to this worktree shared/src (the development condition), not dist or another checkout', () => {
    // The same module instance only when the package name resolves to shared/src/index.ts.
    expect(viaPackage).toBe(viaSource);
  });

  it('every package vitest config sets sharedFromSource (so no package tests the built copy)', () => {
    const packagesDir = path.join(repoRoot, 'packages');
    const missing: string[] = [];
    for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const config = path.join(packagesDir, entry.name, 'vitest.config.ts');
      if (!existsSync(config) || !readFileSync(config, 'utf8').includes('sharedFromSource'))
        missing.push(entry.name);
    }
    expect(missing).toEqual([]);
  });

  it('shared/package.json exports a development condition that points at src', () => {
    const require = createRequire(import.meta.url);
    const pkg = require(path.join(repoRoot, 'shared', 'package.json')) as {
      exports: Record<string, Record<string, string>>;
    };
    expect(pkg.exports['.']?.development).toBe('./src/index.ts');
    expect(pkg.exports['.']?.default).toBe('./dist/index.js');
  });
});
