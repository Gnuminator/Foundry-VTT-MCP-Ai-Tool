// Pins the CI path filter of the Pi container tests (job `pi-changes` in .github/workflows/ci.yml):
//   node --test scripts/pi/ci-pi-filter.test.mjs
// The matrix job `pi-container` runs only when a pull request changes a path the filter names. So every
// file a container test mounts or reads must match the filter, or a change to it would skip the very
// test that guards it. This test reads the real filter and the real tests and fails on the gap.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = rel => readFileSync(path.join(repo, rel), 'utf8');
const ciYml = read('.github/workflows/ci.yml');
const doc = /** @type {any} */ (yaml.load(ciYml));

/** The filter regex, taken from the `grep -qE '...'` of the pi-changes step. */
function filterRegex() {
  const step = doc.jobs['pi-changes'].steps.find(s => s.id === 'filter');
  const m = /grep -qE '([^']+)'/.exec(step.run);
  assert.ok(m, 'pi-changes: no grep -qE pattern found in the filter step');
  return new RegExp(m[1]);
}

/** @type {Array<{ name: string, env: string, test: string }>} */
const matrix = doc.jobs['pi-container'].strategy.matrix.include;
const matches = rel => filterRegex().test(rel);

test('the matrix lists each container test once, with a test file that exists', () => {
  assert.ok(matrix.length > 0);
  const seenTests = new Set();
  const seenEnvs = new Set();
  for (const e of matrix) {
    assert.ok(!seenTests.has(e.test), `${e.test} is in the matrix twice`);
    assert.ok(!seenEnvs.has(e.env), `${e.env} is in the matrix twice`);
    seenTests.add(e.test);
    seenEnvs.add(e.env);
    assert.ok(existsSync(path.join(repo, 'scripts/pi', e.test)), `scripts/pi/${e.test} does not exist`);
  }
});

test('each matrix switch is read by its test file', () => {
  for (const e of matrix) {
    assert.ok(
      read(`scripts/pi/${e.test}`).includes(e.env),
      `${e.test} never reads ${e.env}: the shard would run no container`,
    );
  }
});

test('the job shape: needs pi-changes, parallel, not fail-fast, timeouts, required check name', () => {
  const job = doc.jobs['pi-container'];
  assert.equal(job.needs, 'pi-changes');
  assert.equal(job.strategy['fail-fast'], false);
  assert.equal(job['timeout-minutes'], 20);
  assert.equal(doc.jobs['build-test']['timeout-minutes'], 25);
  assert.equal(doc.jobs['build-test-arm']['timeout-minutes'], 25);
  const summary = doc.jobs['build-test-arm-summary'];
  assert.match(summary.name, /^build-test \(ARM, Node 24\)/, 'the required check name changed');
  assert.deepEqual([...summary.needs].sort(), ['build-test-arm', 'pi-changes', 'pi-container']);
  // No other job may carry the required name: two checks of one name make the ruleset ambiguous.
  const holders = Object.entries(doc.jobs).filter(([, j]) => String(j.name).startsWith('build-test (ARM, Node 24)'));
  assert.deepEqual(
    holders.map(([id]) => id),
    ['build-test-arm-summary'],
  );
});

test('the filter always covers the workflow, the lockfile and its own inputs', () => {
  for (const rel of [
    '.github/workflows/ci.yml',
    'package-lock.json',
    'scripts/pi/remote/lib.sh',
    'scripts/pi/container-test/stage13-scenarios.sh',
    'scripts/plan-b/start.ps1',
    'deploy/pi/compose.yml',
    'scripts/gamenight-watch-pi.mjs',
    'scripts/gamenight-watch.mjs',
  ]) {
    assert.ok(matches(rel), `the pi-changes filter misses ${rel}`);
  }
  for (const rel of ['packages/cogm-dashboard/web/App.tsx', 'docs/index.md', 'scripts/checks.mjs']) {
    assert.ok(!matches(rel), `the pi-changes filter should not fire for ${rel}`);
  }
});

/** Repo paths a file names: `/repo/<path>` in a scenario script, or a quoted `scripts/...`, `deploy/...` literal. */
function pathsIn(text) {
  const found = new Set();
  for (const m of text.matchAll(/\/repo\/([\w./-]+)/g)) found.add(m[1]);
  for (const m of text.matchAll(/['"`]((?:scripts|deploy|packages|shared|docs|tools)\/[\w./-]+)/g)) found.add(m[1]);
  // path.join(repo, 'a', 'b', 'c') and path.resolve(repo, 'a', ...)
  for (const m of text.matchAll(/(?:join|resolve)\(\s*repo\s*,((?:\s*'[^']+',?)+)\s*\)/g)) {
    const parts = [...m[1].matchAll(/'([^']+)'/g)].map(p => p[1]);
    found.add(parts.join('/'));
  }
  return [...found].map(p => p.replace(/[.,]+$/, ''));
}

test('every path the container tests mount or read is inside the filter', () => {
  const files = new Set();
  for (const e of matrix) files.add(`scripts/pi/${e.test}`);
  for (const dir of ['scripts/pi/container-test']) {
    for (const f of readdirSync(path.join(repo, dir))) {
      if (/\.(sh|mjs)$/.test(f)) files.add(`${dir}/${f}`);
    }
  }
  // The stage scripts and helpers the scenarios run under /repo are named in the files above; the whole
  // scripts/pi/ folder is in the filter, so the stage files are covered as long as they live there.
  const outside = [];
  let checked = 0;
  for (const file of files) {
    for (const p of pathsIn(read(file))) {
      // Skip things the tests build in a temporary folder or on the container's own disk.
      if (/^(tmp|etc|usr|var|home|opt)\b/.test(p)) continue;
      // Paths with a shell or template variable in them are built at run time from a covered folder.
      if (/[$`{]/.test(p)) continue;
      checked += 1;
      if (!matches(p)) outside.push(`${file}: ${p}`);
    }
  }
  assert.ok(checked > 40, `only ${checked} paths found: the scan stopped matching the tests`);
  assert.deepEqual(
    outside,
    [],
    'a container test reads a path the pi-changes filter does not cover; add its folder to the pattern in ci.yml',
  );
});

test('a container test mounts the whole repo read-only, nothing wider', () => {
  for (const e of matrix) {
    const text = read(`scripts/pi/${e.test}`);
    for (const m of text.matchAll(/`([^`]*):\/repo[^`]*`/g)) {
      assert.equal(m[0], '`${repo}:/repo:ro`', `${e.test} mounts ${m[0]}`);
    }
  }
});
