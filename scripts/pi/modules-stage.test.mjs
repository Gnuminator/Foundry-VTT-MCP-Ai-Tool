// Tests for Pi stage 25 (scripts/pi/remote/25-modules.sh: the pinned module versions from the PC archive):
//   node --test scripts/pi/modules-stage.test.mjs
// - the stage as text: the guards a Pi stage needs (an EXIT trap, a state file, ${var:?} on every rm -rf, nothing
//   downloaded, no module switched on);
// - with PI_STAGE25_CONTAINER=1 (needs Docker; CI runs it on the ARM runner): the stage itself in a Debian 13 ARM64
//   container with stand-ins for systemd and curl (scripts/pi/container-test/stage25-scenarios.sh): a dry run that
//   changes nothing, the real run, a rerun, UNDO=1 with its read-back, a failed start, a browser that never joins, a
//   failed move and a version mismatch putting the old folders back, a crashed run refusing a new one, and the
//   refusals (a wrong sha256, a "../" entry, a link, a wrong id or version in the zip, an unsafe pin, players online).
//   The container-* scenarios run the stage on a simulated cut-over Pi (fake docker, units off): a dry run that changes
//   nothing, an APPLY that stops the browser then Foundry container, moves the folders, restarts Foundry, starts the
//   browser and reads the versions back without any systemctl start/restart, a failed stop, start or read-back that puts the
//   old folders and the containers back as they were, UNDO=1 (also after a killed run), players online and a mixed state refused.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runStageContainer } from './container-test/run-stage-container.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stage = readFileSync(path.join(repo, 'scripts/pi/remote/25-modules.sh'), 'utf8');
const code = stage
  .split('\n')
  .filter(line => !line.trimStart().startsWith('#'))
  .join('\n');

describe('stage 25 as text', () => {
  test('logs through lib.sh STAGE_LOG, reads back with browser_joined, no early-exit grep on a pipe', () => {
    assert.match(code, /STAGE_LOG="\$LOG_FILE"/);
    assert.doesNotMatch(code, /STATE_LOG/);
    assert.match(code, /browser_joined "\$GM_UNIT"/);
    assert.doesNotMatch(code, /(journalctl|unzip|curl)[^\n]*\|\s*grep -q/);
  });

  test('refuses a new run after one that did not finish, and checks the room once before unpacking', () => {
    assert.match(code, /state_get phase\)" = installing/);
    // two checks: the copies of the zips (before the first copy), then the unpacked room (before the first unpack)
    assert.equal(code.match(/check_room "/g).length, 2);
    assert.ok(code.indexOf('check_room "') < code.indexOf('cp -- "$zip"'));
    assert.match(code, /runuser -u "\$FOUNDRY_USER" -- unzip -q "\$work\/\$id\.zip"/);
    assert.ok(code.indexOf('check_room "') < code.indexOf('unzip -q "$work/$id.zip"'));
  });

  test('every rm -rf has a ${var:?} guard', () => {
    const lines = code.split('\n').filter(l => /\brm\s+(-\w*r\w*f|-\w*f\w*r)/.test(l));
    assert.ok(lines.length > 0);
    for (const l of lines) assert.match(l, /\$\{\w+:\?\}/, l);
  });

  test('restores on exit, keeps a state file, checks the snapshot and who is online', () => {
    assert.match(code, /^trap on_exit EXIT/m);
    assert.match(code, /state_get\(\)/);
    assert.match(code, /require_recent_snapshot/);
    assert.match(code, /require_quiet "installing modules"/);
    assert.match(code, /refuse_during_system_trial/);
    assert.match(code, /flock -n 9/);
  });

  test('never downloads and never switches a module on', () => {
    assert.doesNotMatch(code, /\bwget\b|\bcurl\b[^\n]*\s-o\s|https?:\/\/(?!127\.0\.0\.1)/);
    assert.doesNotMatch(code, /moduleConfiguration/);
  });

  test('works on units and containers: use_stack, and the four services only through svc_*', () => {
    assert.match(code, /^use_stack "stage 25 \(modules\)"/m);
    assert.doesNotMatch(code, /refuse_when_cut_over/);
    // no direct systemctl start/stop/restart/is-active and no journalctl -u of the stack: svc_* runs them on units
    assert.doesNotMatch(code, /systemctl\s+(start|stop|restart|try-restart|is-active|is-enabled)/);
    assert.doesNotMatch(code, /journalctl\s+-u\s+foundry-ai-tool/);
    assert.match(code, /svc_stop gm-browser[^\n]*\n\s*svc_stop foundry/);
    assert.match(code, /svc_restart foundry/);
    assert.match(code, /svc_gm_joined "\$gm_since"/);
    assert.match(code, /svc_logs_hint foundry/);
    // units mode keeps its enable_unit for the browser; containers mode starts the existing container
    assert.match(code, /enable_unit "\$GM_UNIT"/);
    assert.match(code, /svc_start gm-browser/);
    assert.match(code, /can_drive\(\) \{ \[ "\$STACK" = containers \] \|\| have_systemd; \}/);
  });

  test('the containers are never recreated', () => {
    assert.doesNotMatch(code, /docker compose|stack_compose|docker (rm|run|create)/);
  });

  test('a dry run (no APPLY) stops before the real run', () => {
    assert.ok(code.indexOf('if [ -z "$APPLY" ]; then') < code.indexOf('stop_services\nundo=1'));
  });
});

describe(
  'stage 25 in the ARM64 container',
  { skip: process.env.PI_STAGE25_CONTAINER !== '1' },
  () => {
    test('scenarios', () => {
      const res = runStageContainer('stage25-scenarios.sh');
      assert.equal(res.status, 0, res.stdout + res.stderr);
      assert.doesNotMatch(res.stdout, /FAIL/);
    });
  }
);
