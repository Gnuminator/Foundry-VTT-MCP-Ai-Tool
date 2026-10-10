// Tests for Plan B (docs/dev/PLAN-B.md): the pure functions of scripts/plan-b/lib.ps1 and
// connectors-lib.ps1 (ports and refusals, the newest-backup choice, version match, the module port
// flag, Foundry's options, the stop and clean decisions, the Claude Desktop connector switch), and
// that every Plan B script parses.
//   node --test scripts/plan-b/plan-b.test.mjs
// Needs PowerShell 7 (pwsh); skipped where it is missing.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pwshProbe = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major']);
const hasPwsh = pwshProbe.status === 0 && Number(String(pwshProbe.stdout).trim()) >= 7;

let tmp;
let n = 0;
before(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'plan-b-test-'));
});
after(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

/** Runs a PowerShell body with both libraries loaded; the body's last value comes back as JSON. */
function ps(body) {
  const file = path.join(tmp, `case-${++n}.ps1`);
  const lib = path.join(here, 'lib.ps1').replace(/'/g, "''");
  const conn = path.join(here, 'connectors-lib.ps1').replace(/'/g, "''");
  writeFileSync(
    file,
    `$ErrorActionPreference = 'Stop'\n. '${lib}'\n. '${conn}'\n$__r = & {\n${body}\n}\nConvertTo-Json -InputObject $__r -Depth 20 -Compress\n`
  );
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', file], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `pwsh failed:\n${r.stderr}\n${r.stdout}`);
  const out = r.stdout.trim();
  return out ? JSON.parse(out) : null;
}

describe('Plan B', { skip: !hasPwsh && 'PowerShell 7 (pwsh) is not available' }, () => {
  test('every Plan B script parses', () => {
    const files = readdirSync(here).filter(f => f.endsWith('.ps1'));
    assert.ok(files.length >= 8, `expected the Plan B scripts, found ${files.join(', ')}`);
    const list = files.map(f => `'${path.join(here, f).replace(/'/g, "''")}'`).join(',');
    const errors = ps(`
      $bad = @()
      foreach ($f in @(${list})) {
        $tokens = $null; $errs = $null
        [System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$tokens, [ref]$errs) | Out-Null
        foreach ($e in @($errs)) { if ($e) { $bad += "$(Split-Path $f -Leaf): $($e.Message)" } }
      }
      , $bad`);
    assert.deepEqual(errors, []);
  });

  test('ports: rehearsal stays off every port another part of this PC uses; game night is the Pi set', () => {
    const r = ps(`
      $none = { param($p) $false }
      @{
        rehearsal = Get-PlanBPorts
        game = Get-PlanBPorts -GameNight
        rehearsalOk = Get-PortProblems (Get-PlanBPorts) -IsOpen $none
        gameOk = Get-PortProblems (Get-PlanBPorts -GameNight) -GameNight -IsOpen $none
        liveWithoutGameNight = Get-PortProblems (Get-PlanBPorts -GameNight) -IsOpen $none
        testServer = Get-PortProblems ([ordered]@{ Foundry = 30001; Control = 31614; Link = 31615; Dashboard = 3100 }) -IsOpen $none
        taken = Get-PortProblems (Get-PlanBPorts) -IsOpen { param($p) $p -eq 31614 }
        dup = Get-PortProblems ([ordered]@{ Foundry = 30100; Control = 30100; Link = 31615; Dashboard = 3300 }) -IsOpen $none
      }`);
    assert.deepEqual(r.rehearsal, { Foundry: 30100, Control: 31614, Link: 31615, Dashboard: 3300 });
    assert.deepEqual(r.game, { Foundry: 30000, Control: 31414, Link: 31415, Dashboard: 3000 });
    assert.deepEqual(r.rehearsalOk, []);
    assert.deepEqual(r.gameOk, []);
    assert.equal(
      r.liveWithoutGameNight.length,
      2,
      'control and link are live ports outside game night'
    );
    assert.match(r.liveWithoutGameNight[0], /live bridge/);
    assert.equal(r.testServer.length, 2);
    assert.match(r.testServer.join('\n'), /test server's Foundry/);
    assert.match(r.testServer.join('\n'), /test dashboard/);
    assert.equal(r.taken.length, 1);
    assert.match(r.taken[0], /Control port 31614 is in use/);
    assert.match(r.dup.join('\n'), /must all differ/);
  });

  test('newest backup: the newest snapshot that holds Foundry, or the one asked for', () => {
    const snaps = [
      {
        id: 'aaaa1111ffff',
        short_id: 'aaaa1111',
        time: '2026-10-08T04:30:07.1+02:00',
        paths: ['/etc/foundry-ai-tool', '/var/lib/foundry', '/var/lib/foundry-ai-tool'],
      },
      {
        id: 'bbbb2222ffff',
        short_id: 'bbbb2222',
        time: '2026-10-09T04:30:07.1+02:00',
        paths: ['/etc/foundry-ai-tool', '/var/lib/foundry', '/var/lib/foundry-ai-tool'],
      },
      // Newer, but without Foundry's data (a one-off backup of something else).
      {
        id: 'cccc3333ffff',
        short_id: 'cccc3333',
        time: '2026-10-09T10:00:00Z',
        paths: ['/etc/foundry-ai-tool'],
      },
      // The same instant as bbbb in another offset, but earlier: 02:00Z < 02:30Z.
      {
        id: 'dddd4444ffff',
        short_id: 'dddd4444',
        time: '2026-10-09T02:00:00Z',
        paths: ['/var/lib/foundry'],
      },
    ];
    const json = JSON.stringify(snaps).replace(/'/g, "''");
    const r = ps(`
      $s = '${json}' | ConvertFrom-Json
      @{
        latest = (Select-PlanBSnapshot $s).short_id
        short = (Select-PlanBSnapshot $s 'aaaa1111').short_id
        prefix = (Select-PlanBSnapshot $s 'aaaa11').short_id
        notFoundry = $null -eq (Select-PlanBSnapshot $s 'cccc3333')
        none = $null -eq (Select-PlanBSnapshot @() 'latest')
      }`);
    assert.deepEqual(r, {
      latest: 'bbbb2222',
      short: 'aaaa1111',
      prefix: 'aaaa1111',
      notFoundry: true,
      none: true,
    });
  });

  test('Foundry version must match the world exactly (no migration the Pi could not undo)', () => {
    const r = ps(`
      @{
        build = Get-FoundryBuild '{"name":"foundryvtt","version":"14.368.0"}'
        same = (Test-WorldVersion '14.368' '14.368').Ok
        sameLong = (Test-WorldVersion '14.368' '14.368.0').Ok
        newer = Test-WorldVersion '14.370' '14.368'
        older = (Test-WorldVersion '14.360' '14.368').Ok
        noApp = Test-WorldVersion $null '14.368'
        noCore = (Test-WorldVersion '14.368' '').Ok
      }`);
    assert.equal(r.build, '14.368');
    assert.equal(r.same, true);
    assert.equal(r.sameLong, true);
    assert.equal(r.newer.Ok, false);
    assert.match(r.newer.Message, /FoundryVTT-Node-14\.368/);
    assert.equal(r.older, false);
    assert.equal(r.noApp.Ok, false);
    assert.match(r.noApp.Message, /restore\.ps1/);
    assert.equal(r.noCore, false);
  });

  test('module port flag: set for a rehearsal, removed for game night, other flags kept', () => {
    const r = ps(`
      $plain = '{"id":"foundry-mcp-bridge","version":"0.21.0"}'
      $other = '{"id":"foundry-mcp-bridge","flags":{"foundry-mcp-bridge":{"defaultServerPort":31515,"keep":1},"x":{"y":2}}}'
      @{
        set = Set-ModulePortFlag $plain 31615 | ConvertFrom-Json
        cleared = Set-ModulePortFlag (Set-ModulePortFlag $plain 31615) $null | ConvertFrom-Json
        keep = Set-ModulePortFlag $other $null | ConvertFrom-Json
      }`);
    assert.equal(r.set.flags['foundry-mcp-bridge'].defaultServerPort, 31615);
    assert.equal(r.set.version, '0.21.0');
    assert.equal(r.cleared.flags, undefined, 'an empty flags object is removed');
    assert.deepEqual(r.keep.flags, { 'foundry-mcp-bridge': { keep: 1 }, x: { y: 2 } });
  });

  test("Foundry's options: port and no UPnP; the public name sets the proxy options; other options kept", () => {
    const r = ps(`
      $old = '{"port":30001,"cssTheme":"dark","upnp":true,"hostname":"play.example.com","proxySSL":true,"proxyPort":443}'
      @{
        tunnel = Update-FoundryOptions '' 30000 'C:/FoundryPlanB/data' 'plan-b.example.com' | ConvertFrom-Json
        local = Update-FoundryOptions $old 30100 'C:/FoundryPlanB/data' '' | ConvertFrom-Json
      }`);
    assert.deepEqual(
      {
        port: r.tunnel.port,
        upnp: r.tunnel.upnp,
        hostname: r.tunnel.hostname,
        proxySSL: r.tunnel.proxySSL,
        proxyPort: r.tunnel.proxyPort,
      },
      { port: 30000, upnp: false, hostname: 'plan-b.example.com', proxySSL: true, proxyPort: 443 }
    );
    assert.equal(r.local.port, 30100);
    assert.equal(r.local.cssTheme, 'dark');
    assert.equal(r.local.hostname, null);
    assert.equal(r.local.proxySSL, false);
    assert.equal(r.local.dataPath, 'C:/FoundryPlanB/data');
  });

  test('env file: comments, quotes and = in values', () => {
    const r = ps(
      `ConvertFrom-EnvText "# a comment\`nASSISTANT_GM_USER=Assistant GM\`n\`nASSISTANT_GM_PASSWORD='a=b c'\`nBAD LINE\`nQ=""x"""`
    );
    assert.deepEqual(r, {
      ASSISTANT_GM_USER: 'Assistant GM',
      ASSISTANT_GM_PASSWORD: 'a=b c',
      Q: 'x',
    });
  });

  test('stop decision: only our recorded process is stopped', () => {
    const marker = 'C:\\FoundryPlanB\\logs\\bridge.out.log';
    const cmd = `cmd.exe /d /s /c ""node.exe" "standalone.js" --port 31614 1>"${marker}" 2>"x" <nul"`;
    const t = '2026-10-09T20:00:00.0000000Z';
    const base = `@{ Exists = $true; StartTime = '${t}'; RecordedStart = '${t}'; CommandLine = '${cmd.replace(/'/g, "''")}'; Marker = '${marker}' }`;
    const r = ps(`
      function With($h, $k, $v) { $c = $h.Clone(); $c[$k] = $v; $c }
      $b = ${base}
      @{
        ours = (Resolve-PlanBStop $b).Action
        gone = (Resolve-PlanBStop (With $b 'Exists' $false)).Action
        reusedTime = (Resolve-PlanBStop (With $b 'StartTime' '2026-10-09T21:00:00Z')).Action
        jitter = (Resolve-PlanBStop (With $b 'StartTime' '2026-10-09T20:00:01Z')).Action
        other = (Resolve-PlanBStop (With $b 'CommandLine' 'C:\\Windows\\notepad.exe')).Action
        noCmd = (Resolve-PlanBStop (With $b 'CommandLine' $null)).Action
        noTime = (Resolve-PlanBStop (With $b 'StartTime' $null)).Action
        caseless = (Resolve-PlanBStop (With $b 'Marker' '${marker.toLowerCase()}')).Action
        # state.json: ConvertFrom-Json turns the recorded ISO text into a DateTime (local text form;
        # with a day-first culture an invariant parse of it swapped day and month).
        roundTrip = & {
          $old = [Globalization.CultureInfo]::CurrentCulture
          try {
            [Globalization.CultureInfo]::CurrentCulture = [Globalization.CultureInfo]::GetCultureInfo('da-DK')
            $rt = ([pscustomobject]@{ started = '${t}' } | ConvertTo-Json | ConvertFrom-Json).started
            (Resolve-PlanBStop (With $b 'RecordedStart' $rt)).Action
          } finally { [Globalization.CultureInfo]::CurrentCulture = $old }
        }
      }`);
    assert.deepEqual(r, {
      ours: 'stop',
      gone: 'gone',
      reusedTime: 'reused',
      jitter: 'stop',
      other: 'reused',
      noCmd: 'unknown',
      noTime: 'unknown',
      caseless: 'stop',
      roundTrip: 'stop',
    });
  });

  test('clean decision: played data stays until it is back on the Pi; data with no restore is never ours', () => {
    const r = ps(`
      $played = [pscustomobject]@{ restoredAt = 'x'; played = $true; playedAt = '2026-12-06' }
      $rehearsal = [pscustomobject]@{ restoredAt = 'x'; played = $false }
      @{
        rehearsal = (Resolve-PlanBClean $rehearsal).Ok
        noState = Resolve-PlanBClean $null
        noStateNoData = (Resolve-PlanBClean $null -HasData $false).Ok
        cleaned = (Resolve-PlanBClean ([pscustomobject]@{ cleanedAt = 'x'; restoredAt = $null })).Ok
        cleanedNoData = (Resolve-PlanBClean ([pscustomobject]@{ cleanedAt = 'x'; restoredAt = $null }) -HasData $false).Ok
        noStatePushed = (Resolve-PlanBClean $null -PushedBack).Ok
        played = Resolve-PlanBClean $played
        pushed = (Resolve-PlanBClean $played -PushedBack).Ok
      }`);
    assert.equal(r.rehearsal, true);
    assert.equal(
      r.noState.Ok,
      false,
      'a folder with data and no state.json (for example -Root C:\\FoundryTest) is not deleted'
    );
    assert.match(r.noState.Message, /no Plan B restore/);
    assert.equal(r.noStateNoData, true);
    assert.equal(r.cleaned, false);
    assert.equal(r.cleanedNoData, true);
    assert.equal(r.noStatePushed, false, '-PushedBack does not open a folder that is not ours');
    assert.equal(r.played.Ok, false);
    assert.match(r.played.Message, /2026-12-06/);
    assert.match(r.played.Message, /-PushedBack/);
    assert.equal(r.pushed, true);
  });

  test('root: never a drive root, the home folder, the test server or the repo, nor one that holds them', () => {
    const r = ps(`
      $b = Join-Path ([System.IO.Path]::GetTempPath()) 'plan-b-roots'
      $t = Join-Path $b 'FoundryTest'
      $sep = [System.IO.Path]::DirectorySeparatorChar
      @{
        planB = (Test-PlanBRoot (Join-Path $b 'FoundryPlanB') @($t)).Ok
        drive = (Test-PlanBRoot ([System.IO.Path]::GetPathRoot($HOME)) @($t)).Ok
        testServer = (Test-PlanBRoot $t @($t)).Ok
        inside = (Test-PlanBRoot (Join-Path $t 'data') @($t)).Ok
        insideCase = (Test-PlanBRoot ($t.ToLowerInvariant() + $sep + 'Data' + $sep) @($t)).Ok
        holds = (Test-PlanBRoot (Split-Path $HOME) @()).Ok
        home = (Test-PlanBRoot $HOME @()).Ok
        underHome = (Test-PlanBRoot (Join-Path $HOME 'plan-b') @()).Ok
        repo = (Test-PlanBRoot (Join-Path $PlanBRepoRoot 'x') @()).Ok
        sibling = (Test-PlanBRoot (Join-Path $b 'FoundryTestCopy') @($t)).Ok
        empty = (Test-PlanBRoot '' @()).Ok
        layout = $(try { Get-PlanBLayout $HOME | Out-Null; 'ok' } catch { 'refused' })
      }`);
    assert.deepEqual(r, {
      planB: true,
      drive: false,
      testServer: false,
      inside: false,
      insideCase: false,
      holds: false,
      home: false,
      underHome: true,
      repo: false,
      sibling: true,
      empty: false,
      layout: 'refused',
    });
  });

  test('Pi down (D-119): an answer always refuses; no Tailscale counts only with -PiUnplugged', () => {
    const r = ps(`
      @{
        down = (Resolve-PiDown @() 'online').Ok
        answers = Resolve-PiDown @('192.168.1.191') 'online'
        answersUnplugged = (Resolve-PiDown @('100.110.82.102') 'offline' -PiUnplugged).Ok
        offline = Resolve-PiDown @() 'offline'
        missing = Resolve-PiDown @() 'missing'
        unplugged = (Resolve-PiDown @() 'offline' -PiUnplugged).Ok
      }`);
    assert.equal(r.down, true);
    assert.equal(r.answers.Ok, false);
    assert.match(r.answers.Message, /192\.168\.1\.191/);
    assert.equal(r.answersUnplugged, false);
    assert.equal(r.offline.Ok, false);
    assert.match(r.offline.Message, /-PiUnplugged/);
    assert.equal(r.missing.Ok, false);
    assert.match(r.missing.Message, /not installed/);
    assert.equal(r.unplugged, true);
  });

  test('start: the services that never listened make it fail', () => {
    const r = ps(`
      @{
        none = (Get-PlanBDeadServices ([ordered]@{ foundry = $true; bridge = $true })).Count
        some = Get-PlanBDeadServices ([ordered]@{ foundry = $true; bridge = $false; dashboard = $false })
      }`);
    assert.equal(r.none, 0);
    assert.deepEqual(r.some, ['bridge', 'dashboard']);
  });

  test('connector switch: only the two values change, the rest of the file stays byte for byte', () => {
    const config = [
      '{',
      '  "mcpServers": {',
      '    "foundry-mcp": {',
      '      "command": "C:\\\\Program Files\\\\x\\\\node.exe",',
      '      "env": { "FOUNDRY_AI_TOOL_SETS": "core", "MCP_CONTROL_HOST": "100.110.82.102", "MCP_CONTROL_PORT": "31414", "MCP_NO_SPAWN": "1" }',
      '    },',
      '    "foundry-mcp-play": {',
      '      "env": {',
      '        "MCP_CONTROL_HOST":"100.110.82.102",',
      '        "MCP_CONTROL_PORT": "31414"',
      '      }',
      '    }',
      '  },',
      '  "preferences": { "x": 1 }',
      '}',
    ].join('\r\n');
    const file = path.join(tmp, 'claude_desktop_config.json');
    writeFileSync(file, config);
    const f = file.replace(/'/g, "''");
    const r = ps(`
      $t = [System.IO.File]::ReadAllText('${f}')
      $s = Set-ConnectorTarget $t '127.0.0.1' 31614
      $back = Set-ConnectorTarget $s.Text '100.110.82.102' 31414
      $bad = $false
      try { Set-ConnectorTarget $t 'evil" , "x' 1 | Out-Null } catch { $bad = $true }
      @{
        before = Get-ConnectorTarget $t
        after = Get-ConnectorTarget $s.Text
        changed = $s.Changed
        roundTrip = $back.Text -ceq $t
        valid = $null -ne ($s.Text | ConvertFrom-Json)
        refusesBadHost = $bad
        none = (Get-ConnectorTarget '{"mcpServers":{}}').Count
        spawn = Get-ConnectorsThatSpawn $t
        spawnTrue = Get-ConnectorsThatSpawn '{"mcpServers":{"a":{"env":{"MCP_CONTROL_HOST":"x","MCP_NO_SPAWN":" TRUE "}},"b":{"env":{"OTHER":"1"}}}}'
      }`);
    assert.deepEqual(r.before, { Host: '100.110.82.102', Port: 31414, Count: 2 });
    assert.deepEqual(r.after, { Host: '127.0.0.1', Port: 31614, Count: 2 });
    assert.equal(r.changed, 2);
    assert.equal(r.roundTrip, true);
    assert.equal(r.valid, true);
    assert.equal(r.refusesBadHost, true);
    assert.equal(r.none, 0);
    assert.deepEqual(
      r.spawn,
      ['foundry-mcp-play'],
      'the connector without MCP_NO_SPAWN=1 is named'
    );
    assert.deepEqual(r.spawnTrue, []);
  });

  test('the restore never brings back the Pi licence or other secrets', () => {
    const r = ps(`, $PlanBRestoreIncludes`);
    assert.ok(r.includes('/var/lib/foundry/Data'));
    assert.ok(r.includes('/etc/foundry-ai-tool/assistant-gm.env'));
    assert.ok(
      !r.some(p => p === '/var/lib/foundry' || p.startsWith('/var/lib/foundry/Config')),
      'not the Pi Config (licence)'
    );
    assert.ok(
      !r.some(p => p === '/etc/foundry-ai-tool' || /restic|discord|world-.*\.env/.test(p)),
      'no other secrets'
    );
  });
});
