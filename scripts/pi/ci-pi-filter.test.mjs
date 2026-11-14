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

import { PI_CONTAINER_MATRIX, PI_SCENARIOS_ELSEWHERE } from '../checks.mjs';

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

// The matrix is PI_CONTAINER_MATRIX in scripts/checks.mjs; the job reads it from pi-changes.
const matrix = PI_CONTAINER_MATRIX;
const matches = rel => filterRegex().test(rel);

test('the filter lists both sides of a rename and does not quote paths', () => {
  const step = doc.jobs['pi-changes'].steps.find(s => s.id === 'filter');
  assert.match(step.run, /--no-renames/, 'a moved Pi input must list its old path too');
  assert.match(step.run, /core\.quotePath=false/, 'non-ASCII paths must not come out quoted');
});

test('the matrix lists each container test once, with a test file that exists', () => {
  assert.ok(matrix.length > 0);
  const seenTests = new Set();
  const seenEnvs = new Set();
  const seenNames = new Set();
  for (const e of matrix) {
    assert.ok(!seenNames.has(e.name), `${e.name} is in the matrix twice`);
    seenNames.add(e.name);
    assert.ok(!seenTests.has(e.test), `${e.test} is in the matrix twice`);
    assert.ok(!seenEnvs.has(e.env), `${e.env} is in the matrix twice`);
    seenTests.add(e.test);
    seenEnvs.add(e.env);
    assert.ok(
      existsSync(path.join(repo, 'scripts/pi', e.test)),
      `scripts/pi/${e.test} does not exist`
    );
  }
});

test('every container scenario script is in the matrix or in the named list that runs elsewhere', () => {
  const dir = path.join(repo, 'scripts/pi/container-test');
  const scenarios = readdirSync(dir).filter(f => /-scenarios\.sh$/.test(f));
  assert.ok(scenarios.length > 0);
  const inMatrix = new Set(
    matrix.flatMap(e => scenarios.filter(s => read(`scripts/pi/${e.test}`).includes(s)))
  );
  for (const s of scenarios) {
    const elsewhere = s in PI_SCENARIOS_ELSEWHERE;
    assert.ok(
      inMatrix.has(s) || elsewhere,
      `${s} runs in no CI job: add its test to PI_CONTAINER_MATRIX or name it in PI_SCENARIOS_ELSEWHERE (scripts/checks.mjs) with where it runs`
    );
    assert.ok(
      !(inMatrix.has(s) && elsewhere),
      `${s} is in the matrix and in PI_SCENARIOS_ELSEWHERE: drop one`
    );
  }
  for (const s of Object.keys(PI_SCENARIOS_ELSEWHERE)) {
    assert.ok(scenarios.includes(s), `PI_SCENARIOS_ELSEWHERE names ${s}, which does not exist`);
  }
});

test('each PI_SCENARIOS_ELSEWHERE place names a workflow, a runner file or a check that exists', () => {
  for (const [s, where] of Object.entries(PI_SCENARIOS_ELSEWHERE)) {
    const yml = /(\S+\.ya?ml)\b/.exec(where)?.[1];
    const runner = /\(([\w.-]+\.mjs)\)/.exec(where)?.[1];
    const check = /\bcheck ([\w-]+)/.exec(where)?.[1];
    assert.ok(yml || runner || check, `${s}: "${where}" names no workflow, runner or check`);
    if (yml) {
      assert.ok(
        existsSync(path.join(repo, '.github/workflows', yml)),
        `${s}: workflow ${yml} does not exist`
      );
    }
    if (runner) {
      assert.ok(
        read(`scripts/pi/${runner}`).includes(s),
        `${s}: scripts/pi/${runner} never mentions it`
      );
    }
    if (check) {
      assert.ok(
        read('scripts/checks.mjs').includes(`name: '${check}'`),
        `${s}: check ${check} is not in scripts/checks.mjs`
      );
    }
  }
});

test('each matrix switch is read by its test file', () => {
  for (const e of matrix) {
    assert.ok(
      read(`scripts/pi/${e.test}`).includes(e.env),
      `${e.test} never reads ${e.env}: the shard would run no container`
    );
  }
});

