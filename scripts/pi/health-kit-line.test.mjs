// The "kit session" section at the end of scripts/pi/remote/1-health.sh: a kit-session.env that is still there
// (a session nobody took down) is a warning with the STAMP; without it the line is ok. The section is cut out of
// the stage and run in bash with stand-ins for say/ok/warn and a temp TOOL_DATA, so nothing needs root or a Pi.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const stage = readFileSync(
  fileURLToPath(new URL('./remote/1-health.sh', import.meta.url)),
  'utf8'
);
const start = stage.indexOf('say "kit session"');
const end = stage.indexOf('say "stage 1 done"');
assert.ok(start > 0 && end > start, '1-health.sh has no "kit session" section');
const section = stage.slice(start, end);

/** Runs the section against a TOOL_DATA folder holding `stateFile` (or nothing). */
function run(stateFile) {
  const dir = mkdtempSync(join(tmpdir(), 'health-kit-'));
  try {
    if (stateFile !== undefined) writeFileSync(join(dir, 'kit-session.env'), stateFile);
    const script = [
      `TOOL_DATA=${JSON.stringify(dir.replace(/\\/g, '/'))}`,
      'say() { printf "==> %s\\n" "$*"; }',
      'ok() { printf "ok: %s\\n" "$*"; }',
      'warn() { printf "WARNING: %s\\n" "$*"; }',
      section,
    ].join('\n');
    const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('no state file: no kit session up', () => {
  assert.match(run(undefined), /ok: no kit session up/);
});

test('a state file: a warning with the stamp, the file is not sourced', () => {
  const out = run(
    'ORIG_WORLD=curse-of-strahd\nWAS_GM_BROWSER=1\nSTAMP=20261013-074544\nKIT_GM_BROWSER=1\n'
  );
  assert.match(out, /WARNING: kit session up since 20261013-074544 /);
  assert.doesNotMatch(out, /no kit session up/);
});

test('a state file without a valid STAMP still warns', () => {
  const out = run('ORIG_WORLD=x\nSTAMP=$(echo pwned)\n');
  assert.match(out, /WARNING: kit session up since an unknown time /);
  assert.doesNotMatch(out, /pwned/);
});
