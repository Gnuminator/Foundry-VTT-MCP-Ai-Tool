/**
 * scripts/drift-check.mjs: trial-merges the newest main in a throwaway worktree, runs the guards
 * there and removes it. Runs against throwaway git repos (a bare "origin" and a clone) with stand-in
 * guards, so no real guard and no network is involved.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runDriftCheck, pickRemote } from './drift-check.mjs';

/** @param {string} cwd @param {...string} args */
const git = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  }).trim();

/** @param {string} dir @param {string} file @param {string} text @param {string} message */
function commit(dir, file, text, message) {
  fs.writeFileSync(path.join(dir, file), text);
  git(dir, 'add', file);
  git(dir, 'commit', '-q', '-m', message);
}

/** A bare origin with main, a clone on branch "lane", and a second clone that pushes to main. */
function repos() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-test-'));
  const origin = path.join(tmp, 'origin.git');
  const lane = path.join(tmp, 'lane');
  const other = path.join(tmp, 'other');
  git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, lane);
  commit(lane, 'shared.txt', 'base\n', 'base');
  commit(lane, '.gitignore', 'node_modules/\n', 'ignore node_modules');
  git(lane, 'push', '-q', 'origin', 'HEAD:main');
  git(lane, 'config', 'branch.main.remote', 'origin');
  git(lane, 'checkout', '-q', '-b', 'lane');
  commit(lane, 'lane.txt', 'lane work\n', 'lane work');
  // An untracked node_modules the throwaway worktree borrows (a junction) and must not delete.
  fs.mkdirSync(path.join(lane, 'node_modules'));
  fs.writeFileSync(path.join(lane, 'node_modules', 'marker.txt'), 'installed\n');
  git(tmp, 'clone', '-q', origin, other);
  return { tmp, lane, other };
}

/** Lines logged, and a stand-in guard. */
function run(cwd, checks) {
  const lines = [];
  const code = runDriftCheck({ cwd, checks, log: l => lines.push(l) });
  return { code, out: lines.join('\n') };
}

const passes = name => ({ name, command: 'node -e "process.exit(0)"' });
/** A guard that passes only on the merge (main's new file) with the borrowed node_modules. */
const seesMain = {
  name: 'sees main',
  command:
    "node -e \"const f = require('fs'); process.exit(f.existsSync('main.txt') && f.existsSync('node_modules/marker.txt') ? 0 : 3)\"",
};

/** The lane is untouched: same HEAD, clean, no merge, no extra worktree, node_modules intact. */
function assertRestored(lane, head) {
  assert.equal(git(lane, 'rev-parse', 'HEAD'), head);
  assert.equal(git(lane, 'status', '--porcelain'), '');
  assert.equal(fs.existsSync(path.join(lane, '.git', 'MERGE_HEAD')), false);
  assert.equal(git(lane, 'worktree', 'list').split('\n').length, 1, 'the worktree is removed');
  assert.equal(fs.existsSync(path.join(lane, 'main.txt')), false, 'main never reaches the lane');
  assert.equal(
    fs.readFileSync(path.join(lane, 'node_modules', 'marker.txt'), 'utf8'),
    'installed\n',
    'node_modules survives the cleanup'
  );
}

