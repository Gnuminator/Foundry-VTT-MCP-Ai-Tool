// Guards for the Pi's pruned build (#310 review, M1 and L3).
//   node --test scripts/pi/runtime-imports.test.mjs
// Stage 5 builds with every package, then runs `npm prune --omit=dev`. Anything the services import at run time
// must therefore be a `dependencies` entry of its own workspace; a devDependency that happens to be installed on
// the PC would crash the unit on the Pi after the swap. The scan itself is scripts/pi/runtime-imports.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  bareImports,
  isLocalOrBuiltin,
  packageOf,
  runtimeSpecifiers,
  sourceFiles,
  undeclaredImports,
} from './runtime-imports.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const json = rel => JSON.parse(readFileSync(path.join(repo, rel), 'utf8'));

describe('the scanner', () => {
  test('finds the imports that exist at run time and leaves out types, built-ins and relative paths', () => {
    const src = `
      import fs from 'node:fs';
      import { join } from 'path';
      import { readFile } from 'fs/promises';
      import express from 'express';
      import { z } from 'zod/v4';
      import { Sdk } from '@modelcontextprotocol/sdk/server/index.js';
      import type { WebSocket } from 'ws';
      import { type A, type B } from 'only-types';
      import { type C, value } from 'mixed';
      import './local.js';
      import 'side-effect';
      export { x } from 'reexported';
      export * from '../up.js';
      export type { T } from 'type-reexport';
      const lazy = await import('lazy-pkg');
      const old = require('old-pkg');
      const made = createRequire(import.meta.url)('created-pkg');
      const variable = require(name);
    `;
    assert.deepEqual(bareImports(src, 'file.ts'), [
      '@modelcontextprotocol/sdk',
      'created-pkg',
      'express',
      'lazy-pkg',
      'mixed',
      'old-pkg',
      'reexported',
      'side-effect',
      'zod',
    ]);
  });

  test('a workspace package importing itself is not an outside package', () => {
    assert.deepEqual(
      bareImports(`import { a } from '@gnuminator/shared/sub';`, 'a.ts', '@gnuminator/shared'),
      []
    );
  });

  test('reads plain JS and JSX the same way', () => {
    assert.deepEqual(
      runtimeSpecifiers(`const x = require('a'); import b from 'b';`, 'f.cjs').sort(),
      ['a', 'b']
    );
    assert.deepEqual(
      runtimeSpecifiers(`import c from 'c'; export const V = () => <div />;`, 'f.tsx'),
      ['c']
    );
  });

  test('packageOf and isLocalOrBuiltin', () => {
    assert.equal(packageOf('@scope/pkg/deep/file.js'), '@scope/pkg');
    assert.equal(packageOf('pkg/deep'), 'pkg');
    for (const s of ['node:test', 'fs', 'fs/promises', './a', '../b', '/abs', '#internal']) {
      assert.ok(isLocalOrBuiltin(s), s);
    }
    for (const s of ['zod', '@scope/pkg', 'marked']) assert.ok(!isLocalOrBuiltin(s), s);
  });
});

// Each entry: the workspace whose built files stage 5 starts (or stage 8 copies) on the Pi, with the folder
// the compiler reads. The dashboard's browser code (web/) is bundled by Vite before the prune and not listed.
const RUNTIME = [
  { name: 'the bridge (packages/mcp-server/dist/standalone.js)', pkg: 'packages/mcp-server' },
  {
    name: 'the co-GM dashboard server (packages/cogm-dashboard/dist/server.js)',
    pkg: 'packages/cogm-dashboard',
  },
  {
    name: 'the Discord bot (packages/discord-bot/dist/cli.js, copied by stage 8)',
    pkg: 'packages/discord-bot',
  },
  { name: 'the shared package both servers load', pkg: 'shared' },
];

describe('every package the Pi services import is a dependency of its workspace', () => {
  for (const { name, pkg } of RUNTIME) {
    test(name, () => {
      const manifest = json(`${pkg}/package.json`);
      const files = sourceFiles(path.join(repo, pkg, 'src'));
      assert.ok(files.length > 3, `no sources found under ${pkg}/src`);
      const problems = undeclaredImports(files, manifest).map(({ file, name: dep }) => {
        const kind = manifest.devDependencies?.[dep] ? 'a devDependency' : 'not declared';
        return `${path.relative(repo, file)} imports ${dep}, which is ${kind} in ${pkg}/package.json: the Pi's build drops it`;
      });
      assert.deepEqual(problems, []);
    });
  }

  test('the Pi scripts that load a package from the build only use the root dependencies', () => {
    const root = json('package.json');
    const files = ['assistant-gm.mjs', 'player-creation-settings.mjs'].map(f =>
      path.join(repo, 'scripts', 'pi', 'remote', f)
    );
    // They load playwright-core with createRequire(<tool>/package.json)('playwright-core'): the scan sees it.
    for (const f of files) {
      assert.ok(
        bareImports(readFileSync(f, 'utf8'), f).includes('playwright-core'),
        `${path.basename(f)} no longer loads playwright-core: update this test`
      );
    }
    assert.deepEqual(undeclaredImports(files, root), []);
  });
});

describe('playwright-core (#310 review, L3)', () => {
  test('one copy serves the root dependency and the dashboard tests', () => {
    // The root lists playwright-core (the Pi's Assistant GM needs it) and the dashboard's @playwright/test pulls in
    // the same package. If a bump moved only one of them, npm would nest a second copy under @playwright/test and
    // the Pi would keep the root one: bump both together so the lock keeps a single copy.
    const lock = json('package-lock.json');
    const copies = Object.keys(lock.packages).filter(k =>
      k.endsWith('node_modules/playwright-core')
    );
    assert.deepEqual(copies, ['node_modules/playwright-core']);
    const root = json('package.json');
    assert.ok(root.dependencies['playwright-core'], 'playwright-core must stay a root dependency');
    assert.ok(
      !root.devDependencies?.['playwright-core'],
      'playwright-core is a dependency, not a devDependency'
    );
    assert.equal(
      lock.packages['node_modules/playwright-core'].dev,
      undefined,
      'the lock still marks it dev-only'
    );
  });
});
