// Tests for guard-remote-commands.mjs:  node --test .claude/hooks/guard-remote-commands.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { decide, finalDecision } from './guard-remote-commands.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const kind = command => decide(command, repo)?.decision ?? 'allow';

test('local commands are not this hook’s business', () => {
  assert.equal(kind('rm -rf /'), 'allow');
  assert.equal(kind('git status'), 'allow');
});

test('read-only remote commands pass', () => {
  for (const c of [
    "ssh foundry-pi 'systemctl status foundry.service --no-pager; journalctl -u foundry -n 40'",
    "ssh -o BatchMode=yes foundry-pi 'ls -ld /opt /opt/foundry; df -h /; free -h'",
    'scp -q "C:/Users/chris/Downloads/FoundryVTT-Node-14.368.zip" foundry-pi:/root/foundryvtt.zip',
    "ssh foundry-pi 'cat /boot/dietpi/.install_stage'",
  ]) {
    assert.equal(kind(c), 'allow', c);
  }
});

test('the real stage scripts pass, except stage 1 (the foundry user) and stage 9 (SSH login keys), which ask', () => {
  const dir = path.join(repo, 'scripts', 'pi', 'remote');
  for (const name of readdirSync(dir).filter(n => /^\d+-.*\.sh$/.test(n))) {
    const command = `cat scripts/pi/remote/lib.sh scripts/pi/remote/${name} | ssh -o BatchMode=yes foundry-pi bash`;
    const expected = /^(1|9)-/.test(name) ? 'ask' : 'allow';
    assert.equal(kind(command), expected, `${name}: ${JSON.stringify(decide(command, repo))}`);
  }
});

test('commands whose only target is this machine (a test container) pass', () => {
  const k = '-i /root/.ssh/testkey -o StrictHostKeyChecking=no';
  for (const c of [
    `docker exec -i pi-stage5-test ssh -p 2222 ${k} root@127.0.0.1 'mv /tmp/x /root/.ssh/authorized_keys'`,
    `docker exec pi-stage5-test sh -c "echo put a | sftp -P 2222 ${k} -b - root@localhost"`,
    `docker exec pi-stage5-test scp -P 2222 ${k} /etc/hostname root@127.0.0.1:/tmp/scp-test`,
    `cat scripts/pi/remote/lib.sh scripts/pi/remote/9-ssh-log.sh | docker exec -i pi-stage5-test ssh -p 2222 ${k} root@[::1] 'bash -s'`,
  ]) {
    assert.equal(kind(c), 'allow', c);
  }
  // A jump host, a second target or a remote target keeps the guard on.
  for (const c of [
    "ssh -J foundry-pi root@127.0.0.1 'reboot'",
    "ssh -o ProxyJump=foundry-pi localhost 'reboot'",
    "ssh localhost true; ssh foundry-pi 'reboot'",
    "scp /tmp/x root@127.0.0.1:/tmp/x && ssh foundry-pi 'reboot'",
    "ssh foundry-pi 'reboot'",
  ]) {
    assert.equal(kind(c), 'ask', c);
  }
});

test('catastrophic commands are denied', () => {
  for (const c of [
    "ssh foundry-pi 'rm -rf /'",
    "ssh foundry-pi 'rm -rf /*'",
    "ssh foundry-pi 'sudo rm -fr /etc'",
    "ssh foundry-pi 'rm -r --no-preserve-root /'",
    "ssh foundry-pi 'rm -rf /var/'",
    "ssh foundry-pi 'rm -rf ~'",
    "ssh foundry-pi 'mkfs.ext4 /dev/mmcblk1p1'",
    "ssh foundry-pi 'dd if=/dev/zero of=/dev/mmcblk1 bs=4M'",
    "ssh foundry-pi 'chmod -R 777 /'",
    "ssh foundry-pi 'chown -R foundry:foundry /usr'",
    "ssh foundry-pi 'userdel root'",
    "ssh foundry-pi 'wipefs -a /dev/nvme0n1'",
  ]) {
    assert.equal(kind(c), 'deny', c);
  }
});

test('the dangerous list asks', () => {
  for (const c of [
    "ssh foundry-pi 'userdel foundry'",
    "ssh foundry-pi 'apt-get -y purge openssh-server'",
    "ssh foundry-pi 'reboot'",
    `ssh foundry-pi 'k=/root/.ssh/authorized_keys; mv /tmp/x "$k"'`,
    'ssh foundry-pi reboot',
    'ssh -o BatchMode=yes -i key foundry-pi userdel foundry',
    'ssh foundry-pi sudo shutdown -h now',
    "ssh foundry-pi 'systemctl reboot'",
    "ssh foundry-pi 'echo x >> /etc/fstab'",
    'ssh foundry-pi "sed -i \'s/yes/no/\' /etc/ssh/sshd_config"',
    "ssh foundry-pi 'systemctl stop ssh'",
    "ssh foundry-pi 'ufw enable'",
    "ssh foundry-pi 'rm -rf /srv/data'",
    "ssh foundry-pi 'rm -rf $DIR/old'",
    "ssh foundry-pi 'rm -rf /mnt/dietpi-backup/data_3'",
    "ssh foundry-pi 'dietpi-backup -1'",
    "ssh foundry-pi 'parted /dev/nvme0n1 mklabel gpt'",
  ]) {
    assert.equal(kind(c), 'ask', c);
  }
});

