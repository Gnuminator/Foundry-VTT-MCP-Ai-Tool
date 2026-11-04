// Pi stage 26, the Discord bot moves to the game server (scripts/pi/remote/26-discord-game-server.sh, discord-pi-game-server):
//   node --test scripts/pi/discord-game-server.test.mjs
// Text checks always run; the scenarios (real lib.sh, awk and sed in a Debian 13 ARM64 container) run with
// PI_STAGE26_CONTAINER=1 (needs Docker).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stage = readFileSync(path.join(repo, 'scripts/pi/remote/26-discord-game-server.sh'), 'utf8');

describe('stage 26 as text', () => {
  test('the defaults are the game server and its three channels', () => {
    assert.match(stage, /1432040202687348856/);
    assert.match(stage, /1566876400147759394/); // #session-notes
    assert.match(stage, /1566876401519427755/); // #gm-bot
    assert.match(stage, /1566884650494722220/); // #changelog
  });

  test('the snapshot and quiet checks come before the file is written', () => {
    const snap = stage.indexOf('\nrequire_recent_snapshot');
    const quiet = stage.indexOf('\nrequire_quiet_if_active');
    const write = stage.indexOf('mv "$tmp" "$env_file"');
    assert.ok(snap > 0 && quiet > snap && write > quiet);
  });

  test('the token is never echoed', () => {
    assert.doesNotMatch(stage, /echo[^\n]*DISCORD_TOKEN="?\$/);
    assert.match(stage, /DISCORD_TOKEN=<hidden>/);
  });

  test('has a dry run, a check and an undo', () => {
    for (const m of ['DRY_RUN', 'CHECK', 'UNDO']) assert.match(stage, new RegExp(m));
  });
});

describe('stage 26 in the ARM64 container', { skip: process.env.PI_STAGE26_CONTAINER !== '1' }, () => {
  test('scenarios', () => {
    const r = spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '--platform',
        'linux/arm64',
        '-v',
        `${repo}:/repo:ro`,
        'debian:13-slim',
        'bash',
        '/repo/scripts/pi/container-test/stage26-scenarios.sh',
      ],
      { encoding: 'utf8', timeout: 600000 }
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes('ALL SCENARIOS OK'), r.stdout);
  });
});
