#!/usr/bin/env node
/**
 * Fails when `@gnuminator/shared` resolves to a folder outside this checkout.
 *
 * A worktree without its own `npm ci` can find `node_modules/@gnuminator/shared` further up (the main
 * checkout's, a symlink to the main checkout's `shared/`), so typecheck and tests would silently read
 * another checkout's code. The check resolves the package the way a package in this repo would and
 * compares the real path with this checkout's `shared/`.
 *
 *   node scripts/check-shared-link.mjs        exit 1 with "run npm ci in this worktree" on a mismatch
 */
import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The `green --quick` steps for a change that touches shared or a package: the link check first
 * (typecheck and tests read shared/src through node_modules, so a worktree without its own `npm ci`
 * would read another checkout's copy), then the shared build.
 */
export const SHARED_STEPS = [
  { name: 'shared-link', cmd: 'node', args: ['scripts/check-shared-link.mjs'] },
  { name: 'build-shared', cmd: 'npm', args: ['run', 'build:shared'] },
];

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {string} root the checkout to check
 * @returns {{ ok: boolean; message: string }}
 */
export function checkSharedLink(root = defaultRoot) {
  const expected = realpathSync(path.join(root, 'shared'));
  let resolved;
  try {
    const require = createRequire(path.join(root, 'package.json'));
    resolved = path.dirname(realpathSync(require.resolve('@gnuminator/shared/package.json')));
  } catch {
    return {
      ok: false,
      message:
        '@gnuminator/shared does not resolve from this checkout: run npm ci in this worktree',
    };
  }
  if (path.relative(expected, resolved) !== '') {
    return {
      ok: false,
      message: `@gnuminator/shared resolves to ${resolved}, outside this checkout (${expected}): run npm ci in this worktree`,
    };
  }
  return { ok: true, message: `@gnuminator/shared resolves to ${expected}` };
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const r = checkSharedLink();
  if (r.ok) console.log(`check-shared-link: ${r.message}`);
  else {
    console.error(`check-shared-link: ${r.message}`);
    process.exit(1);
  }
}
