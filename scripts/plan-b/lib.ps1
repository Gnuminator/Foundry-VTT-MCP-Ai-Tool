# Shared settings and functions for Plan B (dot-source this file): Foundry on this PC from the
# Pi's newest backup, when the Pi is down on game night (D-097 decision 6; runbook
# docs/dev/PLAN-B.md).
#
# Everything lives under one root (default C:\FoundryPlanB), apart from the test server
# (C:\FoundryTest) and the real worlds on the Pi:
#   <Root>\app           Foundry's Node.js build, the same version as the Pi's
#   <Root>\data          Foundry's data path: Data\ from the backup, Config\ of its own
#   <Root>\tool          the bridge vault and the dashboard state from the backup
#   <Root>\secrets       the Assistant GM login from the backup (readable by you only)
#   <Root>\logs          service logs
#   <Root>\staging       restic restores land here first
#   <Root>\state.json    what restore.ps1 and start.ps1 did (mode, snapshot, pids)
#
# Two port sets. Rehearsal (the default) never touches a port another part of this PC uses.
# Game night (-GameNight) uses the Pi's own ports, so the restored world, the module, the
# Assistant GM and the spare tunnel's route need no changes.
#
# The functions above the "processes" line are pure (no files, no network) and are tested by
# scripts/plan-b/plan-b.test.mjs.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$PlanBRepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
$PlanBModuleId = 'foundry-mcp-bridge'

$PlanBDefaults = [ordered]@{
  Root     = if ($IsWindows) { 'C:\FoundryPlanB' } else { Join-Path $HOME 'foundry-plan-b' }
  World    = 'curse-of-strahd'
  Repo     = 'E:\PiBackup\restic'
  PassFile = if ($env:APPDATA) { Join-Path $env:APPDATA 'foundry-ai-tool' 'restic-pc.pass' } else { '' }
  # Where the Pi answers when it is up (Tailscale name and address); start.ps1 -GameNight refuses
  # while Foundry answers on one of them, so two copies of the world never run at once.
  PiAddresses = @('foundry-pi.tailf949aa.ts.net', '100.110.82.102')
  # The test server's licence: bound to this PC's host name, so it works for Plan B too (the
  # Pi's own licence is bound to the Pi). Only read, never changed.
  LicenseFrom = if ($IsWindows) { 'C:\FoundryTest\data\Config\license.json' } else { '' }
  TunnelTokenFile = if ($env:APPDATA) { Join-Path $env:APPDATA 'foundry-ai-tool' 'plan-b-tunnel.token' } else { '' }
}

# The ports per mode. Game night = the Pi's (stage 3 and 5): Foundry 30000, bridge control 31414,
# Foundry link 31415, dashboard 3000.
function Get-PlanBPorts([switch]$GameNight) {
  if ($GameNight) {
    return [ordered]@{ Foundry = 30000; Control = 31414; Link = 31415; Dashboard = 3000 }
  }
  return [ordered]@{ Foundry = 30100; Control = 31614; Link = 31615; Dashboard = 3300 }
}

# Ports other parts of this PC own. The live bridge ports belong to Plan B only on game night.
# A plain hashtable: an ordered one reads an int index as a position.
$PlanBReservedPorts = @{
  30001 = 'the test server''s Foundry'
  31514 = 'the test bridge'
  31515 = 'the test bridge''s Foundry link'
  31516 = 'the test bridge'
  3100  = 'the test dashboard'
  3200  = 'the project dashboard'
  31414 = 'the live bridge (Plan B uses it only with -GameNight)'
  31415 = 'the live bridge (Plan B uses it only with -GameNight)'
  31416 = 'the live bridge (Plan B uses it only with -GameNight)'
}

