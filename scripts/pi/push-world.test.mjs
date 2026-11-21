// Tests for the "the Pi is the truth" refusals of scripts/pi/push-world.ps1 (Backlog strahd-pi-is-truth):
//   node --test scripts/pi/push-world.test.mjs
// Needs PowerShell 7 (pwsh); skipped where it is missing. Every case stops before anything is built or sent.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const probe = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major']);
const hasPwsh = probe.status === 0 && Number(String(probe.stdout).trim()) >= 7;
// The cases that build a bundle need robocopy and Windows' tar.exe; the refusals stop before that.
const buildSkip = process.platform !== 'win32' && 'building the bundle needs Windows';

let tmp;
let data;
before(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'push-world-test-'));
  data = path.join(tmp, 'Data');
  mkdirSync(path.join(data, 'worlds', 'curse-of-strahd', 'data'), { recursive: true });
  writeFileSync(path.join(data, 'worlds', 'curse-of-strahd', 'world.json'), '{}');
  writeFileSync(path.join(data, 'worlds', 'curse-of-strahd', 'data', 'CURRENT'), 'x');
});
after(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

function run(...args) {
  const r = spawnSync(
    'pwsh',
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      path.join(here, 'push-world.ps1'),
      '-DataPath',
      data,
      '-Modules',
      '',
      '-NoUpload',
      '-SkipRefs',
      '-FoundryUrl',
      'http://127.0.0.1:9',
      ...args,
    ],
    { encoding: 'utf8' }
  );
  return { status: r.status, text: `${r.stdout}\n${r.stderr}` };
}

function setNewestFile(iso) {
  const t = new Date(iso);
  const f = path.join(data, 'worlds', 'curse-of-strahd', 'data', 'CURRENT');
  utimesSync(f, t, t);
  utimesSync(path.join(data, 'worlds', 'curse-of-strahd', 'world.json'), t, t);
}

describe('push-world.ps1: the Pi is the truth', { skip: !hasPwsh && 'no pwsh' }, () => {
  test('the campaign world is refused without a push-back, a snapshot or -FirstInstall', () => {
    const r = run();
    assert.notEqual(r.status, 0, r.text);
    assert.match(r.text, /refusing to push the campaign world/);
    assert.match(r.text, /-NewerThanSnapshot/);
  });

  test('a copy not newer than the named snapshot is refused', () => {
    setNewestFile('2026-11-10T10:00:00Z');
    const r = run('-NewerThanSnapshot', '2026-11-15T04:30:00Z');
    assert.notEqual(r.status, 0, r.text);
    assert.match(r.text, /not newer than the Pi snapshot of 2026-11-15T04:30:00\.000Z/);
    assert.match(r.text, /Nothing was built/);
  });

  test(
    'a copy newer than the snapshot gets past the check and names it in MANIFEST.txt',
    { skip: buildSkip },
    () => {
      setNewestFile('2026-11-20T10:00:00Z');
      const out = path.join(tmp, 'out');
      const r = run('-NewerThanSnapshot', '2026-11-15T04:30:00Z', '-OutDir', out);
      assert.equal(r.status, 0, r.text);
      assert.match(
        r.text,
        /this PC copy is newer than the Pi snapshot of 2026-11-15T04:30:00\.000Z/
      );
      const manifest = spawnSync(
        'pwsh',
        ['-NoProfile', '-Command', `Get-Content -Raw '${path.join(out, 'stage', 'MANIFEST.txt')}'`],
        { encoding: 'utf8' }
      ).stdout;
      assert.match(manifest, /^based-on-snapshot: 2026-11-15T04:30:00\.000Z$/m);
      assert.ok(!/gm-password/.test(manifest), 'a plain copy is not a push-back');
    }
  );

  test(
    '-FirstInstall and -KeepPiWorld pass and write no snapshot line; they do not mix with -NewerThanSnapshot',
    { skip: buildSkip },
    () => {
      const out = path.join(tmp, 'out-first');
      const r = run('-FirstInstall', '-OutDir', out);
      assert.equal(r.status, 0, r.text);
      const keep = run('-KeepPiWorld', '-OutDir', path.join(tmp, 'out-keep'));
      assert.equal(keep.status, 0, keep.text);
      const mixed = run('-FirstInstall', '-NewerThanSnapshot', '2026-11-15T04:30:00Z');
      assert.notEqual(mixed.status, 0);
      assert.match(mixed.text, /do not go with -PushBack or -NewerThanSnapshot/);
    }
  );

  test('another world is not held to the rule', { skip: buildSkip }, () => {
    mkdirSync(path.join(data, 'worlds', 'frostmaiden-training'), { recursive: true });
    writeFileSync(path.join(data, 'worlds', 'frostmaiden-training', 'world.json'), '{}');
    const r = run('-World', 'frostmaiden-training', '-OutDir', path.join(tmp, 'out-frost'));
    assert.equal(r.status, 0, r.text);
  });
});
