// Pi world switch (scripts/pi/remote/switch-world.sh and scripts/pi/switch-world.ps1, backlog pi-world-switch):
//   node --test scripts/pi/switch-world.test.mjs
// The stage runs in bash against a stand-in Foundry config and worlds folder, with stand-ins for systemctl, curl, journalctl,
// ss and runuser (no systemd, no Pi). The stand-in Foundry "runs" the world options.json names when it is started.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const remote = path.join(repo, 'scripts', 'pi', 'remote');
const stage = readFileSync(path.join(remote, 'switch-world.sh'), 'utf8');
const lib = readFileSync(path.join(remote, 'lib.sh'), 'utf8');
const ps1 = path.join(repo, 'scripts', 'pi', 'switch-world.ps1');
const posix = p => p.replace(/\\/g, '/');

const roots = [];
after(() => roots.forEach(d => rmSync(d, { recursive: true, force: true })));

// The stand-in docker. State lives in the fake Pi's folder (FAKE_D): `running` (Foundry runs that world), `stopped-gm` (the
// Assistant GM container was stopped). Switches (environment): STACK_MODE=containers (the four stack containers exist),
// GM_ACTIVE=0 (no Assistant GM container), KIT_ACTIVE=1 (the Kit GM browser container runs), GM_NOJOIN, DOCKER_DOWN=1 (the
// daemon does not answer), FOUNDRY_RUNS_INSTEAD and FOUNDRY_FAIL_FOR (as for the systemctl stand-in in run()).
const FAKE_DOCKER = `#!/usr/bin/env bash
D="$FAKE_D"
echo "docker $*" >>"$D/calls"
mode="\${STACK_MODE:-units}"
world() { "$FAKE_NODE" -e 'process.stdout.write(require(process.argv[1]).world)' "$OPTIONS_FILE"; }
svc_of() { echo "\${1#cid-}"; }
start_foundry() {
  if [ -n "\${FOUNDRY_RUNS_INSTEAD:-}" ] && [ "$(world)" = curse-of-strahd ]; then printf '%s' "$FOUNDRY_RUNS_INSTEAD" >"$D/running"; return 0; fi
  [ -z "\${FOUNDRY_FAIL_FOR:-}" ] || [ "$(world)" != "$FOUNDRY_FAIL_FOR" ] || return 0
  world >"$D/running"
}
case "\${1:-}" in
  info) [ -z "\${DOCKER_DOWN:-}" ] || exit 1; exit 0 ;;
  ps)
    [ "$mode" = containers ] || exit 0
    all=0; svc=""
    for a in "$@"; do
      case "$a" in -aq) all=1 ;; label=com.docker.compose.service=*) svc="\${a#label=com.docker.compose.service=}" ;; esac
    done
    for s in foundry bridge dashboard gm-browser; do
      [ -z "$svc" ] || [ "$svc" = "$s" ] || continue
      [ "$s" != gm-browser ] || [ "\${GM_ACTIVE-1}" = 1 ] || continue
      if [ "$all" = 0 ]; then
        [ "$s" != foundry ] || [ -e "$D/running" ] || continue
        [ "$s" != gm-browser ] || [ ! -e "$D/stopped-gm" ] || continue
      fi
      echo "cid-$s"
    done
    ;;
  stop)
    case "$(svc_of "$2")" in foundry) rm -f "$D/running" ;; gm-browser) touch "$D/stopped-gm" ;; esac
    ;;
  start | restart)
    case "$(svc_of "$2")" in foundry) start_foundry ;; gm-browser) rm -f "$D/stopped-gm" ;; esac
    ;;
  inspect)
    if [ "\${KIT_ACTIVE:-}" = 1 ] && [ "\${*: -1}" = foundry-ai-tool-kit-gm-browser ]; then echo running; exit 0; fi
    exit 1
    ;;
  logs)
    if [ "\${*: -1}" = cid-gm-browser ] && [ -z "\${GM_NOJOIN:-}" ]; then
      echo "[assistant-gm] joined world $(cat "$D/running" 2>/dev/null) as Assistant GM (GM: true)"
    fi
    ;;
esac
exit 0
`;

