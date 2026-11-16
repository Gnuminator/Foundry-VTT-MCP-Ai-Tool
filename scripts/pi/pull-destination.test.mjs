// Tests for the pull scripts' drive check and snapshot age (backlog backup-truth):
//   node --test scripts/pi/pull-destination.test.mjs
// - Test-PullDestination logs an unplugged drive to a fallback log on the PC's own disk and returns false;
// - Get-NewestSnapshotAgeDays measures the snapshot's own time;
// - both pull scripts check the drive before they create anything, and judge freshness by the snapshot's age.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const helper = path.join(repo, 'scripts', 'pi', 'pull-destination.ps1');
const lf = t => t.replace(/\r\n/g, '\n');
const probe = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major']);
const hasPwsh = probe.status === 0 && Number(String(probe.stdout).trim()) >= 7;

let tmp;
before(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'pull-dest-test-'));
});
after(() => rmSync(tmp, { recursive: true, force: true }));

function ps(script) {
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', `. '${helper}'; ${script}`], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return r.stdout.trim();
}

describe('PC functions (pull-destination.ps1)', { skip: !hasPwsh && 'PowerShell 7 is not available' }, () => {
  test('a drive that is there passes and writes no fallback log', () => {
    const log = path.join(tmp, 'fb-ok.log');
    const out = ps(`Test-PullDestination -Destination '${tmp}' -Job 'pull-test' -FallbackLog '${log}'`);
    assert.equal(out, 'True');
    assert.equal(existsSync(log), false);
  });

  test('an unplugged drive is logged on the fallback log and reported as false', () => {
    // A drive letter that is not in use (the last free one from Z down).
    const free = [...'ZYXWVUTSRQPONMLKJIHGFEDCBA'].find(l => !existsSync(`${l}:\\`));
    assert.ok(free, 'no free drive letter');
    const log = path.join(tmp, 'sub', 'fb-missing.log');
    const out = ps(
      `Test-PullDestination -Destination '${free}:\\PiBackup' -Job 'pull-test' -FallbackLog '${log}'`
    );
    assert.equal(out.split(/\r?\n/).pop(), 'False');
    const text = readFileSync(log, 'utf8');
    assert.match(text, /pull-test: FAILED: the drive .* is not there \(unplugged\?\)/);
    assert.ok(text.includes(`${free}:\\PiBackup`));
  });

  test('a destination with no drive letter is not checked', () => {
    assert.equal(ps(`Test-PullDestination -Destination 'relative-folder' -Job 'x' -FallbackLog '${path.join(tmp, 'x.log')}'`), 'True');
  });

  test('the age is of the snapshot itself, in days', () => {
    const out = ps(
      `[math]::Round((Get-NewestSnapshotAgeDays ([datetimeoffset]::Now.AddDays(-5))), 1); ($null -eq (Get-NewestSnapshotAgeDays $null))`
    ).split(/\r?\n/);
    assert.equal(out[0], '5');
    assert.equal(out[1], 'True');
  });
});

describe('the pull scripts', () => {
  const restic = lf(readFileSync(path.join(repo, 'scripts', 'pi', 'pull-restic.ps1'), 'utf8'));
  const snapshot = lf(readFileSync(path.join(repo, 'scripts', 'pi', 'pull-snapshot.ps1'), 'utf8'));

  test('both check the drive before they create any folder or log', () => {
    for (const [name, text] of [['restic', restic], ['snapshot', snapshot]]) {
      const check = text.indexOf('Test-PullDestination');
      const create = text.indexOf('New-Item -ItemType Directory');
      assert.ok(check > 0 && create > check, `${name}: the drive check comes before New-Item`);
      assert.match(text, /Test-PullDestination[^\n]*\{ exit 1 \}/);
    }
  });

  test('the snapshot script judges freshness by the snapshot, not the file, and records only a fresh one', () => {
    assert.doesNotMatch(snapshot, /Sort-Object LastWriteTime/);
    assert.doesNotMatch(snapshot, /\$newest\.LastWriteTime/);
    assert.match(snapshot, /Get-NewestSnapshotAgeDays/);
    assert.match(snapshot, /if \(\$snapAgeDays -gt \$WarnAfterDays\)/);
  });
});
