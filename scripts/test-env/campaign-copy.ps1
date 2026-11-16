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

$Forbidden = @(31414, 31415, 31416, 30100, 31614, 31615, 3300, 3100, 3101, 3102, 31514, 31515, 31524, 31525, 31534, 31535, 31544, 31545, 30001, 30002, 30003, 30000)
if ($Forbidden -contains $Port) { throw "Port $Port belongs to the live system, Plan B or a test server. Pick another." }
$DataRoot = Join-Path $Root 'data'
$PidFile = Join-Path $Root 'foundry.pid'
$DeadLink = 31545

function Get-CopyPid {
  if (-not (Test-Path $PidFile)) { return $null }
  $p = [int](Get-Content $PidFile -TotalCount 1)
  # Only the Foundry we started: a reused pid of any other process does not count.
  $line = Get-ProcessCommandLine $p
  if ($line -and $line.Contains($DataRoot) -and $line.Contains("--port=$Port")) { return $p }
  Remove-Item $PidFile -ErrorAction SilentlyContinue
  return $null
}

function Invoke-Refresh {
  if ((Get-CopyPid) -or (Test-PortOpen $Port)) { throw "The copy is running (port $Port). Stop it first: campaign-copy.ps1 stop" }
  $new = Join-Path $Root 'data.new'
  $prev = Join-Path $Root 'data.prev'
  if ($NoPull) {
    if (-not (Test-Path (Join-Path $new '.pull-complete'))) { throw "-NoPull needs a complete pull in $new (no .pull-complete marker)." }
  } else {
    if (Test-Path $new) { Remove-Item -Recurse -Force $new }
    New-Item -ItemType Directory -Force $new | Out-Null
    $tarFile = Join-Path $Root 'pull.tar'
    if (Test-Path $tarFile) { Remove-Item -Force $tarFile }
  }
  $excludes = @('--exclude=worlds/frostmaiden-training', '--exclude=worlds/pi-check', '--exclude=worlds/strahd-kit')
  if (-not $WithJB2A) { $excludes += '--exclude=modules/JB2A_DnD5e' }
  # cmd keeps the byte stream raw; the PowerShell pipeline would corrupt it.
  $remote = "cd /var/lib/foundry/Data && nice -n 19 tar cf - $($excludes -join ' ') worlds systems modules assets ddb-images tokenizer"
  if (-not $NoPull) {
    Write-Host "Pulling from $PiHost (read-only tar, uncompressed)..."
    # Into a file first (cmd keeps the byte stream raw), so ssh's own exit code is checked.
    & cmd.exe /d /c "ssh -o BatchMode=yes $PiHost `"$remote`" > `"$tarFile`""
    if ($LASTEXITCODE -ne 0) { throw "Pull failed (ssh exit $LASTEXITCODE); the old copy is untouched." }
    New-Item -ItemType Directory -Force (Join-Path $new 'Data') | Out-Null
    & (Join-Path $env:SystemRoot 'System32' 'tar.exe') xf $tarFile -C (Join-Path $new 'Data')
    if ($LASTEXITCODE -ne 0) { throw "Unpacking failed (tar exit $LASTEXITCODE); the old copy is untouched." }
    Remove-Item -Force $tarFile
    foreach ($need in @('systems/dnd5e/system.json', 'modules/foundry-mcp-bridge/module.json', "worlds/$World/world.json", "worlds/$World/packs")) {
      if (-not (Test-Path (Join-Path $new 'Data' $need))) { throw "Pulled data lacks $need; the old copy is untouched." }
    }
    Set-Content (Join-Path $new '.pull-complete') (Get-Date -Format o)
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
  # Server A's admin login (hashed) protects the copy's setup screen too.
  $adminTxt = Join-Path $TestEnv.DataDir 'Config' 'admin.txt'
  if (Test-Path $adminTxt) { Copy-Item $adminTxt (Join-Path $cfg 'admin.txt') }
  $opts = Get-Content (Join-Path $TestEnv.DataDir 'Config' 'options.json') -Raw | ConvertFrom-Json -AsHashtable
  $opts['dataPath'] = $Root.Replace('\', '/') + '/data'
  $opts['port'] = $Port
  $opts['world'] = $null
  $opts | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $cfg 'options.json')

  $movedPrev = $false
  if (Test-Path $DataRoot) {
    if (Test-Path $prev) { Remove-Item -Recurse -Force $prev }
    Move-Item $DataRoot $prev
    $movedPrev = $true
  }
  try {
    Move-Item $new $DataRoot
  } catch {
    $swapError = $_
    # The final move failed: put the old copy back so the copy is never left without data.
    if ($movedPrev -and -not (Test-Path $DataRoot) -and (Test-Path $prev)) {
      try {
        Move-Item $prev $DataRoot
        Write-Warning "Swapping in the new data failed; the previous copy was moved back to $DataRoot."
      } catch {
        throw "Swapping in the new data failed ($($swapError.Exception.Message)) and restoring the previous copy from $prev also failed ($($_.Exception.Message)); move $prev back to $DataRoot by hand."
      }
    }
    throw $swapError
  }
  # Every user of the copy gets an empty password, so the GM can join as "Gamemaster" in the browser.
  & (Get-NodeExe) (Join-Path $PSScriptRoot 'campaign-copy-users.mjs') $TestEnv.AppDir (Join-Path $DataRoot 'Data' 'worlds' $World)
  if ($LASTEXITCODE -ne 0) { throw 'Clearing the copy''s user passwords failed.' }
  Write-Host "Refreshed. Start it with: pwsh scripts/test-env/campaign-copy.ps1 start"
  if (Test-Path $prev) { Write-Host "Previous copy kept in $prev (deleted at the next refresh)." }
}

# Stop the cmd shell Invoke-Start launched and its children (no-op when it already exited).
function Stop-LaunchedShell($shell) {
  if ($shell -and -not $shell.HasExited) { & taskkill.exe /PID $shell.Id /T /F | Out-Null }
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
  if (-not (Wait-PortOpen $Port 90)) {
    Stop-LaunchedShell $shell
    throw "Foundry did not open port $Port; the shell we started was stopped. See $err"
  }
  # The node process that was started with this data folder and port (the port table is not
  # always readable from every shell).
  $owner = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($DataRoot) -and $_.CommandLine.Contains("--port=$Port") } |
    Select-Object -First 1 -ExpandProperty ProcessId
  if (-not $owner) {
    # Do not leave an unrecorded Foundry running: stop the shell we started and its children.
    Stop-LaunchedShell $shell
    throw "Foundry listens on $Port but its process could not be found; the shell we started was stopped."
  }
  Write-Host "Foundry pid $owner"
  Set-Content $PidFile $owner
  Write-Host "Foundry (campaign copy, world $World): http://localhost:$Port"
}

