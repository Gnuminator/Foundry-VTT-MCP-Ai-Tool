import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const stage5 = readFileSync(path.join(here, 'remote', '5-tool.sh'), 'utf8');

// The bridge unit is the text between its [Unit] block and the dashboard unit.
const bridgeUnit = stage5.slice(stage5.indexOf('bridge_unit="'), stage5.indexOf('dashboard_unit="'));

test('the Pi bridge logs at info into a file under the data dir, not the private /tmp', () => {
  assert.match(bridgeUnit, /^Environment=LOG_LEVEL=info$/m);
  assert.match(bridgeUnit, /^Environment=LOG_FILE_PATH=\$TOOL_DATA\/logs\/mcp-server\.log$/m);
});

test('the log settings come before bridge.env, so bridge.env can override them', () => {
  const log = bridgeUnit.indexOf('LOG_FILE_PATH=');
  const env = bridgeUnit.indexOf('EnvironmentFile=-$TOOL_ETC/bridge.env');
  assert.ok(log > 0 && env > log);
});

test('the log folder is inside the unit ReadWritePaths and is made by the stage', () => {
  const rw = stage5.match(/^ReadWritePaths=([^\s"]+)"?$/m);
  const logPath = bridgeUnit.match(/^Environment=LOG_FILE_PATH=(\S+)$/m);
  assert.ok(rw && logPath);
  assert.ok(logPath[1].startsWith(`${rw[1]}/`));
  assert.ok(stage5.includes('"$TOOL_DATA/logs"'), 'the stage creates the log folder with an owner');
});
