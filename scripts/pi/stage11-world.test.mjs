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
// and the old campaign default (the kit copy reset and marked, no extra GM), the kit-copy rule (an installed
// KIT_WORLD that is not a kit copy of WORLD is refused unless REPLACE_KIT=1; a second world's own kit copy resets twice)
// and suffix-only module versions (-aitool.n compared as a number), and how options.json is written (by the foundry
// user through options.json.foundry-tmp and a rename: mode and owner stay, a link at the temp name is never followed)
// with the up-front refusals for a kit session that is up, a Config folder the foundry user cannot write, and no Node. Without PI_STAGE11_CONTAINER the file skips.
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
          switches: part('switches'),
          prevSettings: part('prev settings'),
          driverLeft: part('driver left'),
          world: part('options.json'),
          optstate: part('options state'),
          victim: part('victim'),
          assets: part('assets'),
          before: part('env before'),
          first: part('first run'),
          after: part('env after'),
          pending: part('pending'),
          sentinels: part('sentinels'),
          kitof: part('kitof'),
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
    assert.ok(sentinel(r, 'strahd-kit'), 'the strahd-kit world must not be reset');
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

  test('kit-default-refused: another world without KIT_WORLD never resets the strahd-kit world', () => {
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
      /checked against aitool-content 1\.1\.0, the Pi has 1\.0\.0: update it on the Pi first \(the campaign bundle, or stage 13 for actor-studio\)/
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

  test('pi-modules-suffix-older: the same numbers with a lower -aitool.n on the Pi are refused', () => {
    const r = run('pi-modules-suffix-older');
    assertRefused(
      r,
      /checked against aitool-content 2\.10\.5-aitool\.4, the Pi has 2\.10\.5-aitool\.3: update it on the Pi first/
    );
    assert.match(r.output, /Nothing was changed/);
    assert.deepEqual(lines(r.modules), ['aitool-content yes', 'foundry-mcp-bridge no']);
  });

  test('pi-modules-suffix-newer: a higher -aitool.n on the Pi is accepted', () => {
    const r = run('pi-modules-suffix-newer');
    assert.equal(r.exit, '0', r.output);
    assert.match(
      r.output,
      /module aitool-content: the Pi's copy is the PC's version 2\.10\.5-aitool\.4 or newer/
    );
    assert.doesNotMatch(r.output, /cannot be compared/);
    assert.match(r.output, /world frostmaiden-training installed/);
    assert.deepEqual(lines(r.modules), ['aitool-content yes', 'foundry-mcp-bridge no']);
  });

  test('kit-names-installed: a campaign run never resets an installed world that is not its kit copy', () => {
    const r = run('kit-names-installed');
    assertRefused(
      r,
      /the installed world frostmaiden-training is not a kit copy of curse-of-strahd/
    );
    assert.match(r.output, /REPLACE_KIT=1/);
    assert.match(r.output, /Nothing was changed/);
    assert.ok(sentinel(r, 'frostmaiden-training'), 'the training world must be untouched');
    assert.ok(lines(r.worlds).includes('frostmaiden-training=frostmaiden-training (on the Pi)'));
    assert.ok(lines(r.kitof).includes('frostmaiden-training kitOf=-'), r.kitof);
  });

  test('kit-names-installed-replace: REPLACE_KIT=1 lets the reset replace it and marks the copy', () => {
    const r = run('kit-names-installed-replace');
    assert.equal(r.exit, '0', r.output);
    assert.match(r.output, /kit world frostmaiden-training reset from the bundle/);
    assert.ok(!sentinel(r, 'frostmaiden-training'), 'the training world was replaced on purpose');
    assert.ok(lines(r.worlds).includes('frostmaiden-training=x'), r.worlds);
    assert.ok(lines(r.kitof).includes('frostmaiden-training kitOf=curse-of-strahd'), r.kitof);
    assert.ok(sentinel(r, 'curse-of-strahd'), 'the campaign world is kept');
    assert.equal(r.world, 'curse-of-strahd');
    assert.equal(r.leak, 'no');
  });

  test('kit-copy-rerun: a second world kit copy is reset twice, the marker lets the second run through', () => {
    const r = run('kit-copy-rerun');
    assert.equal(r.first.split('\n')[0], 'exit 0', r.first);
    assert.equal(r.exit, '0', r.output);
    assert.match(r.output, /kit world frost-kit reset from the bundle/);
    assert.ok(lines(r.kitof).includes('frost-kit kitOf=frostmaiden-training'), r.kitof);
    assert.ok(lines(r.worlds).includes('frost-kit=Frost kit'), r.worlds);
    assert.ok(sentinel(r, 'strahd-kit') && sentinel(r, 'curse-of-strahd'));
    assert.equal(r.world, 'curse-of-strahd');
    assert.equal(r.leak, 'no');
  });

  test('kit-unmarked: an installed kit world id without the marker is refused for a second world', () => {
    const r = run('kit-unmarked');
    assertRefused(r, /the installed world frost-kit is not a kit copy of frostmaiden-training/);
    assert.match(r.output, /Nothing was changed/);
    assert.ok(sentinel(r, 'frost-kit'));
  });

  test('kit-is-strahd-kit-replace: REPLACE_KIT=1 never lifts the strahd-kit refusal', () => {
    const r = run('kit-is-strahd-kit-replace');
    assertRefused(r, /KIT_WORLD=strahd-kit is the campaign's test copy/);
    assert.match(r.output, /Nothing was changed/);
  });

  test('old-driver-extra: an extra GM with a pre-D-118 Assistant GM driver is refused before anything changes', () => {
    const r = run('old-driver-extra');
    assertRefused(r, /Assistant GM driver on the Pi .* is older than the extra GM \(D-118\)/);
    assert.match(r.output, /run stage 5 again first/);
    assert.match(r.output, /Nothing was changed/);
    assert.deepEqual(stops(r), []);
    assert.ok(!r.worlds.includes('frostmaiden-training'), 'the world must not be installed');
    assert.equal(r.pending, '', 'no provisioning marker may be written');
    assert.equal(r.after, r.before, 'the env files must not change');
  });

  test('old-driver-env: an env file that already names an extra GM needs the new driver too', () => {
    const r = run('old-driver-env');
    assertRefused(r, /Assistant GM driver on the Pi .* is older than the extra GM \(D-118\)/);
    assert.match(r.output, /Nothing was changed/);
    assert.deepEqual(stops(r), []);
    assert.ok(!r.worlds.includes('frostmaiden-training'), 'the world must not be installed');
    assert.equal(r.pending, '', 'no provisioning marker may be written');
    assert.equal(r.after, r.before, 'the env file that names the extra GM must not change');
  });

  test('old-driver-plain: the old driver is fine when no extra GM is involved', () => {
    const r = run('old-driver-plain');
    assert.equal(r.exit, '0', r.output);
    assert.match(r.output, /world frostmaiden-training installed/);
    assert.doesNotMatch(r.output, /older than the extra GM/);
    assert.equal(
      r.provision,
      'PROVISION world=frostmaiden-training gm=Gamemaster new_pw=true extra=- extra_pw=false assistant=Assistant GM'
    );
    assert.equal(r.world, 'curse-of-strahd');
    assert.equal(r.leak, 'no');
  });

  // set_world writes options.json as the foundry user through options.json.foundry-tmp and a rename (like
  // kit-session.sh), and the request checks refuse three setups before anything stops.
  test('world-switch: options.json changes to the launch world, keeps its mode and owner, leaves no temp file', () => {
    const r = run('world-switch');
    assert.equal(r.exit, '0', r.output);
    assert.equal(r.world, 'strahd-kit');
    assert.equal(r.optstate, 'options mode 644 owner foundry tmp absent');
    assert.equal(r.victim, 'none');
    assert.equal(r.leak, 'no');
  });

  test('options-600: a 600 options.json stays 600 and the foundry user owns it', () => {
    const r = run('options-600');
    assert.equal(r.exit, '0', r.output);
    assert.equal(r.world, 'strahd-kit');
    assert.equal(r.optstate, 'options mode 600 owner foundry tmp absent');
  });

  test('plant-link: a link at the temp name is replaced, root writes through nothing, the target stays as it was', () => {
    const r = run('plant-link');
    assert.equal(r.exit, '0', r.output);
    assert.equal(r.victim, 'victim root:root:644 victim');
    assert.equal(r.world, 'strahd-kit', 'options.json has the right world');
    assert.equal(r.optstate, 'options mode 644 owner foundry tmp absent');
  });

  test('assets-merge: a changed asset is replaced, a new one added, both owned by the foundry user', () => {
    const r = run('assets-merge');
    assert.equal(r.exit, '0', r.output);
    assert.deepEqual(lines(r.assets).slice(0, 2), [
      'pic.png file foundry bundle pic',
      'new.png file foundry bundle new',
    ]);
    assert.match(r.output, /ddb-images merged \(1 changed files saved to /);
  });

  test('assets-link: a link at an asset name is replaced by the bundle file, root writes through nothing', () => {
    const r = run('assets-link');
    assert.equal(r.exit, '0', r.output);
    assert.equal(r.victim, 'victim root:root:644 victim');
    assert.deepEqual(lines(r.assets).slice(0, 2), [
      'pic.png file foundry bundle pic',
      'new.png file foundry bundle new',
    ]);
  });

  test('assets-dirlink: an asset folder that is itself a link is refused before anything stops', () => {
    const r = run('assets-dirlink');
    assertRefused(
      r,
      /ddb-images is a link: the asset merge would write into whatever it points at/
    );
    assert.match(r.output, /Nothing was changed/);
    assert.deepEqual(stops(r), []);
    assert.deepEqual(lines(r.worlds), [
      'curse-of-strahd=curse-of-strahd (on the Pi)',
      'strahd-kit=strahd-kit (on the Pi)',
    ]);
  });

  test('assets-deeplink: a link to a folder below the asset folder is refused before anything stops', () => {
    const r = run('assets-deeplink');
    assertRefused(
      r,
      /ddb-images\/adventures is a link to a folder: the asset merge would write into whatever it points at/
    );
    assert.match(r.output, /Nothing was changed/);
    assert.deepEqual(stops(r), []);
  });

  test('options-readonly: a Config folder the foundry user cannot write is refused before anything stops', () => {
    const r = run('options-readonly');
    assertRefused(r, /the foundry user cannot write in \/var\/lib\/foundry\/Config/);
    assert.match(r.output, /Nothing was changed/);
    assert.equal(r.optstate, 'options mode 644 owner foundry tmp absent');
    assert.deepEqual(stops(r), []);
    assert.deepEqual(lines(r.worlds), [
      'curse-of-strahd=curse-of-strahd (on the Pi)',
      'strahd-kit=strahd-kit (on the Pi)',
    ]);
  });

  test('kit-session-up: a kit session that is up refuses the run before anything stops', () => {
    const r = run('kit-session-up');
    assertRefused(
      r,
      /a kit session is up \(\/var\/lib\/foundry-ai-tool\/kit-session\.env exists\)/
    );
    assert.match(r.output, /kit-session\.sh MODE=down/);
    assert.match(r.output, /Nothing was changed/);
    assert.equal(r.optstate, 'options mode 644 owner foundry tmp absent');
    assert.deepEqual(stops(r), []);
  });

  test('no-node: a Pi without Node is refused before anything stops', () => {
    const r = run('no-node');
    assertRefused(r, /no Node at \/opt\/node24: run stage 2 first/);
    assert.match(r.output, /Nothing was changed/);
    assert.equal(r.optstate, 'options mode 644 owner foundry tmp absent');
    assert.deepEqual(stops(r), []);
  });

  test('campaign-default: the old behaviour: kit copy reset, both worlds provisioned, no extra GM anywhere', () => {
    const r = run('campaign-default');
    assert.equal(r.exit, '0', r.output);
    assert.match(r.output, /kit world strahd-kit reset from the bundle/);
    assert.match(r.output, /world curse-of-strahd installed/);
    // The closing GM password check (read-only, only warns): the fake Pi's worlds have no users database.
    assert.match(r.output, /==> GM passwords[\s\S]*ok: Foundry has an administrator password/);
    assert.match(r.output, /FOUND: curse-of-strahd: never launched/);
    assert.match(r.output, /WARNING: a Gamemaster or Assistant GM user has no password/);
    assert.ok(r.output.indexOf('==> GM passwords') < r.output.indexOf('==> summary'));
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
    assert.ok(
      lines(r.kitof).includes('strahd-kit kitOf=curse-of-strahd'),
      `the legacy strahd-kit gains the marker:\n${r.kitof}`
    );
    assert.equal(r.world, 'curse-of-strahd');
    assert.equal(r.leak, 'no');
  });

  // The fake world-switches.mjs records the world it was given and the world options.json launches at that moment.
  const SW = world =>
    `SWITCHES world=${world} launches=${world} gm=Gamemaster pw=true url=http://127.0.0.1:30000`;

  test('world switches: a world the run installs gets them while Foundry runs it, the kit world too', () => {
    const t = run('training');
    assert.equal(t.exit, '0', t.output);
    assert.equal(t.switches, SW('frostmaiden-training'));
    assert.match(t.output, /world switches in frostmaiden-training/);
    assert.match(t.output, /frostmaiden-training: world switches set and read back/);
    assert.match(t.output, /world switches set and verified in: frostmaiden-training/);
    assert.equal(t.leak, 'no');
    const c = run('campaign-default');
    assert.deepEqual(lines(c.switches), [SW('strahd-kit'), SW('curse-of-strahd')]);
    assert.equal(c.prevSettings, '', 'an installed world has its old copy in prev already');
  });

  test('world switches: a kept world is left alone unless WORLD_SWITCHES=1', () => {
    const rerun = run('training-rerun');
    // /tmp/switches keeps the first run's line; the rerun keeps the world and adds none.
    assert.equal(rerun.switches, SW('frostmaiden-training'), 'the rerun adds no switches');
    assert.match(rerun.output, /world switches: not touched \(WORLD_SWITCHES=auto\)/);
    const auto = run('switches-kept-auto');
    assert.equal(auto.exit, '0', auto.output);
    assert.equal(auto.switches, '');
    const kept = run('switches-kept');
    assert.equal(kept.exit, '0', kept.output);
    assert.equal(kept.switches, SW('curse-of-strahd'));
    assert.match(kept.output, /the settings of curse-of-strahd before the world switches/);
    assert.equal(kept.prevSettings, 'prev/worlds/curse-of-strahd/settings');
    assert.ok(sentinel(kept, 'curse-of-strahd'), 'the kept world is not replaced');
  });

  test('world switches: WORLD_SWITCHES=0 sets none and needs no driver', () => {
    const off = run('switches-off');
    assert.equal(off.exit, '0', off.output);
    assert.equal(off.switches, '');
    assert.match(off.output, /world switches: not touched \(WORLD_SWITCHES=0\)/);
    const nodriver = run('switches-no-driver-off');
    assert.equal(nodriver.exit, '0', nodriver.output);
    assert.equal(nodriver.switches, '');
  });

  test('world switches: a driver from /root is installed and the upload removed', () => {
    const r = run('switches-upload');
    assert.equal(r.exit, '0', r.output);
    assert.match(r.output, /installed .*gm-browser\/world-switches\.mjs/);
    assert.equal(r.switches, SW('frostmaiden-training'));
    assert.equal(r.driverLeft.trim(), '1', 'one copy: installed, none left in /root');
  });

  test('world switches: no driver is refused before anything stops; a bad WORLD_SWITCHES too', () => {
    const missing = run('switches-no-driver');
    assert.equal(missing.exit, '1', missing.output);
    assert.match(missing.output, /no \/root\/world-switches\.mjs: scp .* Nothing was changed/);
    assert.equal(missing.calls, '', 'nothing may stop or start');
    assert.equal(missing.switches, '');
    const bad = run('switches-bad-value');
    assert.equal(bad.exit, '1', bad.output);
    assert.match(bad.output, /WORLD_SWITCHES must be auto, 1 or 0/);
    assert.equal(bad.calls, '', 'nothing may stop or start');
  });

  test('world switches: a failing driver stops the run and says how to go on', () => {
    const r = run('switches-fails');
    assert.equal(r.exit, '1', r.output);
    assert.match(r.output, /the world switches of frostmaiden-training failed or did not verify/);
    assert.match(r.output, /run the stage again with WORLD_SWITCHES=1/);
    assert.match(r.switches, /FAILED$/);
    assert.equal(r.world, 'curse-of-strahd', 'options.json is put back');
    assert.equal(r.leak, 'no');
  });
});
