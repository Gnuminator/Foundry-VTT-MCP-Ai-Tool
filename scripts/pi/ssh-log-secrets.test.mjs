import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const stage9 = readFileSync(path.join(here, 'remote', '9-ssh-log.sh'), 'utf8');

test('the ssh log wrapper keeps no command text for token scripts', () => {
  const start = stage9.indexOf('*no-log |');
  const generic = stage9.indexOf('*)\n  note \\"run: \\$cmd\\"');
  assert.ok(start > 0 && generic > start, 'the secret case comes before the generic case');
  const branch = stage9.slice(start, generic);
  for (const name of ['no-log', 'set-tunnel-token', 'set-dashboard-access', 'set-discord-token', 'gh-runner-']) {
    assert.ok(branch.includes(name), `${name} is covered`);
  }
  assert.ok(!/note[^\n]*cmd/.test(branch), 'the secret branch does not log the command text');
});

test('the wrapper script still parses as shell text', () => {
  assert.match(stage9, /command text not saved/);
});
