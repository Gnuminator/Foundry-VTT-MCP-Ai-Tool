import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../kit.mjs';
import { EnvError } from '../lib/errors.mjs';

const kit = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'kit.mjs');

test('parseArgs reads options and the command', () => {
  const o = parseArgs([
    'run',
    '--size',
    'full',
    '--only',
    'a,b',
    '--only',
    'c',
    '--fake',
    '--world',
    'ai-tool-kit-srd',
  ]);
  assert.equal(o.command, 'run');
  assert.equal(o.size, 'full');
  assert.deepEqual(o.only, ['a', 'b', 'c']);
  assert.equal(o.fake, true);
  assert.equal(o.headed, false);
  assert.equal(parseArgs(['check']).size, 'smoke');
});

test('parseArgs rejects bad input', () => {
  assert.throws(() => parseArgs(['run', '--size', 'huge']), EnvError);
  assert.throws(() => parseArgs(['dance']), EnvError);
  assert.throws(() => parseArgs(['run', '--nope']), EnvError);
  assert.throws(() => parseArgs(['run', '--size']), EnvError);
});

test('--help prints usage and exits 0; no command exits 2', () => {
  const help = spawnSync(process.execPath, [kit, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: node scripts\/test-kit\/kit.mjs/);
  const none = spawnSync(process.execPath, [kit], { encoding: 'utf8' });
  assert.equal(none.status, 2);
});
