// Stage 15, SSH keys only (scripts/pi/remote/15-ssh-keys-only.sh, D-123).
//   node --test scripts/pi/ssh-keys-only.test.mjs                               (the static checks)
//   PI_SSH_KEYS_ONLY_CONTAINER=1 node --test scripts/pi/ssh-keys-only.test.mjs  (also the Docker scenarios)
// The scenarios (scripts/pi/container-test/ssh-keys-only-scenarios.sh) run the stage in a Debian 13 ARM64 container
// with the real OpenSSH server (sshd -t and sshd -T are the real ones) and stand-ins for systemctl and systemd-run:
// the drop-in and the values sshd then reports, every refusal and rollback, the reload and the safety timer.
// PI_SSH_KEYS_ONLY_OUTPUT=<file> reads a saved run instead of starting Docker.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stagePath = path.join(repo, 'scripts', 'pi', 'remote', '15-ssh-keys-only.sh');
const stage = readFileSync(stagePath, 'utf8');

const saved = process.env.PI_SSH_KEYS_ONLY_OUTPUT;
const containerReason = saved
  ? false
  : !process.env.PI_SSH_KEYS_ONLY_CONTAINER
    ? 'set PI_SSH_KEYS_ONLY_CONTAINER=1 to run the stage in a Docker ARM64 container'
    : spawnSync('docker', ['version'], { encoding: 'utf8' }).status !== 0 && 'no Docker here';
// In CI a missing Docker is a failure, not a skip: the step would go green without running a scenario.
const noDockerInCi = Boolean(process.env.CI) && containerReason === 'no Docker here';
// Debian 13 (trixie), pinned by digest so a new upstream image cannot change a required check overnight.
// Update: docker buildx imagetools inspect debian:13 (the index digest, not one platform's).
const IMAGE = 'debian:13@sha256:913f6706df59a68922d1dd08f78c2476560a8d367897200a6005b00e5f67c2d5';

