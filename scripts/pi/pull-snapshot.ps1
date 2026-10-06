#Requires -Version 7
<#
.SYNOPSIS
  Copy the Pi's newest dietpi-backup snapshot to this PC (docs/dev/PI-SETUP.md, "Snapshots on this PC").

.DESCRIPTION
  Runs `tar | zstd` on the Pi over SSH and saves the stream as one archive, so Linux owners,
  permissions and links survive on NTFS and `dietpi-backup -1` can restore from it after a reflash.
  Read-only on the Pi: the only remote commands are `tar`, `cat`, `stat` and `pgrep`.

  - Skips when the newest snapshot is already here, or while dietpi-backup is running.
  - Discards the copy if the snapshot changed while it was being copied.
  - Test-reads every new archive (Windows' tar must decode and list it) before keeping it.
  - Keeps the newest -KeepDaily archives plus the newest one of each of the last -KeepWeekly
    weeks; deletes only its own older archives in this folder, never anything on the Pi.
  - Starts with the storage space check (space-check.ps1): below 20 % free on the Pi's snapshot disk or
    on this PC's destination it logs a WARNING and shows a Windows notification; at critical (under
    5 %) on the destination it skips the copy and exits 1.
  - Logs to <Destination>\logs\pull-<yyyy-MM>.log and writes last-success.txt.

.EXAMPLE
  .\scripts\pi\pull-snapshot.ps1
  .\scripts\pi\pull-snapshot.ps1 -Destination D:\Test -DryRun
#>
[CmdletBinding()]
param(
  [string]$Destination = 'E:\PiBackup',
  [string[]]$Hosts = @('foundry-pi', 'foundry-pi.tailf949aa.ts.net'),
  [string]$SnapshotRoot = '/mnt/dietpi-backup',
  [int]$KeepDaily = 14,
  [int]$KeepWeekly = 8,
  [int]$WarnAfterDays = 3,
  # Test hook: the ssh program to call (a fake in tests).
  [string]$Ssh = 'ssh',
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'space-check.ps1')

$snapDir = Join-Path $Destination 'snapshots'
$logDir = Join-Path $Destination 'logs'
New-Item -ItemType Directory -Force -Path $snapDir, $logDir | Out-Null
$logFile = Join-Path $logDir ("pull-{0}.log" -f (Get-Date -Format 'yyyy-MM'))
$successFile = Join-Path $Destination 'last-success.txt'

function Write-Log([string]$Message) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH\:mm\:ss'), $Message
  Add-Content -Path $logFile -Value $line
  Write-Host $line
}

function Invoke-Remote([string]$Target, [string]$Command) {
  $out = & $Ssh -o BatchMode=yes -o ConnectTimeout=10 $Target $Command 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  return (@($out) -join "`n").Trim()
}

function Get-ArchiveName([string]$Stamp) { "pi-snapshot-$Stamp.tar.zst" }

# The snapshot's completion time, from the stats file dietpi-backup writes at the end of a run.
$statCmd = "stat -c %Y $SnapshotRoot/.dietpi-backup_stats"

