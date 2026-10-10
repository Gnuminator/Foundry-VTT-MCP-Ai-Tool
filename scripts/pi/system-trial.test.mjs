// Tests for Pi stage 14 (scripts/pi/remote/14-system-trial.sh: a new dnd5e version on the kit world first):
//   PI_SYSTEM_TRIAL_CONTAINER=1 node --test scripts/pi/system-trial.test.mjs
// Needs Docker (CI runs it on the ARM runner): the stage itself runs in a Debian 13 ARM64 container with
// stand-ins for systemd and curl and a fake Foundry that writes into the world it opens
// (scripts/pi/container-test/system-trial-scenarios.sh). The "release" is a zip built there, and the stage runs
// from a copy pinned to that zip's sha256. Covered: the trial (the download, then ZIP= under the import folder, also
// a zip with the files in a dnd5e folder; dnd5e kept aside, every world copied, only strahd-kit launched, the state
// file), the refusals that must happen before anything stops (a wrong sha256 also for ZIP=, a failed download, a zip
// outside the import folder or missing, a zip that is too new for Foundry or only fits older ones or holds another
// version, the pinned version or a newer one installed already, Foundry launching the kit world already, a second
// trial, people online, an unreadable /api/status, bad MODE/FORCE/RESTORE_MIGRATED/ZIP words), FORCE=1 with people
// online, a trial that fails after Foundry stopped and puts everything back, the rollback (the old version back,
// the kit world reset from the copy, the campaign launched, the trial archived in prev-*-system-trial; a world
// launched during the trial blocks it unless RESTORE_MIGRATED=1; a world made during the trial stays), a rollback
// that stops halfway and a rerun that finishes it, a new trial after a rollback, the switch (the campaign launched,
// phase switched; a failed switch puts the campaign back from the copy; a second switch and a rollback after a
// switch are refused; a switch without a trial) and the read-only status.
// Without PI_SYSTEM_TRIAL_CONTAINER the file skips.
// PI_SYSTEM_TRIAL_OUTPUT=<file> checks a saved system-trial-scenarios.sh output instead of starting Docker.
// The scenarios run in PI_SYSTEM_TRIAL_SHARDS (default 4) containers side by side; each prints its blocks into one output.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const saved = process.env.PI_SYSTEM_TRIAL_OUTPUT;
const containerReason = saved
  ? false
  : !process.env.PI_SYSTEM_TRIAL_CONTAINER
    ? 'set PI_SYSTEM_TRIAL_CONTAINER=1 to run the stage in a Docker ARM64 container'
    : spawnSync('docker', ['version'], { encoding: 'utf8' }).status !== 0 && 'no Docker here';
// In CI a missing Docker is a failure, not a skip: the step would go green without running a scenario.
const noDockerInCi = Boolean(process.env.CI) && containerReason === 'no Docker here';
// Debian 13 (trixie), pinned by digest so a new upstream image cannot change a required check overnight.
// Update: docker buildx imagetools inspect debian:13 (the index digest, not one platform's).
const IMAGE = 'debian:13@sha256:913f6706df59a68922d1dd08f78c2476560a8d367897200a6005b00e5f67c2d5';
const PIN_URL =
  'https://github.com/foundryvtt/dnd5e/releases/download/release-6.0.6/dnd5e-release-6.0.6.zip';

// The scenarios are listed in the script (SCENARIOS=( ... )). They run in a few containers side by side, because
// under QEMU emulation on a PC one container takes close to an hour (apt and every node start are slow); on an
// ARM runner a single container is quick. PI_SYSTEM_TRIAL_SHARDS=<n> changes the number (default 4).
const SHARDS = Math.max(1, Number(process.env.PI_SYSTEM_TRIAL_SHARDS) || 4);
function scenarioNames() {
  const script = readFileSync(
    path.join(repo, 'scripts', 'pi', 'container-test', 'system-trial-scenarios.sh'),
    'utf8'
  );
  const list = script.match(/^SCENARIOS=\(([\s\S]*?)^\)/m);
  assert.ok(list, 'no SCENARIOS=( ... ) list in system-trial-scenarios.sh');
  return list[1].split(/\s+/).filter(Boolean);
}

