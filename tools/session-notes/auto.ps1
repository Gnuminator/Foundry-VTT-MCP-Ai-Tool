<#
.SYNOPSIS
  One pass of the automatic session pipeline: transcribe finished recordings, write missing
  notes, delete audio past its retention date (D-072). Safe to run often; it does nothing when
  nothing is due.

.DESCRIPTION
  Meant for a scheduled task (for example every hour while the PC is on). For each folder in the
  sessions folder (FVTT_SESSIONS_DIR, default Documents\FoundrySessions):

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
  4. Always: `session-notes cleanup --yes` (audio 14 days after the GM's approval).

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
  if ($age.TotalHours -lt 6) { Write-Host "Another pass is running (lock from $([int]$age.TotalMinutes) min ago)."; exit 0 }
  Say "Removing a stale lock ($([int]$age.TotalHours) h old)."
}
if (-not $DryRun) { Set-Content -Path $lock -Value $PID }

function Invoke-Notes([string[]]$argList) {
  # Python's output goes straight to the console (and the log); only the exit code is returned.
  $env:PYTHONPATH = Join-Path $here 'src'
  & python -m session_notes @argList 2>&1 |
    Where-Object { "$_" -notmatch '^No session has audio' } |
    ForEach-Object { Say "  $_" }
  return $LASTEXITCODE
}

function Test-NotesDone([string]$folder) {
  $json = Join-Path $folder 'notes\notes.json'
  if (-not (Test-Path $json)) { return $false }
  try { return $null -ne (Get-Content $json -Raw -Encoding utf8 | ConvertFrom-Json).session } catch { return $false }
}

$audioPattern = '\.(ogg|oga|opus|flac|wav|mp3|m4a)$'
try {
  foreach ($dir in Get-ChildItem $sessions -Directory | Sort-Object Name) {
    $folder = $dir.FullName
    $timeline = Join-Path $folder 'timeline\timeline.jsonl'
    $recorded = Test-Path (Join-Path $folder 'raw\session.json')
    $hasAudio = @(Get-ChildItem $folder -File | Where-Object { $_.Name -match $audioPattern }).Count -gt 0

    if ($recorded -and $hasAudio -and -not (Test-Path $timeline)) {
      Say "$($dir.Name): transcribing"
      if (-not $DryRun) {
        try { & pwsh -NoProfile -File $voiceStack names $folder *> $null } catch { }
        if (-not (Test-Path (Join-Path $folder 'names.txt'))) { Say "$($dir.Name): no names.txt (bridge not reachable); transcribing without hotwords" }
        & pwsh -NoProfile -File $voiceStack transcribe $folder
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $timeline)) { Say "$($dir.Name): transcription failed (exit $LASTEXITCODE)"; continue }
      }
    }

    if ((Test-Path $timeline) -and -not (Test-NotesDone $folder)) {
      Say "$($dir.Name): writing notes"
      if (-not $DryRun) {
        $code = Invoke-Notes @('run', $folder)
        switch ($code) {
          0 { Say "$($dir.Name): notes done" }
          75 { Say "$($dir.Name): paused by the usage limit; the next pass continues" }
          default { Say "$($dir.Name): notes failed (exit $code), see notes\audit.jsonl" }
        }
        if ($code -eq 75) { break }
      }
    }

    if ((Test-NotesDone $folder) -and -not (Test-Path (Join-Path $folder 'notes\approved.json'))) {
      if ($DryRun) { Say "$($dir.Name): would publish the notes to the bridge" }
      else {
        $code = Invoke-Notes @('publish', $folder)
        if ($code -eq 1) { Say "$($dir.Name): publish failed" }
      }
    }
  }

  $cleanupArgs = if ($DryRun) { @('cleanup') } else { @('cleanup', '--yes') }
  $null = Invoke-Notes $cleanupArgs
} finally {
  if (-not $DryRun) { Remove-Item $lock -ErrorAction SilentlyContinue }
}
