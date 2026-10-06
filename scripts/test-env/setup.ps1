# One-time (and repeatable) setup of the local test environment.
# Creates the folders, builds the repo if needed, copies the module into the
# test Foundry, and says what is still missing. Safe to re-run.
#
#   pwsh scripts/test-env/setup.ps1
param([switch]$Rebuild)

. (Join-Path $PSScriptRoot 'config.ps1')
Assert-SafePorts

foreach ($dir in $TestEnv.Root, $TestEnv.DataDir, $TestEnv.VaultDir, $TestEnv.LogDir) {
  New-Item -ItemType Directory -Force $dir | Out-Null
}

$node = Get-NodeExe
$env:PATH = "$(Split-Path $node)$([IO.Path]::PathSeparator)$env:PATH"
$built = (Test-Path (Join-Path $RepoRoot 'packages' 'mcp-server' 'dist' 'standalone.js')) -and
  (Test-Path (Join-Path $RepoRoot 'packages' 'cogm-dashboard' 'dist' 'server.js'))
if ($Rebuild -or -not $built) {
  Push-Location $RepoRoot
  try {
    npm run build | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
  } finally { Pop-Location }
}

& (Join-Path $PSScriptRoot 'sync-module.ps1') -NoBuild:(-not $Rebuild -and $built)

$main = Find-FoundryMain
$worldDir = Join-Path $TestEnv.DataDir 'Data' 'worlds' $TestEnv.WorldId
Write-Host ''
Write-Host "Test root:      $($TestEnv.Root)"
Write-Host "Foundry app:    $(if ($main) { $main } else { "MISSING - extract the Foundry 14 Node.js build into $($TestEnv.AppDir)" })"
Write-Host "Test world:     $(if (Test-Path $worldDir) { $worldDir } else { "MISSING - create world id '$($TestEnv.WorldId)' (see the foundry-test-env skill, one-time setup)" })"
Write-Host "Vault:          $($TestEnv.VaultDir)"
Write-Host "Ports:          Foundry $($TestEnv.FoundryPort), control $($TestEnv.ControlPort), link $($TestEnv.LinkPort), dashboard $($TestEnv.DashboardPort)"
