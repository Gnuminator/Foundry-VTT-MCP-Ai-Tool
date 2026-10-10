# Shared settings for the local test environment (dot-source this file).
#
# A personal-only test setup, separate from the live campaign in every way. Two test servers
# share this PC's Foundry install and licence (scripts/test-env/servers.json has their ports):
#   server A (the default, quick checks and live:roundtrip)
#     Foundry (Node.js build)  http://localhost:30001, data C:\FoundryTest\data
#     test bridge              control 31514, Foundry link 31515
#     co-GM dashboard          http://localhost:3100
#   server B (kit runs and soak runs; npm run kit:run uses it)
#     Foundry                  http://localhost:30002, data C:\FoundryTestB\data
#     test bridge              control 31524, Foundry link 31525
#     co-GM dashboard          http://localhost:3101
#   bridge vault               <Root>/vault; the lock is <Root>/lock.json, one per server
# The live bridge ports 31414-31416 are never used; every script refuses to run
# if a test port collides with them or with the other server's ports.
#
# Which server: the calling script's -Server A|B (a $Server variable in the scope that
# dot-sources this file), else the environment variable FOUNDRY_TEST_SERVER, else A.
# Override any value in scripts/test-env/local.json (server A) or local.B.json (server B), both
# gitignored, e.g.
#   { "Root": "D:\\FoundryTest", "FoundryPort": 30003 }
# Server B runs A's Foundry install (AppDir) unless local.B.json names another, and uses A's
# AdminUser/AdminPassword unless local.B.json has its own (its admin.txt is a copy of A's).
# Works with PowerShell 7 on Windows and Linux (for the later Orange Pi move).

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
$LivePorts = @(31414, 31415, 31416)

$TestServers = Get-Content (Join-Path $PSScriptRoot 'servers.json') -Raw | ConvertFrom-Json
$TestServerName = 'A'
$serverChoice = Get-Variable -Name Server -ValueOnly -ErrorAction SilentlyContinue
if ($serverChoice) { $TestServerName = [string]$serverChoice }
elseif ($env:FOUNDRY_TEST_SERVER) { $TestServerName = [string]$env:FOUNDRY_TEST_SERVER }
$TestServerName = $TestServerName.Trim().ToUpperInvariant()
if (-not $TestServerName -or -not $TestServers.PSObject.Properties[$TestServerName]) {
  throw "Unknown test server '$TestServerName' (scripts/test-env/servers.json has $(@($TestServers.PSObject.Properties.Name) -join ', '))."
}

# The settings of one server: its servers.json entry, then its local file.
function Get-TestServerSettings([string]$Name) {
  $def = $TestServers.$Name
  $s = [ordered]@{
    Root          = if ($IsWindows) { [string]$def.Root } else { Join-Path $HOME ([string]$def.HomeRoot) }
    # The Foundry Node.js build. Default: <Root>/app for A; A's AppDir for the other servers.
    AppDir        = $null
    WorldId       = 'ai-tool-test'
    FoundryPort   = [int]$def.FoundryPort
    ControlPort   = [int]$def.ControlPort
    LinkPort      = [int]$def.LinkPort
    DashboardPort = [int]$def.DashboardPort
    # Throwaway Obsidian vault the test bridge renders notes into (never the GM's
    # vault). Empty string = Obsidian auto-render off. Default: <Root>/obsidian.
    ObsidianDir   = $null
    # Optional: this test server's own admin login, for setup-screen tasks
    # (install packages, create worlds). Only ever put a password here that is
    # used for nothing else. Never printed by the scripts; local.json is gitignored.
    AdminUser     = $null
    AdminPassword = $null
  }
  $file = Join-Path $PSScriptRoot $(if ($Name -eq 'A') { 'local.json' } else { "local.$Name.json" })
  if (Test-Path $file) {
    $local = Get-Content $file -Raw | ConvertFrom-Json
    foreach ($p in $local.PSObject.Properties) {
      if ($p.Name -eq 'WebrtcPort') { continue }  # retired setting (WebRTC was removed); ignore an old local.json
      if (-not $s.Contains($p.Name)) { throw "Unknown setting '$($p.Name)' in $file" }
      $s[$p.Name] = $p.Value
    }
  }
  return $s
}