// A fake Pi: three installed worlds, options.json launching `launch`, Foundry running that world.
function fakePi({ launch = 'frostmaiden-training', running = launch, snapshot = true } = {}) {
  const d = mkdtempSync(path.join(tmpdir(), 'switch-world-'));
  roots.push(d);
  const worlds = path.join(d, 'worlds');
  for (const w of ['curse-of-strahd', 'frostmaiden-training', 'strahd-kit']) {
    mkdirSync(path.join(worlds, w), { recursive: true });
    writeFileSync(path.join(worlds, w, 'world.json'), JSON.stringify({ id: w, playtime: 7 }));
  }
  const config = path.join(d, 'Config');
  mkdirSync(config);
  const options = path.join(config, 'options.json');
  writeFileSync(
    options,
    JSON.stringify({ port: 30000, world: launch, language: 'en.core' }, null, 2) + '\n'
  );
  if (running) writeFileSync(path.join(d, 'running'), running);
  const dietpiDir = path.join(d, 'dietpi');
  mkdirSync(dietpiDir);
  const stats = path.join(d, 'stats');
  const today = new Date().toLocaleDateString('sv');
  writeFileSync(stats, `${snapshot ? today : '2020-01-01'}_01:25:00  Backup completed\n`);
  const bin = path.join(d, 'node', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    path.join(bin, 'node'),
    `#!/usr/bin/env bash\nexec "${posix(process.execPath)}" "$@"\n`
  );
  chmodSync(path.join(bin, 'node'), 0o755);
  // A stand-in docker on PATH (lib.sh runs it through `timeout`, so a shell function would not do). With STACK_MODE unset
  // it answers like a Docker host without containers (the units run the stack); STACK_MODE=containers is a cut-over Pi.
  const fakeBin = path.join(d, 'fakebin');
  mkdirSync(fakeBin);
  writeFileSync(path.join(fakeBin, 'docker'), FAKE_DOCKER);
  chmodSync(path.join(fakeBin, 'docker'), 0o755);
  return {
    d,
    fakeBin,
    worlds,
    options,
    dietpiDir,
    stats,
    nodeDir: path.join(d, 'node'),
    launched: () => JSON.parse(readFileSync(options, 'utf8')),
    calls: () =>
      existsSync(path.join(d, 'calls')) ? readFileSync(path.join(d, 'calls'), 'utf8') : '',
    worldJson: w => readFileSync(path.join(worlds, w, 'world.json'), 'utf8'),
  };
}

