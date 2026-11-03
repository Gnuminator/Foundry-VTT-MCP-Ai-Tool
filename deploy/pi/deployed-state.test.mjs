// Tests for deploy/pi/deployed-state.sh (backlog pi-deployed-state-check): the read-only check of what is deployed on
// the Pi. Stand-in systemctl, docker and ldconfig scripts and a temp /etc and /opt tree; the real script runs with bash.
//   node --test deploy/pi/deployed-state.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  if (opts.version !== null)
    writeFileSync(path.join(tool, 'app', 'package.json'), `{\n  "version": "${opts.version ?? '0.25.0'}"\n}\n`);
  writeFileSync(path.join(tool, 'gm-browser', 'assistant-gm.mjs'), opts.helper ?? 'helper-v1\n');

  const units = { ...GOOD_UNITS, ...(opts.units ?? {}) };
  const unitCases = Object.entries(units)
    .map(([u, s]) =>
      s === null
        ? `${u}) echo LoadState=not-found;;`
        : `${u}) printf 'LoadState=loaded\\nActiveState=${s.active}\\nSubState=${s.sub}\\nNRestarts=${s.restarts}\\n';;`
    )
    .join('\n');
  const systemctl = stub(path.join(root, 'bin'), 'systemctl', `case "$2" in\n${unitCases}\nesac`);

  let dockerPath = path.join(root, 'bin', 'no-docker');
  if (opts.containers !== null && opts.containers !== undefined) {
    const list = Object.keys(opts.containers).join('\\n');
    const cases = Object.entries(opts.containers)
      .map(([n, c]) => `${n}) echo '${c.state}|${c.restarts}|${c.health}';;`)
      .join('\n');
    dockerPath = stub(
      path.join(root, 'bin'),
      'docker',
      `case "$1" in\nps) printf '${list}\\n';;\ninspect) case "$4" in\n${cases}\nesac;;\nesac`
    );
  }
  const ldconfig = stub(path.join(root, 'bin'), 'ldconfig', opts.icu === false ? 'true' : 'echo "libicuuc.so.72 => /usr/lib/libicuuc.so.72"');

  const env = {
    ...process.env,
    TOOL_DIR: posix(tool),
    TOOL_ETC: posix(etc),
    SYSTEMCTL: systemctl,
    DOCKER: dockerPath,
    LDCONFIG: ldconfig,
    ...(opts.expect ?? {}),
  };
  const r = spawnSync('bash', [script], { encoding: 'utf8', env });
  return { code: r.status, out: r.stdout + r.stderr };
}

describe('deployed-state.sh', { skip: noBash }, () => {
  test('a healthy Pi on systemd passes', () => {
    const r = run({ expect: { EXPECT_VERSION: '0.25.0' } });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /foundry-ai-tool-bridge\.service is active, no restarts/);
    assert.match(r.out, /deployed version 0\.25\.0 is the one expected/);
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
    assert.match(r.out, /gm-browser\.service is not installed \(optional\)/);
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
    const r = run({ containers: { foundry: { state: 'running', restarts: 2, health: 'healthy' } } });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /WARNING: container foundry is healthy but restarted 2 time/);
  });

  test('a stale build and a changed helper warn when expectations are given', () => {
    const r = run({ version: '0.24.0', expect: { EXPECT_VERSION: '0.25.0', EXPECT_ASSISTANT_GM_SHA256: 'deadbeef' } });
    assert.match(r.out, /WARNING: deployed version is 0\.24\.0, main has 0\.25\.0/);
    assert.match(r.out, /WARNING: Assistant GM helper differs from the repo copy/);
  });

  test('no build at all fails', () => {
    const r = run({ version: null });
    assert.equal(r.code, 1);
    assert.match(r.out, /FAIL: no build at/);
  });

  test('missing libicu warns', () => {
    const r = run({ icu: false });
    assert.match(r.out, /WARNING: libicu is missing/);
  });
});
