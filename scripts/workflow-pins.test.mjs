/**
 * Workflow hardening guards: every `uses:` in .github/workflows is pinned to a 40-character commit
 * (version as a comment), and the job of release.yml that publishes runs in the environment
 * `release`, where the user has to click Approve.
 *
 *   node --test scripts/workflow-pins.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, '.github', 'workflows');

/** Every `uses:` value of a parsed workflow (steps and reusable-workflow jobs). @param {any} doc */
export function usesOf(doc) {
  /** @type {string[]} */
  const out = [];
  for (const job of Object.values(doc?.jobs ?? {})) {
    const j = /** @type {any} */ (job);
    if (typeof j?.uses === 'string') out.push(j.uses);
    for (const step of Array.isArray(j?.steps) ? j.steps : []) {
      if (typeof step?.uses === 'string') out.push(step.uses);
    }
  }
  return out;
}

/** Local actions (`./...`) and docker images pinned by digest are fine; the rest needs a commit. @param {string} u */
export function isPinned(u) {
  if (u.startsWith('./')) return true;
  if (u.startsWith('docker://')) return /@sha256:[0-9a-f]{64}$/.test(u);
  return /@[0-9a-f]{40}$/.test(u);
}

/** Jobs of a release workflow that publish (write contents) but name no environment `release`. @param {any} doc */
export function publishJobsWithoutEnvironment(doc) {
  return Object.entries(doc?.jobs ?? {})
    .filter(([, job]) => /** @type {any} */ (job)?.permissions?.contents === 'write')
    .filter(([, job]) => {
      const env = /** @type {any} */ (job).environment;
      return (typeof env === 'string' ? env : env?.name) !== 'release';
    })
    .map(([name]) => name);
}

test('every uses: in .github/workflows is pinned to a full commit', () => {
  const bad = [];
  for (const f of fs.readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const u of usesOf(yaml.load(text))) if (!isPinned(u)) bad.push(`${f}: ${u}`);
    // The version stays visible as a comment after the commit.
    for (const line of text.split('\n')) {
      const m = line.match(/uses:\s*[^\s@]+@[0-9a-f]{40}(.*)$/);
      if (m && !/^\s+#\s*v\d+\.\d+\.\d+/.test(m[1])) bad.push(`${f}: no "# vX.Y.Z" comment on: ${line.trim()}`);
    }
  }
  assert.deepEqual(bad, [], `unpinned or uncommented actions:\n${bad.join('\n')}`);
});

test('release.yml: the publish job runs in the environment "release"', () => {
  const doc = /** @type {any} */ (
    yaml.load(fs.readFileSync(path.join(dir, 'release.yml'), 'utf8'))
  );
  assert.ok(doc.jobs.publish, 'release.yml has a publish job');
  assert.deepEqual(publishJobsWithoutEnvironment(doc), []);
  const env = doc.jobs.publish.environment;
  assert.equal(typeof env === 'string' ? env : env?.name, 'release');
});

test('the guards catch a bad workflow', () => {
  assert.equal(isPinned('actions/checkout@v4'), false);
  assert.equal(isPinned('actions/checkout@main'), false);
  assert.equal(isPinned('actions/checkout@' + 'a'.repeat(40)), true);
  assert.equal(isPinned('./.github/actions/x'), true);
  assert.deepEqual(usesOf({ jobs: { a: { steps: [{ uses: 'x/y@v1' }] }, b: { uses: 'o/r/.github/workflows/w.yml@v2' } } }), [
    'x/y@v1',
    'o/r/.github/workflows/w.yml@v2',
  ]);
  assert.deepEqual(
    publishJobsWithoutEnvironment({ jobs: { publish: { permissions: { contents: 'write' } } } }),
    ['publish']
  );
  assert.deepEqual(
    publishJobsWithoutEnvironment({
      jobs: { publish: { environment: 'release', permissions: { contents: 'write' } } },
    }),
    []
  );
});