$settingsA = Get-TestServerSettings 'A'
if (-not $settingsA.AppDir) { $settingsA.AppDir = Join-Path $settingsA.Root 'app' }
$settings = if ($TestServerName -eq 'A') { $settingsA } else { Get-TestServerSettings $TestServerName }
if (-not $settings.AppDir) { $settings.AppDir = $settingsA.AppDir }
if (-not $settings.AdminPassword -and $settingsA.AdminPassword) {
  $settings.AdminUser = $settingsA.AdminUser
  $settings.AdminPassword = $settingsA.AdminPassword
}
# The other servers' ports: a server must never take one of them.
$OtherServerPorts = @()
foreach ($name in @($TestServers.PSObject.Properties.Name | Where-Object { $_ -ne $TestServerName })) {
  $o = if ($name -eq 'A') { $settingsA } else { Get-TestServerSettings $name }
  $OtherServerPorts += @([int]$o.FoundryPort, [int]$o.ControlPort, [int]$o.LinkPort, [int]$o.DashboardPort)
}

$TestEnv = [pscustomobject]@{
  Server        = $TestServerName
  # What to add to a script's command line so it acts on this server ('' for A, the default).
  ServerArg     = if ($TestServerName -eq 'A') { '' } else { " -Server $TestServerName" }
  Root          = $settings.Root
  AppDir        = [string]$settings.AppDir
  DataDir       = Join-Path $settings.Root 'data'
  VaultDir      = Join-Path $settings.Root 'vault'
  LogDir        = Join-Path $settings.Root 'logs'
  WorldId       = [string]$settings.WorldId
  FoundryPort   = [int]$settings.FoundryPort
  ControlPort   = [int]$settings.ControlPort
  LinkPort      = [int]$settings.LinkPort
  DashboardPort = [int]$settings.DashboardPort
  ObsidianDir   = if ($null -eq $settings.ObsidianDir) { Join-Path $settings.Root 'obsidian' } else { [string]$settings.ObsidianDir }
}
$TestEnv | Add-Member NoteProperty ModuleDir (Join-Path $TestEnv.DataDir 'Data' 'modules' 'foundry-mcp-bridge')
$TestEnv | Add-Member NoteProperty PidFile (Join-Path $TestEnv.LogDir 'pids.json')

# The test server's admin login from local.json, or $null. Callers must never
# print it or pass it on the command line.
function Get-TestAdminCredential {
  if (-not $settings.AdminPassword) { return $null }
  return [pscustomobject]@{ User = [string]$settings.AdminUser; Password = [string]$settings.AdminPassword }
}

function Assert-SafePorts {
  $ports = @($TestEnv.FoundryPort, $TestEnv.ControlPort, $TestEnv.LinkPort, $TestEnv.DashboardPort)
  foreach ($port in $ports) {
    if ($LivePorts -contains $port) { throw "Test port $port is a live bridge port (31414-31416). Pick another in local.json." }
    if ($OtherServerPorts -contains $port) { throw "Test port $port belongs to another test server (servers.json). Pick another in this server's local file." }
  }
  if (($ports | Select-Object -Unique).Count -ne $ports.Count) { throw 'Test ports must all be different.' }
}

# The repo's Node: the newest portable Node 22 in %LOCALAPPDATA%\node22\node-v22.x.y-win-x64
# (the version differs per PC), else the node on PATH.
function Get-NodeExe {
  $portableRoot = Join-Path $HOME 'AppData' 'Local' 'node22'
  if ($IsWindows -and (Test-Path $portableRoot)) {
    $portable = Get-ChildItem $portableRoot -Directory -Filter 'node-v22.*-win-x64' |
      Where-Object { $_.Name -match '^node-v(\d+\.\d+\.\d+)-' -and (Test-Path (Join-Path $_.FullName 'node.exe')) } |
      Sort-Object { [version]($_.Name -replace '^node-v(\d+\.\d+\.\d+)-.*$', '$1') } -Descending |
      Select-Object -First 1
    if ($portable) { return Join-Path $portable.FullName 'node.exe' }
  }
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { throw 'Node.js not found (need 22+; Foundry 14 needs 24).' }
  return $node.Source
}

