# Install the Foundry AI Tool Obsidian plugin (idea I-059) into a vault.
#
# Copies main.js, manifest.json and styles.css (plus FONT-LICENSES.txt for the theme's fonts)
# into <vault>/.obsidian/plugins/foundry-ai-tool/.
# Then, in Obsidian: Settings, Community plugins, turn off Restricted mode once if it is on, and
# turn on "Foundry AI Tool". Reinstalling over an older copy keeps its settings (data.json).
#
#   pwsh scripts/install-obsidian-plugin.ps1 -Vault "C:\Users\me\Documents\Obsidian\vault"
#       builds the plugin from this repo (needs npm), then copies it
#   pwsh scripts/install-obsidian-plugin.ps1 -Vault <path> -From foundry-ai-tool-obsidian.zip
#       copies from a release zip (or from a folder with the three files); no build
#   pwsh scripts/install-obsidian-plugin.ps1 -Vault <path> -NoBuild
#       copies the existing build in packages/obsidian-plugin/dist
param(
  [Parameter(Mandatory = $true)][string]$Vault,
  [string]$From,
  [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path $PSScriptRoot -Parent
$PluginId = 'foundry-ai-tool'
$Files = 'main.js', 'manifest.json', 'styles.css'

if (-not (Test-Path (Join-Path $Vault '.obsidian'))) {
  throw "No Obsidian vault at $Vault (it has no .obsidian folder). Open the folder in Obsidian once first."
}

$temp = $null
try {
  if ($From) {
    if (-not (Test-Path $From)) { throw "Not found: $From" }
    if ((Get-Item $From).PSIsContainer) {
      $source = $From
    } else {
      $temp = Join-Path ([IO.Path]::GetTempPath()) "foundry-ai-tool-plugin-$([guid]::NewGuid())"
      Expand-Archive -Path $From -DestinationPath $temp
      $inner = Join-Path $temp $PluginId
      $source = if (Test-Path $inner) { $inner } else { $temp }
    }
  } else {
    $source = Join-Path $RepoRoot 'packages' 'obsidian-plugin' 'dist'
    if (-not $NoBuild) {
      Push-Location $RepoRoot
      try {
        npm run build -w @gnuminator/obsidian-plugin | Out-Host
        if ($LASTEXITCODE -ne 0) { throw 'Plugin build failed.' }
      } finally { Pop-Location }
    }
  }
  foreach ($file in $Files) {
    if (-not (Test-Path (Join-Path $source $file))) { throw "Missing $file in $source." }
  }

  $dest = Join-Path $Vault '.obsidian' 'plugins' $PluginId
  New-Item -ItemType Directory -Force $dest | Out-Null
  foreach ($file in $Files) { Copy-Item -Force (Join-Path $source $file) (Join-Path $dest $file) }
  # The licences of the fonts the theme embeds in styles.css (older builds have none).
  $licenses = Join-Path $source 'FONT-LICENSES.txt'
  if (Test-Path $licenses) { Copy-Item -Force $licenses (Join-Path $dest 'FONT-LICENSES.txt') }
  $version = (Get-Content (Join-Path $dest 'manifest.json') -Raw | ConvertFrom-Json).version
  Write-Host "Foundry AI Tool plugin $version installed in $dest."
  Write-Host 'In Obsidian: Settings, Community plugins, turn on "Foundry AI Tool" (reload Obsidian if it was on).'
} finally {
  if ($temp -and (Test-Path $temp)) { Remove-Item -Recurse -Force $temp }
}