test('our own folders and guarded variables may be deleted', () => {
  for (const c of [
    "ssh foundry-pi 'rm -rf /opt/foundry/old /tmp/x'",
    'ssh foundry-pi \'rm -rf "${FOUNDRY_APP:?}"/*\'',
    "ssh foundry-pi 'rm -f /root/foundryvtt.zip'",
  ]) {
    assert.equal(kind(c), 'allow', c);
  }
});

test('a word in a comment line is not a command', () => {
  assert.equal(kind("ssh foundry-pi bash <<'EOF'\n# never reboot here\nuptime\nEOF"), 'allow');
});

test('an ask becomes a deny where nobody would see the prompt', () => {
  assert.equal(finalDecision('ask', 'default'), 'ask');
  assert.equal(finalDecision('ask', 'acceptEdits'), 'ask');
  assert.equal(finalDecision('ask', 'bypassPermissions'), 'deny');
  assert.equal(finalDecision('ask', 'auto'), 'deny');
  assert.equal(finalDecision('ask', undefined), 'deny');
  assert.equal(finalDecision('deny', 'default'), 'deny');
});

test('a fed file whose quoted name holds ; or & is still read', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'guard-'));
  for (const name of ['a;b.txt', 'a&b.txt']) {
    const file = path.join(dir, name).replace(/\\/g, '/');
    writeFileSync(file, 'rm -rf /etc/ssh\n');
    for (const q of ['"', "'"]) {
      const c = `cat ${q}${file}${q} | ssh foundry-pi bash -s`;
      assert.equal(kind(c), 'ask', c);
    }
  }
});

test('a remote cat with no pipe after it returns at once (it used to backtrack forever)', () => {
  const t = performance.now();
  assert.equal(kind('ssh foundry-pi cat /var/lib/foundry-ai-tool/space/status.json'), 'allow');
  assert.equal(kind("ssh foundry-pi 'cat /var/lib/foundry-ai-tool/space/status.json'"), 'allow');
  assert.equal(kind('ssh foundry-pi cat /a /b "/c d"'), 'allow');
  assert.ok(performance.now() - t < 1000);
  // A local cat piped into ssh still feeds the script file to the checks.
  assert.equal(
    kind('cat scripts/pi/remote/lib.sh scripts/pi/remote/9-ssh-log.sh | ssh foundry-pi bash'),
    'ask'
  );
});

test('long adversarial commands are checked in linear time', () => {
  const long = [
    'ssh foundry-pi cat ' + 'a'.repeat(2000),
    'ssh foundry-pi cat ' + 'a;'.repeat(1000),
    "ssh foundry-pi cat '" + 'a '.repeat(1000),
    'ssh foundry-pi rm ' + '-rf '.repeat(500) + 'x',
    'ssh foundry-pi rm ' + '-rf '.repeat(500),
    'ssh foundry-pi chmod -R ' + 'a/'.repeat(1000),
    'ssh foundry-pi systemctl stop ' + 'a '.repeat(1000),
    'ssh foundry-pi ' + 'a.sh '.repeat(400),
    ('# x\n' + 'ssh foundry-pi cat a\n').repeat(80),
  ];
  for (const c of long) {
    const t = performance.now();
    decide(c, repo);
    const ms = performance.now() - t;
    assert.ok(ms < 100, `${ms.toFixed(0)} ms for ${c.slice(0, 40)}...`);
  }
});

test('repeated flags do not hide a recursive delete of / or a system folder', () => {
  assert.equal(kind("ssh foundry-pi 'rm -rf -rf /'"), 'deny');
  assert.equal(kind("ssh foundry-pi 'rm -f -r --recursive /etc'"), 'deny');
  assert.equal(kind("ssh foundry-pi 'rm --recursive --force /*'"), 'deny');
  assert.equal(kind("ssh foundry-pi 'rm -rf -rf /opt/foundry/old'"), 'allow');
});

