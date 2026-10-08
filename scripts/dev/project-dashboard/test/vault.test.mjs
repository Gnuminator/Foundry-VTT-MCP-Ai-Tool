import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pushPaths, normalizePaths, parsePorcelain, otherChanges, defaultRun } from '../vault.mjs';

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

// A real git runner that first calls `before(args)`, so a test can act between two git steps.
function hooked(before) {
  const calls = [];
  const run = async (file, args, opts) => {
    calls.push(args.join(' '));
    await before(args);
    return defaultRun(file, args, opts);
  };
  return { run, calls };
}

// Runs `fn` once, before the first git call whose first argument is `cmd`.
function once(cmd, fn) {
  let done = false;
  return args => {
    if (!done && args[0] === cmd) {
      done = true;
      fn();
    }
  };
}

// "Another PC" commits one file and pushes it; returns its new HEAD.
function pushFrom(b, file, text) {
  git(b, 'pull', '--quiet');
  fs.mkdirSync(path.dirname(path.join(b, file)), { recursive: true });
  fs.writeFileSync(path.join(b, file), text);
  git(b, 'add', '--', file);
  git(b, 'commit', '--quiet', '-m', `b: ${file}`);
  git(b, 'push', '--quiet');
  return git(b, 'rev-parse', 'HEAD').trim();
}

const rebaseDir = dir =>
  fs.existsSync(path.join(dir, '.git', 'rebase-merge')) ||
  fs.existsSync(path.join(dir, '.git', 'rebase-apply'));

function hasStash(dir) {
  try {
    git(dir, 'rev-parse', '-q', '--verify', 'refs/stash');
    return true;
  } catch {
    return false;
  }
}

function writeOwn(dir, text) {
  fs.mkdirSync(path.join(dir, 'Dev'), { recursive: true });
  fs.writeFileSync(path.join(dir, OWN), text);
}

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

test('a rejected push rebases once and pushes when the other commit does not conflict', async () => {
  const { a, b } = makeVault();
  fs.writeFileSync(path.join(a, 'Mine.md'), 'mine\n');
  let bHead = null;
  const { run, calls } = hooked(once('push', () => (bHead = pushFrom(b, 'Other.md', 'from b\n'))));
  const r = await pushPaths({ dir: a, paths: ['Mine.md'], message: 'add mine', run });
  assert.equal(r.state, 'pushed', r.detail);
  assert.equal(calls.filter(c => c.startsWith('push')).length, 2);
  assert.equal(git(a, 'rev-parse', 'HEAD~1').trim(), bHead);
  git(b, 'pull', '--quiet');
  assert.equal(fs.readFileSync(path.join(b, 'Mine.md'), 'utf8'), 'mine\n');
});

