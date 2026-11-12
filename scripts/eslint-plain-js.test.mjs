// Every tracked plain JavaScript file must be linted: ESLint may ignore only the files named in
// PLAIN_JS_SKIP (eslint.config.mjs), each with a reason.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

import { PLAIN_JS_SKIP } from '../eslint.config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const tracked = execFileSync('git', ['ls-files', '*.js', '*.mjs', '*.cjs'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
})
  .split('\n')
  .filter(Boolean);

test('every skip-list entry names a tracked file and gives a reason', () => {
  for (const [file, reason] of Object.entries(PLAIN_JS_SKIP)) {
    assert.ok(tracked.includes(file), `${file} is in PLAIN_JS_SKIP but not tracked`);
    assert.ok(reason.trim().length > 0, `${file} has no reason`);
  }
});

test('ESLint ignores no tracked plain JS file outside the skip list', async () => {
  const eslint = new ESLint({ cwd: root });
  const ignored = [];
  for (const file of tracked) {
    if (Object.hasOwn(PLAIN_JS_SKIP, file)) continue;
    if (await eslint.isPathIgnored(path.join(root, file))) ignored.push(file);
  }
  assert.deepEqual(ignored, [], `ESLint ignores plain JS files not in PLAIN_JS_SKIP: ${ignored.join(', ')}`);
});

test('the skip list files really are ignored (the list is not stale)', async () => {
  const eslint = new ESLint({ cwd: root });
  for (const file of Object.keys(PLAIN_JS_SKIP)) {
    assert.equal(await eslint.isPathIgnored(path.join(root, file)), true, `${file} is not ignored`);
  }
});
