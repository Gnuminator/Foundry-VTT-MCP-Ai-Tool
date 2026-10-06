// Tests for the storage space check (docs/dev/PI-SETUP.md, "Storage space check"):
//   node --test scripts/pi/space-check.test.mjs
// - the Pi stage scripts parse (bash -n) and the checker they install writes the JSON of the contract;
// - the nightly backup calls the checker before it stops Foundry;
// - the PC helper's level logic and its handling of the Pi's status (needs PowerShell 7, else skipped).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const remote = path.join(repo, 'scripts', 'pi', 'remote');
const slash = p => p.replace(/\\/g, '/');
const hasBash = spawnSync('bash', ['-c', 'true']).status === 0;
const pwshProbe = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major']);
const hasPwsh = pwshProbe.status === 0 && Number(String(pwshProbe.stdout).trim()) >= 7;

/** The text of a quoted heredoc (<<'NAME' ... NAME) inside a stage script. */
function heredoc(stageFile, name) {
  const lines = readFileSync(path.join(remote, stageFile), 'utf8').split('\n');
  const start = lines.findIndex(l => l.includes(`<<'${name}'`));
  assert.ok(start >= 0, `${stageFile} has no <<'${name}' heredoc`);
  const end = lines.findIndex((l, i) => i > start && l === name);
  assert.ok(end > start, `${stageFile} never closes ${name}`);
  return lines.slice(start + 1, end).join('\n') + '\n';
}

