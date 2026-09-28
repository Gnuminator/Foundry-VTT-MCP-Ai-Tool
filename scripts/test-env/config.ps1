# Shared settings for the local test environment (dot-source this file).
#
# A personal-only test setup, separate from the live campaign in every way:
#   Foundry (Node.js build)  http://localhost:30001, own data folder
#   test bridge              control 31514, Foundry link 31515, WebRTC 31516
#   co-GM dashboard          http://localhost:3100
#   bridge vault             <Root>/vault
# The live bridge ports 31414-31416 are never used; every script refuses to run
# if a test port collides with them.
#
# Override any value in scripts/test-env/local.json (gitignored), e.g.
#   { "Root": "D:\\FoundryTest", "FoundryPort": 30002 }
# Works with PowerShell 7 on Windows and Linux (for the later Orange Pi move).

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
$LivePorts = @(31414, 31415, 31416)

$settings = [ordered]@{
  Root          = if ($IsWindows) { 'C:\FoundryTest' } else { Join-Path $HOME 'foundry-test' }
  WorldId       = 'ai-tool-test'
  FoundryPort   = 30001
  ControlPort   = 31514
  LinkPort      = 31515
  WebrtcPort    = 31516
  DashboardPort = 3100
}
$localFile = Join-Path $PSScriptRoot 'local.json'
if (Test-Path $localFile) {
  $local = Get-Content $localFile -Raw | ConvertFrom-Json
  foreach ($p in $local.PSObject.Properties) {
    if (-not $settings.Contains($p.Name)) { throw "Unknown setting '$($p.Name)' in $localFile" }
    $settings[$p.Name] = $p.Value
  }
}

$TestEnv = [pscustomobject]@{
  Root          = $settings.Root
  AppDir        = Join-Path $settings.Root 'app'
  DataDir       = Join-Path $settings.Root 'data'
  VaultDir      = Join-Path $settings.Root 'vault'
  LogDir        = Join-Path $settings.Root 'logs'
  WorldId       = [string]$settings.WorldId
  FoundryPort   = [int]$settings.FoundryPort
  ControlPort   = [int]$settings.ControlPort
  LinkPort      = [int]$settings.LinkPort
  WebrtcPort    = [int]$settings.WebrtcPort
  DashboardPort = [int]$settings.DashboardPort
}
$TestEnv | Add-Member NoteProperty ModuleDir (Join-Path $TestEnv.DataDir 'Data' 'modules' 'foundry-mcp-bridge')
$TestEnv | Add-Member NoteProperty PidFile (Join-Path $TestEnv.LogDir 'pids.json')

function Assert-SafePorts {
  $ports = @($TestEnv.FoundryPort, $TestEnv.ControlPort, $TestEnv.LinkPort, $TestEnv.WebrtcPort, $TestEnv.DashboardPort)
  foreach ($port in $ports) {
    if ($LivePorts -contains $port) { throw "Test port $port is a live bridge port (31414-31416). Pick another in local.json." }
  }
  if (($ports | Select-Object -Unique).Count -ne $ports.Count) { throw 'Test ports must all be different.' }
}

function Get-NodeExe {
  $portable = Join-Path $HOME 'AppData' 'Local' 'node22' 'node-v22.22.2-win-x64' 'node.exe'
  if ($IsWindows -and (Test-Path $portable)) { return $portable }
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { throw 'Node.js not found (need 18+; Foundry 14 needs 20+).' }
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

function Wait-PortOpen([int]$Port, [int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-PortOpen $Port) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Read-Pids {
  if (Test-Path $TestEnv.PidFile) {
    $h = @{}
    (Get-Content $TestEnv.PidFile -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $h[$_.Name] = [int]$_.Value }
    return $h
  }
  return @{}
}

function Write-Pids([hashtable]$Pids) {
  New-Item -ItemType Directory -Force $TestEnv.LogDir | Out-Null
  $Pids | ConvertTo-Json | Set-Content $TestEnv.PidFile
}
