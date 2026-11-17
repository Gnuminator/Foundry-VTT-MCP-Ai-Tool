# Where the data folders live (FoundryDemo, FoundryNarration, FoundryRehearsals, FoundrySessions,
# VoiceBench, VoiceTest). Dot-source it: . "$PSScriptRoot\..\..\scripts\data-folder.ps1"
#
# Without FVTT_DATA_DIR a folder is Documents\<name> in the user folder (the old place). With it,
# <FVTT_DATA_DIR>\<name>, unless that is missing and the old folder exists (not moved yet).
# The same rule as dataFolder() in shared/src/sessions-dir.ts.
function Get-DataFolder([string]$Name) {
  $legacy = Join-Path $env:USERPROFILE (Join-Path 'Documents' $Name)
  if (-not $env:FVTT_DATA_DIR) { return $legacy }
  $moved = [IO.Path]::Combine($env:FVTT_DATA_DIR, $Name)
  if ((Test-Path -LiteralPath $moved) -or -not (Test-Path -LiteralPath $legacy)) { return $moved }
  return $legacy
}

# The folders at the root of the drive (FoundryAI, FoundryCampaign, FoundryPlanB,
# FoundryPlanB-drill2): C:\<name> until they are moved, <FVTT_DATA_DIR>\<name> after. The same
# rule as rootFolder() in shared/src/root-folders.ts.
function Get-RootFolder([string]$Name) {
  $legacy = "C:\$Name"
  # A relative FVTT_DATA_DIR is ignored (also C:data, like Node's isAbsolute). Path.Combine, not
  # Join-Path: Join-Path throws when the drive is missing (an unplugged one), and then the old
  # place must still answer.
  $d = $env:FVTT_DATA_DIR
  if (-not $d -or -not [IO.Path]::IsPathRooted($d) -or $d -match '^[A-Za-z]:(?![\\/])') { return $legacy }
  $moved = [IO.Path]::Combine($env:FVTT_DATA_DIR, $Name)
  if ((Test-Path -LiteralPath $moved) -or -not (Test-Path -LiteralPath $legacy)) { return $moved }
  return $legacy
}

# Maps a path under one of those folders (as scripts/machine-paths.json writes them, C:\<name>\...)
# to where the folder is now. Any other path comes back unchanged.
function Resolve-RootPath([string]$Path) {
  if ($Path -cmatch '^C:[\\/]+(Foundry(?:AI|Campaign|PlanB(?:-drill2)?))(?:[\\/]+(.*))?$') {
    $base = Get-RootFolder $Matches[1]
    if ($Matches[2]) { return [IO.Path]::Combine($base, $Matches[2]) }
    return $base
  }
  return $Path
}
