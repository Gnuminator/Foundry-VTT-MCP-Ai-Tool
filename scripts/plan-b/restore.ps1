#Requires -Version 7
<#
.SYNOPSIS
  Plan B step 1: restore the Pi's newest backup into the Plan B folder on this PC (docs/dev/PLAN-B.md).

.DESCRIPTION
  Reads this PC's copy of the Pi's backups (E:\PiBackup\restic, filled every day by
  scripts/pi/pull-restic.ps1) with restic's --no-lock, so the daily copy task is never blocked and
  nothing in the repository changes. Never contacts the Pi, never touches C:\FoundryTest.

  1. Picks the newest snapshot that holds Foundry's data (or -Snapshot <id>) and says how old it is.
  2. Restores Foundry's Data folder, the bridge vault, the dashboard state and the Assistant GM
     login into <Root>\staging, checks that the world is there, then moves them into place.
  3. Installs Foundry into <Root>\app from -FoundryZip when the app is missing or is not the
     version the world was last opened with.
  4. Copies the test server's licence file once (it is bound to this PC; the Pi's is bound to the
     Pi). Without it Foundry asks for the licence key on the first start.

  Refuses while Plan B runs (stop.ps1 first), refuses a root that holds data but no recorded restore
  (not Plan B's copy, -Force or not), and refuses to replace data a game night was played on until it
  is pushed back to the Pi (-Force moves it aside to <Root>\previous\ instead).
  The restic password is read by restic from -PassFile; this script never reads or prints it.

.EXAMPLE
  .\scripts\plan-b\restore.ps1 -List
  .\scripts\plan-b\restore.ps1
  .\scripts\plan-b\restore.ps1 -Root D:\PlanBTest -Snapshot 1a2b3c4d
#>
[CmdletBinding()]
param(
  [string]$Root = '',
  [ValidatePattern('^[a-z0-9][a-z0-9-]{0,63}$')] [string]$World = '',
  [string]$Repo = '',
  [string]$PassFile = '',
  [string]$Snapshot = 'latest',
  # Foundry's Node.js build (zip). Default: Downloads\FoundryVTT-Node-<the world's version>*.zip.
  [string]$FoundryZip = '',
  [string]$LicenseFrom = '',
  # Only list the newest snapshots and say which one would be restored.
  [switch]$List,
  # Move data a game night was played on aside to <Root>\previous\ instead of refusing.
  [switch]$Force,
  # Test hook: the restic program.
  [string]$Restic = ''
)

. (Join-Path $PSScriptRoot 'lib.ps1')
if (-not $Root) { $Root = $PlanBDefaults.Root }
if (-not $World) { $World = $PlanBDefaults.World }
if (-not $Repo) { $Repo = $PlanBDefaults.Repo }
if (-not $PassFile) { $PassFile = $PlanBDefaults.PassFile }
if (-not $LicenseFrom) { $LicenseFrom = $PlanBDefaults.LicenseFrom }
$L = Get-PlanBLayout $Root

function Write-Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }

if (-not (Test-Path -LiteralPath (Join-Path $Repo 'config'))) { throw "$Repo is not a restic repository (is drive E: connected?)" }
if (-not (Test-Path -LiteralPath $PassFile -PathType Leaf)) { throw "no restic password file at $PassFile (Waiting item 11: it is also in your password manager)" }
$resticExe = Find-PlanBRestic $Restic
$resticBase = @('--repo', $Repo, '--password-file', $PassFile, '--no-lock')

# --- which snapshot ---------------------------------------------------------------------------
$json = & $resticExe snapshots --json @resticBase
if ($LASTEXITCODE -ne 0) { throw "restic could not list the snapshots in $Repo (exit $LASTEXITCODE)" }
$snaps = @((@($json) -join "`n") | ConvertFrom-Json)
$pick = Select-PlanBSnapshot $snaps $Snapshot
if (-not $pick) { throw "no snapshot $(if ($Snapshot -ne 'latest') { "'$Snapshot' " })with /var/lib/foundry in $Repo" }
$pickTime = ([datetimeoffset]$pick.time).ToLocalTime()
$ageHours = [math]::Round(([datetimeoffset]::Now - $pickTime).TotalHours, 1)

