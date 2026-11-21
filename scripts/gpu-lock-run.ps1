#requires -Version 7
<#
.SYNOPSIS
  Run a script that uses the GPU while holding the GPU lock; release it afterwards, also on failure.

.DESCRIPTION
  pwsh scripts/gpu-lock-run.ps1 -Holder "Previously on narration" -Purpose "..." -Script <script.ps1> -ArgsJson '["make","x.md"]'
  -ArgsJson is a JSON array, so arguments that start with -- reach the script untouched.
  Exit code: the job's own; 1 when the GPU is in use (the message names the holder, nothing was started).
#>
param(
  [Parameter(Mandatory)][string]$Holder,
  [Parameter(Mandatory)][string]$Script,
  [string]$ArgsJson = '[]',
  [string]$Purpose = 'GPU job',
  [string]$Root
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'gpu-lock.ps1')
$jobArgs = @(ConvertFrom-Json $ArgsJson)
try { $session = Enter-GpuLock -Holder $Holder -Purpose $Purpose -Root $Root }
catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
$code = 1
try {
  & pwsh -NoProfile -File $Script @jobArgs
  $code = $LASTEXITCODE
} finally {
  Exit-GpuLock -Session $session -Root $Root
}
exit $code