# Why these ports cannot be used, as one line each; empty when they can. IsOpen is a scriptblock
# that takes a port and says whether something listens there already.
function Get-PortProblems($Ports, [switch]$GameNight, [scriptblock]$IsOpen) {
  $problems = [System.Collections.Generic.List[string]]::new()
  $values = @($Ports.Values | ForEach-Object { [int]$_ })
  if (($values | Select-Object -Unique).Count -ne $values.Count) {
    $problems.Add("the ports must all differ: $($values -join ', ')")
  }
  foreach ($name in $Ports.Keys) {
    $port = [int]$Ports[$name]
    $isLive = $port -in 31414, 31415, 31416
    if ($PlanBReservedPorts.ContainsKey($port) -and -not ($GameNight -and $isLive)) {
      $problems.Add("$name port $port belongs to $($PlanBReservedPorts[$port])")
      continue
    }
    if ($IsOpen -and (& $IsOpen $port)) {
      $problems.Add("$name port $port is in use by another program (find it: Get-NetTCPConnection -LocalPort $port -State Listen)")
    }
  }
  return , $problems.ToArray()
}

# The snapshot to restore from `restic snapshots --json`: the given id (full or short), or the
# newest one that backed up Foundry's data. $null when there is none.
function Select-PlanBSnapshot($Snapshots, [string]$Want = 'latest', [string]$RequiredPath = '/var/lib/foundry') {
  $usable = @($Snapshots | Where-Object { $_ -and (@($_.paths) -contains $RequiredPath) })
  if ($Want -and $Want -ne 'latest') {
    return @($usable | Where-Object { $_.id -eq $Want -or $_.short_id -eq $Want -or $_.id.StartsWith($Want) }) | Select-Object -First 1
  }
  return $usable | Sort-Object { [datetimeoffset]$_.time } -Descending | Select-Object -First 1
}

# What restic restores for Plan B: Foundry's data, the bridge vault, the dashboard state and the
# Assistant GM login. Not the Pi's Foundry Config (its licence is bound to the Pi), not the other
# secrets in /etc/foundry-ai-tool (Discord token, restic password), not the Assistant GM's browser.
$PlanBRestoreIncludes = @(
  '/var/lib/foundry/Data',
  '/var/lib/foundry-ai-tool/vault',
  '/var/lib/foundry-ai-tool/dashboard',
  '/etc/foundry-ai-tool/assistant-gm.env'
)

function Get-PlanBLayout([string]$Root) {
  $layout = [ordered]@{
    Root      = $Root
    AppDir    = Join-Path $Root 'app'
    DataDir   = Join-Path $Root 'data'
    ToolDir   = Join-Path $Root 'tool'
    SecretsDir = Join-Path $Root 'secrets'
    LogDir    = Join-Path $Root 'logs'
    StagingDir = Join-Path $Root 'staging'
    StateFile = Join-Path $Root 'state.json'
  }
  $layout.WorldsDir = Join-Path $layout.DataDir 'Data' 'worlds'
  $layout.ModuleJson = Join-Path $layout.DataDir 'Data' 'modules' $PlanBModuleId 'module.json'
  $layout.OptionsFile = Join-Path $layout.DataDir 'Config' 'options.json'
  $layout.LicenseFile = Join-Path $layout.DataDir 'Config' 'license.json'
  $layout.VaultDir = Join-Path $layout.ToolDir 'vault'
  $layout.DashboardStateDir = Join-Path $layout.ToolDir 'dashboard'
  $layout.GmBrowserDir = Join-Path $layout.ToolDir 'gm-browser'
  $layout.AssistantEnv = Join-Path $layout.SecretsDir 'assistant-gm.env'
  return [pscustomobject]$layout
}

# Foundry's version from its package.json text ("14.368.0"), as generation.build ("14.368").
function Get-FoundryBuild([string]$PackageJsonText) {
  $pkg = $PackageJsonText | ConvertFrom-Json
  $v = [string]$pkg.version
  if ($v -match '^(\d+)\.(\d+)') { return "$($Matches[1]).$($Matches[2])" }
  return $null
}

