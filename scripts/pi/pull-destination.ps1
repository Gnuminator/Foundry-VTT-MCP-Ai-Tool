#Requires -Version 7
<#
.SYNOPSIS
  Check that the drive a Pi pull script copies to is there, and log it when it is not.
  Dot-sourced by pull-restic.ps1 and pull-snapshot.ps1.

.DESCRIPTION
  The pull scripts write their log inside the destination (E:\PiBackup\logs). With the drive
  unplugged, New-Item would have failed before any log line existed and the scheduled task
  would have ended with nothing written anywhere. Test-PullDestination checks the drive first and,
  when it is missing, writes one line to %LOCALAPPDATA%\foundry-ai-tool\pull-fallback.log (a folder
  on the PC's own disk) and returns $false; the caller then exits 1.

  A destination with no drive letter (a UNC path, a relative one) is not checked.

  Functions: Test-PullDestination, Get-NewestSnapshotAgeDays
#>

# Returns $true when the drive of -Destination exists (or has no drive letter to check).
function Test-PullDestination {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Destination,
    [Parameter(Mandatory)][string]$Job,
    # Test hook: where the fallback log goes.
    [string]$FallbackLog = (Join-Path $env:LOCALAPPDATA 'foundry-ai-tool\pull-fallback.log')
  )
  $qualifier = Split-Path -Qualifier $Destination -ErrorAction SilentlyContinue
  if (-not $qualifier) { return $true }
  if (Test-Path -LiteralPath ($qualifier + '\')) { return $true }
  $line = '{0}  {1}: FAILED: the drive {2} for {3} is not there (unplugged?); nothing was copied' -f
    (Get-Date -Format 'yyyy-MM-dd HH\:mm\:ss'), $Job, $qualifier, $Destination
  try {
    New-Item -ItemType Directory -Force -Path (Split-Path $FallbackLog) | Out-Null
    Add-Content -Path $FallbackLog -Value $line
  } catch {
    # The fallback log is best effort; the message below still reaches the task history.
  }
  Write-Host $line
  return $false
}

# Age in days of a point in time (a snapshot's own time, not the time it was copied). $null in, $null out.
function Get-NewestSnapshotAgeDays {
  [CmdletBinding()]
  param([Nullable[datetimeoffset]]$SnapshotTime)
  if ($null -eq $SnapshotTime) { return $null }
  return ([datetimeoffset]::Now - $SnapshotTime).TotalDays
}
