// Pi sync check (scripts/pi/remote/sync-check.sh, backlog obsidian-staleness): when Syncthing last synced, read only.
//   node --test scripts/pi/sync-check.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
    assert.match(stage, /more than \$stale_hours hours ago/);
    assert.match(stage, /still catching up/);
  });

  test('STRICT=1 is the only way it exits non-zero over a warning', () => {
    assert.match(stage, /\[ "\$strict" = 1 \] && \[ "\$problems" -gt 0 \]/);
  });

  test('is valid bash', () => {
    const r = spawnSync('bash', ['-n'], { input: stage, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });
});