# Whether this Foundry may open the world: the same generation and build as the world was last
# opened with (world.json coreVersion). A newer Foundry would migrate the world, and the Pi could
# then not open it again; an older one refuses it.
function Test-WorldVersion([string]$AppBuild, [string]$WorldCoreVersion) {
  if (-not $AppBuild) { return @{ Ok = $false; Message = 'Foundry is not installed in the Plan B app folder (restore.ps1 installs it)' } }
  if (-not $WorldCoreVersion) { return @{ Ok = $false; Message = 'the world has no coreVersion in world.json' } }
  $world = if ($WorldCoreVersion -match '^(\d+)\.(\d+)') { "$($Matches[1]).$($Matches[2])" } else { $WorldCoreVersion }
  if ($world -eq $AppBuild) { return @{ Ok = $true; Message = "Foundry $AppBuild matches the world" } }
  return @{ Ok = $false; Message = "Foundry here is $AppBuild, the world was last opened with ${world}: install Foundry $world into the app folder (restore.ps1 -FoundryZip <FoundryVTT-Node-$world.zip>)" }
}

# The module manifest text with the default bridge port flag set (rehearsal) or removed (game
# night: the release default, 31415). The module reads the flag only while the world has no
# stored port (scripts/plan-b check.ps1 says when the link does not come up).
function Set-ModulePortFlag([string]$ModuleJsonText, $Port) {
  $m = $ModuleJsonText | ConvertFrom-Json -AsHashtable
  if (-not $m.Contains('flags') -or $null -eq $m.flags) { $m.flags = [ordered]@{} }
  if (-not $m.flags.Contains($PlanBModuleId) -or $null -eq $m.flags[$PlanBModuleId]) { $m.flags[$PlanBModuleId] = [ordered]@{} }
  if ($null -eq $Port) {
    $m.flags[$PlanBModuleId].Remove('defaultServerPort')
    if ($m.flags[$PlanBModuleId].Count -eq 0) { $m.flags.Remove($PlanBModuleId) }
    if ($m.flags.Count -eq 0) { $m.Remove('flags') }
  } else {
    $m.flags[$PlanBModuleId].defaultServerPort = [int]$Port
  }
  return ($m | ConvertTo-Json -Depth 20)
}

# Foundry's options.json text for Plan B: its port, no UPnP, and the public name when the spare
# tunnel is used (Foundry then builds invitation links with https://<name>, as on the Pi after
# Part C step 7). Keeps every other option that is already there.
function Update-FoundryOptions([string]$OptionsText, [int]$Port, [string]$DataPath, [string]$PublicHost) {
  $o = if ($OptionsText) { $OptionsText | ConvertFrom-Json -AsHashtable } else { [ordered]@{} }
  $o.port = $Port
  $o.dataPath = $DataPath
  $o.upnp = $false
  $o.updateChannel = 'stable'
  if ($PublicHost) {
    $o.hostname = $PublicHost
    $o.proxySSL = $true
    $o.proxyPort = 443
  } else {
    $o.hostname = $null
    $o.proxySSL = $false
    $o.proxyPort = $null
  }
  return ($o | ConvertTo-Json -Depth 10)
}

