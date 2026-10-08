import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pushPaths, normalizePaths, parsePorcelain, otherChanges } from '../vault.mjs';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// A bare remote and two clones (the vault on this PC and "another PC").
function makeVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-vault-'));
  const remote = path.join(root, 'remote.git');
  git(root, 'init', '--bare', '--quiet', '--initial-branch=main', remote);
  const clone = name => {
    const dir = path.join(root, name);
    git(root, 'clone', '--quiet', remote, dir);
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'user.email', 'test@example.invalid');
    git(dir, 'config', 'core.autocrlf', 'false');
    return dir;
  };
  const a = clone('a');
  // The empty clone's branch name follows the runner's git config; pin it.
  git(a, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  fs.mkdirSync(path.join(a, '.obsidian'));
  fs.writeFileSync(path.join(a, '.obsidian', 'graph.json'), '{}');
  fs.writeFileSync(path.join(a, 'Note.md'), 'hello\n');
  git(a, 'add', '.');
  git(a, 'commit', '--quiet', '-m', 'init');
  git(a, 'push', '--quiet', '-u', 'origin', 'main');
  const b = clone('b');
  return { root, remote, a, b };
}

const OWN = 'Dev/Usage log (measured).md';

test('normalizePaths keeps vault-relative paths and refuses others', () => {
  assert.deepEqual(normalizePaths(['Dev\\a.md', './b.md']), ['Dev/a.md', 'b.md']);
  assert.throws(() => normalizePaths(['../x.md']));
  assert.throws(() => normalizePaths(['C:\\x.md']));
  assert.throws(() => normalizePaths(['/etc/x']));
  assert.throws(() => normalizePaths([]));
});

test('parsePorcelain and otherChanges skip own files and .obsidian', () => {
  const entries = parsePorcelain(
    ' M .obsidian/graph.json\0?? Dev/Usage log (measured).md\0 M Other.md\0R  new.md\0old.md\0'
  );
  assert.deepEqual(
    entries.map(e => e.file),
    ['.obsidian/graph.json', 'Dev/Usage log (measured).md', 'Other.md', 'new.md']
  );
  assert.deepEqual(
    otherChanges(entries, [OWN]).map(e => e.file),
    ['Other.md', 'new.md']
  );
});

test('pushPaths writes after the pull, commits only its files and pushes', async () => {
  const { a, b } = makeVault();
  // Obsidian's UI state is dirty, as it usually is; that must not block the page.
  fs.writeFileSync(path.join(a, '.obsidian', 'graph.json'), '{"x":1}');
  // Another PC pushed meanwhile.
  fs.writeFileSync(path.join(b, 'Other.md'), 'from b\n');
  git(b, 'add', '.');
  git(b, 'commit', '--quiet', '-m', 'b');
  git(b, 'push', '--quiet');

  const r = await pushPaths({
    dir: a,
    paths: [OWN],
    message: 'project dashboard: measured usage',
    requireClean: true,
    write: dir => {
      assert.ok(fs.existsSync(path.join(dir, 'Other.md')), 'write runs after the pull');
      fs.mkdirSync(path.join(dir, 'Dev'), { recursive: true });
      fs.writeFileSync(path.join(dir, OWN), 'rows\n');
    },
  });
  assert.equal(r.state, 'pushed', r.detail);
  git(b, 'pull', '--quiet');
  assert.equal(fs.readFileSync(path.join(b, OWN), 'utf8'), 'rows\n');
  const files = git(a, 'show', '--name-only', '--format=', 'HEAD').trim();
  assert.equal(files, OWN);
  assert.equal(git(a, 'status', '--porcelain').trim(), 'M .obsidian/graph.json');

  // Same content again: nothing to push.
  const again = await pushPaths({
    dir: a,
    paths: [OWN],
    message: 'project dashboard: measured usage',
    requireClean: true,
    write: dir => fs.writeFileSync(path.join(dir, OWN), 'rows\n'),
  });
  assert.equal(again.state, 'nothing');
});

test('pushPaths waits while other vault files are changed or a git command runs', async () => {
  const { a } = makeVault();
  fs.writeFileSync(path.join(a, 'Note.md'), 'half written\n');
  let wrote = false;
  const r = await pushPaths({
    dir: a,
    paths: [OWN],
    message: 'm',
    requireClean: true,
    write: () => {
      wrote = true;
    },
  });
  assert.equal(r.state, 'waiting');
  assert.match(r.detail, /1 other uncommitted change/);
  assert.equal(wrote, false);
  assert.equal(fs.readFileSync(path.join(a, 'Note.md'), 'utf8'), 'half written\n');

  git(a, 'checkout', '--', 'Note.md');
  fs.writeFileSync(path.join(a, '.git', 'index.lock'), '');
  const busy = await pushPaths({ dir: a, paths: [OWN], message: 'm', requireClean: true });
  assert.equal(busy.state, 'waiting');
  assert.match(busy.detail, /git command is running/);
});

test('the command-line form autostashes other edits and commits only the given paths', async () => {
  const { a } = makeVault();
  fs.writeFileSync(path.join(a, 'Note.md'), 'a session edit\n');
  fs.writeFileSync(path.join(a, 'Mine.md'), 'mine\n');
  const r = await pushPaths({ dir: a, paths: ['Mine.md'], message: 'add mine' });
  assert.equal(r.state, 'pushed', r.detail);
  assert.equal(git(a, 'show', '--name-only', '--format=', 'HEAD').trim(), 'Mine.md');
  assert.equal(fs.readFileSync(path.join(a, 'Note.md'), 'utf8'), 'a session edit\n');
});

test('pushPaths reports a missing repository and bad paths as errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-novault-'));
  assert.equal((await pushPaths({ dir, paths: ['a.md'], message: 'm' })).state, 'error');
  assert.equal((await pushPaths({ dir, paths: ['../a.md'], message: 'm' })).state, 'error');
});