let tmp;
before(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'space-check-test-'));
});
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('Pi scripts', { skip: !hasBash && 'bash is not available' }, () => {
  test('stage 10, stage 6 and the scripts they install parse (bash -n)', () => {
    const lib = readFileSync(path.join(remote, 'lib.sh'), 'utf8');
    const parts = {
      '10-space-check.sh (with lib.sh)': lib + '\n' + readFileSync(path.join(remote, '10-space-check.sh'), 'utf8'),
      '6-backup.sh (with lib.sh)': lib + '\n' + readFileSync(path.join(remote, '6-backup.sh'), 'utf8'),
      'the checker': heredoc('10-space-check.sh', 'SPACE_CHECK'),
      'the backup script': heredoc('6-backup.sh', 'BACKUP_SCRIPT'),
    };
    for (const [name, text] of Object.entries(parts)) {
      const r = spawnSync('bash', ['-n'], { input: text, encoding: 'utf8' });
      assert.equal(r.status, 0, `${name}: ${r.stderr}`);
    }
  });

  test('the nightly backup runs the space check before it stops Foundry, and skips at exit 3', () => {
    const script = heredoc('6-backup.sh', 'BACKUP_SCRIPT');
    const check = script.indexOf('/opt/foundry-ai-tool/space/space-check.sh');
    const stop = script.indexOf('systemctl stop foundry.service');
    assert.ok(check > 0 && stop > check, 'the pre-check must come before systemctl stop');
    assert.match(script, /space_rc" = 3/);
    assert.match(script, /--job "restic backup"/);
    // Only the first restic run may follow the check; nothing in the pre-check may fail the script on its own.
    assert.match(script, /\|\| space_rc=\$\?/);
  });

  // A fake df: the last argument is the path; a, a2 share one filesystem, b is 12% free, c is 3% free.
  const fakeDf = `#!/usr/bin/env bash
path="\${@: -1}"
echo "Filesystem 1-blocks Used Available Capacity Mounted on"
case "$(basename "$path")" in
a | a2) echo "/dev/a 1000000000 368000000 632000000 37% /mnt/a" ;;
b) echo "/dev/b 1000000000 880000000 120000000 88% /mnt/b" ;;
c) echo "/dev/c 1000000000 970000000 30000000 97% /mnt/c" ;;
*) exit 1 ;;
esac
`;
  let env;
  let dirs;
  let statusFile;
  const run = (args = [], extra = {}) => {
    const checker = path.join(tmp, 'space-check.sh');
    return spawnSync('bash', [slash(checker), ...args], { env: { ...process.env, ...env, ...extra }, encoding: 'utf8' });
  };
  const readStatus = () => JSON.parse(readFileSync(statusFile, 'utf8'));

  before(() => {
    writeFileSync(path.join(tmp, 'space-check.sh'), heredoc('10-space-check.sh', 'SPACE_CHECK'));
    const df = path.join(tmp, 'fake-df.sh');
    writeFileSync(df, fakeDf);
    chmodSync(df, 0o755);
    dirs = Object.fromEntries(['a', 'a2', 'b', 'c'].map(n => [n, slash(path.join(tmp, 'disks', n))]));
    for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
    statusFile = slash(path.join(tmp, 'status', 'status.json'));
    env = {
      FOUNDRY_AI_SPACE_STATUS: statusFile,
      FOUNDRY_AI_SPACE_DF: slash(df),
      FOUNDRY_AI_SPACE_HOST: 'foundry-pi',
      FOUNDRY_AI_SPACE_ENTRIES: [
        `${dirs.a}|restic backup (source);Syncthing vault (source)`,
        `${dirs.a2}|restic backup (source)`,
        `${dirs.b}|restic backup (destination)`,
        `${slash(path.join(tmp, 'disks', 'missing'))}|recordings`,
        `${dirs.c}|snapshot pull (source);system snapshots (destination)`,
      ].join('\n'),
    };
  });

  test('the hourly run writes the JSON of the contract', () => {
    const r = run();
    assert.equal(r.status, 0, r.stderr);
    const s = readStatus();
    assert.equal(s.version, 1);
    assert.equal(s.host, 'foundry-pi');
    assert.equal(s.thresholdPercent, 20);
    assert.equal(s.criticalPercent, 5);
    assert.match(s.checkedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.equal(s.level, 'critical');
    assert.equal(s.lastJob, undefined);
    // One entry per filesystem, in the order the paths were listed; the missing path is skipped.
    assert.deepEqual(
      s.disks.map(d => [d.mount, d.level, d.freePercent]),
      [
        ['/mnt/a', 'ok', 63.2],
        ['/mnt/b', 'low', 12],
        ['/mnt/c', 'critical', 3],
      ]
    );
    assert.deepEqual(s.disks[0].paths, [dirs.a, dirs.a2]);
    assert.deepEqual(s.disks[0].jobs, ['restic backup (source)', 'Syncthing vault (source)']);
    assert.equal(s.disks[0].totalBytes, 1000000000);
    assert.equal(s.disks[0].freeBytes, 632000000);
    assert.ok(!JSON.stringify(s).includes('missing'));
    // Written atomically: no temp file is left in the folder.
    assert.deepEqual(readdirSync(path.dirname(statusFile)), ['status.json']);
    // Low and critical disks are named on stderr (the journal).
    assert.match(r.stderr, /WARNING: disk \/mnt\/b has 12\.0% free/);
    assert.match(r.stderr, /CRITICAL: disk \/mnt\/c has 3\.0% free/);
    assert.doesNotMatch(r.stderr, /\/mnt\/a/);
  });

  test('a job is blocked only by the disks that list it, and records lastJob', () => {
    // The critical disk c belongs to the snapshot pull, not to the restic backup: the backup runs.
    let r = run(['--job', 'restic backup']);
    assert.equal(r.status, 0, r.stderr);
    let s = readStatus();
    assert.equal(s.level, 'critical');
    assert.equal(s.lastJob.name, 'restic backup');
    assert.equal(s.lastJob.level, 'low');
    assert.equal(s.lastJob.ran, true);
    assert.match(s.lastJob.at, /^\d{4}-\d\d-\d\dT/);
    // The snapshot pull is blocked: exit 3, ran false.
    r = run(['--job', 'snapshot pull']);
    assert.equal(r.status, 3, r.stderr);
    s = readStatus();
    assert.equal(s.lastJob.level, 'critical');
    assert.equal(s.lastJob.ran, false);
  });

  test('less free space than the job needs is critical on the destination', () => {
    // Disk b has 120 MB free (12%): fine for 100 MB, critical for 150 MB.
    let r = run(['--job', 'restic backup', '--need-bytes', '100000000', '--need-path', dirs.b]);
    assert.equal(r.status, 0, r.stderr);
    r = run(['--job', 'restic backup', '--need-bytes', '150000000', '--need-path', dirs.b]);
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /CRITICAL: disk \/mnt\/b/);
    assert.match(r.stderr, /restic backup needs about 0\.1 GB on \/mnt\/b/);
    assert.equal(readStatus().lastJob.ran, false);
  });

  test('the hourly run keeps the last job and the output is valid on a bad option', () => {
    run(['--job', 'restic backup']);
    const before = readStatus().lastJob;
    run();
    assert.deepEqual(readStatus().lastJob, before);
    const r = run(['--nonsense']);
    assert.equal(r.status, 64);
    const bad = run(['--need-bytes', 'lots']);
    assert.equal(bad.status, 64);
  });

  test('--print shows the JSON without writing, and no existing path means an empty list', () => {
    rmSync(statusFile, { force: true });
    const r = run(['--print']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).disks.length, 3);
    assert.ok(!existsSync(statusFile));
    const none = run(['--print'], { FOUNDRY_AI_SPACE_ENTRIES: `${slash(path.join(tmp, 'nothing'))}|x` });
    assert.deepEqual(JSON.parse(none.stdout).disks, []);
    assert.equal(JSON.parse(none.stdout).level, 'ok');
  });
});