# KEY=VALUE lines (systemd EnvironmentFile style: # comments, optional quotes) as a hashtable.
function ConvertFrom-EnvText([string]$Text) {
  $h = @{}
  foreach ($line in ($Text -split "`r?`n")) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith('#')) { continue }
    $i = $t.IndexOf('=')
    if ($i -lt 1) { continue }
    $key = $t.Substring(0, $i).Trim()
    $value = $t.Substring($i + 1).Trim()
    if ($value.Length -ge 2 -and (($value[0] -eq '"' -and $value[-1] -eq '"') -or ($value[0] -eq "'" -and $value[-1] -eq "'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $h[$key] = $value
  }
  return $h
}

# A point in time as a UTC DateTime, from a DateTime, a DateTimeOffset or ISO 8601 text. A start time
# read back from state.json is a DateTime already (ConvertFrom-Json turns ISO text into one); its text
# form is in the local culture, so it must never go through [string] and an invariant parse.
function ConvertTo-PlanBUtc($Value) {
  if ($Value -is [datetime]) { return $Value.ToUniversalTime() }
  if ($Value -is [datetimeoffset]) { return $Value.UtcDateTime }
  return [datetime]::Parse([string]$Value, [Globalization.CultureInfo]::InvariantCulture, 'RoundtripKind').ToUniversalTime()
}

# What stop.ps1 does with one recorded service, from facts alone. start.ps1 records the pid of the
# wrapper shell it starts each service in, with the wrapper's start time; the wrapper's command
# line holds the service's own log file under <Root>\logs, which no other program has.
#   Exists          a process with the pid runs
#   StartTime       its start time (UTC ISO 8601), $null when it cannot be read
#   RecordedStart   the start time start.ps1 recorded
#   CommandLine     its command line, $null when it cannot be read
#   Marker          the service's log file path
# Action: gone (nothing to stop), stop (ours: stop it and its children), reused (another program has
# the pid now: forget it), unknown (cannot tell: leave it, keep the pid, say so).
function Resolve-PlanBStop([hashtable]$F) {
  if (-not $F.Exists) { return @{ Action = 'gone'; Message = 'not running' } }
  if ($F.StartTime -and $F.RecordedStart) {
    $a = ConvertTo-PlanBUtc $F.StartTime
    $r = ConvertTo-PlanBUtc $F.RecordedStart
    if ([math]::Abs(($a - $r).TotalSeconds) -gt 2) {
      return @{ Action = 'reused'; Message = 'not running (its pid now belongs to another program)' }
    }
  }
  if ($null -eq $F.CommandLine) {
    return @{ Action = 'unknown'; Message = 'its command line cannot be read, so it is left alone; the pid is kept' }
  }
  if ($F.CommandLine.IndexOf([string]$F.Marker, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
    if (-not $F.StartTime -and $F.RecordedStart) {
      return @{ Action = 'unknown'; Message = 'its start time cannot be read, so it is left alone; the pid is kept' }
    }
    return @{ Action = 'stop'; Message = 'ours' }
  }
  return @{ Action = 'reused'; Message = 'not running (its pid now belongs to another program)' }
}

# What stop.ps1 -Clean may delete, from the state alone. A rehearsal's copy is a copy of a backup and
# may go. Data a game night was played on must reach the Pi first (runbook, "After the night"):
# without -PushedBack the clean refuses.
function Resolve-PlanBClean($State, [switch]$PushedBack) {
  $played = $State -and $State.PSObject.Properties['played'] -and $State.played
  if ($played -and -not $PushedBack) {
    return @{ Ok = $false; Message = "this Plan B data was played on (game night $($State.playedAt)). Push the world back to the Pi first (docs/dev/PLAN-B.md, ""After the night""), then run stop.ps1 -Clean -PushedBack." }
  }
  return @{ Ok = $true; Message = 'ok' }
}

# --- processes, files and network (not unit tested) -----------------------------------------------

function Test-PlanBPortOpen([int]$Port, [string]$HostName = '127.0.0.1', [int]$TimeoutMs = 300) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $task = $client.ConnectAsync($HostName, $Port)
    return ($task.Wait($TimeoutMs) -and $client.Connected)
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Wait-PlanBPort([int]$Port, [int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-PlanBPortOpen $Port) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Read-PlanBState($Layout) {
  if (-not (Test-Path -LiteralPath $Layout.StateFile)) { return $null }
  return Get-Content -LiteralPath $Layout.StateFile -Raw | ConvertFrom-Json
}

function Write-PlanBState($Layout, $State) {
  New-Item -ItemType Directory -Force -Path $Layout.Root | Out-Null
  $State | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $Layout.StateFile
}

# Set or add one property on a state object from ConvertFrom-Json.
function Set-StateValue($State, [string]$Name, $Value) {
  if ($State.PSObject.Properties[$Name]) { $State.$Name = $Value } else { $State | Add-Member NoteProperty $Name $Value }
}

# restic.exe: PATH, then winget's link folder and package folder (as pull-restic.ps1 does).
function Find-PlanBRestic([string]$Restic) {
  if ($Restic) {
    if (-not (Test-Path -LiteralPath $Restic)) { throw "restic not found at $Restic" }
    return $Restic
  }
  $cmd = Get-Command restic -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  if ($env:LOCALAPPDATA) {
    $link = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\restic.exe'
    if (Test-Path $link) { return $link }
    $pkg = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages') -Filter 'restic.restic_*' -Directory -ErrorAction SilentlyContinue |
      ForEach-Object { Get-ChildItem $_.FullName -Filter 'restic*.exe' } | Sort-Object Name -Descending | Select-Object -First 1
    if ($pkg) { return $pkg.FullName }
  }
  throw 'restic is not installed: winget install restic.restic'
}

# The Foundry build in the app folder ("14.368"), or $null.
function Get-PlanBAppBuild($Layout) {
  $pkg = Join-Path $Layout.AppDir 'package.json'
  if (-not (Test-Path -LiteralPath $pkg)) { return $null }
  return Get-FoundryBuild (Get-Content -LiteralPath $pkg -Raw)
}

function Get-PlanBWorldCoreVersion($Layout, [string]$World) {
  $file = Join-Path $Layout.WorldsDir $World 'world.json'
  if (-not (Test-Path -LiteralPath $file)) { return $null }
  return [string]((Get-Content -LiteralPath $file -Raw | ConvertFrom-Json).coreVersion)
}

# A Node that satisfies Foundry's engines.node (Foundry 14 needs 24). The bridge, the dashboard
# and the Assistant GM run on the same Node, as on the Pi.
function Get-PlanBNodeExe($Layout) {
  $pkg = Join-Path $Layout.AppDir 'package.json'
  $range = if (Test-Path -LiteralPath $pkg) { (Get-Content -LiteralPath $pkg -Raw | ConvertFrom-Json).engines.node } else { $null }
  $min = if ($range -match '>=\s*(\d+\.\d+\.\d+)') { [version]$Matches[1] } else { [version]'24.0.0' }
  $max = if ($range -match '<\s*(\d+\.\d+\.\d+)') { [version]$Matches[1] } else { $null }
  $candidates = @(Get-Command node -All -ErrorAction SilentlyContinue | ForEach-Object Source)
  if ($IsWindows) { $candidates += Join-Path $env:ProgramFiles 'nodejs' 'node.exe' }
  foreach ($exe in ($candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique)) {
    try {
      $text = (& $exe --version 2>$null | Select-Object -First 1)
      if ($text -match '^v(\d+\.\d+\.\d+)') {
        $v = [version]$Matches[1]
        if ($v -ge $min -and (-not $max -or $v -lt $max)) { return $exe }
      }
    } catch { }
  }
  throw "No Node.js matching Foundry's requirement '$range' (install Node 24 from nodejs.org)."
}

# Headless Edge or Chrome for the Assistant GM.
function Get-PlanBChromium {
  $paths = @()
  if ($IsWindows) {
    $paths += Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
    $paths += Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'
    $paths += Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'
  } else {
    $paths += '/usr/bin/chromium', '/usr/bin/google-chrome'
  }
  return $paths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}

function Get-PlanBCommandLine([int]$ProcessId) {
  try {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
    if ($p -and $p.CommandLine) { return [string]$p.CommandLine }
  } catch { }
  return $null
}

function Get-PlanBStartTime([int]$ProcessId) {
  try {
    return (Get-Process -Id $ProcessId -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')
  } catch {
    return $null
  }
}

# Make a file or folder readable and writable by the current user only.
function Protect-PlanBPath([string]$Path) {
  if (-not $IsWindows) { return }
  $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $grant = if (Test-Path -LiteralPath $Path -PathType Container) { "${me}:(OI)(CI)F" } else { "${me}:F" }
  & icacls.exe $Path /inheritance:r /grant:r $grant | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "could not restrict the permissions of $Path" }
}
