// Pi sync check (scripts/pi/remote/sync-check.sh, backlog obsidian-staleness): when Syncthing last synced, read only.
//   node --test scripts/pi/sync-check.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stage = readFileSync(path.join(repo, 'scripts', 'pi', 'remote', 'sync-check.sh'), 'utf8');

describe('sync-check.sh as text', () => {
  test('only reads: no write, delete, restart or config change', () => {
    assert.doesNotMatch(
      stage,
      /\brm\b|\bmv\b|-delete|\bcp\b|\bchown\b|\bchmod\b|\binstall\b|tee |systemctl (restart|stop|start|enable)|config [a-z -]*(add|set|delete)|-X (POST|PUT|DELETE)/
    );
    assert.doesNotMatch(stage, /require_recent_snapshot/);
  });

  test('only GETs the REST API and keeps the key off the command line', () => {
    assert.match(stage, /printf 'X-API-Key: %s\\n' "\$api_key" \| curl -fs --max-time 5 -H @-/);
    assert.doesNotMatch(stage, /echo .*api_key|out .*api_key/);
  });

  test('reads the statistics and warns on never seen, long unseen and not caught up', () => {
    assert.match(stage, /rest stats\/device/);
    assert.match(stage, /rest stats\/folder/);
    assert.match(stage, /has never connected/);
    assert.match(stage, /missed changes and is out of date/);
    assert.match(stage, /still catching up/);
  });

  test('STRICT=1 is the only way it exits non-zero over a warning', () => {
    assert.match(stage, /\[ "\$strict" = 1 \] && \[ "\$problems" -gt 0 \]/);
  });

  test('stops instead of reporting nothing when Syncthing does not answer', () => {
    assert.match(stage, /folders="\$\(st config folders list\)" \|\| die/);
    assert.match(stage, /dev_list="\$\(st config folders "\$folder_id" devices list\)" \|\| die/);
    assert.match(stage, /\[ -n "\$connections" \] \|\| die/);
  });

  test('is valid bash', () => {
    const r = spawnSync('bash', ['-n'], { input: stage, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });
});

// A run with fake id, runuser, syncthing and curl on the PATH that serve the real Syncthing 2026-11 JSON shapes.
function run({ connected, completion, seen, strict = false }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sync-check-'));
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  const put = (name, body) => {
    writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  };
  put('id', 'echo 0');
  put('runuser', 'shift 3; exec "$@"');
  put(
    'syncthing',
    `args="$*"
case "$args" in
*"show system"*) echo '  "myID": "ME-ME",' ;;
*"gui apikey get"*) echo KEY ;;
*"folders list"*) echo foundry-gm-vault ;;
*"devices list"*) printf 'ME-ME\\nPEER-ID\\n' ;;
*"name get"*) echo danni-pc ;;
esac`
  );
  put(
    'curl',
    `url="\${@: -1}"
case "$url" in
*stats/device*) echo '{"PEER-ID":{"lastSeen":"${seen}","lastConnectionDurationS":5}}' ;;
*stats/folder*) echo '{"foundry-gm-vault":{"lastFile":{"at":"2026-11-14T14:10:55+01:00","filename":"a.md","deleted":false},"lastScan":"2026-11-16T17:47:58+01:00"}}' ;;
*system/connections*) echo '{"connections":{"PEER-ID":{"connected":${connected}}}}' ;;
*db/completion*) echo '{"completion":${completion},"needItems":0}' ;;
esac`
  );
  const lib = readFileSync(path.join(repo, 'scripts', 'pi', 'remote', 'lib.sh'), 'utf8');
  const r = spawnSync('bash', ['-s'], {
    input: `${lib}\n${stage}`,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      STRICT: strict ? '1' : '0',
    },
  });
  rmSync(dir, { recursive: true, force: true });
  return { status: r.status, text: `${r.stdout}${r.stderr}` };
}

describe(
  'sync-check.sh with a fake Syncthing',
  { skip: process.platform === 'win32' && !process.env.PI_SYNC_FAKE },
  () => {
    test('a PC away for ten days that holds everything is not a warning', () => {
      const r = run({
        connected: false,
        completion: 100,
        seen: '2026-11-06T10:00:00+01:00',
        strict: true,
      });
      assert.equal(r.status, 0, r.text);
      assert.match(r.text, /danni-pc: not connected, last seen .*holds 100 percent/);
      assert.doesNotMatch(r.text, /WARNING/);
    });

    test('a PC that is off and holds less than everything is out of date, and STRICT=1 fails', () => {
      const r = run({
        connected: false,
        completion: 87,
        seen: '2026-11-16T15:00:00+01:00',
        strict: true,
      });
      assert.equal(r.status, 1, r.text);
      assert.match(r.text, /WARNING: danni-pc is not connected and holds 87 percent/);
    });

    test('a connected PC under 100 is catching up; at 100 it is clean', () => {
      assert.match(
        run({ connected: true, completion: 40, seen: '2026-11-16T15:00:00+01:00' }).text,
        /still catching up/
      );
      const clean = run({ connected: true, completion: 100, seen: '2026-11-16T15:00:00+01:00' });
      assert.equal(clean.status, 0, clean.text);
      assert.doesNotMatch(clean.text, /WARNING/);
    });

    test('a PC that never connected is a warning', () => {
      const r = run({ connected: false, completion: 0, seen: '1970-01-01T01:00:00+01:00' });
      assert.match(r.text, /has never connected/);
    });
  }
);
