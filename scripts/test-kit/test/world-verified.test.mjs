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
    const crlfTabs = world('14.369', '14.369').replace(/\n/g, '\r\n').replace(/ {2}/g, '\t');
    const out = run([
      { World: world('14.369', '14.369'), App: '14.370.0' },
      { World: world('14.368', '14'), App: '14.370.0' },
      { World: world('14.370', '14.370'), App: '14.370.0' },
      { World: world('14.371', '14.371'), App: '14.370.0' },
      // A previous generation needs Foundry's own migration: left alone.
      { World: world('13.351', '13'), App: '14.370.0' },
      { World: world('14.369', '14.369'), App: 'not a version' },
      { World: crlfTabs, App: '14.370.0' },
      { World: JSON.stringify({ id: 'w', coreVersion: '14.369' }), App: '14.370.0' },
      { World: JSON.stringify({ id: 'w', compatibility: { minimum: '14' } }), App: '14.370.0' },
      { World: '{"compatibility":{"verified":14.369}}', App: '14.370.0' },
      // coreVersion newer than the app is not lowered.
      { World: world('14.372', '14.369'), App: '14.370.0' },
    ]);
    assert.deepEqual(
      out.map(o => o.Changed),
      [true, false, false, false, false, false, true, false, false, false, true]
    );
    assert.equal(out[4].Text, world('13.351', '13'));
    // Only the two fields change: line endings and layout stay byte for byte.
    assert.equal(out[6].Text, crlfTabs.replaceAll('14.369', '14.370'));
    assert.equal(JSON.parse(out[10].Text).coreVersion, '14.372');
    assert.equal(JSON.parse(out[10].Text).compatibility.verified, '14.370');
    const bumped = JSON.parse(out[0].Text);
    assert.equal(bumped.coreVersion, '14.370');
    assert.equal(bumped.compatibility.verified, '14.370');
    assert.equal(bumped.compatibility.minimum, '14');
    assert.equal(out[0].Backup, true);
    assert.equal(out[1].Backup, false);
    assert.equal(out[1].Text, world('14.368', '14'));
    // A world from a newer Foundry keeps its own numbers.
    assert.equal(out[3].Text, world('14.371', '14.371'));
  }
);
