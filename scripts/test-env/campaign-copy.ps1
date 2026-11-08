# A copy of the live Curse of Strahd Foundry (the Orange Pi) running on this PC as a test server.
#
#   pwsh scripts/test-env/campaign-copy.ps1 refresh   pull a fresh copy from the Pi (read-only on the Pi)
#   pwsh scripts/test-env/campaign-copy.ps1 start     start Foundry on the copy (http://localhost:30004)
#   pwsh scripts/test-env/campaign-copy.ps1 stop      stop it
#   pwsh scripts/test-env/campaign-copy.ps1 status
#
# refresh options: -PiHost foundry-pi (the ssh name), -Root C:\FoundryCampaign, -WithJB2A (also pull
# the 1.6 GB JB2A animation module, skipped by default), -NoPull (redo the local set-up on an
# already pulled <Root>\data.new). A running copy must be stopped before a refresh.
#
# The Pi side is only read: one `nice tar cf -` of /var/lib/foundry/Data (no compression, no writes,
# no snapshot needed). The copy keeps the old data folder as data.prev until the next refresh.
# The copy is its own Foundry: data folder C:\FoundryCampaign\data, port 30004, no bridge, no
# dashboard. It runs the same Foundry app as the test servers (appdir.txt) and the same licence file
# (copied from server A's Config\license.json). It never uses the live ports 31414 to 31416, the
# Plan B rehearsal ports or the test servers' ports. The copy's bridge module is patched to dial
# 31545 (nothing listens there) so the copy never reaches a real bridge. World data and the
# licensed packs stay in the data folder, outside the repo.
param(
  [Parameter(Position = 0)] [ValidateSet('refresh', 'start', 'stop', 'status')] [string]$Action = 'status',
  [string]$PiHost = 'foundry-pi',
  [string]$Root = 'C:\FoundryCampaign',
  [int]$Port = 30004,
  [string]$World = 'curse-of-strahd',
  [switch]$WithJB2A,
  [switch]$NoPull
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'config.ps1')   # server A's settings: app folder, Node helpers, port checks

$Forbidden = @(31414, 31415, 31416, 30100, 31614, 31615, 3300, 3100, 31514, 31515, 31524, 31525, 31534, 31535, 30001, 30002, 30003, 30000)
if ($Forbidden -contains $Port) { throw "Port $Port belongs to the live system, Plan B or a test server. Pick another." }
$DataRoot = Join-Path $Root 'data'
$PidFile = Join-Path $Root 'foundry.pid'
$DeadLink = 31545

function Get-CopyPid {
  if (-not (Test-Path $PidFile)) { return $null }
  $p = [int](Get-Content $PidFile -TotalCount 1)
  if (Get-Process -Id $p -ErrorAction SilentlyContinue) { return $p }
  Remove-Item $PidFile -ErrorAction SilentlyContinue
  return $null
}

