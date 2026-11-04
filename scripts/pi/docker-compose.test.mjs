// Pi stages 23 and 24 (scripts/pi/remote/23-docker.sh and 24-compose.sh, backlog pi-docker-compose):
//   node --test scripts/pi/docker-compose.test.mjs
// The text checks always run. PI_STAGE23_CONTAINER=1 (needs Docker) runs the scenario scripts in a Debian 13 ARM64
// container; they use stand-ins for apt, docker, systemctl and ss, so they also run without a container in Git Bash:
//   REPO=$PWD bash scripts/pi/container-test/stage23-scenarios.sh   (and stage24-scenarios.sh)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = rel => readFileSync(path.join(repo, rel), 'utf8');
const s22 = read('scripts/pi/remote/23-docker.sh');
const s23 = read('scripts/pi/remote/24-compose.sh');

describe('23-docker.sh as text', () => {
  test('is valid bash', t => {
    const r = spawnSync('bash', ['-n', path.join(repo, 'scripts/pi/remote/23-docker.sh')], {
      encoding: 'utf8',
    });
    if (r.error) return t.skip('no bash here');
    assert.equal(r.status, 0, r.stderr);
  });

  test('asks for a snapshot after the dry run and before the first install, write and build', () => {
    const snap = s22.indexOf('\nrequire_recent_snapshot\n');
    assert.ok(snap > 0);
    assert.ok(s22.indexOf('if [ "$dry" = 1 ]; then') < snap);
    for (const write of [
      'apt_install',
      'DEBIAN_FRONTEND=noninteractive apt-get update',
      'enable_unit docker.service',
      'write_file "$env_file"',
      '(cd "$checkout" && docker compose -f deploy/pi/compose.yml build)',
    ]) {
      assert.ok(snap < s22.indexOf(write), write);
    }
  });

  test('installs from Debian, adds no user to any group, starts no stack, deletes nothing', () => {
    assert.match(s22, /docker\.io/);
    assert.doesNotMatch(s22, /download\.docker\.com|get\.docker\.com|sources\.list\.d|apt-key/);
    const code = s22.replace(/^\s*#.*$/gm, '');
    assert.doesNotMatch(code, /usermod|adduser|gpasswd|groupadd/);
    assert.doesNotMatch(code, /compose[^\n]* (up|start|down|rm)\b/);
    assert.doesNotMatch(code, /\brm\b|\bmv\b|prune|reboot|shutdown/);
  });

  test('keeps the .env lines it does not own and writes only the four managed names', () => {
    assert.match(s22, /FOUNDRY_UID=\$uid/);
    assert.match(s22, /FOUNDRY_GID=\$gid/);
    assert.match(s22, /DASHBOARD_ALLOWED_HOSTS=\$hosts/);
    assert.match(s22, /FOUNDRY_AI_PLAYER_VAULTS_DIR=\$vaults/);
    assert.match(
      s22,
      /grep -vE '\^\(#\|\[\[:space:\]\]\*\$\|FOUNDRY_UID=\|FOUNDRY_GID=\|DASHBOARD_ALLOWED_HOSTS=\|FOUNDRY_AI_PLAYER_VAULTS_DIR=\)'/
    );
  });

  test('compose passes the player vaults folder to the dashboard and gives Foundry time to stop', () => {
    const compose = read('deploy/pi/compose.yml');
    assert.match(compose, /FOUNDRY_AI_PLAYER_VAULTS_DIR: \$\{FOUNDRY_AI_PLAYER_VAULTS_DIR:-\}/);
    assert.match(compose, /init: true # node is not PID 1/);
    assert.equal((compose.match(/stop_grace_period: 90s/g) ?? []).length, 2);
    assert.doesNotMatch(compose, /check `docker compose config`/);
  });
});

describe('24-compose.sh as text', () => {
  test('is valid bash', t => {
    const r = spawnSync('bash', ['-n', path.join(repo, 'scripts/pi/remote/24-compose.sh')], {
      encoding: 'utf8',
    });
    if (r.error) return t.skip('no bash here');
    assert.equal(r.status, 0, r.stderr);
  });

  test('cutover: snapshot and quiet check come before the first stop, the state record before it too', () => {
    const cut = s23.slice(s23.indexOf('mode_cutover() {'), s23.indexOf('mode_rollback() {'));
    const snap = cut.indexOf('require_recent_snapshot');
    const quiet = cut.indexOf('require_quiet "cutting over');
    const record = cut.indexOf(': >"$state_file"');
    const stop = cut.indexOf('systemctl disable --now');
    assert.ok(snap > 0 && snap < quiet && quiet < record && record < stop);
    // The images are checked (preflight) before anything stops.
    assert.ok(cut.indexOf('preflight_stack') < snap);
  });

  test('cutover rolls back by itself when a stop or the start does not hold, and never stops the stack with -v', () => {
    const cut = s23.slice(s23.indexOf('mode_cutover() {'), s23.indexOf('mode_rollback() {'));
    assert.ok((cut.match(/rollback_now/g) ?? []).length >= 3);
    assert.match(cut, /ROLLED BACK/);
    assert.doesNotMatch(s23, /down -v|--volumes|--rmi|system prune|volume rm/);
  });

  test('cutover is refused unless a test switch is set, before anything else runs', () => {
    const refuse = s23.indexOf('MODE=cutover is not supported');
    assert.ok(refuse > 0);
    assert.match(s23, /\[ "\$mode" = cutover \] && \[ "\$\{TEST_ALLOW_CUTOVER:-0\}" != 1 \]/);
    assert.ok(refuse < s23.indexOf('mode_up() {'));
    assert.ok(refuse < s23.indexOf("trap '' HUP PIPE"));
  });

  test('containers are found by label, a dead daemon fails closed, and HUP and PIPE are ignored', () => {
    assert.match(s23, /label=com\.docker\.compose\.project=\$1/);
    assert.match(s23, /docker info >\/dev\/null 2>&1 \|\| return 1/);
    assert.match(s23, /trap '' HUP PIPE/);
    assert.match(s23, /docker update --restart=no/);
    assert.match(s23, /FORCE:-0/);
    assert.match(s23, /live_project-rehearsal/);
    assert.doesNotMatch(s23, /dc ps/);
  });

  test('the health gate leaves gm-browser out; env values with $ # \\ or quotes are refused', () => {
    assert.match(s23, /gate_services="foundry bridge dashboard"/);
    assert.match(s23, /check_env_values/);
    assert.doesNotMatch(s23, /docker compose config/);
  });

  test('units are only disabled, never masked or removed; the unit files stay', () => {
    assert.doesNotMatch(s23, /systemctl (mask|unmask)|\brm\b[^\n]*\.service|daemon-reload/);
    assert.match(s23, /systemctl disable --now/);
    assert.match(s23, /systemctl enable --now/);
  });

  test('up never builds (stage 23 does) and refuses the live ports and data folders next to a running unit', () => {
    assert.match(s23, /up -d --wait --wait-timeout "\$wait_timeout" --no-build/);
    assert.match(s23, /share their data folder/);
    assert.match(s23, /live port\(s\)/);
  });

  test('rollback needs no quiet table and only warns without a snapshot', () => {
    const rb = s23.slice(
      s23.indexOf('mode_rollback() {'),
      s23.indexOf('case "$mode" in\n  status) mode_status')
    );
    assert.doesNotMatch(rb, /require_quiet/);
    assert.match(rb, /\( require_recent_snapshot \) \|\| warn/);
  });

  test('the dependency order is foundry, bridge, dashboard, gm-browser', () => {
    assert.match(
      s23,
      /units=\(foundry\.service foundry-ai-tool-bridge\.service foundry-ai-tool-dashboard\.service foundry-ai-tool-gm-browser\.service\)/
    );
  });
});

for (const [n, script] of [
  ['22', 'stage23-scenarios.sh'],
  ['23', 'stage24-scenarios.sh'],
]) {
  describe(
    `stage ${n} in the ARM64 container`,
    { skip: process.env.PI_STAGE23_CONTAINER !== '1' },
    () => {
      test('scenarios', () => {
        const r = spawnSync(
          'docker',
          [
            'run',
            '--rm',
            '--platform',
            'linux/arm64',
            '-v',
            `${repo}:/repo:ro`,
            'debian:13-slim',
            'bash',
            `/repo/scripts/pi/container-test/${script}`,
          ],
          { encoding: 'utf8', timeout: 900000, env: { ...process.env, MSYS_NO_PATHCONV: '1' } }
        );
        assert.equal(r.status, 0, r.stdout + r.stderr);
        assert.ok(r.stdout.includes('ALL SCENARIOS OK'), r.stdout);
      });
    }
  );
}
