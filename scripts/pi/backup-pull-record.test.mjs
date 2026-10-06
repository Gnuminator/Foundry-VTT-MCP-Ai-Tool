// Tests for the record of the PC's backup copies (PB-06; docs/dev/PI-SETUP.md, "Stale backup copies"):
//   node --test scripts/pi/backup-pull-record.test.mjs
// - stage 6 parses (bash -n) and installs the helper record-pull.sh and its folder;
// - the helper writes <kind>.json (the format the Discord bot reads), refuses anything but
//   restic|snapshot and leaves no temp file;
// - both pull scripts tell the Pi only after a successful run, never in a dry run;
// - the PC function Send-PullRecord runs the one fixed ssh command and never throws (needs PowerShell 7).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  const lines = readFileSync(path.join(remote, stageFile), 'utf8').split(/\r?\n/);
  const start = lines.findIndex(l => l.includes(`<<'${name}'`));
  assert.ok(start >= 0, `${stageFile} has no <<'${name}' heredoc`);
  const end = lines.findIndex((l, i) => i > start && l === name);
  assert.ok(end > start, `${stageFile} never closes ${name}`);
  return lines.slice(start + 1, end).join('\n') + '\n';
}

const lf = text => text.replace(/\r\n/g, '\n');

let tmp;
before(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'backup-pull-test-'));
});
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('Pi side (stage 6)', { skip: !hasBash && 'bash is not available' }, () => {
  test('stage 6 and the helper it installs parse (bash -n)', () => {
    const lib = readFileSync(path.join(remote, 'lib.sh'), 'utf8');
    const stage = lib + '\n' + readFileSync(path.join(remote, '6-backup.sh'), 'utf8');
    for (const [name, text] of Object.entries({ 'stage 6 (with lib.sh)': stage, 'the helper': heredoc('6-backup.sh', 'RECORD_PULL') })) {
      const r = spawnSync('bash', ['-n'], { input: text, encoding: 'utf8' });
      assert.equal(r.status, 0, `${name}: ${r.stderr}`);
    }
  });

  test('stage 6 makes the folder and installs the helper where the PC script calls it', () => {
    const stage = lf(readFileSync(path.join(remote, '6-backup.sh'), 'utf8'));
    assert.match(stage, /pulls_dir="\$TOOL_DATA\/backup-pulls"/);
    assert.match(stage, /install -d -m 0755 -o root -g root "\$pulls_dir"/);
    assert.match(stage, /record_script="\$script_dir\/record-pull\.sh"/);
    assert.match(stage, /write_file "\$record_script" 0755/);
    // script_dir is /opt/foundry-ai-tool/backup: the path record-pull.ps1 calls.
    assert.match(stage, /script_dir="\$TOOL_DIR\/backup"/);
    assert.match(readFileSync(path.join(repo, 'scripts', 'pi', 'record-pull.ps1'), 'utf8'), /\/opt\/foundry-ai-tool\/backup\/record-pull\.sh/);
    // The stage never removes anything for this: no rm in the new section (the helper's own trap is inside the heredoc).
    const section = stage.slice(stage.indexOf('the record of the PC'), stage.indexOf('say "the timer"')).replace(/<<'RECORD_PULL'[\s\S]*\nRECORD_PULL\n/, '');
    assert.doesNotMatch(section, /\brm\b/);
  });

  test('the helper writes the file the bot reads, for each kind, and replaces it on the next run', () => {
    const helper = path.join(tmp, 'record-pull.sh');
    writeFileSync(helper, heredoc('6-backup.sh', 'RECORD_PULL'));
    chmodSync(helper, 0o755);
    const dir = path.join(tmp, 'pulls');
    const run = kind => spawnSync('bash', [slash(helper), kind], { encoding: 'utf8', env: { ...process.env, FOUNDRY_AI_BACKUP_PULLS: slash(dir) } });
    const started = Date.now();
    for (const kind of ['restic', 'snapshot']) {
      const r = run(kind);
      assert.equal(r.status, 0, r.stderr);
      const file = JSON.parse(readFileSync(path.join(dir, `${kind}.json`), 'utf8'));
      assert.deepEqual(Object.keys(file), ['version', 'kind', 'pulledAt']);
      assert.equal(file.version, 1);
      assert.equal(file.kind, kind);
      assert.match(file.pulledAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      const at = Date.parse(file.pulledAt);
      assert.ok(at >= started - 2000 && at <= Date.now() + 2000, file.pulledAt);
    }
    assert.deepEqual(readdirSync(dir).sort(), ['restic.json', 'snapshot.json'], 'no temp file is left behind');
    const second = run('restic');
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(readdirSync(dir).sort(), ['restic.json', 'snapshot.json']);
  });

  test('the helper refuses anything but restic or snapshot and writes nothing', () => {
    const helper = path.join(tmp, 'record-pull-refuse.sh');
    writeFileSync(helper, heredoc('6-backup.sh', 'RECORD_PULL'));
    const dir = path.join(tmp, 'pulls-refuse');
    for (const arg of [[], [''], ['other'], ['restic; touch pwned'], ['../restic'], ['RESTIC']]) {
      const r = spawnSync('bash', [slash(helper), ...arg], { encoding: 'utf8', cwd: tmp, env: { ...process.env, FOUNDRY_AI_BACKUP_PULLS: slash(dir) } });
      assert.equal(r.status, 64, `${JSON.stringify(arg)}: ${r.stderr}`);
      assert.match(r.stderr, /usage: record-pull\.sh restic\|snapshot/);
    }
    assert.ok(!existsSync(dir), 'a refused call does not even make the folder');
    assert.ok(!existsSync(path.join(tmp, 'pwned')));
  });
});

describe('PC scripts', () => {
  const restic = lf(readFileSync(path.join(repo, 'scripts', 'pi', 'pull-restic.ps1'), 'utf8'));
  const snapshot = lf(readFileSync(path.join(repo, 'scripts', 'pi', 'pull-snapshot.ps1'), 'utf8'));

  test('pull-restic tells the Pi only after the whole copy succeeded, never in a dry run or for a test repository', () => {
    assert.match(restic, /record-pull\.ps1/);
    const ok = restic.indexOf("Write-Log 'ok'");
    const send = restic.indexOf('Send-PullRecord -Kind restic');
    const dry = restic.indexOf('if ($DryRun) {\n    Write-Log "dry run: would copy');
    const elseAt = restic.indexOf('} else {\n    Write-Log "copy: new snapshots');
    assert.ok(ok > 0 && send > ok, 'the record comes after the final ok line');
    assert.ok(dry > 0 && elseAt > dry && send > elseAt, 'the record is inside the non-dry-run branch');
    assert.match(restic, /if \(\$sftpHost\) \{ \[void\]\(Send-PullRecord/);
    assert.ok(restic.indexOf('} catch {', send) > send, 'and inside the try block, so a failed copy never records');
  });

  test('pull-snapshot tells the Pi after its success file, not in a dry run, and not on a skip while dietpi-backup runs', () => {
    assert.match(snapshot, /record-pull\.ps1/);
    const send = snapshot.indexOf('Send-PullRecord -Kind snapshot');
    const guard = snapshot.indexOf('if (-not $DryRun) {\n    Set-Content -Path $successFile');
    const skip = snapshot.indexOf('skip: dietpi-backup is running');
    assert.ok(guard > 0 && send > guard, 'inside the not-a-dry-run block');
    assert.ok(skip > 0 && skip < send, 'the early exit for a running dietpi-backup comes first and records nothing');
    assert.ok(snapshot.indexOf('} catch {', send) > send, 'inside the try block');
  });
});

describe('PC function (record-pull.ps1)', { skip: !hasPwsh && 'PowerShell 7 is not available' }, () => {
  const helper = path.join(repo, 'scripts', 'pi', 'record-pull.ps1');

  /** Runs Send-PullRecord with a fake ssh (a .ps1) that stores its arguments and exits with `code`. */
  function send({ kind = 'restic', code = 0, ssh }) {
    const argsFile = path.join(tmp, 'ssh-args.txt');
    rmSync(argsFile, { force: true });
    const fake = path.join(tmp, 'fake-ssh.ps1');
    writeFileSync(fake, `Set-Content -Path $env:FAKE_SSH_ARGS -Value ($args -join '|')\nif ($env:FAKE_SSH_CODE -eq '127') { 'sh: 1: not found' }\nexit [int]$env:FAKE_SSH_CODE\n`);
    const script = `
      $lines = [System.Collections.Generic.List[string]]::new()
      $r = Send-PullRecord -Kind ${kind} -PiHost foundry-pi -Ssh '${ssh ?? fake}' -Log { param($m) $lines.Add($m) }
      [pscustomobject]@{ ok = $r; lines = @($lines) } | ConvertTo-Json -Compress`;
    const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', `. '${helper}'; ${script}`], {
      encoding: 'utf8',
      env: { ...process.env, FAKE_SSH_ARGS: argsFile, FAKE_SSH_CODE: String(code) },
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    return { ...JSON.parse(r.stdout.trim()), args: existsSync(argsFile) ? readFileSync(argsFile, 'utf8').trim() : null };
  }

  test('runs the one fixed command with no prompts and logs a success', () => {
    const r = send({ kind: 'snapshot' });
    assert.equal(r.ok, true);
    assert.equal(r.args, '-o|BatchMode=yes|-o|ConnectTimeout=10|foundry-pi|/opt/foundry-ai-tool/backup/record-pull.sh snapshot');
    assert.deepEqual(r.lines, ['recorded on the Pi: the snapshot copy is done']);
  });

  test('a Pi that is off, lacks the helper or fails only warns and returns false', () => {
    const off = send({ code: 255 });
    assert.equal(off.ok, false);
    assert.match(off.lines.join('\n'), /^WARNING: could not tell the Pi about the restic copy \(exit 255\) \(the Pi did not answer\)/);
    const old = send({ code: 127 });
    assert.equal(old.ok, false);
    assert.match(old.lines.join('\n'), /run Pi stage 6 again to install the helper/);
    const bad = send({ code: 64 });
    assert.equal(bad.ok, false);
    assert.match(bad.lines.join('\n'), /exit 64/);
  });

  test('an ssh program that is missing does not throw', () => {
    const r = send({ ssh: path.join(tmp, 'no-such-ssh.exe') });
    assert.equal(r.ok, false);
    assert.match(r.lines.join('\n'), /^WARNING: could not tell the Pi about the restic copy/);
  });

  test('only restic and snapshot are accepted as the kind', () => {
    const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', `. '${helper}'; Send-PullRecord -Kind other -PiHost x`], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
  });

  test('uses no em dashes', () => {
    const dash = String.fromCharCode(0x2014);
    assert.ok(!readFileSync(helper, 'utf8').includes(dash));
  });
});
