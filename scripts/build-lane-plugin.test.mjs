// node --test scripts/build-lane-plugin.test.mjs
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { NAME, REPO, drift, hooksJson, plan, pluginVersion, retargetHook, write } from './build-lane-plugin.mjs';

test('a fresh write has no drift, and a changed file is reported', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lane-plugin-'));
  try {
    cpSync(path.join(REPO, '.claude'), path.join(dir, '.claude'), { recursive: true });
    cpSync(path.join(REPO, 'package.json'), path.join(dir, 'package.json'));
    write(dir);
    assert.deepEqual(drift(dir), []);
    writeFileSync(path.join(dir, 'plugin', NAME, 'hooks', 'hooks.json'), '{}');
    assert.equal(drift(dir).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a lagging tool-version prefix is not drift, a changed kit hash is', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lane-plugin-lag-'));
  try {
    cpSync(path.join(REPO, '.claude'), path.join(dir, '.claude'), { recursive: true });
    cpSync(path.join(REPO, 'package.json'), path.join(dir, 'package.json'));
    write(dir);
    const pj = path.join(dir, 'plugin', NAME, '.claude-plugin', 'plugin.json');
    writeFileSync(pj, readFileSync(pj, 'utf8').replace(/"version": "[^+]*\+/, '"version": "0.0.1+'));
    assert.deepEqual(drift(dir), []);
    writeFileSync(pj, readFileSync(pj, 'utf8').replace(/\+[0-9a-f]{8}"/, '+deadbeef"'));
    assert.equal(drift(dir).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hooks.json uses plugin-root paths only', () => {
  const j = JSON.stringify(hooksJson({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/a.mjs"' }] }] } }));
  assert.match(j, /CLAUDE_PLUGIN_ROOT\}\/hooks\/a\.mjs/);
  assert.doesNotMatch(j, /CLAUDE_PROJECT_DIR/);
});

test('every hook in the plan resolves the repo from the project dir, not its own folder', () => {
  for (const [rel, c] of plan()) {
    if (rel.startsWith('hooks/') && rel.endsWith('.mjs')) assert.doesNotMatch(String(c), /'\.\.',\s*'\.\.'/, rel);
  }
});

test('the real hooks.json has plugin-root paths only', () => {
  const j = JSON.parse(plan().get('hooks/hooks.json'));
  const cmds = Object.values(j.hooks).flatMap(es => es.flatMap(e => e.hooks.map(h => h.command)));
  assert.ok(cmds.length > 0);
  for (const c of cmds) {
    assert.match(c, /CLAUDE_PLUGIN_ROOT/);
    assert.doesNotMatch(c, /CLAUDE_PROJECT_DIR/);
  }
});

test('an unknown REPO_ROOT shape fails the build, and acorn loads from the project', () => {
  assert.throws(() => retargetHook("const REPO_ROOT = new URL('../..', import.meta.url);"));
  assert.match(retargetHook("a = await import('acorn');"), /CLAUDE_PROJECT_DIR/);
});

test('a stale file and a missing marketplace are reported', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lane-plugin-'));
  try {
    cpSync(path.join(REPO, '.claude'), path.join(dir, '.claude'), { recursive: true });
    cpSync(path.join(REPO, 'package.json'), path.join(dir, 'package.json'));
    write(dir);
    writeFileSync(path.join(dir, 'plugin', NAME, 'skills', 'old.md'), 'x');
    rmSync(path.join(dir, '.claude-plugin'), { recursive: true });
    const p = drift(dir).join('\n');
    assert.match(p, /stale: .*old\.md/);
    assert.match(p, /marketplace\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('retargetHook rewrites both REPO_ROOT shapes', () => {
  assert.match(retargetHook("path.resolve(here, '..', '..')"), /CLAUDE_PROJECT_DIR/);
  assert.match(retargetHook("path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')"), /CLAUDE_PROJECT_DIR/);
});

test('the plugin version is the tool version plus a hash that moves with the content', () => {
  const a = pluginVersion('1.2.3', new Map([['skills/a.md', Buffer.from('x')]]));
  assert.match(a, /^1\.2\.3\+[0-9a-f]{8}$/);
  assert.equal(a, pluginVersion('1.2.3', new Map([['skills/a.md', Buffer.from('x')]])));
  assert.notEqual(a, pluginVersion('1.2.3', new Map([['skills/a.md', Buffer.from('y')]])));
  assert.notEqual(a, pluginVersion('1.2.3', new Map([['skills/b.md', Buffer.from('x')]])));
  assert.match(plan().get('.claude-plugin/plugin.json'), /"version": "\d+\.\d+\.\d+\+[0-9a-f]{8}"/);
});

test('the plan carries the skills, agents and hooks', () => {
  const keys = [...plan().keys()];
  for (const k of ['skills/lane/SKILL.md', 'agents/review-pi-ci.md', 'hooks/hooks.json', '.claude-plugin/plugin.json']) assert.ok(keys.includes(k), k);
});
