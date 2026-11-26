// Tests for deploy/pi/deployed-state.sh (backlog pi-deployed-state-check): the read-only check of what is deployed on
// the Pi. Stand-in systemctl, docker and ldconfig scripts and a temp /etc and /opt tree; the real script runs with bash.
//   node --test deploy/pi/deployed-state.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fwd = p => p.replace(/\\/g, '/');
const posix = p => fwd(p).replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
const script = fwd(path.join(here, 'deployed-state.sh'));

const noBash = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' }).status !== 0 && 'no bash here';

const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const GOOD_UNITS = {
  'foundry.service': { active: 'active', sub: 'running', restarts: 0 },
  'foundry-ai-tool-bridge.service': { active: 'active', sub: 'running', restarts: 0 },
  'foundry-ai-tool-dashboard.service': { active: 'active', sub: 'running', restarts: 0 },
  'foundry-ai-tool-gm-browser.service': { active: 'active', sub: 'running', restarts: 0 },
};

// 4000 lines overflow the pipe buffer. The stub exits 141 once a write fails, so the old `ldconfig | grep -q` pipeline
// fails the test even where the runner ignores SIGPIPE (the write then errors instead of killing the stub).
const LONG_LDCONFIG =
  'echo "libicuuc.so.72 => /usr/lib/libicuuc.so.72" || exit 141; i=0; while [ $i -lt 4000 ]; do echo "libfiller$i.so.1 => /usr/lib/libfiller$i.so.1" || exit 141; i=$((i+1)); done';

const OFF = { active: 'inactive', sub: 'dead', restarts: 0 };

function stub(dir, name, body) {
  const file = path.join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return posix(file);
}

/** Builds a fake Pi tree and runs the script. `opts.units`, `opts.containers` (null = no docker), `opts.env`. */
function run(opts = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dstate-'));
  dirs.push(root);
  const etc = path.join(root, 'etc');
  const tool = path.join(root, 'opt');
  mkdirSync(etc, { recursive: true });
  mkdirSync(path.join(tool, 'app'), { recursive: true });
  mkdirSync(path.join(tool, 'gm-browser'), { recursive: true });
  mkdirSync(path.join(root, 'bin'), { recursive: true });

  const envFiles = opts.env ?? {
    'dashboard.env': 'OBSIDIAN_VAULT_NAME="v"\nDASHBOARD_FOUNDRY_URL=https://play.example.com\n',
    'bridge.env': 'FOUNDRY_AI_OBSIDIAN_DIR=/x\nFOUNDRY_AI_OPEN_BASE=http://pi:3000\n',
    'dashboard-access.env': 'GM_DASHBOARD_TOKEN=abc\n',
    'assistant-gm.env': 'ASSISTANT_GM_PASSWORD="pw"\n',
  };
  for (const [f, text] of Object.entries(envFiles)) writeFileSync(path.join(etc, f), text);
  if (opts.ref !== null) {
    writeFileSync(path.join(tool, 'app', 'package.json'), '{\n  "version": "0.24.0"\n}\n');
    writeFileSync(path.join(tool, 'app', '.tool-ref'), `${opts.ref ?? 'v0.25.0'}\n`);
  }
  writeFileSync(path.join(tool, 'gm-browser', 'assistant-gm.mjs'), opts.helper ?? 'helper-v1\n');
  opts.setup?.(tool);

  const units = { ...GOOD_UNITS, ...(opts.units ?? {}) };
  const unitCases = Object.entries(units)
    .map(([u, s]) =>
      s === null
        ? `${u}) echo LoadState=not-found;;`
        : `${u}) printf 'LoadState=loaded\\nActiveState=${s.active}\\nSubState=${s.sub}\\nNRestarts=${s.restarts}\\nActiveEnterTimestamp=${s.since ?? 'Tue 2026-11-24 12:00:00 CET'}\\n';;`
    )
    .join('\n');
  const dockerActive = opts.dockerActive === false ? 1 : 0;
  const systemctl = stub(
    path.join(root, 'bin'),
    'systemctl',
    `echo "systemctl $1" >> "$CALL_LOG"\nif [ "$1" = is-active ]; then exit ${dockerActive}; fi\ncase "$2" in\n${unitCases}\nesac`
  );

  let dockerPath = path.join(root, 'bin', 'no-docker');
  if (opts.containers !== null && opts.containers !== undefined) {
    // Containers are keyed by compose service; `ps` answers only when asked for the compose project, and a stray
    // exited job container (a GitHub runner's) shows up when the filter is missing.
    const list = Object.keys(opts.containers)
      .map(s => `p-${s}-1|${s}`)
      .join('\\n');
    const cases = Object.entries(opts.containers)
      .map(([s, c]) => `p-${s}-1) echo '${c.state}|${c.restarts}|${c.health}';;`)
      .join('\n');
    dockerPath = stub(
      path.join(root, 'bin'),
      'docker',
      `echo "docker $1" >> "$CALL_LOG"\n${opts.dockerPsFails ? 'if [ "$1" = ps ]; then exit 1; fi\n' : ''}case "$1" in\nps) case "$*" in *label=com.docker.compose.project=foundry-ai-tool-pi-rehearsal*) printf '${opts.rehearsal ? 'r-1\\n' : ''}';; *label=com.docker.compose.project=foundry-ai-tool-pi*) printf '${list}\\n';; *) printf 'runner-job-1|\\n';; esac;;\ninspect) case "$4" in\n${cases}\nrunner-job-1) echo 'exited|0|none';;\nesac;;\nesac`
    );
  }
  const ldconfig = stub(path.join(root, 'bin'), 'ldconfig', opts.icu === false ? 'true' : opts.icu === 'long' ? LONG_LDCONFIG :'echo "libicuuc.so.72 => /usr/lib/libicuuc.so.72"');

  const callLog = path.join(root, 'calls.log');
  writeFileSync(callLog, '');
  const env = {
    ...process.env,
    CALL_LOG: posix(callLog),
    TOOL_DIR: posix(tool),
    TOOL_ETC: posix(etc),
    SYSTEMCTL: systemctl,
    DOCKER: dockerPath,
    LDCONFIG: ldconfig,
    ...(opts.expect ?? {}),
  };
  const r = spawnSync('bash', [script], { encoding: 'utf8', env });
  const calls = readFileSync(callLog, 'utf8').split('\n').filter(Boolean);
  return { code: r.status, out: r.stdout + r.stderr, calls };
}

