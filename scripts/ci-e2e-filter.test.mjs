// Pins the CI path filter of the dashboard browser tests (job `dashboard-e2e-changes` in
// .github/workflows/ci.yml):
//   node --test scripts/ci-e2e-filter.test.mjs
// The shard jobs run only when a pull request changes a path the filter names. The specs and their
// Playwright config may import only from the dashboard package and shared; anything wider would let
// a change skip the very tests that guard it. This test reads the real filter and the real specs.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(path.join(repo, rel), 'utf8');
const doc = /** @type {any} */ (yaml.load(read('.github/workflows/ci.yml')));

const filterStep = doc.jobs['dashboard-e2e-changes'].steps.find(s => s.id === 'filter');
const matchLine = /grep -qE '([^']+)'/.exec(filterStep.run);
assert.ok(matchLine, 'dashboard-e2e-changes: no grep -qE pattern found in the filter step');
const filter = new RegExp(matchLine[1]);

const e2eDir = 'packages/cogm-dashboard/web/e2e';
const specFiles = [
  ...readdirSync(path.join(repo, e2eDir)).map(f => `${e2eDir}/${f}`),
  'packages/cogm-dashboard/web/playwright.config.ts',
].filter(f => /\.tsx?$/.test(f));

test('the filter lists both sides of a rename and does not quote paths', () => {
  assert.match(filterStep.run, /--no-renames/, 'a moved input must list its old path too');
  assert.match(filterStep.run, /core\.quotePath=false/, 'non-ASCII paths must not come out quoted');
});

test('the filter covers the dashboard, shared, the lockfile, the Chromium script and the workflow', () => {
  for (const rel of [
    'packages/cogm-dashboard/web/e2e/glance.spec.ts',
    'packages/cogm-dashboard/src/server.ts',
    'shared/src/switch-off.ts',
    'package-lock.json',
    'scripts/ci-install-chromium.sh',
    '.github/workflows/ci.yml',
    // What the dashboard build reads: the help pages (build-help.mjs) and its helper scripts.
    'docs/gm/modules.md',
    'docs/foundry/index.md',
    'docs/da/gm/index.md',
    'scripts/check-links.mjs',
    'scripts/tsc7.mjs',
    'package.json',
  ]) {
    assert.ok(filter.test(rel), `the dashboard-e2e-changes filter misses ${rel}`);
  }
  for (const rel of [
    'packages/mcp-server/src/index.ts',
    'packages/foundry-module/src/write-gate.ts',
    'docs/index.md',
    'scripts/checks.mjs',
  ]) {
    assert.ok(!filter.test(rel), `the dashboard-e2e-changes filter should not fire for ${rel}`);
  }
});

