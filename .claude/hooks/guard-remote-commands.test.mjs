// Tests for guard-remote-commands.mjs:  node --test .claude/hooks/
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
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

test('the real stage scripts pass, except stage 1 which creates the foundry user (ask)', () => {
  const dir = path.join(repo, 'scripts', 'pi', 'remote');
  for (const name of readdirSync(dir).filter(n => /^\d-.*\.sh$/.test(n))) {
    const command = `cat scripts/pi/remote/lib.sh scripts/pi/remote/${name} | ssh -o BatchMode=yes foundry-pi bash`;
    const expected = name.startsWith('1-') ? 'ask' : 'allow';
    assert.equal(kind(command), expected, `${name}: ${JSON.stringify(decide(command, repo))}`);
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
