/**
 * scripts/docs-tools.mjs --check: exits non-zero on a stale page and writes nothing.
 * Runs against a copy of docs/reference (TOOL_REFERENCE_DIR), never the real pages.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const script = path.join(import.meta.dirname, 'docs-tools.mjs');

function run(dir, ...args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, TOOL_REFERENCE_DIR: dir },
  });
}

test('docs-tools --check passes on current pages, fails on a stale one and writes nothing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'docs-tools-'));
  try {
    cpSync(path.join(repoRoot, 'docs', 'reference'), dir, { recursive: true });
    assert.equal(run(dir, '--check').status, 0);

    const page = path.join(dir, 'tools', 'core.md');
    const stale = readFileSync(page, 'utf8') + '\nstale line\n';
    writeFileSync(page, stale);
    const bad = run(dir, '--check');
    assert.notEqual(bad.status, 0);
    assert.equal(readFileSync(page, 'utf8'), stale, '--check must not rewrite the page');

    assert.equal(run(dir).status, 0, 'the plain run rewrites');
    assert.notEqual(readFileSync(page, 'utf8'), stale);
    assert.equal(run(dir, '--check').status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
