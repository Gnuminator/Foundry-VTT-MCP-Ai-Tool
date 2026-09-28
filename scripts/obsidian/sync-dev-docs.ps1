# Mirror the repo's docs into the GM's Obsidian vault (read-only copy).
#
#   pwsh scripts/obsidian/sync-dev-docs.ps1 [-VaultDir <path>]
#
# Target: <vault>/Dev/Foundry AI Tool/repo-docs/ with docs/, skills/ (from
# .claude/skills) and CLAUDE.md, CHANGELOG.md, README.md. A mirror, not a
# link: Obsidian edits never reach the git working tree, and the next run
# overwrites them. The vault is -VaultDir, else $env:FOUNDRY_AI_OBSIDIAN_DIR,
# else ~/Documents/Obsidian/vault. Only Markdown files are copied.
param([string]$VaultDir)

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..' '..')
if (-not $VaultDir) { $VaultDir = $env:FOUNDRY_AI_OBSIDIAN_DIR }
if (-not $VaultDir) { $VaultDir = Join-Path $HOME 'Documents' 'Obsidian' 'vault' }
if (-not (Test-Path (Join-Path $VaultDir '.obsidian'))) {
  throw "No Obsidian vault at $VaultDir (no .obsidian folder). Pass -VaultDir."
}
$target = Join-Path $VaultDir 'Dev' 'Foundry AI Tool' 'repo-docs'
New-Item -ItemType Directory -Force $target | Out-Null

function Invoke-Mirror([string]$From, [string]$To) {
  # /MIR mirrors (deletes files gone from the source); *.md only; quiet output.
  robocopy $From $To '*.md' /MIR /NJH /NJS /NFL /NDL /NP /R:1 /W:1 | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE): $From -> $To" }
}

Invoke-Mirror (Join-Path $repo 'docs') (Join-Path $target 'docs')
Invoke-Mirror (Join-Path $repo '.claude' 'skills') (Join-Path $target 'skills')
foreach ($file in 'CLAUDE.md', 'CHANGELOG.md', 'README.md') {
  $src = Join-Path $repo $file
  if (Test-Path $src) { Copy-Item $src (Join-Path $target $file) -Force }
}
$global:LASTEXITCODE = 0
$count = (Get-ChildItem -Recurse -File $target -Filter '*.md').Count
Write-Host "Mirrored $count Markdown file(s) to $target"