test('a branch that already has main runs the guards as is', () => {
  const { tmp, lane } = repos();
  try {
    const { code, out } = run(lane, [passes('one')]);
    assert.equal(code, 0, out);
    assert.match(out, /already contains origin\/main/);
    assert.match(out, /ok {3}one/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a newer main is merged for the guards, in a throwaway worktree, and the lane is untouched', () => {
  const { tmp, lane, other } = repos();
  try {
    commit(other, 'main.txt', 'from another lane\n', 'other lane merged');
    git(other, 'push', '-q', 'origin', 'HEAD:main');
    const head = git(lane, 'rev-parse', 'HEAD');
    const { code, out } = run(lane, [seesMain]);
    assert.equal(code, 0, out);
    assert.match(out, /trial merge of origin\/main/);
    assertRestored(lane, head);
    assert.equal(fs.existsSync(path.join(lane, 'main.txt')), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a guard that fails only with main merged in fails the check, and the lane is untouched', () => {
  const { tmp, lane, other } = repos();
  try {
    commit(other, 'main.txt', 'from another lane\n', 'other lane merged');
    git(other, 'push', '-q', 'origin', 'HEAD:main');
    const head = git(lane, 'rev-parse', 'HEAD');
    const failsWithMain = {
      name: 'count guard',
      command: "node -e \"process.exit(require('fs').existsSync('main.txt') ? 1 : 0)\"",
    };
    const { code, out } = run(lane, [failsWithMain, passes('next')]);
    assert.equal(code, 1, out);
    assert.match(out, /FAIL count guard/);
    assert.match(out, /ok {3}next/, 'the other guards still run');
    assert.match(out, /fail once origin\/main is merged in/);
    assertRestored(lane, head);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a conflict with main is named and undone, and no guard runs', () => {
  const { tmp, lane, other } = repos();
  try {
    commit(other, 'shared.txt', 'main side\n', 'main edits shared');
    git(other, 'push', '-q', 'origin', 'HEAD:main');
    commit(lane, 'shared.txt', 'lane side\n', 'lane edits shared');
    const head = git(lane, 'rev-parse', 'HEAD');
    const { code, out } = run(lane, [passes('never')]);
    assert.equal(code, 1, out);
    assert.match(out, /conflicts in:\n {2}shared\.txt/);
    assert.doesNotMatch(out, /never/);
    assertRestored(lane, head);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('uncommitted changes are refused before anything is fetched or merged', () => {
  const { tmp, lane } = repos();
  try {
    fs.writeFileSync(path.join(lane, 'lane.txt'), 'edited\n');
    const { code, out } = run(lane, [passes('never')]);
    assert.equal(code, 2);
    assert.match(out, /uncommitted changes/);
    assert.doesNotMatch(out, /never/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the remote is --remote, else what local main tracks, else aitool, else none', () => {
  const { tmp, lane } = repos();
  try {
    assert.equal(pickRemote(lane, 'upstream'), 'upstream');
    assert.equal(pickRemote(lane, undefined), 'origin', 'local main tracks origin here');
    git(lane, 'config', '--unset', 'branch.main.remote');
    assert.equal(pickRemote(lane, undefined), null, 'origin is never guessed');
    git(lane, 'remote', 'add', 'aitool', 'https://example.invalid/x.git');
    assert.equal(pickRemote(lane, undefined), 'aitool');
    git(lane, 'remote', 'remove', 'aitool');
    git(lane, 'remote', 'add', 'gh', 'https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool.git');
    assert.equal(pickRemote(lane, undefined), 'gh', 'a remote whose URL is this repository');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a main with a new package-lock.json asks for the real merge and npm ci first', () => {
  const { tmp, lane, other } = repos();
  try {
    commit(other, 'package-lock.json', '{"new": true}\n', 'dependency bump');
    git(other, 'push', '-q', 'origin', 'HEAD:main');
    const head = git(lane, 'rev-parse', 'HEAD');
    const { code, out } = run(lane, [passes('never')]);
    assert.equal(code, 2, out);
    assert.match(out, /changed package-lock\.json/);
    assert.match(out, /run `npm ci`/);
    assert.doesNotMatch(out, /never/);
    assertRestored(lane, head);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('no remote for main stops before anything is merged', () => {
  const { tmp, lane } = repos();
  try {
    git(lane, 'config', '--unset', 'branch.main.remote');
    const { code, out } = run(lane, [passes('never')]);
    assert.equal(code, 2);
    assert.match(out, /no remote for this repository found; pass --remote NAME/);
    assert.doesNotMatch(out, /never/);
    const named = runDriftCheck({ cwd: lane, remote: 'missing', checks: [], log: () => {} });
    assert.equal(named, 2, 'a --remote that does not exist fails the fetch');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a worktree a killed run left behind is removed, and its node_modules target kept', () => {
  const { tmp, lane, other } = repos();
  try {
    commit(other, 'main.txt', 'from another lane\n', 'other lane merged');
    git(other, 'push', '-q', 'origin', 'HEAD:main');
    const stale = path.join(tmp, 'drift-check-stale');
    git(lane, 'worktree', 'add', '-q', '--detach', stale, 'HEAD');
    fs.symlinkSync(path.join(lane, 'node_modules'), path.join(stale, 'node_modules'), 'junction');
    const head = git(lane, 'rev-parse', 'HEAD');
    const { code, out } = run(lane, [seesMain]);
    assert.equal(code, 0, out);
    assert.equal(fs.existsSync(stale), false, 'the stale worktree is gone');
    assertRestored(lane, head);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
