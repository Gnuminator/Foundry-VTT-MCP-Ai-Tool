# Points the five foundry-mcp* entries of the Claude Desktop config at a connector folder that
# build-connector.ps1 made. Without -Apply it only shows what it would change.
#
#   pwsh scripts/desktop/repoint-connectors.ps1 -Folder <...\foundry-mcp-server-abc1234>           shows the change
#   pwsh scripts/desktop/repoint-connectors.ps1 -Folder <...\foundry-mcp-server-abc1234> -Apply    changes the config
#   pwsh scripts/desktop/repoint-connectors.ps1 -Rollback <config backup file> -Apply              puts a backup back
#
# -Apply first copies the config to claude_desktop_config.json.bak-<time> next to it. Only the second argument of
# each entry that runs a foundry-mcp-server-*\packages\mcp-server\dist\index.cjs changes; the env (tool set,
# control host and port) and every other server stay as they are. Claude Desktop reads the config at start: this
# script never restarts it, and a restart ends every Claude session, so the user does that when it suits.
param(
  [string]$Folder,
  [string]$Rollback,
  [string]$Config = (Join-Path $env:APPDATA 'Claude\claude_desktop_config.json'),
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Config)) { throw "no Claude Desktop config at $Config" }

if ($Rollback) {
  if (-not (Test-Path $Rollback)) { throw "no backup at $Rollback" }
  if (-not $Apply) { Write-Host "Would copy $Rollback over $Config (add -Apply)"; return }
  Copy-Item $Rollback $Config -Force
  Write-Host "Config restored from $Rollback. Restart Claude Desktop to use it."
  return
}

if (-not $Folder) { throw 'give -Folder <the new foundry-mcp-server-<sha> folder>' }
$target = Join-Path (Resolve-Path $Folder) 'packages\mcp-server\dist\index.cjs'
if (-not (Test-Path $target)) { throw "$target does not exist: run build-connector.ps1 first" }

$cfg = Get-Content $Config -Raw | ConvertFrom-Json
$changed = 0
foreach ($p in $cfg.mcpServers.PSObject.Properties) {
  $args0 = @($p.Value.args)
  if ($args0.Count -ge 1 -and $args0[0] -match 'foundry-mcp-server[^\\]*\\packages\\mcp-server\\dist\\index\.cjs$') {
    if ($args0[0] -eq $target) { Write-Host "  $($p.Name): already on $target"; continue }
    Write-Host "  $($p.Name): $($args0[0])`n    -> $target"
    $p.Value.args[0] = $target
    $changed++
  }
}
if (-not $changed) { Write-Host 'Nothing to change.'; return }
if (-not $Apply) { Write-Host "Dry run: $changed entries would change. Add -Apply to write the config."; return }

$backup = "$Config.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $Config $backup
$json = $cfg | ConvertTo-Json -Depth 20
[IO.File]::WriteAllText($Config, $json, [Text.UTF8Encoding]::new($false))
Write-Host "Changed $changed entries. Backup: $backup"
Write-Host "Roll back with: pwsh scripts/desktop/repoint-connectors.ps1 -Rollback '$backup' -Apply"
Write-Host 'Claude Desktop reads the config at start: restart it when it suits (a restart ends every session).'
