import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootVersion = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version;

test('the player extension carries the release number (manifest and VERSION constant)', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(repo, 'tools/player-connector/manifest.json'), 'utf8')
  );
  const server = fs.readFileSync(path.join(repo, 'tools/player-connector/server/index.js'), 'utf8');
  assert.equal(manifest.version, rootVersion);
  assert.equal(/const VERSION = '([^']+)'/.exec(server)?.[1], rootVersion);
});

test('--tested refuses a malformed pair and writes nothing', () => {
  const script = path.join(repo, 'scripts/sync-version.mjs');
  const file = path.join(repo, 'shared/src/tested-versions.ts');
  const before = fs.readFileSync(file, 'utf8');
  const bad = spawnSync(process.execPath, [script, '--tested', 'fourteen', '6.0.6'], {
    encoding: 'utf8',
  });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /usage: --tested/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.match(before, /TESTED_FOUNDRY_BUILD = '\d+\.\d+';/);
  assert.match(before, /TESTED_DND5E_VERSION = '\d+\.\d+\.\d+';/);
});

test('--check passes and names the player extension targets', () => {
  const script = path.join(repo, 'scripts/sync-version.mjs');
  const ok = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const src = fs.readFileSync(script, 'utf8');
  assert.match(src, /tools\/player-connector\/manifest\.json/);
  assert.match(src, /tools\/player-connector\/server\/index\.js/);
});