test('the job shape: needs pi-changes, parallel, not fail-fast, timeouts, required check name', () => {
  const job = doc.jobs['pi-container'];
  assert.equal(job.needs, 'pi-changes');
  assert.equal(job.strategy.matrix, '${{ fromJSON(needs.pi-changes.outputs.matrix) }}');
  assert.equal(doc.jobs['pi-changes'].outputs.matrix, '${{ steps.matrix.outputs.matrix }}');
  const step = doc.jobs['pi-changes'].steps.find(s => s.id === 'matrix');
  assert.match(step.run, /node scripts\/checks\.mjs --matrix pi/);
  assert.equal(job.strategy['fail-fast'], false);
  assert.equal(job['timeout-minutes'], 20);
  assert.equal(doc.jobs['build-test']['timeout-minutes'], 25);
  assert.equal(doc.jobs['build-test-arm']['timeout-minutes'], 25);
  const summary = doc.jobs['build-test-arm-summary'];
  assert.match(summary.name, /^build-test \(ARM, Node 24\)/, 'the required check name changed');
  assert.deepEqual([...summary.needs].sort(), ['build-test-arm', 'pi-changes', 'pi-container']);
  // No other job may carry the required name: two checks of one name make the ruleset ambiguous.
  const holders = Object.entries(doc.jobs).filter(([, j]) =>
    String(j.name).startsWith('build-test (ARM, Node 24)')
  );
  assert.deepEqual(
    holders.map(([id]) => id),
    ['build-test-arm-summary']
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
    'scripts/checks.mjs', // holds PI_CONTAINER_MATRIX, the matrix of the shards
  ]) {
    assert.ok(matches(rel), `the pi-changes filter misses ${rel}`);
  }
  for (const rel of ['packages/cogm-dashboard/web/App.tsx', 'docs/index.md']) {
    assert.ok(!matches(rel), `the pi-changes filter should not fire for ${rel}`);
  }
});

/** Repo paths a file names: `/repo/<path>` in a scenario script, or a quoted `scripts/...`, `deploy/...` literal. */
function pathsIn(text) {
  const found = new Set();
  for (const m of text.matchAll(/\/repo\/([\w./-]+)/g)) found.add(m[1]);
  for (const m of text.matchAll(/\$\{repo\}\/([\w./-]+)/g)) found.add(m[1]);
  // A relative import out of scripts/pi (from '../x.mjs', from '../../shared/x') names a repo file too.
  for (const m of text.matchAll(/from '((?:\.\.?\/)+[\w./-]+)'/g)) found.add(`REL:${m[1]}`);
  for (const m of text.matchAll(/['"`]((?:scripts|deploy|packages|shared|docs|tools)\/[\w./-]+)/g))
    found.add(m[1]);
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
  // The scenario scripts and the stage scripts and helpers they run under /repo (remote/lib.sh and the
  // stages), and the game-night watch the stage 29 test reads from scripts/.
  for (const f of readdirSync(path.join(repo, 'scripts/pi/container-test'))) {
    if (/\.(sh|mjs)$/.test(f)) files.add(`scripts/pi/container-test/${f}`);
  }
  // Of scripts/pi/remote only the files the tests and scenarios name (a stage, lib.sh and its helpers). The other
  // stages are not inputs of a container test, and some name build output in text the tests only read.
  const remote = readdirSync(path.join(repo, 'scripts/pi/remote')).filter(f =>
    /\.(sh|mjs|js)$/.test(f)
  );
  const named = text => remote.filter(f => text.includes(f));
  const direct = new Set(['lib.sh']);
  for (const file of [...files]) {
    // The scenarios run the stages; a test that only reads a stage as text (kit-session reads 5-tool.sh) does not.
    if (file.startsWith('scripts/pi/container-test/'))
      for (const f of named(read(file))) direct.add(f);
  }
  for (const f of [...direct]) {
    // lib.sh and its helpers source each other; follow only those, not every stage a comment names.
    if (/^lib/.test(f))
      for (const g of named(read(`scripts/pi/remote/${f}`))) if (/^lib/.test(g)) direct.add(g);
  }
  for (const f of direct) files.add(`scripts/pi/remote/${f}`);
  for (const f of readdirSync(path.join(repo, 'scripts'))) {
    if (/^gamenight-watch.*\.mjs$/.test(f)) files.add(`scripts/${f}`);
  }
  const outside = [];
  let checked = 0;
  for (const file of files) {
    for (let p of pathsIn(read(file))) {
      // A relative import is resolved against the file that has it.
      if (p.startsWith('REL:'))
        p = path.posix.normalize(path.posix.join(path.posix.dirname(file), p.slice(4)));
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
    'a container test reads a path the pi-changes filter does not cover; add its folder to the pattern in ci.yml'
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