if ($List) {
  Write-Host 'Newest snapshots with Foundry''s data (local time):'
  $snaps | Where-Object { @($_.paths) -contains '/var/lib/foundry' } | Sort-Object { [datetimeoffset]$_.time } -Descending |
    Select-Object -First 5 | ForEach-Object {
      $mark = if ($_.id -eq $pick.id) { '  <- would be restored' } else { '' }
      Write-Host ('  {0}  {1}{2}' -f $_.short_id, ([datetimeoffset]$_.time).ToLocalTime().ToString('yyyy-MM-dd HH\:mm'), $mark)
    }
  exit 0
}
Write-Step "snapshot $($pick.short_id) from $($pickTime.ToString('yyyy-MM-dd HH\:mm')) ($ageHours hours old)"
if ($ageHours -gt 36) {
  Write-Warning "the newest backup is more than a day and a half old: the Pi's nightly backup or this PC's copy task stopped. The game continues from that point."
}

# --- refusals ---------------------------------------------------------------------------------
$state = Read-PlanBState $L
if ($state -and $state.PSObject.Properties['services'] -and $state.services) {
  foreach ($p in $state.services.PSObject.Properties) {
    if (Get-Process -Id ([int]$p.Value.pid) -ErrorAction SilentlyContinue) {
      throw "Plan B may still run ($($p.Name), pid $($p.Value.pid)): run stop.ps1 first"
    }
  }
}
$hasData = [bool]@(@((Join-Path $L.DataDir 'Data'), $L.ToolDir, $L.SecretsDir) | Where-Object { Test-Path -LiteralPath $_ }).Count
$clean = Resolve-PlanBClean $state -HasData $hasData
if (-not $clean.Ok -and -not ($state -and $state.PSObject.Properties['restoredAt'] -and $state.restoredAt)) {
  # Not Plan B's copy: never deleted or moved, -Force or not.
  throw "refused: $($clean.Message)"
}
$moveAside = $false
if (-not $clean.Ok) {
  if (-not $Force) { throw "refused: $($clean.Message) Or run restore.ps1 -Force to move it aside to $Root\previous\." }
  $moveAside = $true
}

# --- restore into staging ---------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $Root, $L.StagingDir | Out-Null
$stage = Join-Path $L.StagingDir ('{0}-{1}' -f $pick.short_id, (Get-Date -Format 'yyyyMMdd-HHmmss'))
Write-Step "restoring into $stage"
$includes = @($PlanBRestoreIncludes | ForEach-Object { '--include', $_ })
& $resticExe restore $pick.id @resticBase --target $stage @includes
if ($LASTEXITCODE -ne 0) { throw "restic restore failed (exit $LASTEXITCODE); the staging folder $stage is left for a look" }

$stData = Join-Path $stage 'var' 'lib' 'foundry' 'Data'
$stTool = Join-Path $stage 'var' 'lib' 'foundry-ai-tool'
$stEnv = Join-Path $stage 'etc' 'foundry-ai-tool' 'assistant-gm.env'
$worldJson = Join-Path $stData 'worlds' $World 'world.json'
if (-not (Test-Path -LiteralPath $worldJson)) {
  $found = @(Get-ChildItem (Join-Path $stData 'worlds') -Directory -ErrorAction SilentlyContinue | ForEach-Object Name) -join ', '
  throw "the snapshot has no world '$World' (worlds in it: $found); the staging folder $stage is left for a look"
}