test('a rejected push whose rebase conflicts aborts it and takes back only its own commit', async () => {
  const { a, b } = makeVault();
  const start = git(a, 'rev-parse', 'HEAD').trim();
  fs.writeFileSync(path.join(a, 'Mine.md'), 'from a\n');
  let bHead = null;
  const { run, calls } = hooked(once('push', () => (bHead = pushFrom(b, 'Mine.md', 'from b\n'))));
  const r = await pushPaths({ dir: a, paths: ['Mine.md'], message: 'add mine', run });
  assert.equal(r.state, 'error');
  assert.match(r.detail, /push rejected and the rebase failed/);
  assert.ok(calls.includes('rebase --abort'));
  assert.equal(rebaseDir(a), false);
  assert.equal(git(a, 'rev-parse', 'HEAD').trim(), start);
  assert.equal(fs.readFileSync(path.join(a, 'Mine.md'), 'utf8'), 'from a\n');
  assert.equal(git(a, 'status', '--porcelain', '--', 'Mine.md').trim(), '?? Mine.md');
  assert.equal(git(a, 'ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0], bHead);
});

test('the strict form rebuilds its own note after a rejected push instead of merging it', async () => {
  const { a, b } = makeVault();
  let writes = 0;
  let bHead = null;
  const { run } = hooked(once('push', () => (bHead = pushFrom(b, OWN, 'rows from b\n'))));
  const r = await pushPaths({
    dir: a,
    paths: [OWN],
    message: 'project dashboard: measured usage',
    requireClean: true,
    run,
    write: dir => {
      writes += 1;
      writeOwn(dir, 'rows from a\n');
    },
  });
  assert.equal(r.state, 'pushed', r.detail);
  assert.equal(writes, 2);
  assert.equal(git(a, 'rev-parse', 'HEAD~1').trim(), bHead);
  git(b, 'pull', '--quiet');
  assert.equal(fs.readFileSync(path.join(b, OWN), 'utf8'), 'rows from a\n');
});

test('a failed pull never aborts a rebase that another session has running', async () => {
  const { a, b } = makeVault();
  pushFrom(b, 'Note.md', 'from b\n');
  // Another session committed Note.md here and runs its own pull between our busy check and
  // our pull; its rebase stops on a conflict.
  fs.writeFileSync(path.join(a, 'Note.md'), 'from a\n');
  git(a, 'commit', '--quiet', '-am', 'another session');
  fs.writeFileSync(path.join(a, 'Mine.md'), 'mine\n');
  const otherPull = () => {
    try {
      git(a, 'pull', '--rebase', '--quiet');
    } catch {
      // the conflict is the point
    }
  };
  const { run, calls } = hooked(once('pull', otherPull));
  assert.equal(rebaseDir(a), false);
  const r = await pushPaths({ dir: a, paths: ['Mine.md'], message: 'add mine', run });
  assert.equal(r.state, 'error');
  assert.ok(!calls.includes('rebase --abort'), calls.join('\n'));
  assert.equal(rebaseDir(a), true, "the other session's rebase is still there");
});

test('the strict form never stashes a note written after its clean check', async () => {
  const { a, b } = makeVault();
  pushFrom(b, 'Note.md', 'from b\n');
  const start = git(a, 'rev-parse', 'HEAD').trim();
  const { run } = hooked(
    once('fetch', () => fs.writeFileSync(path.join(a, 'Note.md'), 'a session edit\n'))
  );
  const r = await pushPaths({
    dir: a,
    paths: [OWN],
    message: 'm',
    requireClean: true,
    run,
    write: dir => writeOwn(dir, 'rows\n'),
  });
  assert.equal(r.state, 'waiting');
  assert.match(r.detail, /the pull waits/);
  assert.equal(fs.readFileSync(path.join(a, 'Note.md'), 'utf8'), 'a session edit\n');
  assert.equal(hasStash(a), false);
  assert.equal(git(a, 'rev-parse', 'HEAD').trim(), start);
});

test('the strict form waits while the vault holds commits not pushed yet', async () => {
  const { a, remote } = makeVault();
  const remoteHead = git(remote, 'rev-parse', 'main').trim();
  fs.writeFileSync(path.join(a, 'Other.md'), 'unpushed\n');
  git(a, 'add', 'Other.md');
  git(a, 'commit', '--quiet', '-m', 'another session');
  const r = await pushPaths({
    dir: a,
    paths: [OWN],
    message: 'm',
    requireClean: true,
    write: dir => writeOwn(dir, 'rows\n'),
  });
  assert.equal(r.state, 'waiting');
  assert.match(r.detail, /1 local commit not pushed yet/);
  assert.equal(git(remote, 'rev-parse', 'main').trim(), remoteHead);
});

test('the command-line form reports an autostash that did not apply again', async () => {
  const { a, b } = makeVault();
  pushFrom(b, 'Note.md', 'from b\n');
  fs.writeFileSync(path.join(a, 'Note.md'), 'a session edit\n');
  fs.writeFileSync(path.join(a, 'Mine.md'), 'mine\n');
  const r = await pushPaths({ dir: a, paths: ['Mine.md'], message: 'add mine' });
  assert.equal(r.state, 'error');
  assert.match(r.detail, /git stash/);
  assert.equal(hasStash(a), true);
});

test('pushPaths reports a missing repository and bad paths as errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-novault-'));
  assert.equal((await pushPaths({ dir, paths: ['a.md'], message: 'm' })).state, 'error');
  assert.equal((await pushPaths({ dir, paths: ['../a.md'], message: 'm' })).state, 'error');
});
