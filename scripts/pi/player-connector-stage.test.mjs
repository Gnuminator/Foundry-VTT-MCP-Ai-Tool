// Pi stage 30, the player connector (scripts/pi/remote/30-player-connector.sh, player-connector-pi):
//   node --test scripts/pi/player-connector-stage.test.mjs
// Text checks always run; the scenarios (real lib.sh in a Debian 13 ARM64 container) run with PI_STAGE30_CONTAINER=1 (needs Docker).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runStageContainer } from './container-test/run-stage-container.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stage = readFileSync(path.join(repo, 'scripts/pi/remote/30-player-connector.sh'), 'utf8');
const code = stage
  .split('\n')
  .filter(l => !l.trim().startsWith('#'))
  .join('\n');

describe('stage 30 as text', () => {
  test('the snapshot check is after the mode check and before the first write; DRY_RUN, CHECK and UNDO exist', () => {
    const modes = code.indexOf('use one of DRY_RUN=1');
    const snap = code.indexOf('require_recent_snapshot');
    const write = code.indexOf('mktemp "$TOOL_ETC/.player-connector.json');
    assert.ok(modes > 0 && snap > modes && write > snap);
    for (const m of ['DRY_RUN', 'CHECK', 'UNDO']) assert.match(stage, new RegExp(m));
    assert.match(code, /\[ "\$dry" != 1 \] && \[ "\$check" != 1 \]; then require_recent_snapshot/);
  });

  test('DEV_USER is never written, and is refused when found', () => {
    assert.match(code, /refuse_dev_user\(\)/);
    const writes = code.split('\n').filter(l => /DEV_USER/.test(l));
    for (const l of writes) assert.match(l, /grep|refuse|is set in|hits/, l);
    assert.doesNotMatch(code, /^FOUNDRY_AI_PLAYER_CONNECTOR_DEV_USER=/m);
  });

  test('the table is 0600 foundry, installed atomically, and nothing prints a secret', () => {
    assert.match(code, /chmod 0600 "\$tmp"/);
    assert.match(code, /chown "\$FOUNDRY_USER:\$FOUNDRY_USER" "\$tmp"/);
    assert.match(code, /mv "\$tmp" "\$cfg"/);
    assert.doesNotMatch(
      code,
      /(echo|printf|ok|say|warn|die)[^\n]*(clientSecret|clientId|\$\(cat "\$(cfg|src)"\))/
    );
    assert.match(stage, /only counts are printed/);
  });

  test('the units themselves are not edited; only drop-ins, and only the two services restart', () => {
    assert.doesNotMatch(code, /write_file "\$unit_dir\/\$u"/);
    assert.match(code, /\$unit_dir\/\$u\.d\/\$dropin_name/);
    const restarts = code.match(/enable_unit [^\n]*/g) ?? [];
    for (const r of restarts) assert.match(r, /"\$(bridge_unit|dash_unit)"/, r);
    assert.doesNotMatch(code, /systemctl (restart|stop) /);
  });

  test('it touches no firewall, port, tunnel or GM connector setting', () => {
    assert.doesNotMatch(
      code,
      /ufw|iptables|nft |cloudflared |tailscale|MCP_CONTROL_PORT=|MCP_CONTROL_HOST=/
    );
    assert.match(code, /ports_line/);
  });

  test('every rm uses a guarded variable', () => {
    for (const m of code.matchAll(/rm -(rf|f) ("[^"]*")/g))
      assert.match(m[2], /\$\{[a-z_]+:\?\}/, m[0]);
  });

  test('the dashboard check expects 401 with no token and 421 for an unlisted name', () => {
    assert.match(code, /expected 401/);
    assert.match(code, /expected 421/);
  });

  test('the table must be https with the /mcp/player path and an AUD tag', () => {
    assert.match(stage, /endpoint must be https/);
    assert.match(stage, /endpoint path must be \/mcp\/player/);
    assert.match(stage, /\{32,128\}/);
  });
});

describe(
  'stage 30 in the ARM64 container',
  { skip: process.env.PI_STAGE30_CONTAINER !== '1' },
  () => {
    test('scenarios', () => {
      const r = runStageContainer('stage30-scenarios.sh', { timeout: 600000 });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.ok(r.stdout.includes('ALL SCENARIOS OK'), r.stdout);
    });
  }
);