try {
  $target = $null
  foreach ($h in $Hosts) {
    if ($null -ne (Invoke-Remote $h 'true')) { $target = $h; break }
  }
  if (-not $target) { throw "The Pi does not answer on: $($Hosts -join ', ')" }

  # Space check first (never throws): warns below 20 % free, stops the copy at critical on the destination.
  $extra = @()
  $vault = Get-SyncthingVaultPath
  if ($vault) { $extra = @(@{ Path = $vault; Job = 'Syncthing vault (destination)' }) }
  $space = Invoke-SpaceCheck -Job 'snapshot copy' -Destinations @($Destination) -Extra $extra -PiHost $target -Ssh $Ssh `
    -PiPaths @($SnapshotRoot) -Log ${function:Write-Log} -Test:$DryRun
  if ($space.Skip) {
    if ($DryRun) { Write-Log 'dry run: the copy would be skipped (space is critical)' } else { throw $space.SkipReason }
  }

  if ($null -ne (Invoke-Remote $target 'pgrep -f "dietpi-backup [0-9]"')) {
    Write-Log "skip: dietpi-backup is running on $target; next run tries again"
    exit 0
  }

  $epoch = Invoke-Remote $target $statCmd
  if (-not $epoch -or $epoch -notmatch '^\d+$') { throw "No snapshot found in $SnapshotRoot on $target" }
  $stamp = [DateTimeOffset]::FromUnixTimeSeconds([long]$epoch).ToLocalTime().ToString('yyyy-MM-dd_HHmm')
  $archive = Join-Path $snapDir (Get-ArchiveName $stamp)

  if (Test-Path $archive) {
    Write-Log "skip: snapshot $stamp is already here"
  } elseif ($DryRun) {
    Write-Log "dry run: would copy snapshot $stamp from $target to $archive"
  } else {
    $partial = "$archive.partial"
    Write-Log "copy: snapshot $stamp from $target"
    # The Pi packs and compresses; this PC only stores the bytes. cmd's redirect keeps the
    # stream binary (PowerShell pipelines would re-encode it).
    $remote = "tar -C $SnapshotRoot -cf - data .dietpi-backup_stats dietpi-backup.log | zstd -q -3 -T0"
    $sshExe = (Get-Command $Ssh).Source
    & cmd.exe /d /c "`"$sshExe`" -o BatchMode=yes -o ConnectTimeout=10 $target `"$remote`" > `"$partial`""
    if ($LASTEXITCODE -ne 0) { Remove-Item -Force $partial -ErrorAction SilentlyContinue; throw "copy failed (exit $LASTEXITCODE)" }

    $after = Invoke-Remote $target $statCmd
    if ($after -ne $epoch) {
      Remove-Item -Force $partial
      throw "the snapshot changed during the copy ($epoch -> $after); discarded, next run tries again"
    }

    # Test-read: Windows' own tar (libarchive, with zstd) must decode it all and list data/.
    $listing = & (Join-Path $env:SystemRoot 'System32\tar.exe') -tf $partial
    if ($LASTEXITCODE -ne 0 -or -not (@($listing) -match '^data/')) {
      Remove-Item -Force $partial
      throw 'the archive failed its test read; discarded'
    }
    Move-Item -Force $partial $archive
    $sizeMb = [math]::Round((Get-Item $archive).Length / 1MB)
    Write-Log ("ok: {0} ({1} MB, {2} entries)" -f (Split-Path $archive -Leaf), $sizeMb, @($listing).Count)
  }

  # Keep the newest KeepDaily archives, plus the newest of each of the last KeepWeekly ISO weeks.
  $all = @(Get-ChildItem $snapDir -Filter 'pi-snapshot-*.tar.zst' | Sort-Object Name -Descending)
  $keep = [System.Collections.Generic.HashSet[string]]::new()
  $all | Select-Object -First $KeepDaily | ForEach-Object { [void]$keep.Add($_.Name) }
  $weeks = [ordered]@{}
  foreach ($f in $all) {
    if ($f.Name -notmatch 'pi-snapshot-(\d{4}-\d{2}-\d{2})_') { continue }
    $d = [datetime]::ParseExact($Matches[1], 'yyyy-MM-dd', $null)
    $week = '{0}-W{1:00}' -f [System.Globalization.ISOWeek]::GetYear($d), [System.Globalization.ISOWeek]::GetWeekOfYear($d)
    if (-not $weeks.Contains($week)) { $weeks[$week] = $f.Name }
  }
  @($weeks.Values) | Select-Object -First $KeepWeekly | ForEach-Object { [void]$keep.Add($_) }
  foreach ($f in $all) {
    if (-not $keep.Contains($f.Name)) {
      if ($DryRun) { Write-Log "dry run: would remove old $($f.Name)" }
      else { Remove-Item -Force $f.FullName; Write-Log "removed old $($f.Name)" }
    }
  }
  Get-ChildItem $snapDir -Filter '*.partial' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-1) } |
    ForEach-Object { Remove-Item -Force $_.FullName; Write-Log "removed stale $($_.Name)" }

  if (-not $DryRun) { Set-Content -Path $successFile -Value ("{0}  snapshot {1}" -f (Get-Date -Format 's'), $stamp) }
} catch {
  Write-Log "FAILED: $($_.Exception.Message)"
  $exitCode = 1
}

$newest = Get-ChildItem $snapDir -Filter 'pi-snapshot-*.tar.zst' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $newest -or $newest.LastWriteTime -lt (Get-Date).AddDays(-$WarnAfterDays)) {
  Write-Log "WARNING: no snapshot copied in the last $WarnAfterDays days"
}
if (Get-Variable exitCode -ErrorAction SilentlyContinue) { exit $exitCode }
