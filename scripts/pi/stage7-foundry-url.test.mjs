/**
 * Stage 7 writes the dashboard's DASHBOARD_FOUNDRY_URL (the initiative ribbon's portraits) and Plan B passes it too.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = rel => readFileSync(path.join(repo, rel), 'utf8');

describe('DASHBOARD_FOUNDRY_URL on the Pi and in Plan B', () => {
  test('7-vault.sh validates the address, keeps an earlier one and writes it to dashboard.env', () => {
    const text = read('scripts/pi/remote/7-vault.sh');
    assert.match(text, /foundry_url="\$\{DASHBOARD_FOUNDRY_URL:-\}"/);
    assert.match(text, /sed -n 's\/\^DASHBOARD_FOUNDRY_URL=\/\/p' "\$TOOL_ETC\/dashboard\.env"/);
    assert.match(text, /DASHBOARD_FOUNDRY_URL=\$foundry_url/);
    assert.ok(
      text.indexOf('die "DASHBOARD_FOUNDRY_URL must be') <
        text.indexOf('write_file "$TOOL_ETC/dashboard.env"')
    );
  });

  test('Plan B points the dashboard at the local Foundry port', () => {
    const text = read('scripts/plan-b/start.ps1');
    assert.match(text, /DASHBOARD_FOUNDRY_URL\s*=\s*"http:\/\/localhost:\$\(\$ports\.Foundry\)"/);
    const dashboardBlock = text.slice(
      text.indexOf("Start-PlanBService 'dashboard'"),
      text.indexOf("Wait-Service 'foundry'")
    );
    assert.match(dashboardBlock, /DASHBOARD_FOUNDRY_URL/);
  });
});

// With PI_STAGE7_CONTAINER=1 (needs Docker): the dashboard.env step in a Debian 13 ARM64 container.
describe(
  'stage 7 dashboard.env in the ARM64 container',
  { skip: process.env.PI_STAGE7_CONTAINER !== '1' },
  () => {
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
          '/repo/scripts/pi/container-test/stage7-scenarios.sh',
        ],
        { encoding: 'utf8', timeout: 600000 }
      );
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.ok(r.stdout.includes('ALL SCENARIOS OK'), r.stdout);
    });
  }
);