function Invoke-Stop {
  $p = Get-CopyPid
  if (-not $p) { Write-Host 'Not running (no matching Foundry for the pid file).'; return }
  # Get-CopyPid already checked the command line (our data folder and port).
  Stop-Process -Id $p
  Write-Host "Stopped Foundry pid $p."
  Remove-Item $PidFile -ErrorAction SilentlyContinue
}

switch ($Action) {
  'refresh' { Invoke-Refresh }
  'start' { Invoke-Start }
  'stop' { Invoke-Stop }
  'status' {
    Write-Host "Root: $Root   data: $(if (Test-Path $DataRoot) { 'present' } else { 'missing (run refresh)' })"
    Write-Host "Foundry port ${Port}: $(if (Test-PortOpen $Port) { 'listening' } else { 'closed' })   pid: $(Get-CopyPid)"
    # Foundry listens on all interfaces and the copy holds the real campaign data with passwordless
    # users, so say whether the network can reach it (a firewall rule is the user's decision).
    $blocked = @(Get-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Block' -and $_.Direction -eq 'Inbound' } |
        ForEach-Object { ($_ | Get-NetFirewallPortFilter).LocalPort }) -contains [string]$Port
    Write-Host "Network: $(if ($blocked) { "port $Port blocked from the network" } else { "port $Port reachable from the network. To block it: New-NetFirewallRule -DisplayName '$FirewallRuleName' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Block (admin PowerShell, the user's decision)" })"
  }
}