function Get-NodeVersion([string]$Exe) {
  try {
    $text = (& $Exe --version 2>$null | Select-Object -First 1)
    if ($text -match '^v(\d+)\.(\d+)\.(\d+)') { return [version]"$($Matches[1]).$($Matches[2]).$($Matches[3])" }
  } catch { }
  return $null
}

# A Node that satisfies Foundry's own `engines.node` (e.g. ">=24.13.1 <25.0.0" for 14.368),
# which differs from the Node 22 the repo builds with. Checks PATH, then the default install.
function Get-FoundryNodeExe([string]$AppRoot) {
  $pkg = Join-Path $AppRoot 'package.json'
  $range = if (Test-Path $pkg) { (Get-Content $pkg -Raw | ConvertFrom-Json).engines.node } else { $null }
  $min = if ($range -match '>=\s*(\d+\.\d+\.\d+)') { [version]$Matches[1] } else { [version]'20.0.0' }
  $max = if ($range -match '<\s*(\d+\.\d+\.\d+)') { [version]$Matches[1] } else { $null }
  $candidates = @(Get-Command node -All -ErrorAction SilentlyContinue | ForEach-Object Source)
  if ($IsWindows) { $candidates += Join-Path $env:ProgramFiles 'nodejs' 'node.exe' }
  foreach ($exe in ($candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique)) {
    $v = Get-NodeVersion $exe
    if ($v -and $v -ge $min -and (-not $max -or $v -lt $max)) { return $exe }
  }
  throw "No Node.js matching Foundry's requirement '$range' found (install it; the repo's Node 22 is not used for Foundry)."
}

# The Foundry Node.js build: main.js at the root (v13+) or resources/app/main.js (older layouts).
function Find-FoundryMain {
  foreach ($candidate in @((Join-Path $TestEnv.AppDir 'main.js'), (Join-Path $TestEnv.AppDir 'resources' 'app' 'main.js'))) {
    if (Test-Path $candidate) { return $candidate }
  }
  return $null
}

# Foundry has no listen-address option (it listens on all interfaces), so on
# Windows only a firewall block rule keeps the test server off the network.
# Loopback traffic is not filtered, so the rule does not affect this PC.
$FirewallRuleName = 'Foundry test server (block network)'

function Test-FoundryFirewallBlock {
  if (-not $IsWindows) { return $null }
  $rules = Get-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue |
    Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Block' -and $_.Direction -eq 'Inbound' }
  foreach ($rule in @($rules)) {
    $ports = @(($rule | Get-NetFirewallPortFilter).LocalPort)
    if ($ports -contains [string]$TestEnv.FoundryPort) { return $true }
  }
  return $false
}

function Get-FirewallCommand {
  "New-NetFirewallRule -DisplayName '$FirewallRuleName' -Direction Inbound -Protocol TCP -LocalPort $($TestEnv.FoundryPort) -Action Block"
}

# Whether something accepts TCP connections on 127.0.0.1:<port> (cross-platform).
function Test-PortOpen([int]$Port) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $task = $client.ConnectAsync('127.0.0.1', $Port)
    return ($task.Wait(300) -and $client.Connected)
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

# The pids of the processes listening on <port> (every address: a service may listen on more than
# one), empty when nothing listens or it cannot be told. stop.ps1 kills a recorded pid only when it
# is one of these listeners or its command line shows the service we started: a pid from an old
# pids.json may have been reused by another process (another session's node, Claude Desktop's
# backend).
function Get-PortOwners([int]$Port) {
  try {
    if ($IsWindows) {
      $conns = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop)
      return @($conns | ForEach-Object { [int]$_.OwningProcess } | Sort-Object -Unique)
    }
    $out = @(& lsof -t -iTCP:$Port -sTCP:LISTEN 2>$null)
    return @($out | Where-Object { $_ } | ForEach-Object { [int]$_ } | Sort-Object -Unique)
  } catch {
    return @()
  }
}

# The command line of a process, or $null when it cannot be read (gone, or no access).
function Get-ProcessCommandLine([int]$ProcessId) {
  try {
    if ($IsWindows) {
      $p = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
      if ($p -and $p.CommandLine) { return [string]$p.CommandLine }
      return $null
    }
    $raw = Get-Content "/proc/$ProcessId/cmdline" -Raw -ErrorAction Stop
    if ($raw) { return ($raw -replace "`0", ' ').Trim() }
    return $null
  } catch {
    return $null
  }
}

