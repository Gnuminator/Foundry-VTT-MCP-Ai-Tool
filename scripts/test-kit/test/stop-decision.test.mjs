/**
 * The decision table of scripts/test-env/stop.ps1 (Resolve-StopAction in config.ps1), run through
 * pwsh with facts only: no process is read or stopped. Skipped where pwsh 7 is missing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const script = path.join(root, 'scripts', 'test-env', 'stop-decision.cases.ps1');

const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], {
  encoding: 'utf8',
}).stdout?.trim();

/** A fact set with the defaults of a healthy bridge we started. @param {object} over */
const facts = over => ({
  Name: 'bridge',
  Port: 31514,
  ProcessId: 500,
  Exists: true,
  ProcessName: 'node',
  StartTime: '2026-10-07T16:00:00.0000000Z',
  RecordedStart: '2026-10-07T16:00:00.0000000Z',
  Owners: [500],
  CommandLine:
    '"C:\\node22\\node.exe" "C:\\repo\\packages\\mcp-server\\dist\\standalone.js" --port 31514',
  ChildNode: null,
  ...over,
});

const WRAPPER =
  'C:\\WINDOWS\\system32\\cmd.exe /d /s /c ""C:\\node22\\node.exe" "C:\\repo\\packages\\mcp-server\\dist\\standalone.js" --port 31514 1>"out.log" 2>"err.log" <nul"';

/** @param {object[]} cases */
function decide(cases) {
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', script], {
    input: JSON.stringify(cases),
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test(
  'stop.ps1 decides from facts: ours, a wrapper, a reused pid, a stranger on the port, unknown',
  { skip: !hasPwsh && 'pwsh is missing' },
  () => {
    const cases = [
      // 0 our node, on its port
      facts({}),
      // 1 our node by its command line, not on the port yet (Foundry still loading)
      facts({ Owners: [] }),
      // 2 gone
      facts({ Exists: false, ProcessName: '' }),
      // 3 the pid was reused: another start time (after a reboot, a pwsh terminal)
      facts({
        ProcessName: 'pwsh',
        StartTime: '2026-10-07T18:30:00.0000000Z',
        Owners: [],
        CommandLine: 'pwsh -NoLogo',
      }),
      // 4 the cmd.exe wrapper with our command line and a node child: both go
      facts({ ProcessName: 'cmd', CommandLine: WRAPPER, Owners: [501], ChildNode: 501 }),
      // 5 the wrapper alone (its child is gone)
      facts({ ProcessName: 'cmd', CommandLine: WRAPPER, Owners: [], ChildNode: null }),
      // 6 a reused pid that is now a pwsh terminal whose child listens on our port: not a wrapper of
      //   ours and not on the port itself, so a reused pid (the child is left alone)
      facts({
        ProcessName: 'pwsh',
        CommandLine: 'pwsh -NoLogo',
        Owners: [777],
        RecordedStart: null,
      }),
      // 7 a node with another command line on our port, no start time recorded (an older pids.json):
      //   accepted by the port, as before
      facts({
        ProcessName: 'node',
        CommandLine: '"node.exe" other-server.js',
        RecordedStart: null,
      }),
      // 8 a reused pid, readable command line, nothing on the port, no start time recorded
      facts({
        ProcessName: 'Code',
        CommandLine: 'Code.exe --type=renderer',
        Owners: [],
        RecordedStart: null,
      }),
      // 9 cannot tell: no command line, nothing on the port
      facts({ CommandLine: null, Owners: [], RecordedStart: null, StartTime: null }),
      // 10 our node by the port even when the command line cannot be read
      facts({ CommandLine: null, RecordedStart: null, StartTime: null }),
      // 11 the wrapper's command line on a node process is still ours (the fallback never records it, but it is harmless)
      facts({
        Name: 'foundry',
        Port: 30001,
        Owners: [],
        CommandLine:
          '"C:\\Program Files\\nodejs\\node.exe" "C:\\FoundryTest\\app\\main.js" --dataPath="C:\\FoundryTest\\data" --port=30001 --noupnp',
      }),
      // 12 another service's command line (the bridge's) is not Foundry's
      facts({ Name: 'foundry', Port: 30001, Owners: [] }),
      // 13 the dashboard by its server.js, not on its port yet
      facts({
        Name: 'dashboard',
        Port: 3100,
        Owners: [],
        CommandLine: '"node.exe" "C:\\repo\\packages\\cogm-dashboard\\dist\\server.js"',
      }),
      // 14 a stranger (not node, not our wrapper) that holds our port with the recorded pid
      facts({ ProcessName: 'python', CommandLine: 'python app.py', RecordedStart: null }),
      // 15 that node from case 7, but the start time says the pid was reused: not ours, left alone
      facts({
        ProcessName: 'node',
        CommandLine: '"node.exe" other-server.js',
        StartTime: '2026-10-07T18:30:00.0000000Z',
      }),
    ];
    const got = decide(cases).map(d => d.Action);
    assert.deepEqual(got, [
      'stop',
      'stop',
      'none',
      'none',
      'stop-wrapper',
      'stop',
      'none',
      'stop',
      'none',
      'refuse-keep',
      'stop',
      'stop',
      'none',
      'stop',
      'refuse',
      'none',
    ]);
    const messages = decide(cases).map(d => d.Message);
    assert.match(messages[3], /reused by pwsh, started at another time/);
    assert.match(messages[4], /node child \(pid 501\)/);
    assert.match(messages[6], /is now pwsh, not the service we started/);
    assert.match(messages[8], /is now Code, not the service we started/);
    assert.match(messages[9], /the pid is kept/);
    assert.match(messages[12], /is now node, not the service/);
    assert.match(messages[14], /holds port 31514/);
    assert.match(messages[15], /reused by node, started at another time/);
  }
);
