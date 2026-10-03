# Reset the demo world "ai-tool-demo" on the local test server to its saved clean
# state, so every demo take and docs screenshot starts the same (I-082).
#
#   pwsh scripts/test-env/reset-demo-world.ps1            stop the test server, restore the snapshot
#   pwsh scripts/test-env/reset-demo-world.ps1 -Start     ... then start it into ai-tool-demo
#   pwsh scripts/test-env/reset-demo-world.ps1 -Snapshot  stop, save the current state as the clean one
#   pwsh scripts/test-env/reset-demo-world.ps1 -Init      create ai-tool-demo once, as a copy of ai-tool-test
#
# The clean state is three folders, kept in <Root>/demo/snapshot:
#   world     <Root>/data/Data/worlds/ai-tool-demo     (Foundry's world, incl. chat and users)
#   vault     <Root>/vault/ai-tool-demo                (bridge vault: session log, changes, undo)
#   obsidian  <ObsidianDir>/Campaigns/ai-tool-demo     (the test Obsidian vault's notes for it)
# The service logs start empty on every start.ps1 run.
#
# Test server only: works on the ai-tool-demo world and nothing else, refuses the live
# bridge ports 31414-31416, and refuses to stop Foundry while it runs another world
# (another session may be testing) unless -Force.
param(
  [switch]$Start,
  [switch]$Snapshot,
  [switch]$Init,
  [switch]$Force
)

. (Join-Path $PSScriptRoot 'config.ps1')
Assert-SafePorts

$DemoWorld = 'ai-tool-demo'
$SourceWorld = 'ai-tool-test'
$worldsDir = Join-Path $TestEnv.DataDir 'Data' 'worlds'
$snapRoot = Join-Path $TestEnv.Root 'demo' 'snapshot'
$parts = [ordered]@{
  world = Join-Path $worldsDir $DemoWorld
  vault = Join-Path $TestEnv.VaultDir $DemoWorld
}
if ($TestEnv.ObsidianDir) { $parts['obsidian'] = Join-Path $TestEnv.ObsidianDir 'Campaigns' $DemoWorld }

# Every folder this script writes must sit inside the test root or the test Obsidian folder.
foreach ($path in @($parts.Values) + $snapRoot) {
  $full = [IO.Path]::GetFullPath($path)
  $inside = $full.StartsWith([IO.Path]::GetFullPath($TestEnv.Root) + [IO.Path]::DirectorySeparatorChar) -or
    ($TestEnv.ObsidianDir -and $full.StartsWith([IO.Path]::GetFullPath($TestEnv.ObsidianDir) + [IO.Path]::DirectorySeparatorChar))
  $isDemoPath = ($full -match [regex]::Escape($DemoWorld)) -or ($full -eq [IO.Path]::GetFullPath($snapRoot))
  if (-not $inside -or -not $isDemoPath) {
    throw "Refusing to write outside the test server's demo folders: $full"
  }
}

function Get-RunningWorld {
  if (-not (Test-PortOpen $TestEnv.FoundryPort)) { return $null }
  try {
    $status = Invoke-RestMethod -Uri "http://localhost:$($TestEnv.FoundryPort)/api/status" -TimeoutSec 5
    return [string]$status.world
  } catch {
    return ''
  }
}

function Stop-TestServer {
  $running = Get-RunningWorld
  if ($running -and $running -ne $DemoWorld -and -not $Force) {
    throw "Foundry is running world '$running', not $DemoWorld. Another session may be using the test server; ask first, then rerun with -Force."
  }
  & (Join-Path $PSScriptRoot 'stop.ps1')
}

# robocopy /MIR: make $To an exact copy of $From. Exit codes below 8 are success.
function Copy-Mirror([string]$From, [string]$To) {
  New-Item -ItemType Directory -Force $To | Out-Null
  & robocopy $From $To /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy $From -> $To failed (exit $LASTEXITCODE)." }
  $global:LASTEXITCODE = 0
}

if ($Init) {
  if (Test-Path $parts.world) { throw "$DemoWorld already exists; use -Snapshot or a plain reset." }
  $source = Join-Path $worldsDir $SourceWorld
  if (-not (Test-Path $source)) { throw "No $SourceWorld world to copy from." }
  Stop-TestServer
  Copy-Mirror $source $parts.world
  $manifestPath = Join-Path $parts.world 'world.json'
  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  $manifest.id = $DemoWorld
  $manifest.title = 'AI Tool Demo'
  $manifest | ConvertTo-Json -Depth 20 | Set-Content $manifestPath -Encoding utf8NoBOM
  Write-Host "Created $DemoWorld from $SourceWorld. Tidy it in Foundry, then save it with -Snapshot."
  if ($Start) { & (Join-Path $PSScriptRoot 'start.ps1') -World $DemoWorld }
  return
}

if (-not (Test-Path $parts.world)) { throw "No $DemoWorld world yet; create it with -Init." }

if ($Snapshot) {
  Stop-TestServer
  New-Item -ItemType Directory -Force $snapRoot | Out-Null
  $saved = @{}
  foreach ($name in $parts.Keys) {
    $target = Join-Path $snapRoot $name
    if (Test-Path $parts[$name]) {
      Copy-Mirror $parts[$name] $target
      $saved[$name] = $true
    } else {
      if (Test-Path $target) { Remove-Item $target -Recurse -Force }
      $saved[$name] = $false
    }
  }
  [ordered]@{ world = $DemoWorld; savedAt = (Get-Date).ToString('o'); parts = $saved } |
    ConvertTo-Json | Set-Content (Join-Path $snapRoot 'snapshot.json') -Encoding utf8NoBOM
  Write-Host "Saved the clean state of $DemoWorld in $snapRoot."
} else {
  $info = Join-Path $snapRoot 'snapshot.json'
  if (-not (Test-Path $info)) { throw "No snapshot yet in $snapRoot; save one with -Snapshot." }
  $saved = (Get-Content $info -Raw | ConvertFrom-Json).parts
  Stop-TestServer
  foreach ($name in $parts.Keys) {
    $from = Join-Path $snapRoot $name
    if ($saved.$name -and (Test-Path $from)) {
      Copy-Mirror $from $parts[$name]
    } elseif (Test-Path $parts[$name]) {
      # Not part of the clean state: whatever a take wrote here goes.
      Remove-Item $parts[$name] -Recurse -Force
    }
  }
  Write-Host "Restored $DemoWorld from the snapshot of $((Get-Content $info -Raw | ConvertFrom-Json).savedAt)."
}

if ($Start) { & (Join-Path $PSScriptRoot 'start.ps1') -World $DemoWorld }
