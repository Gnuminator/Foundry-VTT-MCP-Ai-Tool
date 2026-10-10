// Tests for the guard that keeps other Pi stages away from an open dnd5e trial (stage 14,
// docs/dev/PI-SETUP.md, "System trial (stage 14)"): refuse_during_system_trial in lib.sh, the stages that call
// it before they launch a world, and stage 5's check world, which never replaces an installed dnd5e.
//   node --test scripts/pi/system-trial-guard.test.mjs
// Runs with the real lib.sh in folders of its own (bash needed; Git Bash on Windows works).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const remote = path.join(repo, 'scripts', 'pi', 'remote');
const hasBash = spawnSync('bash', ['-c', 'true']).status === 0;
const tmp = mkdtempSync(path.join(os.tmpdir(), 'pi-trial-guard-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
const root = tmp.replace(/\\/g, '/');
const lib = readFileSync(path.join(remote, 'lib.sh'), 'utf8');
const trialDir = `${root}/system-trial`;

function bash(script, env = {}) {
  const file = path.join(tmp, 'run.sh');
  writeFileSync(file, script);
  return spawnSync('bash', [file.replace(/\\/g, '/')], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}
function setTrial(state) {
  rmSync(trialDir, { recursive: true, force: true });
  if (state === null) return;
  mkdirSync(trialDir, { recursive: true });
  if (state !== undefined) writeFileSync(`${trialDir}/state`, state);
}
const guard = (...worlds) =>
  bash(
    `${lib}\nSYSTEM_TRIAL_DIR=${trialDir}\nrefuse_during_system_trial "stage X"${worlds.map(w => ` "${w}"`).join('')}\necho passed\n`
  );

describe('refuse_during_system_trial', { skip: !hasBash && 'no bash here' }, () => {
  test('no trial folder: every stage may run', () => {
    setTrial(null);
    assert.match(guard().stdout, /passed/);
    assert.match(guard('curse-of-strahd').stdout, /passed/);
  });

  test('a switched trial is over: every stage may run', () => {
    setTrial('phase=switched\nfrom=6.0.5\nto=6.0.6\n');
    assert.match(guard().stdout, /passed/);
  });

  for (const phase of ['trial', 'installing', 'switching', 'rolling-back']) {
    test(`phase ${phase}: a stage that launches other worlds is refused, with nothing run after it`, () => {
      setTrial(`system=dnd5e\nphase=${phase}\n`);
      for (const res of [
        guard(),
        guard('curse-of-strahd'),
        guard('strahd-kit', 'curse-of-strahd'),
      ]) {
        assert.equal(res.status, 1);
        assert.doesNotMatch(res.stdout, /passed/);
        assert.match(
          res.stderr,
          new RegExp(`a dnd5e system trial is open .*phase ${phase}.*stage X`)
        );
        assert.match(res.stderr, /MODE=switch or MODE=rollback/);
      }
    });
  }

  test('phase trial: a stage that launches only the kit world may run', () => {
    setTrial('phase=trial\n');
    assert.match(guard('strahd-kit').stdout, /passed/);
    assert.match(guard('strahd-kit', 'strahd-kit').stdout, /passed/);
  });

  test('a trial folder without a state file counts as open (phase unknown)', () => {
    setTrial(undefined);
    const res = guard();
    assert.equal(res.status, 1);
    assert.match(res.stderr, /phase unknown/);
  });
});

describe('the stages that launch worlds call the guard first', () => {
  // The guard must come before the stage changes anything: before its first top-level systemctl, options.json
  // write, install, rm, mv or cp (function bodies above the call, such as set_world in stage 13, only define).
  const change = /^(if have_systemd|systemctl |set_world |install |rm |mv |cp |umask 077)/;
  for (const [file, call] of [
    ['5-check-world.sh', /^refuse_during_system_trial "stage 5's check world"$/],
    ['11-world.sh', /^refuse_during_system_trial "stage 11"$/],
    [
      '13-player-creation.sh',
      /^refuse_during_system_trial "stage 13" "\$WORLD" \$\{KIT_WORLD:\+"\$KIT_WORLD"\} \$\{orig_world:\+"\$orig_world"\}$/,
    ],
  ]) {
    test(file, () => {
      const lines = readFileSync(path.join(remote, file), 'utf8').split('\n');
      const at = lines.findIndex(l => call.test(l));
      assert.ok(at > 0, `${file} calls refuse_during_system_trial`);
      const first = lines.findIndex(l => change.test(l));
      assert.ok(first !== -1, `${file} has a change to look for`);
      assert.ok(at < first, `${file}: the guard (line ${at + 1}) comes before line ${first + 1}`);
    });
  }
});

describe(
  "stage 5's check world keeps an installed dnd5e",
  { skip: !hasBash && 'no bash here' },
  () => {
    const pi = `${root}/pi`;
    const sys = `${pi}/foundry/Data/systems/dnd5e`;
    function setUp(version) {
      rmSync(pi, { recursive: true, force: true });
      for (const dir of [
        'bin',
        'tool/gm-browser',
        'etc',
        'data',
        'app',
        'foundry/Data/worlds/pi-check',
      ])
        mkdirSync(`${pi}/${dir}`, { recursive: true });
      writeFileSync(`${pi}/tool/gm-browser/assistant-gm.mjs`, '');
      writeFileSync(`${pi}/app/package.json`, '{"version":"14.368.0"}');
      writeFileSync(`${pi}/foundry/Data/worlds/pi-check/world.json`, '{"id":"pi-check"}');
      if (version) {
        mkdirSync(sys, { recursive: true });
        writeFileSync(`${sys}/system.json`, JSON.stringify({ id: 'dnd5e', version }));
      }
      // A download would replace the system: the fake curl says so and fails.
      writeFileSync(
        `${pi}/bin/curl`,
        `#!/usr/bin/env bash\necho "curl $*" >> "${pi}/curl"\nexit 22\n`,
        {
          mode: 0o755,
        }
      );
    }
    const fakes = [
      'require_root() { :; }',
      'require_arm64() { :; }',
      'have_systemd() { return 1; }',
      `TOOL_DIR=${root}/pi/tool TOOL_ETC=${root}/pi/etc TOOL_DATA=${root}/pi/data FOUNDRY_DATA=${root}/pi/foundry FOUNDRY_APP=${root}/pi/app NODE_DIR=${root}/pi/node`,
      `SYSTEM_TRIAL_DIR=${trialDir}`,
      '',
    ].join('\n');
    const stage5 = env =>
      bash(lib + fakes + readFileSync(path.join(remote, '5-check-world.sh'), 'utf8'), {
        PATH: `${pi}/bin:${process.env.PATH}`,
        ...env,
      });

    test('dnd5e 6.0.6 installed (after a switch): kept, no download', () => {
      setTrial(null);
      setUp('6.0.6');
      const res = stage5({});
      assert.match(
        res.stdout,
        /ok: dnd5e 6\.0\.6 installed \(kept; stage 14 changes the version\)/
      );
      assert.equal(JSON.parse(readFileSync(`${sys}/system.json`, 'utf8')).version, '6.0.6');
      assert.equal(existsSync(`${pi}/curl`), false, 'nothing downloaded');
    });

    test('DND5E_VERSION naming another version than the installed one is refused', () => {
      setTrial(null);
      setUp('6.0.6');
      const res = stage5({ DND5E_VERSION: '6.0.5' });
      assert.equal(res.status, 1);
      assert.match(
        res.stderr,
        /dnd5e 6\.0\.6 is installed, not DND5E_VERSION=6\.0\.5: this stage never replaces it/
      );
      assert.equal(JSON.parse(readFileSync(`${sys}/system.json`, 'utf8')).version, '6.0.6');
      assert.equal(existsSync(`${pi}/curl`), false);
    });

    test('no dnd5e installed: the first install downloads DND5E_VERSION (6.0.5 by default)', () => {
      setTrial(null);
      setUp(null);
      const res = stage5({});
      assert.equal(res.status, 1);
      assert.match(
        readFileSync(`${pi}/curl`, 'utf8'),
        /release-6\.0\.5\/dnd5e-release-6\.0\.5\.zip/
      );
      assert.match(res.stderr, /cannot download/);
    });

    test('during an open trial the stage is refused before the dnd5e step', () => {
      setTrial('phase=trial\n');
      setUp('6.0.6');
      const res = stage5({});
      assert.equal(res.status, 1);
      assert.match(res.stderr, /a dnd5e system trial is open .*stage 5's check world/);
      assert.doesNotMatch(res.stdout, /the dnd5e system/);
      setTrial(null);
    });
  }
);
