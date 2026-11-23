/**
 * The installed nightly backup script of Pi stage 6 (foundry-backup.sh, written by scripts/pi/remote/6-backup.sh) in a
 * Debian 13 ARM64 container: a clean run, a player online and then gone, the GM browser restarted before the run, restic
 * failing, Foundry restarting during the copy (container stack). The host-side tests of the same script are in pi-stage-safety.test.mjs.
 *   PI_STAGE6_CONTAINER=1 node --test scripts/pi/backup-nightly-container.test.mjs   (needs Docker)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runStageContainer } from './container-test/run-stage-container.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = rel => readFileSync(path.join(repo, rel), 'utf8');

describe('stage 6 nightly script, text checks', () => {
  test('the scenario script cuts the nightly script out of the stage by its heredoc marker', () => {
    const stage = read('scripts/pi/remote/6-backup.sh');
    assert.match(stage, /^ {2}cat <<'BACKUP_SCRIPT'$/m);
    assert.match(stage, /^BACKUP_SCRIPT$/m);
    assert.match(read('scripts/pi/container-test/stage6-scenarios.sh'), /BACKUP_SCRIPT/);
  });
});

describe(
  'stage 6 nightly script in the ARM64 container',
  { skip: process.env.PI_STAGE6_CONTAINER !== '1' },
  () => {
    test('scenarios', () => {
      const r = runStageContainer('stage6-scenarios.sh', { timeout: 600000 });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.ok(r.stdout.includes('ALL SCENARIOS OK'), r.stdout);
    });
  }
);
