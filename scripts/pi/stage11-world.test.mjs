// Tests for Pi stage 11 (scripts/pi/remote/11-world.sh, D-118: a second world next to the real one):
//   PI_STAGE11_CONTAINER=1 node --test scripts/pi/stage11-world.test.mjs
// Needs Docker (CI runs it on the ARM runner): the stage itself runs in a Debian 13 ARM64 container with
// stand-ins for systemd and a fake Assistant GM that records each provisioning call
// (scripts/pi/container-test/stage11-scenarios.sh). Covered: the Frostmaiden training world with an extra GM
// (its env file, one provisioning call, options.json back on the real world, the kit world untouched), a rerun
// that keeps the world and changes nothing, a kept world gaining the extra GM, the refusals that must happen
// before anything stops (a pi-modules module the Pi lacks, another extra GM in the env file, the extra GM named like the GM or the Assistant GM
// or written with a space at its end, a missing KIT_WORLD, KIT_TITLE or LAUNCH, a KIT_WORLD that names the campaign
// or the launched world or strahd-kit, an empty LAUNCH, a bundle for any world but curse-of-strahd that ships a
// module without SHIP_MODULES=1 while the campaign's own bundle with LAUNCH=strahd-kit does not need it, a LAUNCH world
// that is not installed, a pi-modules module whose Pi copy is older than the PC version the bundle records), a failed provisioning followed by a plain rerun that provisions again (also for the campaign with its kit copy,
// where every world of the run is marked), no password in the output,
// and the old Strahd default (the kit copy reset, no extra GM). Without PI_STAGE11_CONTAINER the file skips.
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
          pending: part('pending'),
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
    assert.equal(r.pending, '', 'no provisioning may be left unfinished');
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
    assertRefused(r, /LAUNCH must be frostmaiden-training or a world that is already installed/);
  });

  test('launch-omitted: another world without LAUNCH never switches the Pi to it', () => {
    const r = run('launch-omitted');
    assertRefused(r, /WORLD=frostmaiden-training needs LAUNCH set/);
    assert.match(r.output, /Nothing was changed/);
  });

  test('kit-is-campaign: a kit world named like the campaign is refused', () => {
    const r = run('kit-is-campaign');
    assertRefused(r, /KIT_WORLD=curse-of-strahd is the campaign/);
    assert.match(r.output, /Nothing was changed/);
  });

  test('kit-is-launch: a kit world named like the launched world is refused', () => {
    const r = run('kit-is-launch');
    assertRefused(r, /KIT_WORLD=frost-kit is the world Foundry launches/);
    assert.match(r.output, /Nothing was changed/);
  });

  test('kit-is-strahd-kit: the campaign test copy is not a kit world for another world', () => {
    const r = run('kit-is-strahd-kit');
    assertRefused(r, /KIT_WORLD=strahd-kit is the campaign's test copy/);
    assert.match(r.output, /Nothing was changed/);
  });

  test('launch-empty: LAUNCH set but empty is refused like an unset LAUNCH', () => {
    const r = run('launch-empty');
    assertRefused(r, /WORLD=frostmaiden-training needs LAUNCH set \(not empty\)/);
    assert.match(r.output, /Nothing was changed/);
  });

  test('extra-trailing-space: an extra GM name with a space at its end is refused before anything stops', () => {
    const r = run('extra-trailing-space');
    assertRefused(r, /EXTRA_GM_USER has odd characters or a space at an end/);
    assert.match(r.output, /Nothing was changed/);
  });

  test('ship-modules-refused: a second world that ships a module leaves the Pi modules alone', () => {
    const r = run('ship-modules-refused');
    assertRefused(r, /ships modules \(aitool-content\)/);
    assert.match(r.output, /SHIP_MODULES=1/);
    assert.match(r.output, /-PiModules/);
    assert.match(r.output, /Nothing was changed/);
    assert.deepEqual(lines(r.modules), ['aitool-content yes', 'foundry-mcp-bridge no']);
  });

  test('ship-modules-allowed: SHIP_MODULES=1 replaces the Pi module on purpose', () => {
    const r = run('ship-modules-allowed');
    assert.equal(r.exit, '0', r.output);
    assert.match(r.output, /module aitool-content installed/);
    assert.deepEqual(lines(r.modules), ['aitool-content no', 'foundry-mcp-bridge no']);
    assert.equal(r.world, 'curse-of-strahd');
  });

  test('ship-campaign-launch-kit: the campaign bundle ships its modules with LAUNCH=strahd-kit', () => {
    const r = run('ship-campaign-launch-kit');
    assert.equal(r.exit, '0', r.output);
    assert.doesNotMatch(r.output, /SHIP_MODULES/);
    assert.match(r.output, /module aitool-content installed/);
    assert.deepEqual(lines(r.modules), ['aitool-content no', 'foundry-mcp-bridge no']);
    assert.equal(r.world, 'strahd-kit', 'Foundry starts on the test copy');
    assert.equal(r.pending, '');
  });

  test('ship-second-launch-self: a second world that launches itself still may not ship modules', () => {
    const r = run('ship-second-launch-self');
    assertRefused(r, /ships modules \(aitool-content\)/);
    assert.match(r.output, /SHIP_MODULES=1/);
    assert.match(r.output, /Nothing was changed/);
    assert.deepEqual(lines(r.modules), ['aitool-content yes', 'foundry-mcp-bridge no']);
  });

  test('provision-fails-campaign: a failed kit provisioning leaves the swapped campaign marked too', () => {
    const r = run('provision-fails-campaign');
    assert.match(r.first.split('\n')[0], /^exit [1-9]/, r.first);
    const kit =
      'PROVISION world=strahd-kit gm=Gamemaster new_pw=true extra=- extra_pw=false assistant=Assistant GM';
    const campaign =
      'PROVISION world=curse-of-strahd gm=Gamemaster new_pw=true extra=- extra_pw=false assistant=Assistant GM';
    // The kit goes first and fails; the plain rerun (REPLACE_WORLD=0) keeps the campaign but provisions both.
    assert.deepEqual(lines(r.provision), [`${kit} FAILED`, kit, campaign]);
    assert.equal(r.exit, '0', r.output);
    assert.match(r.output, /KEPT: the campaign world curse-of-strahd already exists/);
    assert.equal(r.pending, '', 'no marker may be left after a finished run');
    assert.equal(r.world, 'curse-of-strahd');
    assert.equal(r.leak, 'no');
  });

  test('provision-fails-then-rerun: a plain rerun after a failed provisioning provisions again', () => {
    const r = run('provision-fails-then-rerun');
    assert.match(r.first.split('\n')[0], /^exit [1-9]/, r.first);
    const afterFirst = envFiles(r.first.split('\n').slice(1).join('\n'));
    const frostFirst = afterFirst['world-frostmaiden-training.env'];
    assert.ok(frostFirst, 'the first run wrote the env file before it failed');
    assert.deepEqual(frostFirst.keys, EXTRA_KEYS);
    const call =
      'PROVISION world=frostmaiden-training gm=Gamemaster new_pw=true extra=Claude extra_pw=true assistant=Assistant GM';
    assert.deepEqual(lines(r.provision), [`${call} FAILED`, call]);
    assert.equal(r.exit, '0', r.output);
    assert.match(r.output, /KEPT: the campaign world frostmaiden-training already exists/);
    assert.match(r.output, /frostmaiden-training provisioned/);
    assert.deepEqual(
      envFiles(r.after)['world-frostmaiden-training.env'],
      frostFirst,
      'the retry uses the passwords the first run wrote'
    );
    assert.equal(r.pending, '', 'the finished provisioning clears its marker');
    assert.equal(r.world, 'curse-of-strahd');
    assert.equal(r.leak, 'no');
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

  test('pi-modules-newer: a Pi copy newer than the PC version the world was checked against is fine', () => {
    const r = run('pi-modules-newer');
    assert.equal(r.exit, '0', r.output);
    assert.match(
      r.output,
      /module aitool-content: the Pi's copy is the PC's version 1\.1\.0 or newer/
    );
    assert.match(r.output, /world frostmaiden-training installed/);
    assert.deepEqual(lines(r.modules), ['aitool-content yes', 'foundry-mcp-bridge no']);
  });

  test('pi-modules-older: a Pi copy older than the PC version is refused before anything stops', () => {
    const r = run('pi-modules-older');
    assertRefused(
      r,
      /checked against aitool-content 1\.1\.0, the Pi has 1\.0\.0: update it on the Pi first, or ship it/
    );
    assert.match(r.output, /Nothing was changed/);
    assert.deepEqual(lines(r.modules), ['aitool-content yes', 'foundry-mcp-bridge no']);
  });

  test('pi-modules-unsure: versions that cannot be compared only warn', () => {
    const r = run('pi-modules-unsure');
    assert.equal(r.exit, '0', r.output);
    assert.match(r.output, /module aitool-content: the versions cannot be compared/);
    assert.match(r.output, /world frostmaiden-training installed/);
  });

  test('pi-modules-legacy: an entry without a version (an older push-world.ps1) warns and goes on', () => {
    const r = run('pi-modules-legacy');
    assert.equal(r.exit, '0', r.output);
    assert.match(r.output, /module aitool-content: MANIFEST\.txt records no version/);
    assert.match(r.output, /world frostmaiden-training installed/);
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