function Invoke-Refresh {
  if ((Get-CopyPid) -or (Test-PortOpen $Port)) { throw "The copy is running (port $Port). Stop it first: campaign-copy.ps1 stop" }
  $new = Join-Path $Root 'data.new'
  $prev = Join-Path $Root 'data.prev'
  if ($NoPull) {
    if (-not (Test-Path $new)) { throw "-NoPull needs an already pulled $new." }
  } else {
    if (Test-Path $new) { Remove-Item -Recurse -Force $new }
    New-Item -ItemType Directory -Force $new | Out-Null
  }
  $excludes = @('--exclude=worlds/frostmaiden-training', '--exclude=worlds/pi-check', '--exclude=worlds/strahd-kit')
  if (-not $WithJB2A) { $excludes += '--exclude=modules/JB2A_DnD5e' }
  # cmd keeps the byte stream raw; the PowerShell pipeline would corrupt it.
  $remote = "cd /var/lib/foundry/Data && nice -n 19 tar cf - $($excludes -join ' ') worlds systems modules assets ddb-images tokenizer"
  if (-not $NoPull) {
    Write-Host "Pulling from $PiHost (read-only tar, uncompressed)..."
    New-Item -ItemType Directory -Force (Join-Path $new 'Data') | Out-Null
    & cmd.exe /d /c "ssh -o BatchMode=yes $PiHost `"$remote`" | tar xf - -C `"$(Join-Path $new 'Data')`""
    if ($LASTEXITCODE -ne 0) { throw "Pull failed (exit $LASTEXITCODE); the old copy is untouched, partial data is in $new." }
  }
  if (-not (Test-Path (Join-Path $new 'Data' 'worlds' $World 'world.json'))) { throw "Pulled data has no world '$World'; old copy untouched." }

  # Module copy for the test: dial a port nobody listens on, never update from the release manifest.
  $mj = Join-Path $new 'Data' 'modules' 'foundry-mcp-bridge' 'module.json'
  if (Test-Path $mj) {
    $m = Get-Content $mj -Raw | ConvertFrom-Json -AsHashtable
    if (-not $m.Contains('flags')) { $m['flags'] = @{} }
    $m['flags']['foundry-mcp-bridge'] = @{ defaultServerPort = $DeadLink; testInstall = $true }
    $m.Remove('manifest'); $m.Remove('download')
    $m | ConvertTo-Json -Depth 20 | Set-Content $mj
  }

  # Foundry's own config: a fresh one for this port and world, licence from server A.
  $cfg = Join-Path $new 'Config'
  New-Item -ItemType Directory -Force $cfg | Out-Null
  $licence = Join-Path $TestEnv.DataDir 'Config' 'license.json'
  if (-not (Test-Path $licence)) { throw "No licence at $licence (start server A once and enter the licence key)." }
  Copy-Item $licence (Join-Path $cfg 'license.json')
  # No admin.txt: the copy's setup screen has no admin password (localhost only, test data).
  $opts = Get-Content (Join-Path $TestEnv.DataDir 'Config' 'options.json') -Raw | ConvertFrom-Json -AsHashtable
  $opts['dataPath'] = $Root.Replace('\', '/') + '/data'
  $opts['port'] = $Port
  $opts['world'] = $null
  $opts | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $cfg 'options.json')

  if (Test-Path $DataRoot) {
    if (Test-Path $prev) { Remove-Item -Recurse -Force $prev }
    Move-Item $DataRoot $prev
  }
  Move-Item $new $DataRoot
  # Every user of the copy gets an empty password, so the GM can join as "Gamemaster" in the browser.
  & (Get-NodeExe) (Join-Path $PSScriptRoot 'campaign-copy-users.mjs') $TestEnv.AppDir (Join-Path $DataRoot 'Data' 'worlds' $World)
  if ($LASTEXITCODE -ne 0) { throw 'Clearing the copy''s user passwords failed.' }
  Write-Host "Refreshed. Start it with: pwsh scripts/test-env/campaign-copy.ps1 start"
  if (Test-Path $prev) { Write-Host "Previous copy kept in $prev (deleted at the next refresh)." }
}

function Invoke-Start {
  if (-not (Test-Path (Join-Path $DataRoot 'Data' 'worlds' $World 'world.json'))) { throw "No copy yet: run campaign-copy.ps1 refresh first." }
  if ((Get-CopyPid) -or (Test-PortOpen $Port)) { Write-Host "Already running on http://localhost:$Port"; return }
  $main = Find-FoundryMain
  if (-not $main) { throw "Foundry app not found under $($TestEnv.AppDir)." }
  $appRoot = Split-Path $main
  $nodeExe = Get-FoundryNodeExe $appRoot
  $logDir = Join-Path $Root 'logs'
  New-Item -ItemType Directory -Force $logDir | Out-Null
  $lock = Join-Path $DataRoot 'Config' 'options.json.lock'
  $deadline = (Get-Date).AddSeconds(30)
  while ((Test-Path $lock) -and ((Get-Date) - (Get-Item $lock).LastWriteTime).TotalSeconds -lt 12 -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 1 }
  $out = Join-Path $logDir 'foundry.out.log'; $err = Join-Path $logDir 'foundry.err.log'
  $cmd = "`"$nodeExe`" `"$main`" --dataPath=`"$DataRoot`" --port=$Port --noupnp --noupdate --world=$World"
  $shell = Start-Process -FilePath 'cmd.exe' -WindowStyle Hidden -WorkingDirectory $appRoot -PassThru `
    -ArgumentList '/d', '/s', '/c', "`"$cmd 1>`"$out`" 2>`"$err`" <nul`""
  if (-not (Wait-PortOpen $Port 90)) { throw "Foundry did not open port $Port; see $err" }
  $child = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($shell.Id)" -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^node' } | Select-Object -First 1
  Set-Content $PidFile $(if ($child) { $child.ProcessId } else { $shell.Id })
  Write-Host "Foundry (campaign copy, world $World): http://localhost:$Port"
}

function Invoke-Stop {
  $p = Get-CopyPid
  if (-not $p) { Write-Host 'Not running (no pid file).'; return }
  # Only the pid we recorded, after checking it is a node process on our port.
  $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -match '^node') { Stop-Process -Id $p; Write-Host "Stopped pid $p." } else { Write-Host "Pid $p is not a node process; left alone." }
  Remove-Item $PidFile -ErrorAction SilentlyContinue
}

switch ($Action) {
  'refresh' { Invoke-Refresh }
  'start' { Invoke-Start }
  'stop' { Invoke-Stop }
  'status' {
    Write-Host "Root: $Root   data: $(if (Test-Path $DataRoot) { 'present' } else { 'missing (run refresh)' })"
    Write-Host "Foundry port ${Port}: $(if (Test-PortOpen $Port) { 'listening' } else { 'closed' })   pid: $(Get-CopyPid)"
  }
}
