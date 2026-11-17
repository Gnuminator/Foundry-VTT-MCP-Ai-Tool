# Where the data folders live (FoundryDemo, FoundryNarration, FoundryRehearsals, FoundrySessions,
# VoiceBench, VoiceTest). Dot-source it: . "$PSScriptRoot\..\..\scripts\data-folder.ps1"
#
# Without FVTT_DATA_DIR a folder is Documents\<name> in the user folder (the old place). With it,
# <FVTT_DATA_DIR>\<name>, unless that is missing and the old folder exists (not moved yet).
# The same rule as dataFolder() in shared/src/sessions-dir.ts.
function Get-DataFolder([string]$Name) {
  $legacy = Join-Path $env:USERPROFILE (Join-Path 'Documents' $Name)
  if (-not $env:FVTT_DATA_DIR) { return $legacy }
  $moved = Join-Path $env:FVTT_DATA_DIR $Name
  if ((Test-Path -LiteralPath $moved) -or -not (Test-Path -LiteralPath $legacy)) { return $moved }
  return $legacy
}
