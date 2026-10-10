// Tests for Pi stage 11 (scripts/pi/remote/11-world.sh, D-118: a second world next to the real one):
//   PI_STAGE11_CONTAINER=1 node --test scripts/pi/stage11-world.test.mjs
// Needs Docker (CI runs it on the ARM runner): the stage itself runs in a Debian 13 ARM64 container with
// stand-ins for systemd and a fake Assistant GM that records each provisioning call
// (scripts/pi/container-test/stage11-scenarios.sh). Covered: the Frostmaiden training world with an extra GM
// (its env file, one provisioning call, options.json back on the real world, the kit world untouched), a rerun
// that keeps the world and changes nothing, a kept world gaining the extra GM, the refusals that must happen
// before anything stops (a pi-modules module the Pi lacks, another extra GM in the env file, the extra GM named like the GM or the Assistant GM,
// a missing KIT_WORLD or KIT_TITLE, a LAUNCH world that is not installed), no password in the output, and the
// old Strahd default (the kit copy reset, no extra GM). Without PI_STAGE11_CONTAINER the file skips.
// PI_STAGE11_OUTPUT=<file> checks a saved stage11-scenarios.sh output instead of starting Docker.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const saved = process.env.PI_STAGE11_OUTPUT;
const containerReason = saved
  ? false
  : !process.env.PI_STAGE11_CONTAINER
    ? 'set PI_STAGE11_CONTAINER=1 to run the stage in a Docker ARM64 container'
    : spawnSync('docker', ['version'], { encoding: 'utf8' }).status !== 0 && 'no Docker here';
// In CI a missing Docker is a failure, not a skip: the step would go green without running a scenario.
const noDockerInCi = Boolean(process.env.CI) && containerReason === 'no Docker here';
// Debian 13 (trixie), pinned by digest so a new upstream image cannot change a required check overnight.
// Update: docker buildx imagetools inspect debian:13 (the index digest, not one platform's).
const IMAGE = 'debian:13@sha256:913f6706df59a68922d1dd08f78c2476560a8d367897200a6005b00e5f67c2d5';

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
      '/repo/scripts/pi/container-test/stage11-scenarios.sh',
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 45 * 60_000 }
  );
  return `${res.stdout ?? ''}\n${res.stderr ?? ''}${res.error ? `\n${res.error.message}` : ''}`;
}

test('the container suite has Docker when CI asks for it', { skip: !noDockerInCi }, () => {
  assert.fail('PI_STAGE11_CONTAINER=1 and CI are set, but `docker version` failed');
});

