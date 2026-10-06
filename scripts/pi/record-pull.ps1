#Requires -Version 7
<#
.SYNOPSIS
  Tell the Pi that this PC just copied its backups (PB-06). Dot-sourced by pull-restic.ps1 and
  pull-snapshot.ps1 after a successful run.

.DESCRIPTION
  Runs ONE fixed command on the Pi over SSH:

      /opt/foundry-ai-tool/backup/record-pull.sh restic      (or: snapshot)

  The helper (installed by Pi stage 6) writes the Pi's own clock into
  /var/lib/foundry-ai-tool/backup-pulls/<kind>.json. The Discord bot on the Pi reads those files and
  sends the owner a DM when the newest copy of either kind is older than 3 days (set
  FOUNDRY_AI_BACKUP_STALE_DAYS in the bot's settings to change it). The command takes no data from
  this PC, only the word restic or snapshot, and it shows in the Pi's SSH log (stage 9).

  Never throws: a Pi that is off, or a Pi without the helper (stage 6 not rerun yet), only logs a
  WARNING and returns $false, so a good copy is never reported as failed.

  Functions: Send-PullRecord
#>

# Dot-sourced: nothing runs until Send-PullRecord is called.
function Send-PullRecord {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][ValidateSet('restic', 'snapshot')][string]$Kind,
    [Parameter(Mandatory)][string]$PiHost,
    [string]$Ssh = 'ssh',
    [string]$HelperPath = '/opt/foundry-ai-tool/backup/record-pull.sh',
    # Called with one plain line; the pull scripts pass their Write-Log.
    [scriptblock]$Log = { param($m) Write-Host $m }
  )
  try {
    $out = & $Ssh -o BatchMode=yes -o ConnectTimeout=10 $PiHost "$HelperPath $Kind" 2>&1 | ForEach-Object { "$_" }
    $code = $LASTEXITCODE
    if ($code -eq 0) {
      & $Log "recorded on the Pi: the $Kind copy is done"
      return $true
    }
    $hint = if ($code -eq 127) { ' (run Pi stage 6 again to install the helper)' } elseif ($code -eq 255) { ' (the Pi did not answer)' } else { '' }
    $detail = (@($out) -join ' ').Trim()
    $line = "WARNING: could not tell the Pi about the $Kind copy (exit $code)$hint; the Pi's stale-backup DM may be wrong until the next run. $detail"
    & $Log $line.TrimEnd()
    return $false
  } catch {
    & $Log "WARNING: could not tell the Pi about the $Kind copy: $($_.Exception.Message)"
    return $false
  }
}