// Each of these took from 100 ms to over 30 s at 50,000 characters with the old single regexes
// (a hook past its timeout fails open). Linear checks take a few milliseconds.
test('50,000-character crafted commands are checked in well under 200 ms', () => {
  const N = 50_000;
  const rep = s => s.repeat(Math.ceil(N / s.length)).slice(0, N);
  const P = 'ssh foundry-pi ';
  const long = [
    P + rep('\n'),
    P + rep('('),
    P + rep(';'),
    P + rep('$('),
    P + rep("'"),
    P + rep('sudo '),
    P + 'rm ' + rep('-rm '),
    P + 'rm ' + rep('--a-b '),
    P + 'rm -rf ' + rep('"'),
    P + 'rm -rf ' + rep("'") + 'x',
    P + 'sed -i' + rep('i'),
    P + rep('sed -i x '),
    P + rep('>'),
    P + rep('tee -a '),
    P + 'cat ' + rep('"'),
    P + 'cat ' + rep('a;'),
    P + rep('cat '),
    P + rep('cat \'" '),
    P + rep('chmod -R '),
    P + 'chmod -' + rep('R') + '_',
    P + 'userdel ' + rep('-userdel '),
    P + 'systemctl ' + rep('-systemctl '),
    P + rep('systemctl stop '),
    P + 'apt ' + rep('-apt '),
    P + 'dpkg ' + rep('-dpkg '),
    P + rep('dd '),
    P + rep('a=('),
    P + rep('a/'),
    P + rep('a.sh.'),
    P + rep('x"a.sh"'),
    P + rep('cd / && rm -rf x; '),
    P + rep('find '),
    P + 'find / ' + rep('-exec '),
    P + rep('xargs '),
    'scp ' + rep('scp a: '),
    rep('ssh -o '),
    rep('# x\nssh foundry-pi cat a\n'),
  ];
  for (const c of long) {
    const t = performance.now();
    decide(c, repo);
    const ms = performance.now() - t;
    assert.ok(ms < 200, `${ms.toFixed(0)} ms for ${JSON.stringify(c.slice(0, 40))}...`);
  }
});

test('deleting everything after a cd, with find or through xargs is caught', () => {
  for (const c of [
    "ssh foundry-pi 'cd / && rm -rf *'",
    "ssh foundry-pi 'cd /etc; rm -rf .'",
    "ssh foundry-pi 'cd /; rm -rf etc'",
    "ssh foundry-pi bash <<'EOF'\ncd /\nrm -rf -- *\nEOF",
    "ssh foundry-pi 'cd /opt/foundry && rm -rf ../*'",
    "ssh foundry-pi 'cd ~ && rm -rf *'",
    "ssh foundry-pi 'find / -delete'",
    "ssh foundry-pi 'find /etc -name x -exec rm -rf {} +'",
    "ssh foundry-pi 'find / -type f -exec /bin/rm -f {} \\;'",
    "ssh foundry-pi 'rm -rf -- /'",
    "ssh foundry-pi 'rm -rf --interactive=never ~'",
    "ssh foundry-pi 'rm -rf ~/*'",
    "ssh foundry-pi 'rm -rf /tmp/x /'",
    "ssh foundry-pi 'rm -rf /tmp/..'",
    "ssh foundry-pi 'rm -rf /opt/foundry/../../etc'",
    "ssh foundry-pi 'rm -rf //etc /./usr'",
    "ssh foundry-pi 'rm -rf /e*c'",
  ]) {
    assert.equal(kind(c), 'deny', c);
  }
  for (const c of [
    "ssh foundry-pi 'echo /etc | xargs rm -rf'",
    "ssh foundry-pi 'find / -print0 | xargs -0 rm -f'",
    "ssh foundry-pi 'find /var/log -delete'",
    "ssh foundry-pi 'find . -name x -delete'",
    "ssh foundry-pi 'find -delete'",
    'ssh foundry-pi \'find "$DIR" -delete\'',
    "ssh foundry-pi 'rm -rf *'",
    "ssh foundry-pi 'rm -rf ./../x'",
    "ssh foundry-pi 'rm -rf ~/old'",
    "ssh foundry-pi 'cd /srv && rm -rf data'",
    'ssh foundry-pi \'cd "$X" && rm -rf *\'',
  ]) {
    assert.equal(kind(c), 'ask', c);
  }
});

test('deletes in our own folders, by find too, and the documented drill commands still pass', () => {
  for (const c of [
    "ssh foundry-pi 'cd /opt/foundry && rm -rf *'",
    "ssh foundry-pi 'cd /var/lib/foundry-ai-tool/x; rm -rf old'",
    "ssh foundry-pi 'rm -rf build'",
    "cd /c/Users/chris && ssh foundry-pi 'rm -rf build'",
    'ssh foundry-pi "find /opt/foundry/app -name \'*.map\' -delete"',
    'ssh foundry-pi \'find "$stage/dist" -name x -delete\'',
    "ssh foundry-pi 'find /etc/foundry-ai-tool -gid 5 -exec chgrp foundry {} +'",
    "ssh foundry-pi 'find /var/lib/foundry/Data/worlds -mindepth 1 -maxdepth 1 -type d'",
    "ssh foundry-pi 'install -d -m 0700 /var/lib/foundry-restore'",
    'scp -r E:\\PiBackup\\restic foundry-pi:/var/lib/foundry-restore/pc-repo',
    "Get-Content .\\scripts\\pi\\drill\\restore.sh -Raw | ssh foundry-pi 'DRILL_KEEP_SYNCTHING=1 bash -s'",
    "ssh foundry-pi 'rm -rf /var/lib/foundry-restore'",
    'ssh foundry-pi /opt/foundry-ai-tool/space/space-check.sh --print',
  ]) {
    assert.equal(kind(c), 'allow', `${c}: ${JSON.stringify(decide(c, repo))}`);
  }
});