describe('PC helper (space-check.ps1)', { skip: !hasPwsh && 'PowerShell 7 is not available' }, () => {
  const helper = path.join(repo, 'scripts', 'pi', 'space-check.ps1');
  const pwsh = script => {
    const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', `. '${helper}'; ${script}`], {
      encoding: 'utf8',
      env: process.env,
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    return r.stdout.trim();
  };

  test('levels: ok from 20%, low below 20%, critical below 5% or below what the job needs', () => {
    const out = pwsh(`
      @(
        (Get-SpaceLevel -FreePercent 63.2),
        (Get-SpaceLevel -FreePercent 20),
        (Get-SpaceLevel -FreePercent 19.9),
        (Get-SpaceLevel -FreePercent 5),
        (Get-SpaceLevel -FreePercent 4.9),
        (Get-SpaceLevel -FreePercent 50 -FreeBytes 100 -NeedBytes 200),
        (Get-SpaceLevel -FreePercent 50 -FreeBytes 300 -NeedBytes 200)
      ) -join ','`);
    assert.equal(out, 'ok,ok,low,low,critical,critical,ok');
  });

  /** Runs Invoke-SpaceCheck against a fake ssh that serves a status file; returns what it did. */
  function check({ mode = 'ok', ageHours = 1, simulate = -1, level = 'low', freePercent = 12 }) {
    const ssh = path.join(tmp, 'fake-ssh.ps1');
    writeFileSync(ssh, `if ($env:FAKE_SSH_MODE -eq 'down') { exit 255 }\nif ($env:FAKE_SSH_MODE -eq 'missing') { exit 1 }\nGet-Content -Raw $env:FAKE_SSH_STATUS\nexit 0\n`);
    const statusPath = path.join(tmp, 'pi-status.json');
    writeFileSync(
      statusPath,
      JSON.stringify({
        version: 1,
        checkedAt: new Date(Date.now() - ageHours * 3600e3).toISOString(),
        host: 'foundry-pi',
        level,
        disks: [
          { mount: '/', paths: ['/var/lib/foundry-backup/restic'], jobs: ['restic backup (destination)'], totalBytes: 60e9, freeBytes: (60e9 * freePercent) / 100, freePercent, level },
          { mount: '/data', paths: ['/mnt/other'], jobs: ['other'], totalBytes: 60e9, freeBytes: 1e9, freePercent: 1.7, level: 'critical' },
        ],
      })
    );
    const dest = path.join(tmp, 'dest');
    mkdirSync(dest, { recursive: true });
    const script = `
      $lines = [System.Collections.Generic.List[string]]::new()
      $r = Invoke-SpaceCheck -Job 'restic copy' -Destinations @('${dest}') -PiHost foundry-pi -Ssh '${ssh}' \`
        -PiPaths @('/var/lib/foundry-backup/restic') -Log { param($m) $lines.Add($m) } -Test -SimulateFreePercent ${simulate}
      [pscustomobject]@{ level = $r.Level; skip = $r.Skip; reason = $r.SkipReason; lines = @($lines); toasts = @($r.Notifications | ForEach-Object { $_.Title + ' | ' + $_.Message }) } | ConvertTo-Json -Compress -Depth 4`;
    const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', `. '${helper}'; ${script}`], {
      encoding: 'utf8',
      env: { ...process.env, FAKE_SSH_MODE: mode, FAKE_SSH_STATUS: statusPath },
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    return JSON.parse(r.stdout.trim());
  }

  test('a low Pi source warns and notifies with disk, percent, GB and job; it does not skip', () => {
    const r = check({});
    const lines = r.lines.join('\n');
    assert.match(lines, /WARNING: space is low: the Pi's disk \/ has 12\.0% free \(6\.\d GB of 55\.\d GB\)\. Job: restic backup \(destination\)\./);
    assert.ok(!lines.includes('/data'), 'a Pi disk without the job path is not reported');
    assert.equal(r.skip, false);
    assert.ok(r.toasts.some(t => t.startsWith('Foundry AI Tool: low disk space | The Pi\'s disk / has 12.0% free')), r.toasts.join('\n'));
    assert.match(lines, /test: would notify/);
  });

  test('critical on the PC destination skips the copy; critical on the Pi source does not', () => {
    const local = check({ simulate: 3 });
    assert.equal(local.skip, true);
    assert.match(local.reason, /the restic copy is skipped: space is critical on this PC's disk/);
    assert.equal(local.level, 'critical');
    const pi = check({ level: 'critical', freePercent: 2 });
    assert.equal(pi.skip, false, 'the Pi source never blocks the copy');
    assert.match(pi.lines.join('\n'), /CRITICAL: space is critical: the Pi's disk \//);
  });

  test('a missing, unreachable or stale Pi status is a warning, not an error', () => {
    for (const [opts, expect] of [
      [{ mode: 'missing' }, /no space status yet/],
      [{ mode: 'down' }, /does not answer over SSH/],
      [{ ageHours: 5 }, /is 5 hours old/],
    ]) {
      const r = check(opts);
      assert.equal(r.skip, false);
      assert.match(r.lines.join('\n'), expect);
      assert.match(r.lines.join('\n'), /WARNING: space check:/);
    }
  });
});
