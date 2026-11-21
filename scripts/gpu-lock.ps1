# Take and release the GPU lock (scripts/test-env/lock.ps1 -Server GPU) around a GPU job, so a
# transcription or a narration never runs on top of another GPU job (two NVIDIA driver crashes,
# 2026-11). Dot-source this file; it only defines functions.
#
#   Enter-GpuLock -Holder 'voice-stack transcribe' -Purpose '...' [-Root <lock folder>]  -> the session id
#   Exit-GpuLock  -Session <id> [-Root <lock folder>]
#
# Enter-GpuLock throws a plain message that names the holder when the lock is taken. -Root is for tests.
$script:GpuLockScript = Join-Path $PSScriptRoot 'test-env/lock.ps1'

function Invoke-GpuLockScript([string[]]$LockArgs, [string]$Root) {
  $a = @('-NoProfile', '-File', $script:GpuLockScript) + $LockArgs + @('-Server', 'GPU')
  if ($Root) { $a += @('-Root', $Root) }
  $out = & pwsh @a 2>&1 | ForEach-Object { "$_" }
  return [pscustomobject]@{ Code = $LASTEXITCODE; Text = (($out -join ' ').Trim()) }
}

function Enter-GpuLock {
  param([Parameter(Mandatory)][string]$Holder, [string]$Purpose = 'GPU job', [string]$Root)
  $session = "gpu-job-$PID"
  $r = Invoke-GpuLockScript @('take', '-Holder', $Holder, '-Session', $session, '-Purpose', $Purpose) $Root
  if ($r.Code -ne 0) {
    # lock.ps1 says "GPU lock is held by <who> (session ...) since ...": keep that, drop the how-to lines.
    $held = ($r.Text -split 'Wait, or join')[0].Trim()
    throw "The GPU is in use, nothing was started. $held"
  }
  return $session
}

function Exit-GpuLock {
  param([Parameter(Mandatory)][string]$Session, [string]$Root)
  $r = Invoke-GpuLockScript @('release', '-Session', $Session) $Root
  if ($r.Code -ne 0) { Write-Warning "Could not release the GPU lock: $($r.Text)" }
}
