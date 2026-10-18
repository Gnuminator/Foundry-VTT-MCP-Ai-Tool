#Requires -Version 7
<#
.SYNOPSIS
  Restores only one world's scenes database from the newest backup into a folder of its own, for
  the scene restore tool (plan-scene-restore) and nothing else.

.DESCRIPTION
  Reads this PC's copy of the Pi's backups (E:\PiBackup\restic) with restic's --no-lock and only
  restores worlds/<World>/data/scenes of the newest snapshot (or -Snapshot <id>), a few megabytes
  instead of the whole Plan B root. Read-only on restic; it never touches Plan B's folder, the test
  server or the Pi. Says how old the snapshot is and prints the folder to give plan-scene-restore
  as backupPath.

.EXAMPLE
  .\scripts\plan-b\extract-scenes.ps1
  .\scripts\plan-b\extract-scenes.ps1 -World curse-of-strahd -Snapshot 1a2b3c4d
#>
[CmdletBinding()]
param(
  [ValidatePattern('^[a-z0-9][a-z0-9_-]{0,63}$')] [string]$World = '',
  [string]$Repo = '',
  [string]$PassFile = '',
  [string]$Snapshot = 'latest',
  # Where the extract folders go (one subfolder per run). Never inside Plan B's own root.
  [string]$Out = '',
  # Test hook: the restic program.
  [string]$Restic = ''
)

. (Join-Path $PSScriptRoot 'lib.ps1')
if (-not $World) { $World = $PlanBDefaults.World }
if (-not $Repo) { $Repo = $PlanBDefaults.Repo }
if (-not $PassFile) { $PassFile = $PlanBDefaults.PassFile }
if (-not $Out) { $Out = if ($IsWindows) { 'C:\FoundrySceneBackup' } else { Join-Path $HOME 'foundry-scene-backup' } }
$outOk = Test-PlanBSceneOut $Out $Repo
if (-not $outOk.Ok) { throw "refused: $($outOk.Message)" }

if (-not (Test-Path -LiteralPath (Join-Path $Repo 'config'))) { throw "$Repo is not a restic repository (is drive E: connected?)" }
if (-not (Test-Path -LiteralPath $PassFile -PathType Leaf)) { throw "no restic password file at $PassFile (Waiting item 11: it is also in your password manager)" }
$resticExe = Find-PlanBRestic $Restic
$resticBase = @('--repo', $Repo, '--password-file', $PassFile, '--no-lock')

$json = & $resticExe snapshots --json @resticBase
if ($LASTEXITCODE -ne 0) { throw "restic could not list the snapshots in $Repo (exit $LASTEXITCODE)" }
$snaps = @((@($json) -join "`n") | ConvertFrom-Json)
$pick = Select-PlanBSnapshot $snaps $Snapshot
if (-not $pick) { throw "no snapshot $(if ($Snapshot -ne 'latest') { "'$Snapshot' " })with /var/lib/foundry in $Repo" }
$pickTime = ([datetimeoffset]$pick.time).ToLocalTime()
$ageHours = [math]::Round(([datetimeoffset]::Now - $pickTime).TotalHours, 1)
Write-Host "==> snapshot $($pick.short_id) from $($pickTime.ToString('yyyy-MM-dd HH\:mm')) ($ageHours hours old)" -ForegroundColor Cyan
if ($ageHours -gt 36) {
  Write-Warning 'the newest backup is more than a day and a half old: it may not hold the map as it was before it broke.'
}

$target = Join-Path $Out ('{0}-{1}' -f $pick.short_id, (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Force -Path $target | Out-Null
& $resticExe restore $pick.id @resticBase --target $target --include (Get-PlanBSceneInclude $World)
if ($LASTEXITCODE -ne 0) {
  if (-not (Get-ChildItem -LiteralPath $target -Recurse -File -ErrorAction SilentlyContinue)) { Remove-Item -LiteralPath $target -Recurse -Force }
  throw "restic restore failed (exit $LASTEXITCODE)"
}

$worldDir = Join-Path $target 'var' 'lib' 'foundry' 'Data' 'worlds' $World
if (-not (Test-Path -LiteralPath (Join-Path $worldDir 'data' 'scenes'))) {
  if (-not (Get-ChildItem -LiteralPath $target -Recurse -File -ErrorAction SilentlyContinue)) { Remove-Item -LiteralPath $target -Recurse -Force }
  throw "the snapshot has no scenes database for world '$World'"
}
Write-Host ''
Write-Host "Scenes of '$World' from $($pickTime.ToString('yyyy-MM-dd HH\:mm')) ($ageHours hours old) are in:"
Write-Host "  $worldDir"
Write-Host 'Give that folder as backupPath to plan-scene-restore.'