# The parent pid of a process, or $null.
function Get-ParentProcessId([int]$ProcessId) {
  try {
    if ($IsWindows) {
      $p = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
      if ($p) { return [int]$p.ParentProcessId }
      return $null
    }
    $out = & ps -o ppid= -p $ProcessId 2>$null
    if ($out) { return [int]("$out".Trim()) }
    return $null
  } catch {
    return $null
  }
}

# Whether a command line is the test service start.ps1 starts under that name (the script and, for
# Foundry and the bridge, the test port). A process of ours that is not (yet) on its port (Foundry
# still loading, a start that timed out) is still ours to stop.
function Test-OurServiceCommandLine([string]$Name, [string]$CommandLine) {
  if (-not $CommandLine) { return $false }
  switch ($Name) {
    'foundry'   { return ($CommandLine -match 'main\.js' -and $CommandLine -match "--port=$($TestEnv.FoundryPort)(\s|$)") }
    'bridge'    { return ($CommandLine -match 'standalone\.js' -and $CommandLine -match "--port\s+$($TestEnv.ControlPort)(\s|$)") }
    'dashboard' { return ($CommandLine -match 'cogm-dashboard[\\/]dist[\\/]server\.js') }
  }
  return $false
}

function Wait-PortOpen([int]$Port, [int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-PortOpen $Port) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

# pids.json: { "<service>": <pid> }. Only whole numbers, so every checkout on this PC can read it;
# anything else in the file is skipped.
function Read-Pids {
  if (Test-Path $TestEnv.PidFile) {
    $h = @{}
    (Get-Content $TestEnv.PidFile -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object {
      if ("$($_.Value)" -match '^\d+$') { $h[$_.Name] = [int]$_.Value }
    }
    return $h
  }
  return @{}
}

# pids.started.json, next to pids.json: { "<service>": { "pid": <pid>, "started": "<UTC ISO 8601>" } }.
# The start time tells a reused pid (after a reboot, or any other program) from the process we
# started. It counts only for the pid it was recorded with: an older checkout's start.ps1 and
# stop.ps1 never touch this file, so after they cycle a service the entry is stale, and stop.ps1
# must not compare it with the new pid. A service without an entry is judged by the port and the
# command line alone. A separate file, so older checkouts' Read-Pids never see it.
function Get-StartFile { return ($TestEnv.PidFile -replace '\.json$', '.started.json') }

# name -> @{ pid = <int>; started = <UTC ISO 8601 text> }. An entry of another shape (no pid, no
# started, a time that does not parse) is skipped, and a file that is not a JSON object (empty,
# broken, a list) is no entries: a damaged file must never stop start.ps1 or stop.ps1, which then
# judge the service by its port and command line alone.
function Read-Starts {
  $file = Get-StartFile
  if (-not (Test-Path $file)) { return @{} }
  $h = @{}
  try {
    $parsed = Get-Content $file -Raw | ConvertFrom-Json
  } catch {
    return @{}
  }
  if ($null -eq $parsed -or $parsed -isnot [pscustomobject]) { return @{} }
  foreach ($p in $parsed.PSObject.Properties) {
    $e = $p.Value
    if ($null -eq $e -or $e -isnot [pscustomobject]) { continue }
    $names = @($e.PSObject.Properties.Name)
    if (-not ($names -contains 'pid') -or -not ($names -contains 'started')) { continue }
    if (-not ("$($e.pid)" -match '^\d+$')) { continue }
    # ConvertFrom-Json turns an ISO 8601 text into a DateTime: keep the instant, as UTC text.
    try { $started = ConvertTo-UtcInstant $e.started } catch { continue }
    if ($started) { $h[$p.Name] = @{ pid = [int]$e.pid; started = $started } }
  }
  return $h
}

function Write-Starts([hashtable]$Starts) {
  New-Item -ItemType Directory -Force $TestEnv.LogDir | Out-Null
  $out = @{}
  foreach ($k in $Starts.Keys) {
    $e = $Starts[$k]
    $started = ConvertTo-UtcInstant $e.started
    if ($started -and "$($e.pid)" -match '^\d+$') { $out[$k] = @{ pid = [int]$e.pid; started = $started } }
  }
  $out | ConvertTo-Json | Set-Content (Get-StartFile)
}

# The recorded start time of a service, when it was recorded for this very pid; else $null.
function Get-RecordedStart([hashtable]$Starts, [string]$Name, [int]$ProcessId) {
  if (-not $Starts.ContainsKey($Name)) { return $null }
  $e = $Starts[$Name]
  if ([int]$e.pid -ne $ProcessId) { return $null }
  return $e.started
}

# A point in time as UTC ISO 8601 text ('o'), from a DateTime or an ISO 8601 text; $null when empty.
function ConvertTo-UtcInstant($Value) {
  if ($null -eq $Value -or $Value -eq '') { return $null }
  if ($Value -is [DateTime]) { return $Value.ToUniversalTime().ToString('o') }
  if ($Value -is [DateTimeOffset]) { return $Value.UtcDateTime.ToString('o') }
  return [DateTime]::Parse([string]$Value, [Globalization.CultureInfo]::InvariantCulture, 'RoundtripKind').ToUniversalTime().ToString('o')
}

# The start time of a process as ISO 8601 text, or $null when it cannot be read.
function Get-ProcessStartTime([int]$ProcessId) {
  try {
    $p = Get-Process -Id $ProcessId -ErrorAction Stop
    return ConvertTo-UtcInstant $p.StartTime
  } catch {
    return $null
  }
}

# What stop.ps1 does with one recorded pid, from facts alone (no process is touched here, so the
# table is unit-tested: scripts/test-env/stop-decision.cases.ps1). The facts:
#   Name           the service (foundry, bridge, dashboard)
#   ProcessId      the recorded pid
#   Exists         whether a process with that pid runs
#   ProcessName    its name (node, cmd, pwsh, ...)
#   StartTime      its start time (ISO 8601) or $null when it cannot be read
#   RecordedStart  the start time pids.started.json recorded, or $null (none, or an older checkout
#                  cycled the service since: see Get-RecordedStart)
#   RecordedStartPid  the pid that start time was recorded with (when given, the time counts only
#                  when it equals ProcessId)
#   Owners         the pids listening on the service's port
#   CommandLine    the process's command line, or $null when it cannot be read
#   ChildNode      for a cmd.exe wrapper: the pid of its node child whose command line is ours, $null
#                  when it has none, 'unknown' when the lookup failed
# The answer: Action = none | stop | stop-wrapper | refuse | refuse-keep, and Message.
#   none          nothing to stop; the pid is forgotten
#   stop          our process: stop it
#   stop-wrapper  our cmd.exe wrapper (start.ps1 could not find node's pid): stop ChildNode, then it
#   refuse        not ours, and it holds our port: stderr, exit 1, the pid is forgotten
#   refuse-keep   cannot tell (no command line, nothing on the port): stderr, exit 1, the pid is kept
function Resolve-StopAction([hashtable]$F) {
  $who = "the recorded pid $($F.ProcessId) ($($F.ProcessName))"
  if (-not $F.Exists) { return @{ Action = 'none'; Message = 'not running' } }
  $recordedText = ConvertTo-UtcInstant $F.RecordedStart
  if ($recordedText -and $F.ContainsKey('RecordedStartPid') -and $null -ne $F.RecordedStartPid -and [int]$F.RecordedStartPid -ne [int]$F.ProcessId) {
    $recordedText = $null # recorded for another pid: an older checkout cycled the service since
  }
  $actualText = ConvertTo-UtcInstant $F.StartTime
  $timeUnknown = $false
  if ($recordedText -and $actualText) {
    $recorded = [DateTime]::Parse($recordedText, [Globalization.CultureInfo]::InvariantCulture, 'RoundtripKind')
    $actual = [DateTime]::Parse($actualText, [Globalization.CultureInfo]::InvariantCulture, 'RoundtripKind')
    if ([Math]::Abs(($actual - $recorded).TotalSeconds) -gt 2) {
      return @{ Action = 'none'; Message = "not running (pid $($F.ProcessId) was reused by $($F.ProcessName), started at another time)" }
    }
  } elseif ($recordedText) {
    # A start time was recorded but the process's cannot be read (access denied): the command line
    # alone no longer vouches for it; only the port does.
    $timeUnknown = $true
  }
  $isNode = $F.ProcessName -match '^node'
  $isCmd = $F.ProcessName -match '^cmd'
  $ours = (-not $timeUnknown) -and (Test-OurServiceCommandLine $F.Name $F.CommandLine)
  $onPort = @($F.Owners) -contains [int]$F.ProcessId
  if ($isNode -and ($onPort -or $ours)) { return @{ Action = 'stop'; Message = 'ours' } }
  $reused = @{ Action = 'none'; Message = "not running (pid $($F.ProcessId) is now $($F.ProcessName), not the service we started)" }
  if ($timeUnknown -and -not $onPort) {
    # Our services are node under a cmd.exe wrapper: anything else holding the pid is a reuse.
    if (-not ($isNode -or $isCmd)) { return $reused }
    return @{ Action = 'refuse-keep'; Message = "REFUSED: $($F.Name) : $who has a recorded start time that cannot be checked (its start time is not readable) and it listens on nothing, so it is left alone. Check it with Get-Process -Id $($F.ProcessId) and run stop.ps1 again; the pid is kept." }
  }
  if ($isCmd -and $ours) {
    if ("$($F.ChildNode)" -eq 'unknown') {
      return @{ Action = 'refuse-keep'; Message = "REFUSED: $($F.Name) : $who is our cmd.exe wrapper, but its node child could not be looked up (the process query failed), so nothing is stopped: a kill of the wrapper alone would leave the child running. Run stop.ps1 again; the pid is kept." }
    }
    if ($F.ChildNode) { return @{ Action = 'stop-wrapper'; Message = "the cmd.exe wrapper and its node child (pid $($F.ChildNode))" } }
    return @{ Action = 'stop'; Message = 'the cmd.exe wrapper (its node child is gone)' }
  }
  if ($onPort) {
    return @{ Action = 'refuse'; Message = "REFUSED: $($F.Name) : $who holds port $($F.Port) but is not the service we started; nothing stopped. If that is yours, stop it yourself; the stale pid is forgotten." }
  }
  if ($F.CommandLine) { return $reused }
  if (-not ($isNode -or $isCmd)) { return $reused }
  return @{ Action = 'refuse-keep'; Message = "REFUSED: $($F.Name) : $who listens on nothing and its command line cannot be read, so it is left alone (it may still be ours, loading). Check it with Get-Process -Id $($F.ProcessId) and run stop.ps1 again; the pid is kept." }
}

# The test server lock, <Root>/lock.json (written only by lock.ps1, which serialises its writes):
#   { holder, session, since, purpose, queue: [ { holder, session, since, purpose } ] }
# Returns Holder, Session, Since (UTC ISO 8601 text), Purpose and Queue (a list of the same four
# fields); a missing file is a free lock with an empty queue. A file that cannot be read as a
# lock sets Unreadable: lock.ps1 then refuses take and queue without -Force, so a damaged file is
# never silently treated as free.
function Read-TestLock([string]$Root = $TestEnv.Root) {
  $lock = [pscustomobject]@{ Holder = $null; Session = $null; Since = $null; Purpose = $null; Queue = @(); Unreadable = $false }
  $file = Join-Path $Root 'lock.json'
  if (-not (Test-Path $file)) { return $lock }
  try {
    $parsed = Get-Content $file -Raw | ConvertFrom-Json
  } catch {
    $lock.Unreadable = $true
    return $lock
  }
  if ($null -eq $parsed -or $parsed -isnot [pscustomobject]) {
    $lock.Unreadable = $true
    return $lock
  }
  $field = {
    param($o, [string]$name)
    $p = $o.PSObject.Properties[$name]
    if ($null -eq $p -or $null -eq $p.Value -or "$($p.Value)" -eq '') { return $null }
    if ($name -eq 'since') { try { return ConvertTo-UtcInstant $p.Value } catch { return $null } }
    return [string]$p.Value
  }
  $lock.Holder = & $field $parsed 'holder'
  $lock.Session = & $field $parsed 'session'
  $lock.Since = & $field $parsed 'since'
  $lock.Purpose = & $field $parsed 'purpose'
  $queue = @()
  $qp = $parsed.PSObject.Properties['queue']
  if ($qp -and $null -ne $qp.Value) {
    foreach ($e in @($qp.Value)) {
      if ($null -eq $e -or $e -isnot [pscustomobject]) { continue }
      $queue += [pscustomobject]@{
        Holder = & $field $e 'holder'; Session = & $field $e 'session'
        Since = & $field $e 'since'; Purpose = & $field $e 'purpose'
      }
    }
  }
  $lock.Queue = $queue
  return $lock
}

# Whole minutes since a UTC ISO 8601 text, or $null.
function Get-LockMinutes([string]$Since) {
  if (-not $Since) { return $null }
  try {
    $t = [DateTime]::Parse($Since, [Globalization.CultureInfo]::InvariantCulture, 'RoundtripKind').ToUniversalTime()
    return [int][Math]::Max(0, [Math]::Floor(([DateTime]::UtcNow - $t).TotalMinutes))
  } catch {
    return $null
  }
}

# One line for status.ps1: "free" or "held by <holder> since <since> (<N> min) for <purpose>",
# plus ", queue: N waiting" when somebody waits.
function Get-TestLockLine($Lock) {
  if ($Lock.Unreadable) { return 'lock.json cannot be read (lock.ps1 take -Force starts a fresh lock)' }
  $text = 'free'
  if ($Lock.Holder) {
    $mins = Get-LockMinutes $Lock.Since
    $text = "held by $($Lock.Holder) since $($Lock.Since)"
    if ($null -ne $mins) { $text += " ($mins min)" }
    if ($Lock.Purpose) { $text += " for $($Lock.Purpose)" }
    if (Test-LockOld $Lock.Since) { $text += ' (old: maybe a crashed session)' }
  }
  $waiting = @($Lock.Queue).Count
  if ($waiting -gt 0) { $text += ", queue: $waiting waiting" }
  return $text
}

# A holder or queue entry older than this is flagged: probably a crashed session.
$LockOldHours = 4
function Test-LockOld([string]$Since) {
  $mins = Get-LockMinutes $Since
  return ($null -ne $mins -and $mins -ge $LockOldHours * 60)
}

# What sync-module.ps1 -Watch does with a pending module change, from the lock alone: it syncs only
# while this session holds the lock, and it never takes the lock. Returns Action (sync | wait), Key
# (the same key means the same wait, so the watch says it once) and Message.
function Resolve-WatchSync($Lock, [string]$Session) {
  if ($Lock.Unreadable) {
    return @{ Action = 'wait'; Key = 'unreadable'; Message = 'Waiting: lock.json cannot be read, so nobody can tell who holds the test server (lock.ps1 status). Not synced.' }
  }
  if ($Lock.Holder -and $Lock.Session -eq $Session) {
    return @{ Action = 'sync'; Key = 'mine'; Message = 'This session holds the lock.' }
  }
  if ($Lock.Holder) {
    $since = if ($Lock.Since) { " since $($Lock.Since)" } else { '' }
    $mins = Get-LockMinutes $Lock.Since
    if ($null -ne $mins) { $since += " ($mins min)" }
    $for = if ($Lock.Purpose) { " for $($Lock.Purpose)" } else { '' }
    return @{ Action = 'wait'; Key = "other:$($Lock.Session)"; Message = "Waiting: the test server lock is held by $($Lock.Holder) (session $($Lock.Session))$since$for. Not synced; the change syncs once this session holds the lock." }
  }
  return @{ Action = 'wait'; Key = 'free'; Message = "Waiting: the test server lock is free, but this session does not hold it. Not synced; take it with: pwsh scripts/test-env/lock.ps1 take$($TestEnv.ServerArg) -Holder `"<session title>`" -Session $Session -Purpose `"...`" (the watch never takes it)." }
}

function Write-Pids([hashtable]$Pids) {
  New-Item -ItemType Directory -Force $TestEnv.LogDir | Out-Null
  $Pids | ConvertTo-Json | Set-Content $TestEnv.PidFile
}