test('the specs and the Playwright config import only from the dashboard and shared', () => {
  assert.ok(specFiles.length > 20, `only ${specFiles.length} spec files found: the scan stopped matching`);
  const outside = [];
  for (const file of specFiles) {
    const text = read(file);
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*'(\.{1,2}\/[^']+)'/g)) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1]));
      if (!filter.test(resolved)) outside.push(`${file}: ${m[1]} -> ${resolved}`);
    }
    // A path built from the repo root (path.join(repo, ...), a fixture read) must stay inside, too.
    for (const m of text.matchAll(/['"`]((?:scripts|deploy|docs|tools|packages)\/[\w./-]+)/g)) {
      if (!filter.test(m[1])) outside.push(`${file}: ${m[1]}`);
    }
    // Climbing out of the package folder with a string path is also a way to read something wider.
    for (const m of text.matchAll(/['"`](\.\.\/[^'"`]*)['"`]/g)) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1]));
      if (!filter.test(resolved)) outside.push(`${file}: ${m[1]} -> ${resolved}`);
    }
  }
  assert.deepEqual(outside, [], 'a browser test reads a path the dashboard-e2e-changes filter does not cover');
});

test('the dashboard code under test depends on no workspace the filter misses', () => {
  const pkg = JSON.parse(read('packages/cogm-dashboard/package.json'));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter(d => d.startsWith('@gnuminator/'));
  assert.deepEqual(
    deps.filter(d => d !== '@gnuminator/cogm-dashboard').sort(),
    ['@gnuminator/shared'],
    'the dashboard depends on another workspace: add its folder to the dashboard-e2e-changes pattern'
  );
  const outside = [];
  const walk = dir => {
    for (const e of readdirSync(path.join(repo, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (!/^(node_modules|dist|storybook-static|test-results|playwright-report)$/.test(e.name)) walk(rel);
      } else if (/\.(?:ts|tsx|mjs)$/.test(e.name)) {
        for (const m of read(rel).matchAll(/(?:from|import)\s*\(?\s*'(\.{1,2}\/[^']+)'/g)) {
          const resolved = path.posix.normalize(path.posix.join(dir, m[1]));
          if (!filter.test(resolved)) outside.push(`${rel}: ${m[1]} -> ${resolved}`);
        }
        if (/from '@gnuminator\/(?!shared|cogm-dashboard)/.test(read(rel))) outside.push(`${rel}: imports another workspace`);
      }
    }
  };
  for (const d of ['packages/cogm-dashboard/src', 'packages/cogm-dashboard/web/src']) walk(d);
  assert.deepEqual(outside, [], 'dashboard code imports a path the dashboard-e2e-changes filter does not cover');
});

test('the shard job: needs the filter, runs only when it says so, not fail-fast, shards add up', () => {
  const job = doc.jobs['dashboard-e2e-shard'];
  assert.equal(job.needs, 'dashboard-e2e-changes');
  assert.match(job.if, /dashboard-e2e-changes\.outputs\.run == 'true'/);
  assert.equal(job.strategy['fail-fast'], false);
  assert.equal(job['timeout-minutes'], 20);
  const shards = job.strategy.matrix.shard;
  assert.deepEqual(
    shards,
    shards.map((_, i) => i + 1),
    'the shard list must be 1..N'
  );
  const run = job.steps.map(s => s.run ?? '').find(r => r.includes('test:e2e'));
  assert.ok(run, 'no shard step runs test:e2e');
  const m = /--shard=\$\{\{ matrix\.shard \}\}\/(\d+)/.exec(run);
  assert.ok(m, 'the e2e step passes no --shard=i/N');
  assert.equal(Number(m[1]), shards.length, 'the N of --shard=i/N differs from the matrix size');
  assert.match(job.name, new RegExp(`/${shards.length}`), 'the shard check name states another N');
  // Same Chromium install script as before (retries a DNS blip) and the build the specs run against.
  const all = job.steps.map(s => s.run ?? '').join('\n');
  assert.match(all, /bash scripts\/ci-install-chromium\.sh/);
  assert.match(all, /npm run build:shared/);
  assert.match(all, /npm run build -w @gnuminator\/cogm-dashboard/);
  assert.ok(existsSync(path.join(repo, 'scripts/ci-install-chromium.sh')));
});

test('the summary job is one check: green when every shard passed or was skipped, red otherwise', () => {
  const summary = doc.jobs['dashboard-e2e'];
  assert.match(summary.name, /^dashboard-e2e \(browser tests\)/);
  assert.deepEqual([...summary.needs].sort(), ['dashboard-e2e-changes', 'dashboard-e2e-shard']);
  assert.match(summary.if, /!cancelled\(\)/, 'without !cancelled() a red shard would leave the summary skipped');
  const run = summary.steps.map(s => s.run ?? '').join('\n');
  assert.match(run, /success\|skipped\) ;;/);
  assert.match(run, /exit 1/);
  const holders = Object.entries(doc.jobs).filter(([, j]) => String(j.name).startsWith('dashboard-e2e (browser tests)'));
  assert.deepEqual(
    holders.map(([id]) => id),
    ['dashboard-e2e']
  );
});

test('build-test no longer runs the browser tests (they would run twice)', () => {
  const steps = doc.jobs['build-test'].steps;
  for (const s of steps) {
    assert.ok(!String(s.run ?? '').includes('test:e2e'), `build-test still runs test:e2e in "${s.name}"`);
  }
  assert.equal(doc.jobs['build-test']['timeout-minutes'], 25);
});