describe('deployed-state.sh', { skip: noBash }, () => {
  test('a healthy Pi on systemd passes', () => {
    const r = run({ expect: { EXPECT_REF: 'v0.25.0', EXPECT_MAIN_AHEAD: '3' } });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /foundry-ai-tool-bridge\.service is active, no restarts/);
    assert.match(r.out, /deployed ref v0\.25\.0 is the newest release; main is 3 commit\(s\) past it/);
    assert.match(r.out, /0 failed/);
  });

  test('a missing DASHBOARD_FOUNDRY_URL is named with the fix', () => {
    const r = run({
      env: {
        'dashboard.env': 'OBSIDIAN_VAULT_NAME="v"\n',
        'bridge.env': 'FOUNDRY_AI_OBSIDIAN_DIR=/x\nFOUNDRY_AI_OPEN_BASE=http://pi:3000\n',
        'dashboard-access.env': 'GM_EMAILS=a@b.c\n',
        'assistant-gm.env': 'ASSISTANT_GM_PASSWORD="pw"\n',
      },
    });
    assert.equal(r.code, 0, 'a warning is not a failure');
    assert.match(r.out, /WARNING: dashboard\.env has no DASHBOARD_FOUNDRY_URL/);
    assert.match(r.out, /stage 7/);
  });

  test('an empty value counts as missing and no value is ever printed', () => {
    const r = run({
      env: {
        'dashboard.env': 'DASHBOARD_FOUNDRY_URL=\nOBSIDIAN_VAULT_NAME="v"\n',
        'bridge.env': 'FOUNDRY_AI_OBSIDIAN_DIR=/x\nFOUNDRY_AI_OPEN_BASE=http://pi:3000\n',
        'dashboard-access.env': 'GM_DASHBOARD_TOKEN=supersecrettoken\n',
        'assistant-gm.env': 'ASSISTANT_GM_PASSWORD="hunter2"\n',
      },
    });
    assert.match(r.out, /WARNING: dashboard\.env has no DASHBOARD_FOUNDRY_URL/);
    assert.doesNotMatch(r.out, /supersecrettoken|hunter2/);
  });

  test('a missing split file warns about spoilers', () => {
    const r = run({
      env: {
        'dashboard.env': 'DASHBOARD_FOUNDRY_URL=https://p.example\nOBSIDIAN_VAULT_NAME="v"\n',
        'bridge.env': 'FOUNDRY_AI_OBSIDIAN_DIR=/x\nFOUNDRY_AI_OPEN_BASE=http://pi:3000\n',
        'assistant-gm.env': 'ASSISTANT_GM_PASSWORD="pw"\n',
      },
    });
    assert.match(r.out, /WARNING: .*dashboard-access\.env is missing/);
  });

  test('a unit in auto-restart fails as a crash loop', () => {
    const r = run({ units: { 'foundry-ai-tool-bridge.service': { active: 'activating', sub: 'auto-restart', restarts: 2 } } });
    assert.equal(r.code, 1);
    assert.match(r.out, /FAIL: foundry-ai-tool-bridge\.service is in a crash loop/);
  });

  test('five restarts fail, one restart warns', () => {
    const loop = run({ units: { 'foundry.service': { active: 'active', sub: 'running', restarts: 5 } } });
    assert.equal(loop.code, 1);
    assert.match(loop.out, /FAIL: foundry\.service is in a crash loop \(active\/running, 5 restarts\)/);
    const once = run({ units: { 'foundry.service': { active: 'active', sub: 'running', restarts: 1 } } });
    assert.equal(once.code, 0);
    assert.match(once.out, /WARNING: foundry\.service is active but restarted 1 time/);
  });

  test('the Assistant GM restarting nightly after the backup is ok, other restarts and a failed unit are not', () => {
    const gm = 'foundry-ai-tool-gm-browser.service';
    const night = run({ units: { [gm]: { active: 'active', sub: 'running', restarts: 7, since: 'Tue 2026-11-24 04:31:16 CET' } } });
    assert.equal(night.code, 0);
    assert.match(night.out, /ok: foundry-ai-tool-gm-browser\.service is active, 7 restart/);
    assert.doesNotMatch(night.out, /WARNING: foundry-ai-tool-gm-browser/);
    // A restart at another time of day keeps the old rule: warn from one, fail from five.
    const day = run({ units: { [gm]: { active: 'active', sub: 'running', restarts: 2, since: 'Tue 2026-11-24 14:10:00 CET' } } });
    assert.match(day.out, /WARNING: foundry-ai-tool-gm-browser\.service is active but restarted 2 time/);
    const dayLoop = run({ units: { [gm]: { active: 'active', sub: 'running', restarts: 5, since: 'Tue 2026-11-24 14:10:00 CET' } } });
    assert.equal(dayLoop.code, 1);
    // The crash guard's start limit leaves the unit failed: a crash loop even for the optional Assistant GM.
    const failed = run({ units: { [gm]: { active: 'failed', sub: 'failed', restarts: 9, since: 'Tue 2026-11-24 04:31:16 CET' } } });
    assert.equal(failed.code, 1);
    assert.match(failed.out, /FAIL: foundry-ai-tool-gm-browser\.service is in a crash loop/);
  });

  test('a stopped required unit fails, a stopped Assistant GM only warns', () => {
    const r = run({
      units: {
        'foundry-ai-tool-dashboard.service': { active: 'inactive', sub: 'dead', restarts: 0 },
        'foundry-ai-tool-gm-browser.service': { active: 'inactive', sub: 'dead', restarts: 0 },
      },
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /FAIL: foundry-ai-tool-dashboard\.service is inactive/);
    assert.match(r.out, /WARNING: foundry-ai-tool-gm-browser\.service is inactive/);
  });

  test('an uninstalled optional unit is fine, a required one fails', () => {
    const r = run({ units: { 'foundry-ai-tool-gm-browser.service': null, 'foundry.service': null } });
    assert.match(r.out, /gm-browser\.service is not installed/);
    assert.match(r.out, /FAIL: foundry\.service is not installed/);
  });

  test('containers: healthy passes; unhealthy, restarting and crash-looped fail; no health check warns', () => {
    const r = run({
      containers: {
        foundry: { state: 'running', restarts: 0, health: 'healthy' },
        bridge: { state: 'running', restarts: 0, health: 'unhealthy' },
        dashboard: { state: 'restarting', restarts: 1, health: 'starting' },
        gmbrowser: { state: 'running', restarts: 7, health: 'healthy' },
        cloudflared: { state: 'running', restarts: 0, health: 'none' },
      },
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /ok: container foundry is running and healthy, no restarts/);
    assert.match(r.out, /FAIL: container bridge is unhealthy/);
    assert.match(r.out, /FAIL: container dashboard is in a crash loop \(restarting, 1 restarts\)/);
    assert.match(r.out, /FAIL: container gmbrowser is in a crash loop \(running, 7 restarts\)/);
    assert.match(r.out, /WARNING: container cloudflared has no health check/);
  });

  test('containers: a healthy container that restarted once warns with the count', () => {
    const r = run({
      containers: { foundry: { state: 'running', restarts: 2, health: 'healthy' } },
      units: { 'foundry.service': OFF },
    });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /WARNING: container foundry is healthy but restarted 2 time/);
  });

  test('after the cutover the retired units are fine; a unit running next to its container is a port clash', () => {
    const healthy = { state: 'running', restarts: 0, health: 'healthy' };
    const cut = run({
      containers: { foundry: healthy, bridge: healthy, dashboard: healthy, 'gm-browser': healthy },
      units: {
        'foundry.service': OFF,
        'foundry-ai-tool-bridge.service': OFF,
        'foundry-ai-tool-dashboard.service': OFF,
        'foundry-ai-tool-gm-browser.service': OFF,
      },
    });
    assert.equal(cut.code, 0, cut.out);
    assert.match(cut.out, /units \(containers\)/);
    assert.match(cut.out, /foundry\.service is inactive \(retired; the foundry container runs\)/);
    const clash = run({
      containers: { bridge: healthy },
      units: { 'foundry-ai-tool-bridge.service': { active: 'active', sub: 'running', restarts: 0 } },
    });
    assert.equal(clash.code, 1);
    assert.match(clash.out, /FAIL: foundry-ai-tool-bridge\.service is active and the bridge container is running too/);
  });

  test('the Discord bot: a unit and the bot container together fail, the retired unit next to the container is fine', () => {
    const healthy = { state: 'running', restarts: 0, health: 'healthy' };
    const unit = 'foundry-ai-tool-discord-bot.service';
    const clash = run({
      containers: { 'discord-bot': healthy },
      units: { [unit]: { active: 'active', sub: 'running', restarts: 0 } },
    });
    assert.equal(clash.code, 1);
    assert.match(clash.out, /FAIL: foundry-ai-tool-discord-bot\.service is active and the discord-bot container is running too/);
    const cut = run({ containers: { 'discord-bot': healthy }, units: { [unit]: OFF } });
    assert.match(cut.out, /foundry-ai-tool-discord-bot\.service is inactive \(retired; the discord-bot container runs\)/);
    assert.match(cut.out, /container discord-bot is running and healthy/);
    // No bot unit installed (a Pi without the recorder) is fine.
    assert.match(run().out, /foundry-ai-tool-discord-bot\.service is not installed/);
  });

  test('containers outside the compose project are ignored', () => {
    const r = run({ containers: {} });
    assert.match(r.out, /no containers in project foundry-ai-tool-pi/);
    assert.doesNotMatch(r.out, /runner-job/);
    assert.equal(r.code, 0, r.out);
  });

  test('a stale ref and a changed helper warn when expectations are given', () => {
    const r = run({
      ref: 'v0.24.0',
      expect: { EXPECT_REF: 'v0.25.0', EXPECT_MAIN_AHEAD: '41', EXPECT_ASSISTANT_GM_SHA256: 'deadbeef' },
    });
    assert.match(r.out, /WARNING: deployed ref is v0\.24\.0, the newest release is v0\.25\.0; main is 41 commit\(s\) past it/);
    assert.match(r.out, /WARNING: Assistant GM helper differs from the repo copy/);
  });

  test('a package.json that matches the release proves nothing: only the ref counts', () => {
    const r = run({ ref: 'v0.24.0', expect: { EXPECT_REF: 'v0.25.0' } });
    assert.match(r.out, /WARNING: deployed ref is v0\.24\.0/);
  });

  test('no build at all fails', () => {
    const r = run({ ref: null });
    assert.equal(r.code, 1);
    assert.match(r.out, /FAIL: no build at/);
  });

  test('libicu is found when ldconfig prints a long list (no SIGPIPE under pipefail)', () => {
    const r = run({ icu: 'long' });
    assert.match(r.out, /libicu is installed/);
  });

  test('docker is queried only while docker.service is active (a stopped daemon is never socket-activated)', () => {
    const r = run({ containers: { foundry: { state: 'running', restarts: 0, health: 'healthy' } }, dockerActive: false });
    assert.match(r.out, /WARNING: docker is installed but not running/);
    assert.doesNotMatch(r.out, /no containers in project|container foundry/);
    assert.ok(!r.calls.some(c => c.startsWith('docker ')), `docker was called: ${r.calls}`);
    assert.equal(r.code, 0, r.out);
  });

  test('a failing docker ps warns instead of reading as no containers', () => {
    const r = run({ containers: {}, dockerPsFails: true });
    assert.match(r.out, /WARNING: docker ps failed/);
    assert.doesNotMatch(r.out, /no containers in project/);
  });

  test('a quoted empty value counts as missing, a quoted real value as set', () => {
    const r = run({
      env: {
        'dashboard.env': 'DASHBOARD_FOUNDRY_URL=https://p.example\nOBSIDIAN_VAULT_NAME=""\n',
        'bridge.env': "FOUNDRY_AI_OBSIDIAN_DIR=''\nFOUNDRY_AI_OPEN_BASE=\"http://pi:3000\"\n",
        'dashboard-access.env': 'GM_DASHBOARD_TOKEN=abc\n',
        'assistant-gm.env': 'ASSISTANT_GM_PASSWORD="pw"\n',
      },
    });
    assert.match(r.out, /WARNING: dashboard\.env has no OBSIDIAN_VAULT_NAME/);
    assert.match(r.out, /WARNING: bridge\.env has no FOUNDRY_AI_OBSIDIAN_DIR/);
    assert.match(r.out, /ok: bridge\.env sets FOUNDRY_AI_OPEN_BASE/);
  });

  test('the helper line says which copy the hash came from', () => {
    const helper = 'helper-v1\n';
    const sha = createHash('sha256').update(helper).digest('hex');
    const src = 'the v0.25.0 copy of assistant-gm.mjs';
    const same = run({ helper, expect: { EXPECT_ASSISTANT_GM_SHA256: sha, EXPECT_ASSISTANT_GM_SOURCE: src } });
    assert.match(same.out, /ok: Assistant GM helper matches the v0\.25\.0 copy of assistant-gm\.mjs/);
    const diff = run({ helper, expect: { EXPECT_ASSISTANT_GM_SHA256: 'deadbeef', EXPECT_ASSISTANT_GM_SOURCE: src } });
    assert.match(diff.out, /WARNING: Assistant GM helper differs from the v0\.25\.0 copy of assistant-gm\.mjs/);
  });

  test('read-only: the stand-ins only ever see show, is-active, ps or inspect', () => {
    const healthy = { state: 'running', restarts: 0, health: 'healthy' };
    const runs = [
      run({}),
      run({ containers: { foundry: healthy, bridge: healthy }, units: { 'foundry.service': OFF } }),
      run({ containers: {}, dockerActive: false }),
      run({ containers: {}, dockerPsFails: true }),
    ];
    const allowed = new Set(['systemctl show', 'systemctl is-active', 'docker ps', 'docker inspect']);
    const seen = runs.flatMap(r => r.calls);
    for (const call of seen) assert.ok(allowed.has(call), `not read-only: ${call}`);
    assert.ok(seen.includes('docker inspect') && seen.includes('systemctl show'), 'the recorder saw nothing useful');
  });

  test('a rehearsal stack left behind warns', () => {
    const r = run({ containers: {}, rehearsal: true });
    assert.match(r.out, /WARNING: a rehearsal stack is present/);
    assert.equal(r.code, 0, r.out);
  });

  const sha = text => createHash('sha256').update(text).digest('hex');
  const LIST = [
    '# comment',
    '5 or 28|gm-browser/assistant-gm.mjs|scripts/pi/remote/assistant-gm.mjs',
    '29|gamenight-watch/gamenight-watch.mjs|scripts/gamenight-watch.mjs',
    '35|who-uses-what/who-uses-what.mjs|scripts/who-uses-what.mjs',
    '',
  ].join('\n');
  const b64 = text => Buffer.from(text).toString('base64');
  const put = (tool, rel, text) => {
    mkdirSync(path.dirname(path.join(tool, rel)), { recursive: true });
    writeFileSync(path.join(tool, rel), text);
  };

  test('stage files: a stale file is named with its stage, a missing one is not counted', () => {
    const r = run({
      setup: tool => put(tool, 'gamenight-watch/gamenight-watch.mjs', 'old\n'),
      helper: 'helper-v2\n',
      expect: {
        STAGE_FILES_B64: b64(LIST),
        EXPECT_STAGE_SHAS_B64: b64(
          `scripts/pi/remote/assistant-gm.mjs ${sha('helper-v2\n')}\nscripts/gamenight-watch.mjs ${sha('new\n')}\nscripts/who-uses-what.mjs ${sha('x')}\n`
        ),
      },
    });
    assert.equal(r.code, 0, 'a stale file is a warning');
    assert.match(r.out, /WARNING: .*gamenight-watch\.mjs differs from the release copy of scripts\/gamenight-watch\.mjs: run stage 29 again/);
    assert.doesNotMatch(r.out, /assistant-gm\.mjs differs/);
    assert.doesNotMatch(r.out, /who-uses-what\.mjs differs/);
    assert.match(r.out, /stage files: 1 behind, 1 match, 0 ahead, 1 not installed/);
  });

  test('stage files: a file that matches main but not the release is ahead, not behind', () => {
    const r = run({
      setup: tool => put(tool, 'gamenight-watch/gamenight-watch.mjs', 'main\n'),
      expect: {
        STAGE_FILES_B64: b64(LIST),
        EXPECT_STAGE_SOURCE: 'the v0.31.0 copy',
        EXPECT_STAGE_SHAS_B64: b64(`scripts/gamenight-watch.mjs ${sha('release\n')}\n`),
        EXPECT_STAGE_MAIN_SHAS_B64: b64(`scripts/gamenight-watch.mjs ${sha('main\n')}\n`),
      },
    });
    assert.match(r.out, /ok: .*gamenight-watch\.mjs matches main's copy of scripts\/gamenight-watch\.mjs \(ahead of the v0\.31\.0 copy\)/);
    assert.doesNotMatch(r.out, /WARNING: .*gamenight/);
    assert.match(r.out, /ok: stage files: .*1 ahead of the release.*0 behind/);
  });

  test('stage files: all current is ok; with no list passed the deployed build supplies list and copies', () => {
    const current = run({
      helper: 'h\n',
      expect: { STAGE_FILES_B64: b64(LIST), EXPECT_STAGE_SHAS_B64: b64(`scripts/pi/remote/assistant-gm.mjs ${sha('h\n')}\n`) },
    });
    assert.match(current.out, /ok: stage files: 1 match, 0 ahead of the release, 2 not installed, 0 behind/);
    const fromBuild = run({
      helper: 'installed\n',
      setup: tool => {
        put(tool, 'app/deploy/pi/stage-files.txt', LIST);
        put(tool, 'app/scripts/pi/remote/assistant-gm.mjs', 'in the build\n');
      },
    });
    assert.match(fromBuild.out, /assistant-gm\.mjs differs from the deployed build's copy of scripts\/pi\/remote\/assistant-gm\.mjs: run stage 5 or 28 again/);
  });

  test('stage files: no list anywhere warns that nothing was compared', () => {
    const r = run({});
    assert.match(r.out, /WARNING: no stage file list/);
    assert.equal(r.code, 0);
  });

  test('stage-files.txt: every repo path exists and every installed path is one a stage writes', () => {
    const repoRoot = path.resolve(here, '..', '..');
    const rows = readFileSync(path.join(here, 'stage-files.txt'), 'utf8')
      .split('\n')
      .filter(l => l && !l.startsWith('#'))
      .map(l => l.split('|'));
    assert.ok(rows.length >= 8);
    const stageText = readdirSync(path.join(repoRoot, 'scripts', 'pi', 'remote'))
      .filter(f => f.endsWith('.sh'))
      .map(f => readFileSync(path.join(repoRoot, 'scripts', 'pi', 'remote', f), 'utf8'))
      .join('\n');
    const remoteDir = path.join(repoRoot, 'scripts', 'pi', 'remote');
    const stageFile = n => readdirSync(remoteDir).find(f => f === `${n}.sh` || f.startsWith(`${n}-`));
    for (const [stage, rel, repoPath] of rows) {
      assert.ok(stage && rel && repoPath, `bad row ${stage}|${rel}|${repoPath}`);
      assert.ok(existsSync(path.join(repoRoot, repoPath)), `${repoPath} is not in the repo`);
      assert.ok(stageText.includes(path.basename(rel)), `no stage script installs ${path.basename(rel)}`);
      // The named stage (or one of "5 or 28") must mention the file and its install folder.
      const named = stage.split(' or ').map(n => stageFile(n)).filter(Boolean);
      assert.ok(named.length > 0, `no stage script for "${stage}"`);
      const ok = named.some(f => {
        const t = readFileSync(path.join(remoteDir, f), 'utf8');
        return t.includes(path.basename(rel)) && t.includes(path.dirname(rel).split('/')[0]);
      });
      assert.ok(ok, `stage "${stage}" does not mention ${rel}`);
    }
    // A new copy-from-repo install in a stage needs a row.
    const listed = new Set(rows.map(r => path.basename(r[1])));
    for (const f of readdirSync(remoteDir).filter(x => x.endsWith('.sh'))) {
      const t = readFileSync(path.join(remoteDir, f), 'utf8');
      for (const m of t.matchAll(/install -m 0?644 (?:-o root -g root )?"\$(?:SETTINGS_DRIVER|SWITCH_DRIVER|SESSION_DRIVER)" "[^"]*\/([\w.-]+\.mjs)"/g)) {
        assert.ok(listed.has(m[1]), `${f} installs ${m[1]} but deploy/pi/stage-files.txt has no row for it`);
      }
      // The other install forms: the loop over a `files="a b"` list (stages 29, 35) needs a row per listed file ...
      if (/for f in \$files; do install -m 0?644 [^;]*"\$src_dir\/\$f" "\$dest\/\$f"/.test(t)) {
        const list = /^files="([^"]+)"/m.exec(t);
        assert.ok(list, `${f} installs "$files" in a loop but has no files="..." line the test can read`);
        for (const name of list[1].split(/\s+/)) {
          assert.ok(listed.has(name), `${f} installs ${name} (its files list) but deploy/pi/stage-files.txt has no row for it`);
        }
      }
      // ... and a plain `install -m 0644 "$var" "<dir>/<name>.mjs"` whatever the variable is called (stage 5's driver_src).
      for (const m of t.matchAll(/install -m 0?644 (?:-o root -g root )?"\$\w+" "\$\w+\/([\w.-]+\.mjs)"/g)) {
        assert.ok(listed.has(m[1]), `${f} installs ${m[1]} but deploy/pi/stage-files.txt has no row for it`);
      }
    }
  });

  test('missing libicu warns', () => {
    const r = run({ icu: false });
    assert.match(r.out, /WARNING: libicu is missing/);
  });
});