function run(pi, env = {}) {
  const dd = posix(pi.d);
  const script = `${lib}
NODE_DIR="${posix(pi.nodeDir)}"
TOOL_DATA="${dd}/tool"
SYSTEM_TRIAL_DIR="${dd}/system-trial"
id() { echo 0; }
sleep() { :; }
have_systemd() { [ -z "\${NO_SYSTEMD:-}" ]; }
require_quiet() { echo "quiet-check: $*" >>"${dd}/calls"; [ -z "\${QUIET_FAIL:-}" ] || die "3 player(s) are online in Foundry"; }
runuser() { shift 3; "$@"; }
running_world() { cat "${dd}/running" 2>/dev/null || true; }
systemctl() {
  echo "systemctl $*" >>"${dd}/calls"
  # A cut-over Pi: the four units are off (MIXED_UNIT=1: Foundry's unit runs next to the containers).
  if [ "\${STACK_MODE:-units}" = containers ]; then
    case "$1" in is-active | is-enabled) [ -z "\${MIXED_UNIT:-}" ] || [ "$2 $3" != "--quiet foundry.service" ] || return 0; return 1 ;; esac
  fi
  case "$1 \${@: -1}" in
    "is-active foundry.service") [ -e "${dd}/running" ] ;;
    "is-active foundry-ai-tool-kit-gm-browser.service") [ -n "\${KIT_ACTIVE:-}" ] ;;
    "is-active foundry-ai-tool-gm-browser.service") [ "\${GM_ACTIVE-1}" = 1 ] ;;
    "is-enabled foundry-ai-tool-gm-browser.service") [ "\${GM_ACTIVE-1}" = 1 ] ;;
    "stop foundry.service") rm -f "${dd}/running" ;;
    "start foundry.service")
      if [ -n "\${FOUNDRY_RUNS_INSTEAD:-}" ] && [ "$("$NODE_DIR/bin/node" -e 'process.stdout.write(require(process.argv[1]).world)' "$OPTIONS_FILE")" = curse-of-strahd ]; then
        printf '%s' "$FOUNDRY_RUNS_INSTEAD" >"${dd}/running"
        return 0
      fi
      [ -z "\${FOUNDRY_FAIL_FOR:-}" ] || [ "$("$NODE_DIR/bin/node" -e 'process.stdout.write(require(process.argv[1]).world)' "$OPTIONS_FILE")" != "$FOUNDRY_FAIL_FOR" ] ||
        return 0
      "$NODE_DIR/bin/node" -e 'process.stdout.write(require(process.argv[1]).world)' "$OPTIONS_FILE" >"${dd}/running" ;;
    "show foundry-ai-tool-gm-browser.service") echo inv1 ;;
  esac
}
journalctl() {
  case "$*" in
    *_SYSTEMD_INVOCATION_ID=*) [ -n "\${GM_NOJOIN:-}" ] || echo "[assistant-gm] joined world $(running_world) as Assistant GM (GM: true)" ;;
  esac
  return 0
}
ss() { echo "ESTAB 0 0 127.0.0.1:31415 127.0.0.1:50000"; }
curl() {
  case "$*" in
    *api/status*) [ -e "${dd}/running" ] || return 22; echo "{\\"active\\":true,\\"world\\":\\"$(running_world)\\",\\"users\\":0}" ;;
    *) [ -e "${dd}/running" ] || return 22; [ -z "\${JOIN_DOWN:-}" ] || return 22; echo '<template id="join-game"></template>' ;;
  esac
}
${stage}`;
  const file = path.join(pi.d, 'run.sh');
  writeFileSync(file, script);
  const r = spawnSync('bash', [posix(file)], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${pi.fakeBin}${path.delimiter}${process.env.PATH}`,
      FAKE_D: posix(pi.d),
      FAKE_NODE: posix(process.execPath),
      OPTIONS_FILE: posix(pi.options),
      WORLDS_DIR: posix(pi.worlds),
      KIT_STATE_FILE: `${dd}/kit-session.env`,
      DIETPI_DIR: posix(pi.dietpiDir),
      DIETPI_BACKUP_STATS: posix(pi.stats),
      ...env,
    },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const noService = calls => assert.doesNotMatch(calls, /systemctl (stop|start|restart)/);

describe('switch-world.sh', () => {
  test('is valid bash', t => {
    const res = spawnSync('bash', ['-n', path.join(remote, 'switch-world.sh')], {
      encoding: 'utf8',
    });
    if (res.error) return t.skip('no bash here');
    assert.equal(res.status, 0, res.stderr);
  });

  test('a real run stops both services, sets options.json, starts Foundry then the browser, and prints before and after', () => {
    const pi = fakePi({ launch: 'frostmaiden-training' });
    const worldBefore = pi.worldJson('curse-of-strahd');
    const r = run(pi, { WORLD: 'curse-of-strahd' });
    assert.equal(r.status, 0, r.out);
    assert.match(
      r.out,
      /world before: running frostmaiden-training, launch choice frostmaiden-training/
    );
    assert.match(r.out, /world after: running curse-of-strahd, launch choice curse-of-strahd/);
    assert.match(r.out, /the Assistant GM browser joined curse-of-strahd/);
    const o = pi.launched();
    assert.equal(o.world, 'curse-of-strahd');
    assert.equal(o.port, 30000);
    assert.equal(o.language, 'en.core');
    const calls = pi.calls();
    const at = s => calls.indexOf(s);
    assert.ok(at('stop foundry-ai-tool-gm-browser.service') < at('stop foundry.service'), calls);
    assert.ok(at('stop foundry.service') < at('start foundry.service'), calls);
    assert.ok(at('start foundry.service') < at('start foundry-ai-tool-gm-browser.service'), calls);
    assert.match(calls, /quiet-check: switching the world to curse-of-strahd/);
    assert.equal(pi.worldJson('curse-of-strahd'), worldBefore, 'world data is never touched');
  });

  test('the launch choice is switched even when Foundry runs another world than options.json names', () => {
    const pi = fakePi({ launch: 'curse-of-strahd', running: 'strahd-kit' });
    const r = run(pi, { WORLD: 'curse-of-strahd' });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /world after: running curse-of-strahd/);
  });

  test('the world that already runs and launches is left alone', () => {
    const pi = fakePi({ launch: 'strahd-kit' });
    const r = run(pi, { WORLD: 'strahd-kit' });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /already runs and is what Foundry launches: nothing to do/);
    noService(pi.calls());
    assert.doesNotMatch(pi.calls(), /quiet-check/);
  });

  test('a dry run prints the world before, changes nothing and needs no snapshot', () => {
    const pi = fakePi({ snapshot: false });
    const r = run(pi, { WORLD: 'strahd-kit', DRY_RUN: '1' });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /world before: running frostmaiden-training/);
    assert.match(r.out, /dry run: would stop the Assistant GM browser and Foundry/);
    assert.equal(pi.launched().world, 'frostmaiden-training');
    noService(pi.calls());
  });

  test('WORLD must be one of the three ids', () => {
    const pi = fakePi();
    for (const w of ['', 'ai-tool-test', '../curse-of-strahd', 'curse-of-strahd; reboot']) {
      const r = run(pi, { WORLD: w });
      assert.notEqual(r.status, 0, `WORLD='${w}'`);
      assert.match(r.out, /Nothing was changed/);
    }
    assert.equal(pi.launched().world, 'frostmaiden-training');
    noService(pi.calls());
  });

  test('a world that is not installed is refused before anything stops', () => {
    const pi = fakePi();
    rmSync(path.join(pi.worlds, 'strahd-kit'), { recursive: true });
    const r = run(pi, { WORLD: 'strahd-kit' });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /no world folder/);
    noService(pi.calls());
  });

  test('people online or a recording (the quiet check) refuse before anything stops', () => {
    const pi = fakePi();
    const r = run(pi, { WORLD: 'curse-of-strahd', QUIET_FAIL: '1' });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /player\(s\) are online/);
    assert.equal(pi.launched().world, 'frostmaiden-training');
    noService(pi.calls());
  });

  test('an open kit session and an open system trial refuse', () => {
    const pi = fakePi();
    const kitGm = run(pi, { WORLD: 'curse-of-strahd', KIT_ACTIVE: '1' });
    assert.notEqual(kitGm.status, 0);
    assert.match(kitGm.out, /a kit session is running/);
    writeFileSync(path.join(pi.d, 'kit-session.env'), 'STAMP=1\n');
    const state = run(pi, { WORLD: 'curse-of-strahd' });
    assert.notEqual(state.status, 0);
    assert.match(state.out, /a kit session is open/);
    rmSync(path.join(pi.d, 'kit-session.env'));
    mkdirSync(path.join(pi.d, 'system-trial'));
    writeFileSync(path.join(pi.d, 'system-trial', 'state'), 'phase=installing\n');
    const trial = run(pi, { WORLD: 'curse-of-strahd' });
    assert.notEqual(trial.status, 0);
    assert.match(trial.out, /system trial is open/);
    noService(pi.calls());
    assert.equal(pi.launched().world, 'frostmaiden-training');
  });

  test('without a snapshot from today nothing stops; NO_SNAPSHOT=1 overrides, and a dry run says so', () => {
    const pi = fakePi({ snapshot: false });
    const refused = run(pi, { WORLD: 'curse-of-strahd' });
    assert.notEqual(refused.status, 0);
    assert.match(refused.out, /snapshot/);
    noService(pi.calls());
    assert.equal(pi.launched().world, 'frostmaiden-training');
    const dry = run(pi, { WORLD: 'curse-of-strahd', DRY_RUN: '1' });
    assert.match(dry.out, /NO dietpi-backup snapshot from today: a real run would refuse/);
    assert.match(dry.out, /people online in Foundry: 0/);
    const r = run(pi, { WORLD: 'curse-of-strahd', NO_SNAPSHOT: '1' });
    assert.equal(r.status, 0, r.out);
    assert.equal(pi.launched().world, 'curse-of-strahd');
  });

  test('when Foundry comes up on another world than asked, options.json is put back and the old world runs', () => {
    const pi = fakePi({ launch: 'frostmaiden-training' });
    const r = run(pi, { WORLD: 'curse-of-strahd', FOUNDRY_RUNS_INSTEAD: 'strahd-kit' });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /Foundry runs 'strahd-kit', not curse-of-strahd/);
    assert.equal(pi.launched().world, 'frostmaiden-training');
    assert.equal(readFileSync(path.join(pi.d, 'running'), 'utf8'), 'frostmaiden-training');
    assert.match(r.out, /Foundry runs 'frostmaiden-training' again/);
  });

  test('when the new world does not come up, options.json is put back and Foundry and the browser start again', () => {
    const pi = fakePi({ launch: 'frostmaiden-training' });
    const r = run(pi, { WORLD: 'curse-of-strahd', FOUNDRY_FAIL_FOR: 'curse-of-strahd' });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /does not answer/);
    assert.match(r.out, /options.json is put back/);
    assert.equal(pi.launched().world, 'frostmaiden-training');
    const calls = pi.calls();
    assert.ok(
      calls.lastIndexOf('start foundry.service') > calls.indexOf('stop foundry.service'),
      calls
    );
    assert.ok(
      calls.lastIndexOf('start foundry-ai-tool-gm-browser.service') >
        calls.lastIndexOf('stop foundry.service'),
      calls
    );
  });

  test('when only the Assistant GM browser does not join, the switch stays and the run exits 1 with the command to read', () => {
    const pi = fakePi();
    const r = run(pi, { WORLD: 'curse-of-strahd', GM_NOJOIN: '1' });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /did not report 'joined world curse-of-strahd'/);
    assert.match(r.out, /journalctl -u foundry-ai-tool-gm-browser.service/);
    assert.equal(pi.launched().world, 'curse-of-strahd');
  });

  test('a browser that was neither running nor enabled is left stopped, with a warning', () => {
    const pi = fakePi();
    const r = run(pi, { WORLD: 'curse-of-strahd', GM_ACTIVE: '0' });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /left stopped/);
    assert.doesNotMatch(pi.calls(), /start foundry-ai-tool-gm-browser/);
  });
});

// A Pi after the cutover (stage 24): the stack runs as the containers of compose project foundry-ai-tool-pi, the units are
// off. The stand-in docker keeps them; no unit may be started, restarted or enabled.
describe('switch-world.sh on a cut-over Pi (containers)', () => {
  const cut = { STACK_MODE: 'containers' };
  const noUnitStart = calls =>
    assert.doesNotMatch(calls, /systemctl (start|restart|enable|stop|try-restart)/);
  const at = (calls, s) => calls.indexOf(s);

  test('a real run docker-stops the browser and Foundry, sets options.json, docker-starts Foundry then the browser', () => {
    const pi = fakePi({ launch: 'frostmaiden-training' });
    const r = run(pi, { ...cut, WORLD: 'curse-of-strahd' });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /world after: running curse-of-strahd, launch choice curse-of-strahd/);
    assert.match(r.out, /the Assistant GM browser joined curse-of-strahd/);
    assert.equal(pi.launched().world, 'curse-of-strahd');
    const calls = pi.calls();
    noUnitStart(calls);
    assert.doesNotMatch(calls, /docker (rm|compose|run|kill)/);
    assert.ok(
      at(calls, 'docker stop cid-gm-browser') < at(calls, 'docker stop cid-foundry'),
      calls
    );
    assert.ok(at(calls, 'docker stop cid-foundry') < at(calls, 'docker start cid-foundry'), calls);
    assert.ok(
      at(calls, 'docker start cid-foundry') < at(calls, 'docker start cid-gm-browser'),
      calls
    );
    // Only the Foundry and the Assistant GM browser containers were touched: never the bridge or the dashboard.
    assert.doesNotMatch(calls, /docker (stop|start|restart) cid-(bridge|dashboard)/);
    assert.match(calls, /docker logs --since \d+ cid-gm-browser/);
    assert.match(calls, /quiet-check: switching the world to curse-of-strahd/);
  });

  test('it runs on a host without systemd as long as the containers answer', () => {
    const pi = fakePi({ launch: 'frostmaiden-training' });
    const r = run(pi, { ...cut, WORLD: 'curse-of-strahd', NO_SYSTEMD: '1' });
    assert.equal(r.status, 0, r.out);
    assert.doesNotMatch(r.out, /nothing was started/);
    assert.match(pi.calls(), /docker start cid-foundry/);
  });

  test('the world that already runs and launches is left alone: no container is touched', () => {
    const pi = fakePi({ launch: 'strahd-kit' });
    const r = run(pi, { ...cut, WORLD: 'strahd-kit' });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /nothing to do/);
    assert.doesNotMatch(pi.calls(), /docker (stop|start|restart)/);
    noUnitStart(pi.calls());
  });

  test('a dry run changes nothing', () => {
    const pi = fakePi();
    const r = run(pi, { ...cut, WORLD: 'strahd-kit', DRY_RUN: '1' });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /dry run: people online in Foundry: 0/);
    assert.doesNotMatch(pi.calls(), /docker (stop|start|restart)/);
    assert.equal(pi.launched().world, 'frostmaiden-training');
  });

  test('the Kit GM browser container (no compose label) refuses before anything stops', () => {
    const pi = fakePi();
    const r = run(pi, { ...cut, WORLD: 'curse-of-strahd', KIT_ACTIVE: '1' });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /a kit session is running \(the kit GM browser container/);
    assert.match(r.out, /Nothing was changed/);
    assert.doesNotMatch(pi.calls(), /docker (stop|start|restart)/);
    assert.equal(pi.launched().world, 'frostmaiden-training');
  });

  test('when the new world does not come up, options.json goes back and both containers start again', () => {
    const pi = fakePi({ launch: 'frostmaiden-training' });
    const r = run(pi, { ...cut, WORLD: 'curse-of-strahd', FOUNDRY_FAIL_FOR: 'curse-of-strahd' });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /does not answer/);
    assert.match(r.out, /docker logs --tail 50/);
    assert.match(r.out, /options.json is put back/);
    assert.equal(pi.launched().world, 'frostmaiden-training');
    const calls = pi.calls();
    noUnitStart(calls);
    assert.doesNotMatch(calls, /docker (rm|compose|run)/);
    assert.ok(
      calls.lastIndexOf('docker start cid-foundry') > calls.lastIndexOf('docker stop cid-foundry'),
      calls
    );
    assert.ok(
      calls.lastIndexOf('docker start cid-gm-browser') >
        calls.lastIndexOf('docker stop cid-foundry'),
      calls
    );
    assert.equal(readFileSync(path.join(pi.d, 'running'), 'utf8'), 'frostmaiden-training');
  });

  test('when Foundry comes up on another world, options.json is put back and the old world runs', () => {
    const pi = fakePi({ launch: 'frostmaiden-training' });
    const r = run(pi, { ...cut, WORLD: 'curse-of-strahd', FOUNDRY_RUNS_INSTEAD: 'strahd-kit' });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /Foundry runs 'strahd-kit', not curse-of-strahd/);
    assert.equal(pi.launched().world, 'frostmaiden-training');
    assert.equal(readFileSync(path.join(pi.d, 'running'), 'utf8'), 'frostmaiden-training');
    noUnitStart(pi.calls());
  });

  test('a browser container that does not join leaves the switch in place and names the docker logs command', () => {
    const pi = fakePi();
    const r = run(pi, { ...cut, WORLD: 'curse-of-strahd', GM_NOJOIN: '1' });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /did not report 'joined world curse-of-strahd'/);
    assert.match(r.out, /docker logs --tail 50/);
    assert.equal(pi.launched().world, 'curse-of-strahd');
    noUnitStart(pi.calls());
  });

  test('no Assistant GM container: it is left alone with a warning', () => {
    const pi = fakePi();
    const r = run(pi, { ...cut, WORLD: 'curse-of-strahd', GM_ACTIVE: '0' });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /left stopped/);
    assert.doesNotMatch(pi.calls(), /docker start cid-gm-browser/);
  });

  test('a unit that runs next to the containers refuses (mixed state), and so does a silent Docker daemon', () => {
    const pi = fakePi();
    const mixed = run(pi, { ...cut, WORLD: 'curse-of-strahd', MIXED_UNIT: '1' });
    assert.notEqual(mixed.status, 0);
    assert.match(mixed.out, /runs next to the containers/);
    const down = run(pi, { WORLD: 'curse-of-strahd', DOCKER_DOWN: '1' });
    assert.notEqual(down.status, 0);
    assert.match(down.out, /Docker daemon does not answer/);
    assert.doesNotMatch(pi.calls(), /docker (stop|start|restart)/);
    noService(pi.calls());
    assert.equal(pi.launched().world, 'frostmaiden-training');
  });
});

describe('switch-world.sh as text', () => {
  test('writes only options.json: no world folder is copied, removed or written', () => {
    assert.doesNotMatch(stage, /\brm\b|\bmv\b|\bcp\b|\binstall\b|tee |>>? *"?\$(dir|worlds_dir)/);
    assert.match(stage, /foundry_edit_json "\$options"/);
  });

  test('the checks come before the first stop', () => {
    const firstStop = stage.indexOf('svc_stop');
    for (const check of [
      'refuse_during_system_trial',
      'require_quiet "',
      'foundry_can_write',
      'dry" = 1',
    ]) {
      const at = stage.indexOf(check);
      assert.ok(at > 0 && at < firstStop, check);
    }
  });

  test('the wrapper sends WORLD only from the three ids', () => {
    const text = readFileSync(ps1, 'utf8');
    assert.match(text, /ValidateSet\('curse-of-strahd', 'frostmaiden-training', 'strahd-kit'\)/);
  });
});

const probe = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major']);
const hasPwsh = !probe.error && probe.status === 0;

describe('switch-world.ps1', { skip: !hasPwsh && 'PowerShell 7 is not available' }, () => {
  function wrapper(args) {
    const d = mkdtempSync(path.join(tmpdir(), 'switch-world-ps-'));
    roots.push(d);
    const fake = path.join(d, 'fake-ssh.ps1');
    writeFileSync(
      fake,
      `$args | Set-Content -Path '${path.join(d, 'args.txt')}'\n$stdin = @($input) -join "\`n"\nSet-Content -Path '${path.join(d, 'stdin.txt')}' -Value $stdin\nexit 0\n`
    );
    const r = spawnSync('pwsh', ['-NoProfile', '-File', ps1, '-Ssh', fake, ...args], {
      encoding: 'utf8',
    });
    const read = f => (existsSync(path.join(d, f)) ? readFileSync(path.join(d, f), 'utf8') : '');
    return {
      status: r.status,
      out: `${r.stdout}${r.stderr}`,
      args: read('args.txt'),
      stdin: read('stdin.txt'),
    };
  }

  test('sends lib.sh and the stage, with WORLD (and DRY_RUN, FORCE) in front of bash', () => {
    const r = wrapper(['-World', 'strahd-kit', '-DryRun', '-Force']);
    assert.equal(r.status, 0, r.out);
    assert.match(r.args, /WORLD=strahd-kit DRY_RUN=1 FORCE=1 bash -s/);
    assert.match(r.stdin, /Shared helpers for the Orange Pi stage scripts/);
    assert.match(r.stdin, /Switch the world the Pi's Foundry runs/);
  });

  test('a plain run has no DRY_RUN or FORCE, and an unknown world is refused before ssh', () => {
    const ok = wrapper(['-World', 'curse-of-strahd']);
    assert.match(ok.args, /^WORLD=curse-of-strahd bash -s/m);
    assert.doesNotMatch(ok.args, /DRY_RUN|FORCE/);
    const bad = wrapper(['-World', 'ai-tool-test']);
    assert.notEqual(bad.status, 0);
    assert.equal(bad.args, '');
  });
});
