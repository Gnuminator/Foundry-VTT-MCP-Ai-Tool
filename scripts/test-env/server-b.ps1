# Create or refresh test server B from server A. B runs kit runs and soak runs, so A stays free
# for quick checks and live:roundtrip. Both run A's Foundry install and licence; nobody plays on B.
#
#   pwsh scripts/test-env/server-b.ps1                    first setup, or refresh B's packages
#   pwsh scripts/test-env/server-b.ps1 -World strahd-kit  copy one world from A again (replaces B's)
#
# Copies from A (C:\FoundryTest) to B (C:\FoundryTestB, ports in servers.json):
#   Config  license.json and admin.txt as they are; options.json with B's data path and port
#   Data    everything but the worlds (systems, modules, assets, imports), mirrored, so B has A's
#           package versions after every run; B's own module copy (foundry-mcp-bridge, dialing B's
#           bridge) is never touched here: sync-module.ps1 -Server B writes it at the end
#   worlds  the everyday world (ai-tool-test) and the kit worlds (KIT_WORLDS in
#           scripts/test-kit/lib/contract.mjs) that B does not have yet, each with its kit manifest
#           (<kit home>/worlds/<id> to <kit home>/worlds-B/<id>); -World copies one again
# Refuses while B's Foundry runs, and does not copy a world A's Foundry has open. Never prints
# the licence or the admin password (it copies the files, it does not read them).
param(
  [ValidatePattern('^[a-z0-9][a-z0-9-]{0,63}$')] [string]$World = ''
)

$Server = 'B'
. (Join-Path $PSScriptRoot 'config.ps1')
Assert-SafePorts

# Keep in step with KIT_WORLDS in scripts/test-kit/lib/contract.mjs (targets.test.mjs checks it).
$KitWorlds = @('ai-tool-kit-srd', 'ai-tool-kit-licensed', 'strahd-kit')

