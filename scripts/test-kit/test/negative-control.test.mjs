import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const kit = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'kit.mjs');

// The negative control: with the bridge, dashboard, GM page and browser all dead, every scenario
// of every size must fail. One that still passes (or skips) tests nothing.
for (const size of ['smoke', 'full', 'long']) {
  test(`${size}: every scenario fails when the bridge is stopped`, () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'kit-negative-'));
    try {
      const run = spawnSync(
        process.execPath,
        [
          kit,
          'run',
          '--fake',
          '--stopped-bridge',
          '--size',
          size,
          '--report-dir',
          path.join(dir, 'report'),
        ],
        { encoding: 'utf8', timeout: 150000, env: { ...process.env, TEST_KIT_HOME: dir } }
      );
      const report = JSON.parse(readFileSync(path.join(dir, 'report', 'report.json'), 'utf8'));
      assert.ok(report.scenarios.length > 0, `no scenarios ran\n${run.stdout}\n${run.stderr}`);
      const notFailed = report.scenarios
        .filter((/** @type {any} */ s) => s.status !== 'fail' && s.status !== 'error')
        .map((/** @type {any} */ s) => `${s.id} (${s.status})`);
      assert.deepEqual(notFailed, [], 'scenarios that do not fail against a stopped bridge');
      assert.notEqual(run.status, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
