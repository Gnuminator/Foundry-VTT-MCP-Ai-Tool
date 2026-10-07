# Start the test environment in the background (logs in <Root>/logs).
#
#   pwsh scripts/test-env/start.ps1                   Foundry + bridge + dashboard
#   pwsh scripts/test-env/start.ps1 -Only bridge      one service
#   pwsh scripts/test-env/start.ps1 -NoWorld          Foundry at the setup screen
#   pwsh scripts/test-env/start.ps1 -World ai-tool-kit Foundry into another world (e.g. the
#                                                      test kit world with DDB imports)
#
# Refuses to start a service whose port is already taken, and never uses the
# live bridge ports 31414-31416.
param(
  [ValidateSet('all', 'foundry', 'bridge', 'dashboard')] [string]$Only = 'all',
  [switch]$NoWorld,
  [ValidatePattern('^[a-z0-9][a-z0-9-]{0,63}$')] [string]$World = ''
)

. (Join-Path $PSScriptRoot 'config.ps1')
Assert-SafePorts
if ($World -and -not (Test-Path (Join-Path $TestEnv.DataDir 'Data' 'worlds' $World))) {
  throw "No world '$World' under $(Join-Path $TestEnv.DataDir 'Data' 'worlds'); nothing started."
}
New-Item -ItemType Directory -Force $TestEnv.LogDir, $TestEnv.VaultDir | Out-Null
$node = Get-NodeExe
$pids = Read-Pids

function Start-TestService([string]$Name, [int]$Port, [string[]]$NodeArgs, [hashtable]$EnvVars, [string]$WorkDir, [int]$Timeout, [string]$Exe = $node) {
  if (Test-PortOpen $Port) {
    Write-Host "$Name : port $Port is already in use; not starting (see status.ps1)."
    return
  }
  $saved = @{}
  foreach ($k in $EnvVars.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, [string]$EnvVars[$k]) }
  $out = Join-Path $TestEnv.LogDir "$Name.out.log"
  $err = Join-Path $TestEnv.LogDir "$Name.err.log"
  # The service must not inherit this shell's output handles, or whoever ran
  # start.ps1 (a terminal, an agent) waits until the service exits. So the
  # shell that starts node does its own redirection.
  $command = "`"$Exe`" $($NodeArgs -join ' ')"
  try {
    if ($IsWindows) {
      $shell = Start-Process -FilePath 'cmd.exe' -WindowStyle Hidden -WorkingDirectory $WorkDir -PassThru `
        -ArgumentList '/d', '/s', '/c', "`"$command 1>`"$out`" 2>`"$err`" <nul`""
    } else {
      $shell = Start-Process -FilePath '/bin/sh' -WorkingDirectory $WorkDir -PassThru `
        -ArgumentList '-c', "exec $command >'$out' 2>'$err' </dev/null"
    }
  } finally {
    foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
  }
  $opened = Wait-PortOpen $Port $Timeout
  # Record node's own pid (on Windows it is a child of the cmd.exe wrapper).
  $nodePid = $shell.Id
  if ($IsWindows) {
    $child = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($shell.Id)" -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '^node' } | Select-Object -First 1
    if ($child) { $nodePid = [int]$child.ProcessId }
  }
  $script:pids[$Name] = $nodePid
  Write-Pids $script:pids
  # The start time (pids.started.json) lets stop.ps1 tell this process from one that reused its pid.
  $starts = Read-Starts
  $started = Get-ProcessStartTime $nodePid
  if ($started) { $starts[$Name] = $started } else { $starts.Remove($Name) }
  Write-Starts $starts
  if ($opened) {
    Write-Host "$Name : listening on 127.0.0.1:$Port (pid $nodePid)"
  } else {
    Write-Host "$Name : NOT listening on $Port after ${Timeout}s; see $err"
  }
}

if ($Only -in 'all', 'foundry') {
  $main = Find-FoundryMain
  if (-not $main) {
    Write-Host "foundry : not installed; extract the Foundry 14 Node.js build into $($TestEnv.AppDir)."
  } else {
    $foundryArgs = @("`"$main`"", "--dataPath=`"$($TestEnv.DataDir)`"", "--port=$($TestEnv.FoundryPort)", '--noupnp', '--noupdate')
    $worldId = if ($World) { $World } else { $TestEnv.WorldId }
    $worldDir = Join-Path $TestEnv.DataDir 'Data' 'worlds' $worldId
    if (-not $NoWorld -and (Test-Path $worldDir)) { $foundryArgs += "--world=$worldId" }
    # Foundry locks its data folder (Config/options.json.lock) and refreshes the
    # lock while running; right after a stop it is still fresh and a new start
    # fails with "already locked". Wait until it has gone stale.
    $lock = Join-Path $TestEnv.DataDir 'Config' 'options.json.lock'
    $deadline = (Get-Date).AddSeconds(30)
    while ((Test-Path $lock) -and ((Get-Date) - (Get-Item $lock).LastWriteTime).TotalSeconds -lt 12 -and (Get-Date) -lt $deadline) {
      Start-Sleep -Seconds 1
    }
    $appRoot = Split-Path $main
    $foundryNode = Get-FoundryNodeExe $appRoot
    Start-TestService 'foundry' $TestEnv.FoundryPort $foundryArgs @{} $appRoot 90 $foundryNode
  }
}

if ($Only -in 'all', 'bridge') {
  $standalone = Join-Path $RepoRoot 'packages' 'mcp-server' 'dist' 'standalone.js'
  if (-not (Test-Path $standalone)) { throw 'Backend not built: run setup.ps1.' }
  Start-TestService 'bridge' $TestEnv.ControlPort @("`"$standalone`"", '--port', "$($TestEnv.ControlPort)") @{
    MCP_CONTROL_HOST    = '127.0.0.1'
    FOUNDRY_PORT        = $TestEnv.LinkPort
    FOUNDRY_LINK_HOST   = '127.0.0.1'
    FOUNDRY_AI_DATA_DIR = $TestEnv.VaultDir
    FOUNDRY_AI_OBSIDIAN_DIR = $TestEnv.ObsidianDir
    # Obsidian mirror notes link here ("Open in Foundry"): the origin the GM opens the dashboard at.
    FOUNDRY_AI_OPEN_BASE = "http://localhost:$($TestEnv.DashboardPort)"
    LOG_LEVEL           = 'info'
  } $RepoRoot 30
}

if ($Only -in 'all', 'dashboard') {
  $server = Join-Path $RepoRoot 'packages' 'cogm-dashboard' 'dist' 'server.js'
  if (-not (Test-Path $server)) { throw 'Dashboard not built: run setup.ps1.' }
  Start-TestService 'dashboard' $TestEnv.DashboardPort @("`"$server`"") @{
    PORT             = $TestEnv.DashboardPort
    DASHBOARD_HOST   = '127.0.0.1'
    MCP_CONTROL_HOST = '127.0.0.1'
    MCP_CONTROL_PORT = $TestEnv.ControlPort
    FOUNDRY_AI_OBSIDIAN_DIR = $TestEnv.ObsidianDir
  } (Join-Path $RepoRoot 'packages' 'cogm-dashboard') 30
}

Write-Host ''
Write-Host "Foundry:   http://localhost:$($TestEnv.FoundryPort)"
Write-Host "Dashboard: http://localhost:$($TestEnv.DashboardPort)"