$fromRoot = [string]$settingsA.Root
$fromData = Join-Path $fromRoot 'data'
$toData = $TestEnv.DataDir
if ([IO.Path]::GetFullPath($fromRoot).TrimEnd('\', '/') -eq [IO.Path]::GetFullPath($TestEnv.Root).TrimEnd('\', '/')) {
  throw "Server B's root is server A's ($fromRoot); give B its own Root in local.B.json."
}
if (-not (Test-Path (Join-Path $fromData 'Data' 'worlds'))) { throw "Server A has no data folder at $fromData; set up A first (setup.ps1)." }
if (Test-PortOpen $TestEnv.FoundryPort) {
  throw "Server B's Foundry runs (port $($TestEnv.FoundryPort)); stop it first: pwsh scripts/test-env/stop.ps1 -Server B"
}

# The world A's Foundry has open, or $null (A is down, or at the setup screen).
function Get-AOpenWorld {
  if (-not (Test-PortOpen ([int]$settingsA.FoundryPort))) { return $null }
  try {
    $s = Invoke-RestMethod -Uri "http://127.0.0.1:$($settingsA.FoundryPort)/api/status" -TimeoutSec 5
    if ($s.world) { return [string]$s.world }
  } catch { }
  return $null
}

# Mirrors a folder (Windows: robocopy, elsewhere: rsync). $Exclude are folder names under $From
# that are neither copied nor deleted on the B side.
function Sync-Folder([string]$From, [string]$To, [string[]]$Exclude = @()) {
  New-Item -ItemType Directory -Force $To | Out-Null
  if ($IsWindows) {
    $robo = @($From, $To, '/MIR', '/R:2', '/W:2', '/NFL', '/NDL', '/NP', '/NJH')
    if ($Exclude.Count) { $robo += '/XD'; $robo += @($Exclude | ForEach-Object { Join-Path $From $_ }) }
    & robocopy @robo | Select-Object -Last 8 | Out-Host
    # robocopy: 0-7 is success (files copied, extras removed), 8 and up is a failure.
    if ($LASTEXITCODE -ge 8) { throw "robocopy $From -> $To failed (exit $LASTEXITCODE)." }
    $global:LASTEXITCODE = 0
  } else {
    $rsync = @('-a', '--delete')
    foreach ($e in $Exclude) { $rsync += "--exclude=/$($e -replace '\\', '/')" }
    & rsync @rsync "$($From.TrimEnd('/'))/" "$($To.TrimEnd('/'))/"
    if ($LASTEXITCODE -ne 0) { throw "rsync $From -> $To failed (exit $LASTEXITCODE)." }
  }
}

$kitHome = if ($env:TEST_KIT_HOME) { $env:TEST_KIT_HOME } else { Join-Path $fromRoot 'test-kit' }

function Copy-World([string]$Id) {
  $from = Join-Path $fromData 'Data' 'worlds' $Id
  $to = Join-Path $toData 'Data' 'worlds' $Id
  if (-not (Test-Path (Join-Path $from 'world.json'))) {
    Write-Host "world $Id : not on server A; skipped"
    return
  }
  if ((Get-AOpenWorld) -eq $Id) {
    Write-Host "world $Id : server A's Foundry has it open; not copied (run again once A has left it)"
    return
  }
  Write-Host "world $Id : copying from A ..."
  Sync-Folder $from $to
  # Foundry's LevelDB folders carry a LOCK file; a copied one is harmless, but start clean.
  Get-ChildItem $to -Recurse -File -Filter 'LOCK' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
  $manifest = Join-Path $kitHome 'worlds' $Id 'manifest.json'
  if (Test-Path $manifest) {
    $dest = Join-Path $kitHome "worlds-$($TestEnv.Server)" $Id
    New-Item -ItemType Directory -Force $dest | Out-Null
    Copy-Item -LiteralPath $manifest -Destination (Join-Path $dest 'manifest.json') -Force
    Write-Host "world $Id : kit manifest copied to $dest"
  }
}

foreach ($dir in $TestEnv.Root, $toData, $TestEnv.VaultDir, $TestEnv.LogDir) {
  New-Item -ItemType Directory -Force $dir | Out-Null
}

if ($World) {
  Copy-World $World
  exit 0
}

# Config: the licence and the admin login as files, options.json pointed at B.
$fromConfig = Join-Path $fromData 'Config'
$toConfig = Join-Path $toData 'Config'
New-Item -ItemType Directory -Force $toConfig | Out-Null
foreach ($f in 'license.json', 'admin.txt') {
  $src = Join-Path $fromConfig $f
  if (Test-Path $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $toConfig $f) -Force }
  else { Write-Host "Config: server A has no $f (B will ask for it at the setup screen)" }
}
$options = Get-Content (Join-Path $fromConfig 'options.json') -Raw | ConvertFrom-Json -AsHashtable
$options['dataPath'] = $toData -replace '\\', '/'
$options['port'] = $TestEnv.FoundryPort
$options['world'] = $null
$options | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $toConfig 'options.json') -Encoding utf8NoBOM
Write-Host "Config: licence, admin login and options.json (data path $toData, port $($TestEnv.FoundryPort))"

# Data: everything but the worlds and B's own module copy.
Write-Host "Data: mirroring A's packages and assets (worlds and B's module copy excluded) ..."
Sync-Folder (Join-Path $fromData 'Data') (Join-Path $toData 'Data') @('worlds', (Join-Path 'modules' 'foundry-mcp-bridge'))

# Worlds B does not have yet.
foreach ($id in @($TestEnv.WorldId) + $KitWorlds) {
  if (Test-Path (Join-Path $toData 'Data' 'worlds' $id 'world.json')) {
    Write-Host "world $id : already on B (-World $id copies it again)"
  } else {
    Copy-World $id
  }
}

$built = Test-Path (Join-Path $RepoRoot 'packages' 'foundry-module' 'dist' 'main.js')
if ($built) {
  & (Join-Path $PSScriptRoot 'sync-module.ps1') -NoBuild -Server $TestEnv.Server
} else {
  Write-Host "Module: no build in this checkout; run pwsh scripts/test-env/sync-module.ps1 -Server B"
}
Write-Host ''
Write-Host "Server B ready at $($TestEnv.Root): pwsh scripts/test-env/start.ps1 -Server B [-World <id>]"
