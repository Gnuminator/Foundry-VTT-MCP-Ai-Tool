<#
.SYNOPSIS
  The manual way to turn one recording into session notes, start to end (until G2 this is the
  current way; the hourly task is not registered).

.DESCRIPTION
  For the one named session folder: pull it from the Pi (when FVTT_PI_HOST is set), consent check,
  names list, transcribe (takes the GPU lock itself), `session_notes run --layers`, publish to the
  bridge. It is auto.ps1 for one session, so every rule there holds: consent gate, nothing is
  deleted, a pause by the usage limit is run again later with the same command.

  Publishing goes to the TEST bridge (control port 31514) unless -Real is given. Use -Real only
  on the user's word: it puts the notes into the campaign world's GM journal.

  Roster of who plays whom: not applied here yet (Backlog item notes-roster).

.PARAMETER Session
  The session folder name, for example 2026-11-22_190000-discord.

.PARAMETER Real
  Publish to the real bridge (port 31414, or MCP_CONTROL_HOST's) instead of the test bridge.

.PARAMETER DryRun
  Only print what would be done.
#>
param(
  [Parameter(Mandatory, Position = 0)][string]$Session,
  [switch]$Real,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
if ($Session -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]*$') { Write-Host "Not a session folder name: $Session"; exit 2 }
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = if ($Real) { 31414 } else { 31514 }
Write-Host "Session $Session; publish goes to the $(if ($Real) { 'REAL' } else { 'test' }) bridge on port $port."

$autoArgs = @('-Session', $Session, '-Port', $port)
if ($DryRun) { $autoArgs += '-DryRun' }
& pwsh -NoProfile -File (Join-Path $here 'auto.ps1') @autoArgs
$code = $LASTEXITCODE

. (Join-Path $here '..\..\scripts\data-folder.ps1')
$sessions = if ($env:FVTT_SESSIONS_DIR) { $env:FVTT_SESSIONS_DIR } else { Get-DataFolder 'FoundrySessions' }
$folder = Join-Path $sessions $Session
if (-not (Test-Path $folder)) { Write-Host "No folder $Session in $sessions (not pulled yet, or a wrong name)."; exit 1 }
$status = Join-Path $folder 'notes\status.json'
if (Test-Path $status) {
  $s = Get-Content $status -Raw -Encoding utf8 | ConvertFrom-Json
  Write-Host "Status: $($s.state) - $($s.message)"
  if ($s.state -ne 'published' -and -not $DryRun) { Write-Host 'Not finished: run the same command again.'; if ($code -eq 0) { $code = 1 } }
}
elseif (-not $DryRun) { Write-Host 'No notes\status.json: nothing was written. See auto.log in the sessions folder.'; if ($code -eq 0) { $code = 1 } }
exit $code