# --- move into place --------------------------------------------------------------------------
Write-Step 'moving the restored files into place'
$liveData = Join-Path $L.DataDir 'Data'
if ($moveAside) {
  $prev = Join-Path $Root 'previous' (Get-Date -Format 'yyyyMMdd-HHmmss')
  New-Item -ItemType Directory -Force -Path $prev | Out-Null
  foreach ($p in @($liveData, $L.ToolDir, $L.SecretsDir)) {
    if (Test-Path -LiteralPath $p) { Move-Item -LiteralPath $p -Destination (Join-Path $prev (Split-Path $p -Leaf)) }
  }
  Write-Host "    the played data was moved to $prev"
} else {
  # A rehearsal's data is only a copy of a backup.
  foreach ($p in @($liveData, $L.ToolDir, $L.SecretsDir)) {
    if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force }
  }
}
New-Item -ItemType Directory -Force -Path $L.DataDir, $L.ToolDir, $L.SecretsDir, $L.LogDir | Out-Null
Move-Item -LiteralPath $stData -Destination $liveData
foreach ($sub in 'vault', 'dashboard') {
  $src = Join-Path $stTool $sub
  if (Test-Path -LiteralPath $src) { Move-Item -LiteralPath $src -Destination (Join-Path $L.ToolDir $sub) }
}
Protect-PlanBPath $L.SecretsDir
if (Test-Path -LiteralPath $stEnv) {
  Move-Item -LiteralPath $stEnv -Destination $L.AssistantEnv
  # A moved file keeps the staging folder's permissions: restrict it again.
  Protect-PlanBPath $L.AssistantEnv
} else {
  Write-Warning 'the snapshot has no Assistant GM login: the bridge then needs a GM browser of yours (runbook, "No Assistant GM")'
}
Remove-Item -LiteralPath $stage -Recurse -Force

# --- Foundry itself ---------------------------------------------------------------------------
$core = Get-PlanBWorldCoreVersion $L $World
$appBuild = Get-PlanBAppBuild $L
$ver = Test-WorldVersion $appBuild $core
if (-not $ver.Ok) {
  $want = if ($core -match '^(\d+)\.(\d+)') { "$($Matches[1]).$($Matches[2])" } else { $core }
  if (-not $FoundryZip -and $env:USERPROFILE) {
    $FoundryZip = Get-ChildItem (Join-Path $env:USERPROFILE 'Downloads') -Filter "FoundryVTT-Node-$want*.zip" -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
  }
  if (-not $FoundryZip -or -not (Test-Path -LiteralPath $FoundryZip)) {
    throw "Foundry $want is needed in $($L.AppDir) and no FoundryVTT-Node-$want zip was found: download the Node.js build of $want from foundryvtt.com (your account, Purchased Licenses) and run restore.ps1 -FoundryZip <file>"
  }
  if (Test-Path -LiteralPath $L.AppDir) {
    $old = '{0}-{1}' -f $L.AppDir, $(if ($appBuild) { $appBuild } else { 'old' })
    if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Recurse -Force }
    Move-Item -LiteralPath $L.AppDir -Destination $old
  }
  Write-Step "installing Foundry from $FoundryZip"
  New-Item -ItemType Directory -Force -Path $L.AppDir | Out-Null
  # Windows' own tar unpacks zips far faster than Expand-Archive (22,000 files).
  $tar = if ($IsWindows) { Join-Path $env:SystemRoot 'System32\tar.exe' } else { 'tar' }
  & $tar -xf $FoundryZip -C $L.AppDir
  if ($LASTEXITCODE -ne 0) { throw "could not unpack $FoundryZip (tar exit $LASTEXITCODE)" }
  $ver = Test-WorldVersion (Get-PlanBAppBuild $L) $core
  if (-not $ver.Ok) { throw "after installing: $($ver.Message)" }
}
Write-Host "    $($ver.Message)"

New-Item -ItemType Directory -Force -Path (Split-Path $L.LicenseFile) | Out-Null
if (-not (Test-Path -LiteralPath $L.LicenseFile)) {
  if ($LicenseFrom -and (Test-Path -LiteralPath $LicenseFrom)) {
    Copy-Item -LiteralPath $LicenseFrom -Destination $L.LicenseFile
    Write-Host '    licence: copied from the test server (bound to this PC)'
  } else {
    Write-Warning 'no licence file: on the first start Foundry asks for your licence key (foundryvtt.com, Purchased Licenses)'
  }
}

# --- state ------------------------------------------------------------------------------------
$newState = [pscustomobject]@{
  world      = $World
  snapshot   = [pscustomobject]@{ id = $pick.id; short = $pick.short_id; time = $pickTime.ToString('o') }
  restoredAt = (Get-Date).ToString('o')
  played     = $false
  playedAt   = $null
  mode       = $null
  services   = $null
}
Write-PlanBState $L $newState
Write-Host ''
Write-Host "Restored '$World' from $($pickTime.ToString('yyyy-MM-dd HH\:mm')) into $Root."
Write-Host 'Next: .\scripts\plan-b\start.ps1 (a rehearsal) or .\scripts\plan-b\start.ps1 -GameNight (the Pi is down).'
