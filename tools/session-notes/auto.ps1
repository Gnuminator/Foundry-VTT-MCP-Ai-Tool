<#
.SYNOPSIS
  One pass of the automatic session pipeline: transcribe finished recordings, write missing
  notes, hand the notes to the bridge. Safe to run often; it does nothing when nothing is due.
  Nothing here deletes audio: recordings are kept on this PC (D-097).

.DESCRIPTION
  Meant for a scheduled task (for example every hour while the PC is on). For each folder in the
  sessions folder (FVTT_SESSIONS_DIR, default Documents\FoundrySessions):

  0. Consent gate: a session is skipped, with the reason in notes\status.json, unless every
     speaker in raw\session.json has a recorded yes in <sessions>\consent.json (D-097).
  1. A finished Discord recording (raw\session.json exists) with audio but no
     timeline\timeline.jsonl: build names.txt from Foundry if the bridge answers (skipped
     otherwise), then transcribe with scripts\voice-stack.ps1 (GPU, Docker).
  2. A timeline without finished notes (notes\notes.json with a session summary): run the notes
     writer. A usage limit only pauses it; the next pass continues.
  3. Finished notes not yet approved: `session-notes publish` hands them to the bridge (once),
     which puts them into a GM-only Foundry journal by itself (D-087), and writes
     notes\approved.json once the GM revealed or approved the Recap. A bridge that is not
     running only means "next pass" (FOUNDRY_AI_CONTROL_PORT picks the port, FVTT_WORLD the
     world while Foundry is closed).

  A lock file keeps two passes from overlapping. The report goes to the console and to
  <sessions>\auto.log.

.PARAMETER DryRun
  Only print what would be done.
#>
param([switch]$DryRun)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Resolve-Path (Join-Path $here '..\..')
$voiceStack = Join-Path $repo 'scripts\voice-stack.ps1'
$sessions = if ($env:FVTT_SESSIONS_DIR) { $env:FVTT_SESSIONS_DIR } else { Join-Path $env:USERPROFILE 'Documents\FoundrySessions' }
if (-not (Test-Path $sessions)) { Write-Host "No sessions folder at $sessions; nothing to do."; exit 0 }

$log = Join-Path $sessions 'auto.log'
function Say([string]$text) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $text"
  Write-Host $line
  if (-not $DryRun) { Add-Content -Path $log -Value $line -Encoding utf8 }
}

$lock = Join-Path $sessions '.auto.lock'
if (Test-Path $lock) {
  $age = (Get-Date) - (Get-Item $lock).LastWriteTime
  # The lock holds the PID of the pass that made it: a killed pass (sleep, reboot, closed app) is
  # stale at once, not after 6 h. An unreadable PID falls back to the age test alone.
  $lockPid = 0
  [void][int]::TryParse(((Get-Content $lock -ErrorAction SilentlyContinue) -join '').Trim(), [ref]$lockPid)
  # A PID can be reused after a reboot: the process must have started before the lock was written.
  $holder = if ($lockPid -gt 0) { Get-Process -Id $lockPid -ErrorAction SilentlyContinue } else { $null }
  $alive = ($null -ne $holder) -and ($holder.StartTime -le (Get-Item $lock).LastWriteTime.AddMinutes(1))
  # No readable PID (empty or junk lock): trust it for 10 minutes only.
  $unknownHolder = ($lockPid -le 0) -and ($age.TotalMinutes -lt 10)
  if ($age.TotalHours -lt 6 -and ($alive -or $unknownHolder)) { Write-Host "Another pass is running (lock from $([int]$age.TotalMinutes) min ago)."; exit 0 }
  Say "Removing a stale lock ($([int]$age.TotalMinutes) min old, pass $lockPid $(if ($alive) { 'still listed' } else { 'gone' }))."
}
if (-not $DryRun) { Set-Content -Path $lock -Value $PID }

