<#
.SYNOPSIS
  Builds the bundle that takes a played Plan B world back to the Pi (docs/dev/PLAN-B.md, "After the night").

.DESCRIPTION
  Runs on this PC only and never runs stage 11. It reads <Root>\state.json and refuses while a Plan B
  service still runs (run stop.ps1 first) and when the copy was never played on a game night (the Pi
  has it all already). Then it calls scripts/pi/push-world.ps1 -PushBack on Plan B's Data folder: the
  world keeps the Pi's own Gamemaster password, and MANIFEST.txt records the Pi backup Plan B restored
  (based-on-snapshot), so stage 11 can refuse when the Pi's world changed after it.

  By default it only builds and checks (-NoUpload). With -Upload it also sends the bundle to the Pi
  and prints the stage 11 command; a session runs that only after a dietpi-backup 1 snapshot and your OK.

.PARAMETER Root      Plan B's folder (default C:\FoundryPlanB).
.PARAMETER Upload    Send the bundle to the Pi (default: build and check only).
.PARAMETER Modules   Module ids to ship (push-world's default: aitool-content, dnd-players-handbook, foundryvtt-actor-studio).
.PARAMETER PiHost    The SSH name of the Pi (default foundry-pi).
.PARAMETER OutDir    Where the bundle is built (default a new folder under $env:TEMP).
.PARAMETER AllowSettingKeys  Passed to push-world.ps1: reviewed ddb-importer.* setting keys. The default is the list the
                     Strahd world needed (checked against the Pi backup of 2026-10-09): its ddb-importer settings
                     only name compendiums, a version and the import proxy's local address.
.PARAMETER AllowMissing      Passed to push-world.ps1: reviewed known missing asset paths. The default is the list of the
                     first push of the Strahd world (2026-10-06, vault "Licensed content import"): Tasha's and
                     Xanathar's journal images (on no disk anywhere), tcoe/images/cover.jpg and two refs inside the
                     official PHB module. A push-back sends back the world that came from the Pi, so the same holds.
#>
[CmdletBinding()]
param(
  [string]$Root = '',
  [switch]$Upload,
  [string[]]$Modules = @(),
  [string]$PiHost = 'foundry-pi',
  [string]$OutDir = '',
  [string[]]$AllowSettingKeys = @('ddb-importer.entity-*', 'ddb-importer.allowed-weapon-property-sources', 'ddb-importer.api-endpoint', 'ddb-importer.data-version'),
  [string[]]$AllowMissing = @(
    'ddb-images/adventures/Tasha_s_Cauldron_of_Everything/*', 'ddb-images/adventures/Xanathar_s_Guide_to_Everything/*',
    'tcoe/images/cover.jpg', 'modules/dnd-players-handbook/assets/subjects/empty.webp', 'systems/dnd5e/subjects/beast/Raven.webp')
)

. (Join-Path $PSScriptRoot 'lib.ps1')
if (-not $Root) { $Root = $PlanBDefaults.Root }
$L = Get-PlanBLayout $Root
$state = Read-PlanBState $L

# The services start.ps1 recorded that still run (the same test stop.ps1 uses).
$running = @()
if ($state -and $state.PSObject.Properties['services'] -and $state.services) {
  foreach ($p in $state.services.PSObject.Properties) {
    $s = $p.Value
    $id = [int]$s.pid
    $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
    $d = Resolve-PlanBStop @{
      Exists        = [bool]$proc
      StartTime     = if ($proc) { Get-PlanBStartTime $id } else { $null }
      RecordedStart = $s.started
      CommandLine   = if ($proc) { Get-PlanBCommandLine $id } else { $null }
      Marker        = $s.log
    }
    if ($d.Action -in 'stop', 'unknown') { $running += $p.Name }
  }
}

$pb = Resolve-PlanBPushBack $state -Running $running
if (-not $pb.Ok) { [Console]::Error.WriteLine("REFUSED: $($pb.Message)"); exit 1 }
Write-Host "Pushing back '$($pb.World)' (game night $($pb.PlayedAt)), based on the Pi backup of $($pb.BasedOn) (UTC)."

$pw = @{
  DataPath        = Join-Path $L.DataDir 'Data'
  World           = $pb.World
  PushBack        = $true
  BasedOnSnapshot = $pb.BasedOn
  FoundryUrl      = "http://localhost:$($pb.FoundryPort)"
  PiHost          = $PiHost
  NoUpload        = -not $Upload
}
# Plan B's own Foundry reads the world with the same classic-level the Pi has; the test server's is the fallback.
$level = Join-Path $L.AppDir 'node_modules' 'classic-level'
if (Test-Path -LiteralPath $level -PathType Container) { $pw.LevelModule = $level }
if ($Modules.Count) { $pw.Modules = $Modules }
if ($OutDir) { $pw.OutDir = $OutDir }
if ($AllowSettingKeys.Count) { $pw.AllowSettingKeys = $AllowSettingKeys }
if ($AllowMissing.Count) { $pw.AllowMissing = $AllowMissing }
& (Join-Path $PlanBRepoRoot 'scripts' 'pi' 'push-world.ps1') @pw
if (-not $Upload) {
  Write-Host ''
  Write-Host 'Built and checked; nothing was sent to the Pi. Next (a session, after a dietpi-backup 1 snapshot and your OK):'
  Write-Host '  .\scripts\plan-b\push-back.ps1 -Upload, then the stage 11 command it prints.'
}
