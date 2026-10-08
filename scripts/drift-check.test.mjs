/**
 * scripts/drift-check.mjs: trial-merges the newest main, runs the guards on the result and puts
 * the branch back. Runs against throwaway git repos (a bare "origin" and a clone) with stand-in
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-check-'));
  const origin = path.join(tmp, 'origin.git');
  const lane = path.join(tmp, 'lane');
  const other = path.join(tmp, 'other');
  git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, lane);
  commit(lane, 'shared.txt', 'base\n', 'base');
  git(lane, 'push', '-q', 'origin', 'HEAD:main');
  git(lane, 'checkout', '-q', '-b', 'lane');
  commit(lane, 'lane.txt', 'lane work\n', 'lane work');
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
/** A guard that passes only when main's new file is in the tree (so it ran on the merge). */
const seesMain = {
  name: 'sees main',
  command: "node -e \"process.exit(require('fs').existsSync('main.txt') ? 0 : 3)\"",
};

/** HEAD, a clean tree and no merge in progress: the branch is exactly as before. */
function assertRestored(lane, head) {
  assert.equal(git(lane, 'rev-parse', 'HEAD'), head);
  assert.equal(git(lane, 'status', '--porcelain'), '');
  assert.equal(fs.existsSync(path.join(lane, '.git', 'MERGE_HEAD')), false);
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

test('a newer main is merged for the guards, then the merge is undone', () => {
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

test('a guard that fails only with main merged in fails the check, and the merge is undone', () => {
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

test('the remote is --remote, else the remote local main tracks, else origin', () => {
  const { tmp, lane } = repos();
  try {
    assert.equal(pickRemote(lane, 'aitool'), 'aitool');
    assert.equal(pickRemote(lane, undefined), 'origin');
    git(lane, 'config', 'branch.main.remote', 'aitool');
    assert.equal(pickRemote(lane, undefined), 'aitool');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