describe('15-ssh-keys-only.sh as written', () => {
  test('is valid bash', t => {
    const res = spawnSync('bash', ['-n', stagePath], { encoding: 'utf8' });
    if (res.error) return t.skip('no bash here');
    assert.equal(res.status, 0, res.stderr);
  });

  test('reloads ssh and never restarts it; never switches off a service', () => {
    assert.match(stage, /systemctl reload "\$unit"/);
    assert.doesNotMatch(stage, /systemctl (restart|stop|disable|mask) "?\$?(unit|ssh)/);
    assert.doesNotMatch(stage, /\bservice ssh/);
  });

  test('the timer revives a dead sshd (reload-or-restart), and a dead one after the reload is started', () => {
    assert.match(stage, /--on-active=300 \/bin\/sh -c/);
    assert.match(stage, /\/bin\/systemctl reload-or-restart \$unit/);
    assert.match(stage, /systemctl start "\$unit"/);
  });

  test('sets exactly the three values of D-123 in a drop-in, and no other file is edited', () => {
    assert.match(stage, /^PasswordAuthentication no$/m);
    assert.match(stage, /^KbdInteractiveAuthentication no$/m);
    assert.match(stage, /^PermitRootLogin prohibit-password"$/m);
    assert.match(stage, /drop="\$drop_dir\/00-foundry-keys-only\.conf"/);
    // The main sshd_config is only read (grep, sshd -t), never written.
    assert.doesNotMatch(stage, />>?\s*"?\$sshd_main/);
    assert.doesNotMatch(stage, /sed -i[^\n]*\$sshd_main/);
  });

  test('every rm uses a guarded variable', () => {
    const rms = stage.split('\n').filter(l => /^\s*rm\s/.test(l));
    assert.ok(rms.length >= 2, 'the stage removes its drop-in in at least two places');
    for (const line of rms) assert.match(line, /\$\{\w+:\?\}/, line);
  });

  test('the checks come before the first write', () => {
    const at = s => stage.indexOf(s);
    assert.ok(
      at('ssh-keygen -l -f') > 0 && at('ssh-keygen -l -f') < at('printf \'%s\\n\' "$body" >"$new"')
    );
    assert.ok(
      at('sshd_config\\.d') > 0 && at('sshd_config\\.d') < at('printf \'%s\\n\' "$body" >"$new"')
    );
    assert.ok(at('sshd -t || die') < at('printf \'%s\\n\' "$body" >"$new"'));
    // The service lookup, the key-login settings and the Match refusal all precede the first write (M1, M3, L1, L6).
    for (const check of [
      'if have_systemd; then need_unit; fi',
      'systemctl is-active --quiet ssh.socket',
      "grep -qx 'pubkeyauthentication yes'",
      'match_hits="$(match_overrides)"',
    ]) {
      assert.ok(at(check) > 0 && at(check) < at('printf \'%s\\n\' "$body" >"$new"'), check);
    }
    assert.ok(at('if ! sshd -t; then') > at('mv -f "$new" "$drop"'));
    assert.ok(at('values_are_wanted; then') > at('if ! sshd -t; then'));
    // Arm the timer, then reload: arm_timer is called before the last reload_ssh.
    assert.ok(at('if ! arm_timer; then') > 0);
    assert.ok(
      stage.lastIndexOf('reload_ssh\n') > at('if ! arm_timer; then'),
      'the reload follows the timer'
    );
  });
});

// A few minutes under QEMU emulation on a PC (apt is the slow part), less on an ARM runner.
function runContainer() {
  const res = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--platform',
      'linux/arm64',
      '-v',
      `${repo}:/repo:ro`,
      IMAGE,
      'bash',
      '/repo/scripts/pi/container-test/ssh-keys-only-scenarios.sh',
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30 * 60_000 }
  );
  return `${res.stdout ?? ''}\n${res.stderr ?? ''}${res.error ? `\n${res.error.message}` : ''}`;
}

test('the container suite has Docker when CI asks for it', { skip: !noDockerInCi }, () => {
  assert.fail('PI_SSH_KEYS_ONLY_CONTAINER=1 and CI are set, but `docker version` failed');
});

describe('15-ssh-keys-only.sh in an ARM64 container', { skip: containerReason }, () => {
  /** @type {Map<string, Record<string, string>>} */
  const runs = new Map();
  before(
    () => {
      const stdout = saved ? readFileSync(saved, 'utf8').replace(/\r\n/g, '\n') : runContainer();
      assert.match(stdout, /=== ALL DONE/, stdout);
      for (const block of stdout.split(/^=== SCENARIO /m).slice(1)) {
        const name = block.slice(0, block.indexOf('\n'));
        const part = label => {
          const m = block.match(new RegExp(`^--- ${label}\\n([\\s\\S]*?)(?=^--- |^=== END)`, 'm'));
          return (m?.[1] ?? '').trimEnd();
        };
        runs.set(name, {
          output: part('output'),
          exit: block.match(/^--- exit (\d+)$/m)?.[1] ?? '?',
          dropin: part('dropin'),
          before: part('before'),
          values: part('values'),
          calls: part('calls'),
          timer: part('timer'),
          marker: part('marker'),
          extra: part('extra'),
        });
      }
    },
    { timeout: 31 * 60_000 }
  );
  const run = name => {
    const r = runs.get(name);
    assert.ok(r, `scenario ${name} did not run`);
    return r;
  };
  const lines = text => text.split('\n').filter(Boolean);
  const calls = r => lines(r.calls);
  /** Calls that change something or reload; looking the service up (cat, is-active) is allowed in a refusal. */
  const mutating = r => calls(r).filter(c => !/^systemctl (cat|is-active) /.test(c));

  // What sshd reports for root once the stage has run (OpenSSH 10 prints prohibit-password as without-password).
  const KEYS_ONLY = [
    'kbdinteractiveauthentication no',
    'passwordauthentication no',
    'permitrootlogin without-password',
  ].join('\n');
  const AS_FOUND = [
    'kbdinteractiveauthentication no',
    'passwordauthentication yes',
    'permitrootlogin yes',
  ].join('\n');
  const DROPIN_VALUES = [
    'PasswordAuthentication no',
    'KbdInteractiveAuthentication no',
    'PermitRootLogin prohibit-password',
  ];
  const assertDropIn = r => {
    assert.deepEqual(
      lines(r.dropin).filter(l => !l.startsWith('#')),
      DROPIN_VALUES
    );
  };
  /** A refusal before anything is written: exit 1, the reason, sshd as it was, no reload, no timer. */
  const assertRefused = (r, reason) => {
    assert.equal(r.exit, '1', r.output);
    assert.match(r.output, reason);
    assert.equal(r.dropin, '(none)');
    assert.deepEqual(mutating(r), [], `nothing may be reloaded:\n${r.calls}`);
    assert.equal(r.timer, 'none');
    assert.equal(r.marker, 'none');
  };

  test('fresh: the drop-in, the real sshd -T values, a reload and a safety timer', () => {
    const r = run('fresh');
    assert.equal(r.exit, '0', r.output);
    assertDropIn(r);
    assert.equal(r.values, KEYS_ONLY);
    assert.match(r.output, /sshd -T: passwordauthentication no/);
    assert.match(r.output, /sshd -T: kbdinteractiveauthentication no/);
    assert.match(r.output, /sshd -T: permitrootlogin without-password/);
    assert.match(r.output, /2 key\(s\) in/);
    assert.ok(r.extra.includes('00-foundry-keys-only.conf'), r.extra);
    // Reload, never restart; the timer is armed before the reload and the reload is the last change.
    assert.ok(calls(r).includes('systemctl reload ssh'), r.calls);
    assert.ok(
      !calls(r).some(
        c => /restart|stop ssh|disable|mask/.test(c) && !c.includes('foundry-ssh-keys-only-revert')
      ),
      r.calls
    );
    const armed = calls(r).findIndex(c => c.startsWith('systemd-run '));
    assert.ok(armed >= 0 && armed < calls(r).indexOf('systemctl reload ssh'), r.calls);
    assert.match(calls(r)[armed], /--on-active=300 \/bin\/sh -c /);
    assert.equal(r.timer, 'armed');
    assert.equal(r.marker, 'none');
    assert.match(
      r.output,
      /live: could not ask the running sshd/,
      'no daemon runs in this scenario'
    );
    assert.match(r.output, /CONFIRM=1/);
    assert.match(r.output, /console login with the root password/);
  });

  test('rerun while the first run timer is armed: reloads, leaves the timer, says CONFIRM=1 is still needed', () => {
    const r = run('rerun-timer-armed');
    assert.equal(r.exit, '0', r.output);
    assert.match(r.output, /unchanged/);
    assert.match(r.output, /safety timer of the earlier run is still armed/);
    assert.match(r.output, /CONFIRM=1/);
    assert.doesNotMatch(r.output, /SSH is keys only/, 'it must not claim a finished state');
    assertDropIn(r);
    assert.equal(r.values, KEYS_ONLY);
    assert.equal(r.before, '(none)', 'an unchanged drop-in leaves no copy');
    assert.equal(r.timer, 'armed');
    assert.ok(calls(r).includes('systemctl reload ssh'), r.calls);
    assert.ok(!calls(r).some(c => c.startsWith('systemd-run')), 'no second timer');
  });

  test('rerun after CONFIRM=1: only a reload, no timer, keys only is reported', () => {
    const r = run('rerun-confirmed');
    assert.equal(r.exit, '0', r.output);
    assert.match(r.output, /SSH is keys only \(the drop-in was already there and confirmed\)/);
    assert.equal(r.timer, 'none');
    assert.equal(r.marker, 'confirmed');
    assert.ok(calls(r).includes('systemctl reload ssh'), r.calls);
    assert.ok(!calls(r).some(c => c.startsWith('systemd-run')), 'no timer after a confirmation');
  });

  test('rerun with no timer and no confirmation (a stopped first run, a reboot): arms the timer before the reload', () => {
    const r = run('rerun-lost-timer');
    assert.equal(r.exit, '0', r.output);
    assert.match(r.output, /unchanged/);
    assert.match(r.output, /safety net: the old SSH settings come back in 5 minutes/);
    assert.equal(r.timer, 'armed');
    const armed = calls(r).findIndex(c => c.startsWith('systemd-run '));
    assert.ok(armed >= 0 && armed < calls(r).indexOf('systemctl reload ssh'), r.calls);
    assert.match(r.output, /confirm from a NEW key-only connection within 5 minutes/);
  });

  test('a confirmed drop-in that changes is unconfirmed again and gets a new timer', () => {
    const r = run('changed-after-confirm');
    assert.equal(r.exit, '0', r.output);
    assertDropIn(r);
    assert.match(r.before, /a changed version/);
    assert.equal(r.marker, 'none');
    assert.equal(r.timer, 'armed');
    assert.match(r.output, /confirm from a NEW key-only connection/);
  });

  test('replaces an older drop-in: a copy is kept and the timer puts it back', () => {
    const r = run('replaces-old');
    assert.equal(r.exit, '0', r.output);
    assertDropIn(r);
    assert.match(r.before, /an older version/);
    assert.equal(r.values, KEYS_ONLY);
    assert.match(
      r.extra,
      /mv -f .*00-foundry-keys-only\.conf\.before .*00-foundry-keys-only\.conf; \/bin\/rm -f \/etc\/ssh\/foundry-keys-only\.confirmed; \/bin\/systemctl reload-or-restart ssh/
    );
  });

  test('a DietPi-style drop-in and a later cloud-init one both lose to ours (00- is read first)', () => {
    const r = run('later-file');
    assert.equal(r.exit, '0', r.output);
    assert.equal(r.values, KEYS_ONLY);
    assert.equal(run('fresh').values, KEYS_ONLY, 'fresh has dietpi.conf with both values on');
  });

  test('the timer removes the drop-in and reloads ssh when it fires', () => {
    const r = run('timer-revert');
    assert.equal(r.exit, '0', r.output);
    assert.equal(r.dropin, '(none)');
    assert.equal(r.values, AS_FOUND);
    assert.ok(calls(r).includes('systemctl reload-or-restart ssh'), r.calls);
    assert.match(
      r.extra,
      /revert-cmd: \/bin\/rm -f \/etc\/ssh\/sshd_config\.d\/00-foundry-keys-only\.conf; \/bin\/rm -f \/etc\/ssh\/foundry-keys-only\.confirmed; \/bin\/systemctl reload-or-restart ssh/
    );
  });

  test('CONFIRM=1 cancels the timer and keeps keys only', () => {
    const r = run('confirm');
    assert.equal(r.exit, '0', r.output);
    assert.equal(r.timer, 'none');
    assert.equal(r.marker, 'confirmed');
    assertDropIn(r);
    assert.match(r.output, /revert timer cancelled/);
  });

  test('CONFIRM=1 with no drop-in fails', () => {
    const r = run('confirm-without-stage');
    assert.equal(r.exit, '1', r.output);
    assert.match(r.output, /is not there/);
    assert.equal(r.values, AS_FOUND);
    assert.equal(r.marker, 'none');
  });

  test('UNDO=1 removes the drop-in, cancels the timer, reloads and shows the old values', () => {
    const r = run('undo');
    assert.equal(r.exit, '0', r.output);
    assert.equal(r.dropin, '(none)');
    assert.equal(r.values, AS_FOUND);
    assert.equal(r.timer, 'none');
    assert.equal(r.marker, 'none');
    assert.equal(calls(r).filter(c => c === 'systemctl reload ssh').length, 2, r.calls);
    assert.match(r.output, /is not put back/, 'UNDO says it does not restore a .before copy');
  });

  test('refuses without a key file, and with a key file that holds no key', () => {
    assertRefused(run('no-keys-file'), /authorized_keys is missing/);
    assertRefused(run('empty-keys'), /holds no valid key/);
    assert.equal(run('no-keys-file').values, AS_FOUND);
    assert.equal(run('empty-keys').values, AS_FOUND);
  });

  test('refuses when the main config does not include the drop-in folder (also a commented Include)', () => {
    assertRefused(run('no-include'), /no Include line for \/etc\/ssh\/sshd_config\.d/);
    assertRefused(run('commented-include'), /no Include line for \/etc\/ssh\/sshd_config\.d/);
  });

  test('refuses when sshd -t already fails before any change', () => {
    assertRefused(run('broken-before'), /sshd -t already fails before any change/);
  });

  test('rolls the drop-in back when something earlier overrides a value, and says which lines win', () => {
    for (const name of ['overridden-above', 'overridden-earlier-file']) {
      const r = run(name);
      assert.equal(r.exit, '1', `${name}: ${r.output}`);
      assert.equal(r.dropin, '(none)', name);
      assert.match(r.output, /something overrides the drop-in/, name);
      assert.match(r.output, /ssh was not reloaded/, name);
      assert.deepEqual(mutating(r), [], `${name}: no reload, no timer:\n${r.calls}`);
      assert.equal(r.timer, 'none');
    }
    assert.match(run('overridden-above').output, /sshd_config:1:PasswordAuthentication yes/);
    assert.match(run('overridden-earlier-file').output, /00-a-earlier\.conf:1:PermitRootLogin yes/);
  });

  test('refuses before any write when a Match block sets a login value, for root or for any other address', () => {
    for (const name of ['overridden-match', 'lan-match', 'lan-match-dropin']) {
      assertRefused(run(name), /remove or change those Match lines first; nothing changed/);
    }
    assert.match(run('overridden-match').output, /sshd_config:\d+:\s+PasswordAuthentication yes/);
    assert.match(run('lan-match').output, /sshd_config:\d+:\s+PasswordAuthentication yes/);
    assert.match(run('lan-match-dropin').output, /90-lan\.conf:2:\s+PermitRootLogin yes/);
  });

  test('refuses before any write when key login would not work (PubkeyAuthentication, AuthorizedKeysFile, AuthenticationMethods)', () => {
    assertRefused(run('pubkey-off'), /does not accept public keys/);
    assertRefused(run('keys-file-elsewhere'), /does not read root's \.ssh\/authorized_keys/);
    assertRefused(run('two-methods'), /AuthenticationMethods asks for more than a key/);
  });

  test('refuses without an ssh service, and with socket-activated ssh', () => {
    assertRefused(run('no-unit'), /found no ssh or sshd service to reload; nothing changed/);
    assertRefused(run('socket-activated'), /ssh is socket-activated/);
  });

  test('a Match block that sets none of the login values does not stop the stage', () => {
    const r = run('unrelated-match');
    assert.equal(r.exit, '0', r.output);
    assertDropIn(r);
    assert.equal(r.values, KEYS_ONLY);
    assert.match(r.output, /no Match block sets a login value/);
  });

  test('sshd -t failing after the write: the drop-in is removed, or the old one comes back, and ssh is not touched', () => {
    const fresh = run('sshd-t-fails');
    assert.equal(fresh.exit, '1', fresh.output);
    assert.match(fresh.output, /sshd -t fails with the new drop-in; rolled back/);
    assert.equal(fresh.dropin, '(none)');
    assert.deepEqual(mutating(fresh), []);
    const old = run('sshd-t-fails-old');
    assert.equal(old.exit, '1', old.output);
    assert.match(old.dropin, /an older version/);
    assert.equal(old.before, '(none)', 'the saved copy was moved back');
    assert.deepEqual(mutating(old), []);
  });

  test('a safety timer that cannot be armed rolls the drop-in back before any reload', () => {
    const r = run('timer-fails');
    assert.equal(r.exit, '1', r.output);
    assert.match(r.output, /could not arm the safety timer; rolled back/);
    assert.equal(r.dropin, '(none)');
    assert.equal(r.values, AS_FOUND);
    assert.ok(!calls(r).includes('systemctl reload ssh'), r.calls);
  });

  test('a failed reload stops the stage with the timer armed', () => {
    const r = run('reload-fails');
    assert.equal(r.exit, '1', r.output);
    assert.match(r.output, /systemctl reload ssh failed/);
    assert.equal(r.timer, 'armed');
  });

  test('ssh not active after the reload: the drop-in is rolled back, ssh is started, the timer is cancelled', () => {
    const fresh = run('dead-after-reload');
    assert.equal(fresh.exit, '1', fresh.output);
    assert.match(fresh.output, /was not active after the reload; rolled back/);
    assert.equal(fresh.dropin, '(none)');
    assert.equal(fresh.values, AS_FOUND);
    assert.equal(fresh.timer, 'none');
    assert.ok(calls(fresh).includes('systemctl start ssh'), fresh.calls);
    const old = run('dead-after-reload-old');
    assert.equal(old.exit, '1', old.output);
    assert.match(old.dropin, /an older version/);
    assert.equal(old.before, '(none)', 'the saved copy was moved back');
    assert.equal(old.timer, 'none');
    assert.ok(calls(old).includes('systemctl start ssh'), old.calls);
  });

  test('live check against a real sshd: keys only after the reload took, a warning when it did not', () => {
    const ok = run('live-keys-only');
    assert.equal(ok.exit, '0', ok.output);
    assert.match(
      ok.output,
      /live: the running sshd offers keys only \(Permission denied \(publickey\)\)/
    );
    const stale = run('live-stale');
    assert.equal(stale.exit, '0', stale.output);
    assert.match(
      stale.output,
      /live: the running sshd still offers a password \(Permission denied \(publickey,password\)\)/
    );
    assert.equal(stale.timer, 'armed', 'the net stays while the daemon has the old settings');
  });

  test('without systemd the files are written and checked, nothing is reloaded or scheduled', () => {
    const r = run('no-systemd');
    assert.equal(r.exit, '0', r.output);
    assertDropIn(r);
    assert.equal(r.values, KEYS_ONLY);
    assert.equal(r.calls, '');
    assert.match(r.output, /no safety timer/);
  });
});
