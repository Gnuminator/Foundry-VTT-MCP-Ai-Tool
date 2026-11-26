import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { mergeBaselines } from './merge-drivers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DRIVER = path.join(HERE, 'merge-drivers.mjs').replace(/\\/g, '/');

test('mergeBaselines: two branches lowering different files keep both', () => {
  const base = { limit: 1000, files: { 'a.ts': 1500, 'b.ts': 1200 }, exceptions: [] };
  const ours = { limit: 1000, files: { 'a.ts': 1400, 'b.ts': 1200 }, exceptions: [] };
  const theirs = { limit: 1000, files: { 'a.ts': 1500, 'b.ts': 1100 }, exceptions: [] };
  assert.deepEqual(mergeBaselines(base, ours, theirs).files, { 'a.ts': 1400, 'b.ts': 1100 });
});

test('mergeBaselines: a dropped file stays dropped, both-changed takes the lower, exceptions union', () => {
  const ex = { file: 'c.ts', lines: 1300, reason: 'r', pr: '1' };
  const base = { files: { 'a.ts': 1500, 'b.ts': 1200 }, exceptions: [] };
  const ours = { files: { 'a.ts': 1450 }, exceptions: [ex] };
  const theirs = { files: { 'a.ts': 1400, 'b.ts': 1200, 'c.ts': 1300 }, exceptions: [ex] };
  const m = mergeBaselines(base, ours, theirs);
  assert.deepEqual(m.files, { 'a.ts': 1400, 'c.ts': 1300 });
  assert.deepEqual(m.exceptions, [ex]);
});

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
  });

test('git merge: baseline and tool pages touched on both branches merge with no conflict', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'merge-drivers-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'merge.line-baseline.driver', `node "${DRIVER}" baseline %O %A %B`);
  git(dir, 'config', 'merge.generated-docs.driver', `node "${DRIVER}" generated %O %A %B`);
  mkdirSync(path.join(dir, 'scripts'));
  mkdirSync(path.join(dir, 'docs'));
  writeFileSync(
    path.join(dir, '.gitattributes'),
    'scripts/line-baseline.json merge=line-baseline\ndocs/tools.md merge=generated-docs\n'
  );
  const base = JSON.stringify(
    { limit: 1000, files: { 'a.ts': 1500, 'b.ts': 1200 }, exceptions: [] },
    null,
    2
  );
  const bl = path.join(dir, 'scripts', 'line-baseline.json');
  const doc = path.join(dir, 'docs', 'tools.md');
  writeFileSync(bl, `${base}\n`);
  writeFileSync(doc, 'one\n\ntwo\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'base');
  git(dir, 'checkout', '-qb', 'lane');
  writeFileSync(bl, `${base.replace('1500', '1400')}\n`);
  writeFileSync(doc, 'one\nlane tool\ntwo\n');
  git(dir, 'commit', '-qam', 'lane');
  git(dir, 'checkout', '-q', 'main');
  writeFileSync(bl, `${base.replace('1500', '1500').replace('1200', '1100')}\n`);
  writeFileSync(doc, 'one\nmain tool\ntwo\n');
  git(dir, 'commit', '-qam', 'main');
  git(dir, 'checkout', '-q', 'lane');
  git(dir, 'merge', '--no-edit', 'main');
  assert.deepEqual(JSON.parse(readFileSync(bl, 'utf8')).files, { 'a.ts': 1400, 'b.ts': 1100 });
  assert.match(readFileSync(doc, 'utf8'), /lane tool/);
});
