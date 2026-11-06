/**
 * Update-WorldVerified (scripts/test-env/config.ps1): Foundry refuses to auto-launch a world whose
 * compatibility.verified is an older point build than the running Foundry, so start.ps1 bumps it.
 * Run through pwsh on temporary world.json texts. Skipped where pwsh 7 is missing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const script = path.join(root, 'scripts', 'test-env', 'world-verified.cases.ps1');

const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], {
  encoding: 'utf8',
}).stdout?.trim();

const world = (core, verified) =>
  JSON.stringify(
    { id: 'w', coreVersion: core, compatibility: { minimum: '14', verified }, packs: [] },
    null,
    2
  );

function run(cases) {
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', script], {
    input: JSON.stringify(cases),
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test(
  'a world verified on an older build is bumped; a current or generation-only one is left alone',
  { skip: !hasPwsh && 'pwsh is missing' },
  () => {
    const out = run([
      { World: world('14.369', '14.369'), App: '14.370.0' },
      { World: world('14.368', '14'), App: '14.370.0' },
      { World: world('14.370', '14.370'), App: '14.370.0' },
      { World: world('14.371', '14.371'), App: '14.370.0' },
      { World: world('13.351', '13'), App: '14.370.0' },
      { World: world('14.369', '14.369'), App: 'not a version' },
    ]);
    assert.deepEqual(
      out.map(o => o.Changed),
      [true, false, false, false, true, false]
    );
    const bumped = JSON.parse(out[0].Text);
    assert.equal(bumped.coreVersion, '14.370');
    assert.equal(bumped.compatibility.verified, '14.370');
    assert.equal(bumped.compatibility.minimum, '14');
    assert.equal(out[0].Backup, true);
    assert.equal(out[1].Backup, false);
    assert.equal(out[1].Text, world('14.368', '14'));
    // A world from a newer Foundry keeps its own numbers.
    assert.equal(out[3].Text, world('14.371', '14.371'));
    // A previous generation is brought up to the app's.
    assert.equal(JSON.parse(out[4].Text).compatibility.verified, '14.370');
  }
);