describe('11-world.sh in an ARM64 container', { skip: containerReason }, () => {
  /** @typedef {{mode: string, owner: string, keys: string[], sha: string, gmpw: string}} EnvFile */
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
          calls: part('calls'),
          provision: part('provision'),
          world: part('options.json'),
          before: part('env before'),
          first: part('first run'),
          after: part('env after'),
          sentinels: part('sentinels'),
          worlds: part('worlds'),
          modules: part('modules'),
          leak: part('leak'),
        });
      }
    },
    { timeout: 46 * 60_000 }
  );
  const run = name => {
    const r = runs.get(name);
    assert.ok(r, `scenario ${name} did not run`);
    return r;
  };
  const lines = text => text.split('\n').filter(Boolean);
  /** The env file lines of a block as {file name: parsed fields}. */
  const envFiles = text => {
    const files = {};
    for (const line of lines(text)) {
      const m = line.match(/^(\S+) mode=(\d+) owner=(\S+) keys=(\S*) sha=(\w+) gmpw=(\w+)$/);
      assert.ok(m, `odd env state line: ${line}`);
      files[m[1]] = { mode: m[2], owner: m[3], keys: m[4].split(','), sha: m[5], gmpw: m[6] };
    }
    return files;
  };
  const stops = r => lines(r.calls).filter(c => c.startsWith('stop') || c.startsWith('restart'));
  const sentinel = (r, world) => r.sentinels.includes(`${world} yes`);
  const EXTRA_KEYS = ['GM_USER', 'GM_PASSWORD', 'EXTRA_GM_USER', 'EXTRA_GM_PASSWORD'];

  /** A refusal before anything stops: exit 1, the reason, no systemctl call at all, the Pi as it was. */
  const assertRefused = (r, reason) => {
    assert.equal(r.exit, '1', r.output);
    assert.match(r.output, reason);
    assert.equal(r.calls, '', `nothing may stop or start:\n${r.calls}`);
    assert.equal(r.provision, '');
    assert.equal(r.world, 'curse-of-strahd');
    assert.deepEqual(envFiles(r.after), envFiles(r.before), 'no env file may change');
    assert.ok(sentinel(r, 'strahd-kit') && sentinel(r, 'curse-of-strahd'), r.sentinels);
    assert.equal(r.leak, 'no');
  };

  test('training: the Frostmaiden world next to the real one, with its own env file and the extra GM', () => {
    const r = run('training');
    assert.equal(r.exit, '0', r.output);
    assert.match(r.output, /world frostmaiden-training installed/);
    assert.doesNotMatch(r.output, /KEPT/);
    const files = envFiles(r.after);
    const frost = files['world-frostmaiden-training.env'];
    assert.ok(frost, r.after);
    assert.deepEqual(frost.keys, EXTRA_KEYS);
    assert.equal(frost.mode, '600');
    assert.equal(frost.owner, 'root');
    assert.equal(
      r.provision,
      'PROVISION world=frostmaiden-training gm=Gamemaster new_pw=true extra=Claude extra_pw=true assistant=Assistant GM'
    );
    assert.equal(r.world, 'curse-of-strahd', 'Foundry keeps launching the real world');
    assert.ok(sentinel(r, 'strahd-kit'), 'the Strahd kit world must not be reset');
    assert.ok(sentinel(r, 'curse-of-strahd'));
    assert.deepEqual(lines(r.worlds), [
      'curse-of-strahd=curse-of-strahd (on the Pi)',
      'frostmaiden-training=frostmaiden-training (bundle)',
      'strahd-kit=strahd-kit (on the Pi)',
    ]);
    const { 'world-frostmaiden-training.env': _, ...others } = files;
    assert.deepEqual(others, envFiles(r.before), 'the other worlds env files stay as they were');
    // The provisioned world runs first, then Foundry restarts on the launch world.
    assert.deepEqual(
      lines(r.calls).filter(c => /^(stop|start|restart) foundry\.service$/.test(c)),
      [
        'stop foundry.service',
        'start foundry.service',
        'stop foundry.service',
        'restart foundry.service',
      ]
    );
    assert.match(r.output, /Foundry launches: curse-of-strahd/);
    assert.match(
      r.output,
      /the extra GM Claude of frostmaiden-training: the same file, EXTRA_GM_PASSWORD/
    );
    assert.equal(r.leak, 'no', 'no password may reach the output');
  });

  test('training-rerun: the second run keeps the world, changes no env file and provisions nothing', () => {
    const r = run('training-rerun');
    const first = r.first.split('\n')[0];
    assert.equal(first, 'exit 0', r.first);
    assert.equal(r.exit, '0', r.output);
    assert.match(r.output, /KEPT: the campaign world frostmaiden-training already exists/);
    const afterFirst = envFiles(r.first.split('\n').slice(1).join('\n'));
    const after = envFiles(r.after);
    assert.ok(afterFirst['world-frostmaiden-training.env'], r.first);
    assert.deepEqual(
      after['world-frostmaiden-training.env'],
      afterFirst['world-frostmaiden-training.env']
    );
    assert.deepEqual(after['world-frostmaiden-training.env'].keys, EXTRA_KEYS);
    assert.deepEqual(lines(r.provision), [
      'PROVISION world=frostmaiden-training gm=Gamemaster new_pw=true extra=Claude extra_pw=true assistant=Assistant GM',
    ]);
    assert.match(r.output, /world frostmaiden-training: kept/);
    assert.equal(r.world, 'curse-of-strahd');
    assert.ok(sentinel(r, 'strahd-kit'));
    assert.equal(r.leak, 'no');
  });

  test('kept-gains-extra: a kept world gets the extra GM added after its GM lines and is provisioned for it', () => {
    const r = run('kept-gains-extra');
    assert.equal(r.exit, '0', r.output);
    assert.match(r.output, /KEPT: the campaign world curse-of-strahd already exists/);
    const before = envFiles(r.before)['world-curse-of-strahd.env'];
    const after = envFiles(r.after)['world-curse-of-strahd.env'];
    assert.deepEqual(before.keys, ['GM_USER', 'GM_PASSWORD']);
    assert.deepEqual(after.keys, EXTRA_KEYS);
    assert.equal(after.gmpw, before.gmpw, 'the GM password line must not change');
    assert.notEqual(after.sha, before.sha);
    assert.equal(after.mode, '600');
    assert.equal(after.owner, 'root');
    assert.equal(
      envFiles(r.after)['world-strahd-kit.env'].sha,
      envFiles(r.before)['world-strahd-kit.env'].sha
    );
    assert.equal(
      r.provision,
      'PROVISION world=curse-of-strahd gm=Gamemaster new_pw=true extra=Claude extra_pw=true assistant=Assistant GM'
    );
    assert.match(r.output, /added the Claude login to/);
    assert.equal(r.world, 'curse-of-strahd');
    assert.ok(sentinel(r, 'curse-of-strahd'), 'a kept world must not be replaced');
    assert.equal(r.leak, 'no');
  });

  test('extra-conflict: an env file that names another extra GM is refused before anything stops', () => {
    const r = run('extra-conflict');
    assertRefused(r, /already names the extra GM 'Other', not 'Claude'/);
    assert.match(r.output, /world-curse-of-strahd\.env/);
    assert.deepEqual(stops(r), []);
    assert.deepEqual(envFiles(r.after)['world-curse-of-strahd.env'].keys, EXTRA_KEYS);
  });

  test('extra-is-gm: the extra GM named like the world GM is refused', () => {
    assertRefused(
      run('extra-is-gm'),
      /EXTRA_GM_USER must differ from curse-of-strahd's GM \(Gamemaster\)/
    );
  });

  test('extra-is-assistant: the extra GM named like the Assistant GM is refused', () => {
    assertRefused(run('extra-is-assistant'), /EXTRA_GM_USER must differ from the Assistant GM/);
  });

  test('kit-default-refused: another world without KIT_WORLD never resets the Strahd kit world', () => {
    const r = run('kit-default-refused');
    assertRefused(r, /WORLD=frostmaiden-training needs KIT_WORLD set/);
    assert.match(r.output, /Nothing was changed/);
  });

  test('kit-needs-title: a kit world for another world needs a KIT_TITLE', () => {
    const r = run('kit-needs-title');
    assertRefused(r, /KIT_WORLD=frost-kit needs a KIT_TITLE for WORLD=frostmaiden-training/);
  });

  test('launch-not-installed: a LAUNCH world that is not installed is refused before anything stops', () => {
    const r = run('launch-not-installed');
    assertRefused(
      r,
      /LAUNCH must be frostmaiden-training, the kit world or a world that is already installed/
    );
  });

  test('pi-modules-installed: a module named in pi-modules stays the Pi copy and the world installs', () => {
    const r = run('pi-modules-installed');
    assert.equal(r.exit, '0', r.output);
    assert.match(r.output, /modules already on the Pi, left as they are: aitool-content/);
    assert.match(r.output, /world frostmaiden-training installed/);
    assert.doesNotMatch(r.output, /module aitool-content installed/);
    assert.deepEqual(lines(r.modules), ['aitool-content yes', 'foundry-mcp-bridge no']);
    assert.equal(r.world, 'curse-of-strahd');
    assert.equal(r.leak, 'no');
  });

  test('pi-modules-missing: a pi-modules module that the Pi lacks is refused before anything stops', () => {
    const r = run('pi-modules-missing');
    assertRefused(r, /module aitool-content is not installed on the Pi/);
    assert.match(r.output, /Nothing was changed/);
    assert.deepEqual(lines(r.modules), ['foundry-mcp-bridge no']);
  });

  test('strahd-default: the old behaviour: kit copy reset, both worlds provisioned, no extra GM anywhere', () => {
    const r = run('strahd-default');
    assert.equal(r.exit, '0', r.output);
    assert.match(r.output, /kit world strahd-kit reset from the bundle/);
    assert.match(r.output, /world curse-of-strahd installed/);
    assert.ok(!sentinel(r, 'strahd-kit'), 'the kit world is reset from the bundle');
    assert.ok(!sentinel(r, 'curse-of-strahd'), 'REPLACE_WORLD=1 replaced the real world');
    assert.deepEqual(lines(r.worlds), [
      'curse-of-strahd=curse-of-strahd (bundle)',
      'strahd-kit=Curse of Strahd (test copy for kit runs)',
    ]);
    assert.deepEqual(
      envFiles(r.after),
      envFiles(r.before),
      'no env file changes and none gains an extra GM'
    );
    for (const f of Object.values(envFiles(r.after)))
      assert.deepEqual(f.keys, ['GM_USER', 'GM_PASSWORD']);
    assert.deepEqual(lines(r.provision), [
      'PROVISION world=strahd-kit gm=Gamemaster new_pw=true extra=- extra_pw=false assistant=Assistant GM',
      'PROVISION world=curse-of-strahd gm=Gamemaster new_pw=true extra=- extra_pw=false assistant=Assistant GM',
    ]);
    assert.equal(r.world, 'curse-of-strahd');
    assert.equal(r.leak, 'no');
  });
});