/** One container that runs the named scenarios; resolves with its stdout and stderr. */
function runContainer(names) {
  return new Promise(resolve => {
    const child = spawn(
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
        '/repo/scripts/pi/container-test/system-trial-scenarios.sh',
        ...names,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let text = '';
    child.stdout.on('data', d => (text += d));
    child.stderr.on('data', d => (text += d));
    const timer = setTimeout(() => child.kill(), 45 * 60_000);
    child.on('error', error => resolve(`${text}\n${error.message}`));
    child.on('close', () => {
      clearTimeout(timer);
      resolve(text);
    });
  });
}

async function runContainers() {
  const names = scenarioNames();
  const shards = Array.from({ length: Math.min(SHARDS, names.length) }, () => []);
  names.forEach((name, i) => shards[i % shards.length].push(name));
  const outputs = await Promise.all(shards.map(runContainer));
  for (const text of outputs) assert.match(text, /=== ALL DONE/, text);
  return outputs.join('\n');
}

test('the container suite has Docker when CI asks for it', { skip: !noDockerInCi }, () => {
  assert.fail('PI_SYSTEM_TRIAL_CONTAINER=1 and CI are set, but `docker version` failed');
});

describe('14-system-trial.sh in an ARM64 container', { skip: containerReason }, () => {
  /** @type {Map<string, Map<string, string>>} scenario name to its "<label> <part>" sections */
  const scenarios = new Map();
  before(
    async () => {
      const stdout = saved
        ? readFileSync(saved, 'utf8').replace(/\r\n/g, '\n')
        : await runContainers();
      assert.match(stdout, /=== ALL DONE/, stdout);
      for (const block of stdout.split(/^=== SCENARIO /m).slice(1)) {
        const name = block.slice(0, block.indexOf('\n'));
        const sections = new Map();
        const parts = block.slice(block.indexOf('\n') + 1).split(/^--- (.+)$/m);
        for (let i = 1; i < parts.length; i += 2) {
          sections.set(
            parts[i],
            parts[i + 1]
              .replace(/\n=== END[\s\S]*$/, '')
              .replace(/^\n/, '')
              .trimEnd()
          );
        }
        scenarios.set(name, sections);
      }
    },
    { timeout: 46 * 60_000 }
  );

  const lines = text => text.split('\n').filter(Boolean);
  /** One scenario: its sections by "<label> <part>", with small readers for each part. */
  const run = name => {
    const sections = scenarios.get(name);
    assert.ok(sections, `scenario ${name} did not run`);
    const part = (label, kind) => {
      const text = sections.get(`${label} ${kind}`);
      assert.notEqual(text, undefined, `scenario ${name} has no "${label} ${kind}" section`);
      return text;
    };
    return {
      exit: label => part(label, 'exit'),
      output: label => part(label, 'output'),
      calls: label => lines(part(label, 'calls')),
      downloads: label => lines(part(label, 'downloads')),
      /** The state text of a run, and the same without its zips line (a refused run may keep the download). */
      rawState: label => part(label, 'state'),
      state: label => parseState(part(label, 'state')),
    };
  };

  /** @typedef {{systemVersion: string, marker: string, files: string[], opened: string}} World */
  /** The "one fact per line" state block as an object. */
  function parseState(text) {
    const st = {
      raw: text,
      system: '',
      options: '',
      stopped: '',
      zips: '',
      work: '',
      trial: /** @type {Record<string, string>|null} */ (null),
      trialDir: /** @type {string[]} */ ([]),
      worlds: /** @type {Record<string, World>} */ ({}),
      copies: /** @type {Record<string, Omit<World, 'opened'>>} */ ({}),
      prev: /** @type {string[]} */ ([]),
    };
    for (const line of lines(text)) {
      const [kind, ...rest] = line.split(' ');
      const value = rest.join(' ');
      if (kind === 'system') st.system = value;
      else if (kind === 'options') st.options = value;
      else if (kind === 'stopped') st.stopped = value;
      else if (kind === 'zips') st.zips = value;
      else if (kind === 'work') st.work = value;
      else if (kind === 'trial-dir') st.trialDir = value.split(' ');
      else if (kind === 'prev') st.prev.push(value);
      else if (kind === 'trial-state')
        st.trial =
          value === 'none'
            ? null
            : Object.fromEntries(
                value
                  .split(';')
                  .map(kv => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)])
              );
      else if (kind === 'world' || kind === 'trial-copy') {
        const [id, ...fields] = rest;
        const f = Object.fromEntries(
          fields
            .join(' ')
            .match(/(\w+)=(.*?)(?= \w+=|$)/g)
            .map(kv => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)])
        );
        const entry = {
          systemVersion: f.systemVersion,
          marker: f.marker,
          files: f.files.split(','),
        };
        if (kind === 'world') st.worlds[id] = { ...entry, opened: f.opened };
        else st.copies[id] = entry;
      } else assert.fail(`odd state line: ${line}`);
    }
    return st;
  }
  const withoutZips = raw => raw.replace(/^zips .*$/m, 'zips -');

  const stops = calls => calls.filter(c => c.startsWith('stop foundry.service'));

  /**
   * A refusal before anything stopped: exit 1, the reason, the "Nothing was changed" promise, Foundry never stopped,
   * and the Pi as it was in the state `before` (a refused run may keep a download it checked, so zips are left out).
   */
  const assertRefused = (r, label, reason, before = 'start') => {
    assert.equal(r.exit(label), '1', r.output(label));
    assert.match(r.output(label), reason);
    assert.match(r.output(label), /Nothing was changed/);
    assert.deepEqual(stops(r.calls(label)), [], 'Foundry must not stop');
    assert.equal(
      withoutZips(r.rawState(label)),
      withoutZips(r.rawState(before)),
      'nothing may change'
    );
  };

  const INSTALLED = 'dnd5e 6.0.5 files';
  const NEW = 'dnd5e 6.0.6 files';
  const WORLDS = ['curse-of-strahd', 'frostmaiden-training', 'pi-check', 'strahd-kit'];
  /** A world as the scenario script made it, never opened since. */
  const untouched = {
    systemVersion: '6.0.5',
    marker: 'original',
    files: ['LOG', 'marker.txt'],
    opened: '-',
  };
  const opened = (version, extra = []) => ({
    systemVersion: version,
    marker: 'original',
    files: ['LOG', ...extra, 'marker.txt', 'opened-by-foundry.txt'].sort(),
    opened: `opened on dnd5e ${version}`,
  });
  /** The same entries in any order. */
  const sameSet = (actual, expected, message) =>
    assert.deepEqual([...actual].sort(), [...expected].sort(), message ?? actual.join('\n'));

  /**
   * The Pi after a good trial: 6.0.6 installed, strahd-kit launched on it (and opened by Foundry), the other worlds as
   * they were. `campaign` is the world curse-of-strahd as it was at the trial's start, `prev` the folders in the
   * import folder from before.
   */
  const assertTrialState = (st, { campaign = untouched, prev = [] } = {}) => {
    assert.equal(st.system, `6.0.6 (${NEW})`);
    assert.equal(st.options, 'strahd-kit');
    assert.equal(st.stopped, 'none');
    assert.deepEqual(Object.keys(st.worlds).sort(), WORLDS);
    assert.deepEqual(st.worlds['strahd-kit'], opened('6.0.6'));
    assert.deepEqual(st.worlds['curse-of-strahd'], campaign);
    for (const id of ['frostmaiden-training', 'pi-check'])
      assert.deepEqual(st.worlds[id], untouched, id);
    assert.deepEqual(st.trial, {
      from: '6.0.5',
      launched_before: 'curse-of-strahd',
      phase: 'trial',
      started: 'STAMP',
      system: 'dnd5e',
      to: '6.0.6',
    });
    assert.deepEqual(st.trialDir, ['dnd5e-6.0.5', 'started', 'state', 'worlds']);
    // The copies are the worlds as they were before anything ran on 6.0.6.
    assert.deepEqual(Object.keys(st.copies).sort(), WORLDS);
    for (const id of WORLDS) {
      const { opened: _, ...copy } = id === 'curse-of-strahd' ? campaign : untouched;
      assert.deepEqual(st.copies[id], copy, `trial copy of ${id}`);
    }
    assert.equal(st.work, 'none');
    sameSet(st.prev, prev);
  };

  test('trial-download: the download is checked, 6.0.5 kept aside, every world copied, only strahd-kit launched', () => {
    const r = run('trial-download');
    const start = r.state('start');
    assert.equal(start.system, `6.0.5 (${INSTALLED})`);
    assert.equal(start.options, 'curse-of-strahd');
    assert.equal(start.trial, null);
    assert.equal(start.zips, 'none');
    assert.equal(r.exit('trial'), '0', r.output('trial'));
    const out = r.output('trial');
    assert.match(out, /downloaded \/var\/lib\/foundry-import\/dnd5e-release-6\.0\.6\.zip/);
    assert.match(out, /sha256 matches the pin/);
    assert.match(out, /dnd5e 6\.0\.6 fits Foundry 14\.368\.0 \(minimum 14\.367, maximum 14\)/);
    assert.match(out, /copied: curse-of-strahd frostmaiden-training pi-check strahd-kit/);
    assert.match(
      out,
      /dnd5e 6\.0\.6 installed; 6\.0\.5 kept in \/var\/lib\/foundry-import\/system-trial\/dnd5e-6\.0\.5/
    );
    assert.match(out, /strahd-kit is running/);
    assert.match(out, /Foundry reports dnd5e 6\.0\.6/);
    assert.doesNotMatch(out, /did not finish/);
    assert.deepEqual(r.downloads('trial'), [PIN_URL]);
    const st = r.state('trial');
    assertTrialState(st);
    assert.equal(st.zips, 'dnd5e-release-6.0.6.zip');
    // Order: the Assistant GM browser and Foundry stop, Foundry starts on the kit world, then the browser.
    const calls = r.calls('trial');
    const at = c => calls.indexOf(c);
    assert.ok(at('stop foundry-ai-tool-gm-browser.service') >= 0, calls.join('\n'));
    assert.ok(at('stop foundry-ai-tool-gm-browser.service') < at('stop foundry.service'));
    assert.ok(at('stop foundry.service') < at('restart foundry.service'));
    assert.ok(at('restart foundry.service') < at('restart foundry-ai-tool-gm-browser.service'));
  });

  test('trial-zip: ZIP= under the import folder is used as it is, with no download', () => {
    const r = run('trial-zip');
    assert.equal(r.exit('trial'), '0', r.output('trial'));
    assert.deepEqual(r.downloads('trial'), []);
    assert.doesNotMatch(r.output('trial'), /downloaded/);
    assert.match(r.output('trial'), /sha256 matches the pin/);
    assert.doesNotMatch(r.output('trial'), /the zip stays in/);
    const st = r.state('trial');
    assertTrialState(st);
    assert.equal(st.zips, 'mine.zip', 'the zip the user gave stays');
  });

  test('trial-zip-nested: a zip with the files inside a dnd5e folder installs the same way', () => {
    const r = run('trial-zip-nested');
    assert.equal(r.exit('trial'), '0', r.output('trial'));
    assertTrialState(r.state('trial'));
  });

  test('zip-outside-import: ZIP= outside the import folder is refused', () => {
    const r = run('zip-outside-import');
    assertRefused(
      r,
      'trial',
      /ZIP must be a \.zip under \/var\/lib\/foundry-import\/ \(got \/tmp\/zips\/good\.zip\)/
    );
  });

  test('zip-missing: ZIP= naming nothing is refused', () => {
    const r = run('zip-missing');
    assertRefused(r, 'trial', /no such zip: \/var\/lib\/foundry-import\/nope\.zip/);
  });

  test('download-fails: a failed download dies with nothing changed and no half file left', () => {
    const r = run('download-fails');
    assertRefused(
      r,
      'trial',
      /the download from https:\/\/github\.com\/.*dnd5e-release-6\.0\.6\.zip failed/
    );
    assert.equal(r.state('trial').zips, 'none');
  });

  test('bad-sha: a zip that is not the pinned release dies, the download is removed, nothing stops or changes', () => {
    const r = run('bad-sha');
    assertRefused(
      r,
      'trial',
      /the zip's sha256 is [0-9a-f]{64}, not the pinned [0-9a-f]{64}: damaged or not the release/
    );
    assert.deepEqual(r.downloads('trial'), [PIN_URL], 'it was downloaded, then judged');
    assert.equal(r.state('trial').zips, 'none', 'the bad download is removed');
    assert.equal(r.state('trial').work, 'none');
    assert.deepEqual(r.calls('trial'), [], 'not even a systemctl call');
  });

  test('bad-sha-zip: a bad sha256 on a zip the user gave is refused and the zip stays', () => {
    const r = run('bad-sha-zip');
    assertRefused(r, 'trial', /the zip's sha256 is [0-9a-f]{64}, not the pinned/);
    assert.equal(r.state('trial').zips, 'mine.zip', "the user's own file is never removed");
    assert.deepEqual(r.calls('trial'), []);
  });

  test('zip-too-new: a zip that needs a newer Foundry is refused before anything stops', () => {
    const r = run('zip-too-new');
    assertRefused(
      r,
      'trial',
      /dnd5e 6\.0\.6 needs Foundry 14\.369 or newer; the Pi runs 14\.368\.0/
    );
    assert.deepEqual(r.calls('trial'), [], 'not even a systemctl call');
    assert.equal(r.state('trial').work, 'none', 'the unpacked zip is removed');
  });

  test('zip-max-below: a zip that supports only older Foundry builds is refused', () => {
    const r = run('zip-max-below');
    assertRefused(r, 'trial', /dnd5e 6\.0\.6 supports Foundry up to 13; the Pi runs 14\.368\.0/);
    assert.deepEqual(r.calls('trial'), []);
  });

  test('zip-wrong-version: a zip that holds another version is refused', () => {
    const r = run('zip-wrong-version');
    assertRefused(r, 'trial', /the zip holds dnd5e 6\.0\.7, not 6\.0\.6/);
    assert.deepEqual(r.calls('trial'), []);
  });

  test('already-installed: the pinned version installed already is refused', () => {
    const r = run('already-installed');
    assertRefused(r, 'trial', /dnd5e 6\.0\.6 is installed already/);
    assert.deepEqual(r.calls('trial'), []);
    assert.equal(r.state('trial').zips, 'none', 'nothing was downloaded');
    assert.deepEqual(r.downloads('trial'), []);
  });

  test('newer-installed: a trial goes forward only', () => {
    const r = run('newer-installed');
    assertRefused(
      r,
      'trial',
      /dnd5e 6\.0\.6 is not newer than the installed 6\.0\.7: a trial goes forward only/
    );
  });

  test('kit-launched: Foundry launching the kit world already is refused', () => {
    const r = run('kit-launched');
    assertRefused(
      r,
      'trial',
      /Foundry launches strahd-kit already: launch the world it should go back to/
    );
  });

  test('second-trial: a trial while one is open is refused and the open one is untouched', () => {
    const r = run('second-trial');
    assert.equal(r.exit('trial'), '0', r.output('trial'));
    assertRefused(
      r,
      'second',
      /a trial is open \(\/var\/lib\/foundry-import\/system-trial, phase trial, dnd5e 6\.0\.5 to 6\.0\.6\): finish it with MODE=switch or MODE=rollback first/,
      'trial'
    );
    assert.deepEqual(r.calls('second'), []);
    assertTrialState(r.state('second'));
  });

  test('trial-fails: a trial that fails after Foundry stopped puts 6.0.5, strahd-kit and options.json back', () => {
    const r = run('trial-fails');
    assert.equal(r.exit('trial'), '1', r.output('trial'));
    const out = r.output('trial');
    assert.match(out, /strahd-kit is not running on port 30000/);
    assert.match(out, /dnd5e 6\.0\.5 is back in \/var\/lib\/foundry\/Data\/systems\/dnd5e/);
    assert.match(out, /strahd-kit is back from the trial's copy/);
    assert.match(out, /the run did not finish: Foundry runs curse-of-strahd/);
    const st = r.state('trial');
    assert.equal(st.system, `6.0.5 (${INSTALLED})`, 'the old version is back');
    assert.equal(st.options, 'curse-of-strahd');
    assert.equal(st.stopped, 'none', 'Foundry and the Assistant GM browser run again');
    assert.deepEqual(st.worlds['strahd-kit'], untouched, 'strahd-kit is the copy again');
    for (const id of ['frostmaiden-training', 'pi-check'])
      assert.deepEqual(st.worlds[id], untouched, id);
    // Foundry restarted on the campaign, which it opens on the old version.
    assert.deepEqual(st.worlds['curse-of-strahd'], opened('6.0.5'));
    assert.equal(st.trial, null, 'the trial folder is gone from the import folder');
    assert.equal(st.work, 'none');
    sameSet(st.prev, [
      'prev-STAMP-failed-trial',
      'prev-STAMP-failed-trial/trial',
      'prev-STAMP-failed-trial/trial/started',
      'prev-STAMP-failed-trial/trial/state',
      'prev-STAMP-failed-trial/trial/worlds',
      'prev-STAMP-failed-trial/worlds',
      'prev-STAMP-failed-trial/worlds/strahd-kit',
    ]);
    // Foundry stopped and was restarted by the cleanup, the Assistant GM browser stopped and started again.
    const calls = r.calls('trial');
    assert.equal(calls.filter(c => c === 'restart foundry.service').length, 2, calls.join('\n'));
    assert.ok(calls.includes('start foundry-ai-tool-gm-browser.service'), calls.join('\n'));
  });

  /** The Pi after a rollback of the plain trial: 6.0.5 back, strahd-kit reset, curse-of-strahd launched. */
  const assertRolledBack = st => {
    assert.equal(st.system, `6.0.5 (${INSTALLED})`);
    assert.equal(st.options, 'curse-of-strahd');
    assert.equal(st.stopped, 'none');
    assert.equal(st.trial, null, 'the trial folder moved to prev');
    assert.deepEqual(
      st.worlds['strahd-kit'],
      untouched,
      'strahd-kit is the copy again, kit-run.txt is gone'
    );
    assert.deepEqual(st.worlds['curse-of-strahd'], opened('6.0.5'), 'the campaign was launched');
    for (const id of ['frostmaiden-training', 'pi-check'])
      assert.deepEqual(st.worlds[id], untouched, id);
    assert.equal(st.work, 'none');
  };
  const ARCHIVE = 'prev-STAMP-system-trial';

  test('rollback: 6.0.5 back, strahd-kit reset from the copy, the campaign launched, the trial archived in prev', () => {
    const r = run('rollback');
    assert.equal(r.exit('rollback'), '0', r.output('rollback'));
    const out = r.output('rollback');
    assert.match(
      out,
      /dnd5e 6\.0\.6 to 6\.0\.5; reset from the trial's copies: strahd-kit; then Foundry launches curse-of-strahd/
    );
    assert.match(
      out,
      /dnd5e 6\.0\.5 is back; 6\.0\.6 kept in .*prev-\d{8}-\d{6}-system-trial\/dnd5e-6\.0\.6/
    );
    assert.match(out, /strahd-kit reset from the trial's copy/);
    assert.match(out, /curse-of-strahd is running/);
    assert.match(out, /Foundry reports dnd5e 6\.0\.5/);
    assert.doesNotMatch(out, /did not finish|halfway/);
    const st = r.state('rollback');
    assertRolledBack(st);
    sameSet(st.prev, [
      ARCHIVE,
      `${ARCHIVE}/dnd5e-6.0.6`,
      `${ARCHIVE}/trial`,
      `${ARCHIVE}/trial/restored-strahd-kit`,
      `${ARCHIVE}/trial/started`,
      `${ARCHIVE}/trial/state`,
      `${ARCHIVE}/trial/worlds`,
      `${ARCHIVE}/worlds`,
      `${ARCHIVE}/worlds/strahd-kit`,
    ]);
    assert.equal(st.zips, 'dnd5e-release-6.0.6.zip', 'the downloaded zip is kept');
    const calls = r.calls('rollback');
    assert.ok(calls.includes('stop foundry.service') && calls.includes('restart foundry.service'));
  });

  test('rollback-migrated-refused: a world launched during the trial blocks the rollback and nothing changes', () => {
    const r = run('rollback-migrated-refused');
    const before = r.state('before');
    assert.deepEqual(
      before.worlds['frostmaiden-training'],
      opened('6.0.6'),
      'it migrated on 6.0.6'
    );
    assert.deepEqual(before.worlds['strahd-kit'], opened('6.0.6', ['kit-run.txt']));
    assertRefused(
      r,
      'rollback',
      /launched during the trial, so they may be migrated to 6\.0\.6: frostmaiden-training\. RESTORE_MIGRATED=1 puts them back from the trial's copies too/,
      'before'
    );
    assert.deepEqual(r.calls('rollback'), []);
    assert.equal(r.state('rollback').system, `6.0.6 (${NEW})`);
  });

  test('rollback-restore-migrated: RESTORE_MIGRATED=1 puts the migrated world back from the trial copy too', () => {
    const r = run('rollback-restore-migrated');
    assert.equal(r.exit('rollback'), '0', r.output('rollback'));
    const out = r.output('rollback');
    assert.match(
      out,
      /reset from the trial's copies: strahd-kit frostmaiden-training; then Foundry launches curse-of-strahd/
    );
    assert.match(out, /frostmaiden-training reset from the trial's copy/);
    const st = r.state('rollback');
    assertRolledBack(st);
    assert.deepEqual(
      st.worlds['frostmaiden-training'],
      untouched,
      'back to 6.0.5 data, without its run'
    );
    sameSet(
      st.prev.filter(p => p.startsWith(`${ARCHIVE}/worlds/`)),
      [`${ARCHIVE}/worlds/strahd-kit`, `${ARCHIVE}/worlds/frostmaiden-training`]
    );
  });

  test('rollback-world-created: a world made during the trial stays and the rollback says so', () => {
    const r = run('rollback-world-created');
    assert.equal(r.exit('rollback'), '0', r.output('rollback'));
    assert.match(
      r.output('rollback'),
      /WARNING: made during the trial, so there is no copy to put back: new-world/
    );
    const st = r.state('rollback');
    assertRolledBack(st);
    assert.equal(st.worlds['new-world'].systemVersion, '6.0.6', 'left as it was');
  });

  test('rollback-halfway: a rollback that stops after the system swap says so and a rerun finishes it', () => {
    const r = run('rollback-halfway');
    // The first run: the old version is back and strahd-kit is reset, but the campaign does not come up.
    assert.equal(r.exit('rollback'), '1', r.output('rollback'));
    const out = r.output('rollback');
    assert.match(out, /curse-of-strahd is not running on port 30000/);
    assert.match(
      out,
      /the rollback stopped halfway: dnd5e 6\.0\.5 is back and Foundry launches curse-of-strahd; run MODE=rollback again to finish/
    );
    const half = r.state('rollback');
    assert.equal(half.system, `6.0.5 (${INSTALLED})`);
    assert.equal(half.options, 'curse-of-strahd');
    assert.equal(half.stopped, 'none', 'Foundry and the browser were started again');
    assert.deepEqual(half.worlds['strahd-kit'], untouched);
    assert.equal(half.trial?.phase, 'rolling-back');
    assert.equal(half.trial?.restore, 'strahd-kit');
    assert.ok(half.trialDir.includes('restored-strahd-kit'), half.trialDir.join(' '));
    assert.ok(
      half.prev.some(p => p.endsWith('-system-trial/dnd5e-6.0.6')),
      half.prev.join('\n')
    );
    assert.ok(
      half.prev.some(p => p.endsWith('-system-trial/worlds/strahd-kit')),
      half.prev.join('\n')
    );
    // The rerun: it takes the saved list (the campaign it launched in between does not count as a new launch).
    assert.equal(r.exit('rerun'), '0', r.output('rerun'));
    assert.match(
      r.output('rerun'),
      /finishing the rollback that stopped halfway; worlds to reset: strahd-kit/
    );
    assert.doesNotMatch(r.output('rerun'), /launched during the trial/);
    const st = r.state('rerun');
    assertRolledBack(st);
    assert.ok(
      st.prev.some(p => p.endsWith('-system-trial/trial/restored-strahd-kit')),
      st.prev.join('\n')
    );
    assert.ok(
      st.prev.some(p => p.endsWith('-system-trial/dnd5e-6.0.6')),
      st.prev.join('\n')
    );
    assert.ok(
      st.prev.some(p => p.endsWith('-system-trial/worlds/strahd-kit')),
      st.prev.join('\n')
    );
    // The rerun keeps the first run's archive: one prev-*-system-trial folder holds everything.
    const archives = new Set(
      st.prev.map(p => p.match(/prev-[^/]*-system-trial/)?.[0]).filter(Boolean)
    );
    assert.equal(archives.size, 1, st.prev.join('\n'));
    assert.match(r.output('rerun'), /dnd5e 6\.0\.5 is back already/);
    assert.match(r.output('rerun'), /kept in \S+-system-trial: dnd5e 6\.0\.6,/);
    assert.doesNotMatch(r.output('rerun'), /6\.0\.5 to 6\.0\.5/);
  });

  test('rollback-no-trial: nothing to roll back is refused', () => {
    const r = run('rollback-no-trial');
    assertRefused(r, 'rollback', /no trial is open: nothing to roll back/);
    assert.deepEqual(r.calls('rollback'), []);
  });

  test('trial-again: after a rollback a new trial reuses the downloaded zip', () => {
    const r = run('trial-again');
    const afterRollback = r.state('rollback');
    assertRolledBack(afterRollback);
    assert.equal(r.exit('again'), '0', r.output('again'));
    assert.match(r.output('again'), /using the zip downloaded before/);
    assert.deepEqual(r.downloads('again'), []);
    assertTrialState(r.state('again'), { campaign: opened('6.0.5'), prev: afterRollback.prev });
  });

  test('switch: the campaign is launched on the new version and the phase is switched', () => {
    const r = run('switch');
    assert.equal(r.exit('switch'), '0', r.output('switch'));
    const out = r.output('switch');
    assert.match(
      out,
      /curse-of-strahd goes to dnd5e 6\.0\.6 \(it migrates on this launch\); frostmaiden-training pi-check migrate\(s\) when next launched/
    );
    assert.match(out, /curse-of-strahd is running/);
    assert.match(
      out,
      /curse-of-strahd runs on dnd5e 6\.0\.6; Foundry launches it again after a reboot/
    );
    const st = r.state('switch');
    assert.equal(st.system, `6.0.6 (${NEW})`);
    assert.equal(st.options, 'curse-of-strahd');
    assert.equal(st.stopped, 'none');
    assert.deepEqual(st.worlds['curse-of-strahd'], opened('6.0.6'), 'the campaign migrated');
    assert.deepEqual(
      st.worlds['strahd-kit'],
      opened('6.0.6', ['kit-run.txt']),
      'the kit run stays'
    );
    for (const id of ['frostmaiden-training', 'pi-check'])
      assert.deepEqual(st.worlds[id], untouched, id);
    assert.equal(st.trial?.phase, 'switched');
    assert.match(st.trial?.switched ?? '', /^STAMP$/);
    assert.equal(st.trial?.from, '6.0.5');
    assert.deepEqual(
      st.trialDir,
      ['dnd5e-6.0.5', 'started', 'state', 'worlds'],
      'the old version and copies stay'
    );
    assert.deepEqual(st.prev, []);
    const calls = r.calls('switch');
    assert.ok(calls.includes('stop foundry.service') && calls.includes('restart foundry.service'));
  });

  test('switch-fails: a failed switch puts the campaign back from the copy and launches the kit world again', () => {
    const r = run('switch-fails');
    assert.equal(r.exit('switch'), '1', r.output('switch'));
    const out = r.output('switch');
    assert.match(out, /curse-of-strahd is not running on port 30000/);
    assert.match(out, /curse-of-strahd is back from the trial's copy, still on 6\.0\.5 data/);
    const st = r.state('switch');
    assert.equal(st.system, `6.0.6 (${NEW})`, 'a failed switch leaves the new version');
    assert.equal(st.options, 'strahd-kit');
    assert.equal(st.stopped, 'none');
    assert.deepEqual(st.worlds['curse-of-strahd'], untouched, 'the campaign is the copy again');
    assert.equal(st.trial?.phase, 'trial', 'the trial is open again');
    assert.equal(st.trial?.switched, undefined);
    sameSet(st.prev, [
      'prev-STAMP-failed-switch',
      'prev-STAMP-failed-switch/worlds',
      'prev-STAMP-failed-switch/worlds/curse-of-strahd',
    ]);
  });

  test('switch-twice: a second switch is refused and nothing changes', () => {
    const r = run('switch-twice');
    assert.equal(r.exit('switch'), '0', r.output('switch'));
    assertRefused(r, 'second', /the trial of dnd5e 6\.0\.6 was switched already/, 'switch');
    assert.deepEqual(r.calls('second'), []);
  });

  test('switch-no-trial: a switch without a trial is refused', () => {
    const r = run('switch-no-trial');
    assertRefused(r, 'switch', /no trial is open: MODE=trial first/);
    assert.deepEqual(r.calls('switch'), []);
  });

  test('rollback-after-switch: there is no rollback after a switch', () => {
    const r = run('rollback-after-switch');
    assert.equal(r.exit('switch'), '0', r.output('switch'));
    assertRefused(
      r,
      'rollback',
      /the trial was switched: curse-of-strahd runs on dnd5e 6\.0\.6\. Going back means restoring the snapshot from before the switch/,
      'switch'
    );
    assert.deepEqual(r.calls('rollback'), []);
  });

  test('status: read-only, it reports the trial, the version and each world, and changes nothing', () => {
    const r = run('status');
    assert.equal(r.exit('status'), '0', r.output('status'));
    const out = r.output('status');
    assert.match(
      out,
      /Foundry 14\.368\.0, dnd5e 6\.0\.6 in \/var\/lib\/foundry\/Data\/systems\/dnd5e; options\.json launches strahd-kit/
    );
    assert.match(
      out,
      /trial: phase trial, dnd5e 6\.0\.5 to 6\.0\.6, began \d{8}-\d{6}, Foundry ran curse-of-strahd before it/
    );
    assert.match(
      out,
      /world frostmaiden-training: dnd5e 6\.0\.6 \(launched since the trial began\)/
    );
    assert.match(out, /world pi-check: dnd5e 6\.0\.5 \(not launched since the trial began\)/);
    assert.match(
      out,
      /world curse-of-strahd: dnd5e 6\.0\.5 \(not launched since the trial began\)/
    );
    assert.match(out, /world strahd-kit: dnd5e 6\.0\.6 \(launched since the trial began\)/);
    assert.deepEqual(r.calls('status'), [], 'no systemctl call');
    assert.equal(r.rawState('status'), r.rawState('before'));
  });

  test('status-no-trial: without a trial it says so and changes nothing', () => {
    const r = run('status-no-trial');
    assert.equal(r.exit('status'), '0', r.output('status'));
    const out = r.output('status');
    assert.match(
      out,
      /Foundry 14\.368\.0, dnd5e 6\.0\.5 in .*; options\.json launches curse-of-strahd/
    );
    assert.match(out, /no trial open \(pinned for the next one: dnd5e 6\.0\.6\)/);
    assert.match(out, /world strahd-kit: dnd5e 6\.0\.5$/m);
    assert.deepEqual(r.calls('status'), []);
    assert.equal(r.rawState('status'), r.rawState('start'));
  });

  test('online-refused: people online refuse the run, only the Assistant GM browser was stopped and started again', () => {
    const r = run('online-refused');
    assert.equal(r.exit('trial'), '1', r.output('trial'));
    assert.match(
      r.output('trial'),
      /2 user\(s\) are online in Foundry: run this when nobody plays \(or FORCE=1\)\. Nothing was changed/
    );
    const calls = r.calls('trial');
    assert.deepEqual(stops(calls), [], 'Foundry must not stop');
    assert.ok(calls.includes('stop foundry-ai-tool-gm-browser.service'), calls.join('\n'));
    assert.ok(calls.includes('start foundry-ai-tool-gm-browser.service'), calls.join('\n'));
    assert.equal(
      withoutZips(r.rawState('trial')),
      withoutZips(r.rawState('start')),
      'nothing may change'
    );
  });

  test('online-force: FORCE=1 goes ahead with people online and warns', () => {
    const r = run('online-force');
    assert.equal(r.exit('trial'), '0', r.output('trial'));
    assert.match(
      r.output('trial'),
      /WARNING: 2 user\(s\) online or unknown; FORCE=1, stopping Foundry anyway/
    );
    assertTrialState(r.state('trial'));
  });

  test('status-unreadable: an /api/status that cannot be read refuses the run', () => {
    const r = run('status-unreadable');
    assert.equal(r.exit('trial'), '1', r.output('trial'));
    assert.match(
      r.output('trial'),
      /cannot read who is online in Foundry \(\/api\/status on port 30000\).* Nothing was changed/
    );
    assert.deepEqual(stops(r.calls('trial')), []);
    assert.equal(withoutZips(r.rawState('trial')), withoutZips(r.rawState('start')));
  });

  test('bad-env: a missing or odd MODE, FORCE, RESTORE_MIGRATED or ZIP is refused before anything happens', () => {
    const r = run('bad-env');
    const refuse = (label, reason) => {
      assertRefused(r, label, reason);
      assert.deepEqual(r.calls(label), [], `${label}: not even a systemctl call`);
      assert.deepEqual(r.downloads(label), []);
    };
    refuse('no_mode', /MODE must be trial, switch, rollback or status/);
    refuse('bogus_mode', /MODE must be trial, switch, rollback or status/);
    refuse('force_2', /FORCE must be 0 or 1/);
    refuse('restore_2', /RESTORE_MIGRATED must be 0 or 1/);
    refuse('restore_in_trial', /RESTORE_MIGRATED is for MODE=rollback only/);
    refuse('zip_in_rollback', /ZIP is for MODE=trial only/);
    refuse('zip_in_switch', /ZIP is for MODE=trial only/);
  });
});