$passStart = Get-Date
function Write-Status([string]$folder, [string]$state, [string]$message, [switch]$KeepFresh) {
  # notes\status.json, the same file `session_notes run` writes: how the last pass ended.
  # -KeepFresh leaves a status the notes run wrote in this pass (it is more specific).
  if ($DryRun) { return }
  try {
    $notesDir = Join-Path $folder 'notes'
    $existing = Join-Path $notesDir 'status.json'
    if ($KeepFresh -and (Test-Path $existing) -and (Get-Item $existing).LastWriteTime -ge $passStart) { return }
    New-Item -ItemType Directory -Force -Path $notesDir | Out-Null
    $at = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
    $json = [ordered]@{ state = $state; message = $message; at = $at } | ConvertTo-Json
    [System.IO.File]::WriteAllText((Join-Path $notesDir 'status.json'), $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
  } catch { Say "  could not write status.json: $_" }
}

function Invoke-Notes([string[]]$argList) {
  # Python's output goes straight to the console (and the log); only the exit code is returned.
  $env:PYTHONPATH = Join-Path $here 'src'
  & python -m session_notes @argList 2>&1 | ForEach-Object { Say "  $_" }
  return $LASTEXITCODE
}

function Test-NotesDone([string]$folder) {
  $json = Join-Path $folder 'notes\notes.json'
  if (-not (Test-Path $json)) { return $false }
  try { return $null -ne (Get-Content $json -Raw -Encoding utf8 | ConvertFrom-Json).session } catch { return $false }
}

$audioPattern = '\.(ogg|oga|opus|flac|wav|mp3|m4a)$'
try {
  # 0. With the recorder on the Pi (FVTT_PI_HOST set, D-068): copy its finished recordings here.
  if ($env:FVTT_PI_HOST) {
    if ($DryRun) { & pwsh -NoProfile -File (Join-Path $here 'pull.ps1') -DryRun | ForEach-Object { Say "  pull: $_" } }
    else { & pwsh -NoProfile -File (Join-Path $here 'pull.ps1') | ForEach-Object { Say "  pull: $_" } }
  }

  foreach ($dir in Get-ChildItem $sessions -Directory | Where-Object { $_.Name -notlike '.*' } | Sort-Object Name) {
    $folder = $dir.FullName
    $timeline = Join-Path $folder 'timeline\timeline.jsonl'
    $recorded = Test-Path (Join-Path $folder 'raw\session.json')
    $hasAudio = @(Get-ChildItem $folder -File | Where-Object { $_.Name -match $audioPattern }).Count -gt 0

    # Consent gate (D-097): nothing is transcribed, written or published for a session unless every
    # speaker has a recorded yes (consent.json, `session-notes consent`). Work already handed to
    # the GM (approved) is left alone.
    $due = (($recorded -and $hasAudio -and -not (Test-Path $timeline)) -or
            ((Test-Path $timeline) -and -not (Test-NotesDone $folder)) -or
            ((Test-NotesDone $folder) -and -not (Test-Path (Join-Path $folder 'notes\approved.json'))))
    if ($due) {
      $consentArgs = @('consent', 'check', $folder)
      if (-not $DryRun -and -not (Test-NotesDone $folder)) { $consentArgs += '--write-status' }
      $consentCode = Invoke-Notes $consentArgs
      if ($consentCode -ne 0) { Say "$($dir.Name): not processed (consent check exit $consentCode; 77 = recording consent is missing)"; continue }
    }

    if ($recorded -and $hasAudio -and -not (Test-Path $timeline)) {
      Say "$($dir.Name): transcribing"
      if (-not $DryRun) {
        try { & pwsh -NoProfile -File $voiceStack names $folder *> $null } catch { }
        if (-not (Test-Path (Join-Path $folder 'names.txt'))) { Say "$($dir.Name): no names.txt (bridge not reachable); transcribing without hotwords" }
        & pwsh -NoProfile -File $voiceStack transcribe $folder
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $timeline)) { Say "$($dir.Name): transcription failed (exit $LASTEXITCODE)"; Write-Status $folder 'failed' "Transcription failed (exit $LASTEXITCODE); the next pass tries again."; continue }
      }
    }

    if ((Test-Path $timeline) -and -not (Test-NotesDone $folder)) {
      Say "$($dir.Name): writing notes"
      if (-not $DryRun) {
        $code = Invoke-Notes @('run', $folder)
        switch ($code) {
          0 { Say "$($dir.Name): notes done" }
          75 { Say "$($dir.Name): paused (usage limit, or Claude not logged in: see notes\status.json); the next pass continues" }
          76 { Say "$($dir.Name): some scenes are still raw; the next pass tries them again" }
          default {
            Say "$($dir.Name): notes failed (exit $code), see notes\audit.jsonl"
            Write-Status $folder 'failed' "The notes run failed (exit $code); the next pass tries again." -KeepFresh
          }
        }
        if ($code -eq 75) { break }
      }
    }

    if ((Test-NotesDone $folder) -and -not (Test-Path (Join-Path $folder 'notes\approved.json'))) {
      if ($DryRun) { Say "$($dir.Name): would publish the notes to the bridge" }
      else {
        $code = Invoke-Notes @('publish', $folder)
        if ($code -eq 1) { Say "$($dir.Name): publish failed"; Write-Status $folder 'failed' 'Publishing the notes to Foundry failed; the next pass tries again.' }
        elseif ($code -eq 0) { Write-Status $folder 'published' 'The notes are in Foundry.' }
        elseif ($code -eq 3) { Say "$($dir.Name): publish: bridge not reachable, will retry"; Write-Status $folder 'waiting' 'The notes are written but Foundry cannot take them yet (bridge not reachable); the next pass tries again.' }
      }
    }
  }
} finally {
  if (-not $DryRun) { Remove-Item $lock -ErrorAction SilentlyContinue }
}
