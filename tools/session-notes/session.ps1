<#
.SYNOPSIS
  The manual way to turn one recording into session notes, start to end (until G2 this is the
  current way; the hourly task is not registered).

.DESCRIPTION
  For the one named session folder: pull it from the Pi (when FVTT_PI_HOST is set), consent check,
  names list, transcribe (takes the GPU lock itself), `session_notes run --layers`, publish to the
  bridge. It is auto.ps1 for one session, so every rule there holds: consent gate, nothing is
  deleted, a pause by the usage limit is run again later with the same command.

  Publishing goes to the TEST bridge (testA control port in shared/ports.json) unless -Real is given. Use -Real only
  on the user's word: it puts the notes into the campaign world's GM journal.

  Roster of who plays whom: not applied here yet (Backlog item notes-roster).

.PARAMETER Session
  The session folder name, for example 2026-11-22_190000-discord.

.PARAMETER Real
  Publish to the real bridge (live control port in shared/ports.json, or MCP_CONTROL_HOST's) instead of the test bridge.

.PARAMETER Server
  Which test server's bridge gets the publish (A, B or C; default A). Take that server's lock first.

.PARAMETER DryRun
  Only print what would be done.
#>
param(
  [Parameter(Mandatory, Position = 0)][string]$Session,
  [switch]$Real,
  [ValidateSet('A', 'B', 'C')][string]$Server = 'A',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
if ($Session -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]*$') { Write-Host "Not a session folder name: $Session"; exit 2 }
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
# The ports live in shared/ports.json (generated from shared/src/ports.ts).
if ($Real -and $PSBoundParameters.ContainsKey('Server')) { Write-Host '-Server only picks a test server; it cannot be combined with -Real.'; exit 2 }
$portTable = (Get-Content (Join-Path (Split-Path -Parent (Split-Path -Parent $here)) 'shared/ports.json') -Raw | ConvertFrom-Json).ports
$port = if ($Real) { $portTable.live.control } else { $portTable."test$Server".control }
Write-Host "Session $Session; publish goes to the $(if ($Real) { 'REAL' } else { "test server $Server" }) bridge on port $port."

$autoArgs = @('-Session', $Session, '-Port', $port)
if ($DryRun) { $autoArgs += '-DryRun' }
# Without -Real the publish must stay on this PC, even when MCP_CONTROL_HOST points at the Pi.
if (-not $Real) { $env:FOUNDRY_AI_CONTROL_HOST = '127.0.0.1' }
$started = Get-Date
& pwsh -NoProfile -File (Join-Path $here 'auto.ps1') @autoArgs
$code = $LASTEXITCODE
if ($DryRun) { exit $code }

. (Join-Path $here '..\..\scripts\data-folder.ps1')
$sessions = if ($env:FVTT_SESSIONS_DIR) { $env:FVTT_SESSIONS_DIR } else { Get-DataFolder 'FoundrySessions' }
$folder = Join-Path $sessions $Session
if (-not (Test-Path $folder)) { Write-Host "No folder $Session in $sessions (not pulled yet, or a wrong name)."; exit 1 }
$status = Join-Path $folder 'notes\status.json'
# A status file older than this run is from an earlier pass (another pass held the lock, or consent was missing).
if ((Test-Path $status) -and (Get-Item $status).LastWriteTime -lt $started) {
  Write-Host 'No new run: another pass holds the lock, consent is missing, or the notes are already approved. See auto.log in the sessions folder.'
  exit 1
}
if (Test-Path $status) {
  $s = Get-Content $status -Raw -Encoding utf8 | ConvertFrom-Json
  Write-Host "Status: $($s.state) - $($s.message)"
  if ($s.state -ne 'published' -and -not $DryRun) { Write-Host 'Not finished: run the same command again.'; if ($code -eq 0) { $code = 1 } }
}
elseif (-not $DryRun) { Write-Host 'No notes\status.json: nothing was written. See auto.log in the sessions folder.'; if ($code -eq 0) { $code = 1 } }
exit $code
