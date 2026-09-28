# Copy this repo's Foundry module build into the test Foundry's data folder.
#
# The copy's module.json gets flags.foundry-mcp-bridge.defaultServerPort = the
# test link port, so the test world dials the test bridge (31515), never the
# live one (31415). Run after changing module code, then reload the browser.
#
#   pwsh scripts/test-env/sync-module.ps1            build, then copy
#   pwsh scripts/test-env/sync-module.ps1 -NoBuild   copy the existing build
param([switch]$NoBuild)

. (Join-Path $PSScriptRoot 'config.ps1')
Assert-SafePorts

$source = Join-Path $RepoRoot 'packages' 'foundry-module'
if (-not $NoBuild) {
  $node = Get-NodeExe
  $env:PATH = "$(Split-Path $node)$([IO.Path]::PathSeparator)$env:PATH"
  Push-Location $RepoRoot
  try {
    npm run build:foundry | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Module build failed.' }
  } finally { Pop-Location }
}
if (-not (Test-Path (Join-Path $source 'dist' 'main.js'))) { throw 'No module build (packages/foundry-module/dist). Run without -NoBuild.' }

$dest = $TestEnv.ModuleDir
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
New-Item -ItemType Directory -Force $dest | Out-Null
foreach ($item in 'dist', 'lang', 'styles', 'templates') {
  $from = Join-Path $source $item
  if (Test-Path $from) { Copy-Item -Recurse $from (Join-Path $dest $item) }
}

$manifest = Get-Content (Join-Path $source 'module.json') -Raw | ConvertFrom-Json -AsHashtable
if (-not $manifest.Contains('flags')) { $manifest['flags'] = @{} }
$manifest['flags']['foundry-mcp-bridge'] = @{ defaultServerPort = $TestEnv.LinkPort; testInstall = $true }
# A test copy must never update itself from the release manifest.
$manifest.Remove('manifest')
$manifest.Remove('download')
$manifest | ConvertTo-Json -Depth 20 | Set-Content (Join-Path $dest 'module.json')

Write-Host "Module $($manifest.version) copied to $dest (bridge port $($TestEnv.LinkPort))."
