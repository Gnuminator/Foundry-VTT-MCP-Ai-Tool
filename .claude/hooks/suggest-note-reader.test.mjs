// node --test .claude/hooks/suggest-note-reader.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { run } from './suggest-note-reader.mjs';

const root = mkdtempSync(path.join(os.tmpdir(), 'note-reader-test-'));
const vault = path.join(root, 'vault');
const tmp = path.join(root, 'tmp');
mkdirSync(vault);
const env = { FOUNDRY_AI_OBSIDIAN_DIR: vault };
const long = path.join(vault, 'Long.md');
const short = path.join(vault, 'Short.md');
const outside = path.join(root, 'Outside.md');
writeFileSync(long, 'line\n'.repeat(400));
writeFileSync(short, 'line\n'.repeat(50));
writeFileSync(outside, 'line\n'.repeat(400));

const read = (file_path, extra = {}, session_id = 's1') => ({
  tool_name: 'Read',
  session_id,
  cwd: root,
  tool_input: { file_path, ...extra },
});

test('a long vault note gets one hint, additionalContext only, no decision', () => {
  const out = JSON.parse(run(read(long), { env, tmp }));
  assert.match(out.hookSpecificOutput.additionalContext, /note-reader/);
  assert.equal(out.hookSpecificOutput.permissionDecision, undefined);
});

test('the hint shows once per file per session', () => {
  assert.equal(run(read(long), { env, tmp }), '');
  assert.notEqual(run(read(long, {}, 's2'), { env, tmp }), '');
});

test('short notes, files outside the vault, partial reads and other tools stay quiet', () => {
  assert.equal(run(read(short, {}, 's3'), { env, tmp }), '');
  assert.equal(run(read(outside, {}, 's3'), { env, tmp }), '');
  assert.equal(run(read(long, { offset: 10, limit: 50 }, 's3'), { env, tmp }), '');
  assert.equal(run({ ...read(long, {}, 's3'), tool_name: 'Grep' }, { env, tmp }), '');
});

test('bad input and missing files print nothing', () => {
  assert.equal(run(null, { env, tmp }), '');
  assert.equal(run(read(path.join(vault, 'Nope.md'), {}, 's3'), { env, tmp }), '');
});
