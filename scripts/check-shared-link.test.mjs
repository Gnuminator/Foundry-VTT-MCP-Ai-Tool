import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkSharedLink } from './check-shared-link.mjs';

function makeCheckout(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `shared-link-${label}-`));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"root"}');
  fs.mkdirSync(path.join(root, 'shared'));
  fs.writeFileSync(path.join(root, 'shared', 'package.json'), '{"name":"@gnuminator/shared"}');
  fs.mkdirSync(path.join(root, 'node_modules', '@gnuminator'), { recursive: true });
  return root;
}

const link = (root, target) =>
  fs.symlinkSync(target, path.join(root, 'node_modules', '@gnuminator', 'shared'), 'junction');

test('checkSharedLink: ok when node_modules points at this checkout shared/', () => {
  const root = makeCheckout('ok');
  link(root, path.join(root, 'shared'));
  assert.equal(checkSharedLink(root).ok, true);
});

test('checkSharedLink: fails with "run npm ci in this worktree" when it points at another checkout', () => {
  const root = makeCheckout('mine');
  const other = makeCheckout('other');
  link(root, path.join(other, 'shared'));
  const r = checkSharedLink(root);
  assert.equal(r.ok, false);
  assert.match(r.message, /run npm ci in this worktree/);
});

test('checkSharedLink: fails when the package does not resolve at all', () => {
  const root = makeCheckout('none');
  const r = checkSharedLink(root);
  assert.equal(r.ok, false);
  assert.match(r.message, /run npm ci in this worktree/);
});
