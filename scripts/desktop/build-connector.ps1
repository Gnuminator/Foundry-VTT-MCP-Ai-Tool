# Builds the Claude Desktop connector (the stdio MCP server the five foundry-mcp* entries run) from a git ref
# into its own folder next to the older ones, so a repoint is one config change and a rollback is the old path.
#
#   pwsh scripts/desktop/build-connector.ps1                 builds aitool/main
#   pwsh scripts/desktop/build-connector.ps1 -Ref v0.23.0    builds a tag (after the planner has cut it)
#
# Result: %LOCALAPPDATA%\FoundryMCPServer\foundry-mcp-server-<short sha>\packages\mcp-server\dist\index.cjs (plus
# the rest of dist, like the older folders), a smoke check on the test bridge port (never 31414 to 31416), and the
# command to repoint (repoint-connectors.ps1, which this script never runs). An existing folder is never touched or
# deleted, and neither is the running Claude Desktop.
param(
  [string]$Ref = 'aitool/main',
  [string]$Root = (Join-Path $env:LOCALAPPDATA 'FoundryMCPServer'),
  [int]$SmokePort = 31514
)

$ErrorActionPreference = 'Stop'
if ($SmokePort -ge 31414 -and $SmokePort -le 31416) { throw "refusing the live bridge port $SmokePort" }

$repo = (git rev-parse --show-toplevel).Trim()
git -C $repo fetch -q aitool
$sha = (git -C $repo rev-parse --short=7 $Ref).Trim()
$dest = Join-Path $Root "foundry-mcp-server-$sha"
if (Test-Path $dest) { throw "$dest exists already: nothing was changed" }

$tmp = Join-Path ([IO.Path]::GetTempPath()) "connector-build-$sha"
if (Test-Path $tmp) { throw "$tmp exists: remove that worktree first (git worktree remove --force)" }
git -C $repo worktree add --detach $tmp $Ref | Out-Null
try {
  Push-Location $tmp
  npm ci --no-audit --no-fund | Out-Null
  if ($LASTEXITCODE) { throw 'npm ci failed' }
  npm run build | Out-Null
  if ($LASTEXITCODE) { throw 'npm run build failed' }
  npm -w "@gnuminator/mcp-server" run build:bundle | Out-Null
  if ($LASTEXITCODE) { throw 'build:bundle failed' }
  Pop-Location

  $mcp = Join-Path $tmp 'packages\mcp-server'
  $out = Join-Path $dest 'packages\mcp-server'
  New-Item -ItemType Directory -Force -Path $out | Out-Null
  Copy-Item -Recurse (Join-Path $mcp 'dist') (Join-Path $out 'dist')
  Copy-Item (Join-Path $mcp 'package.json') $out
  Copy-Item (Join-Path $out 'dist\index.bundle.cjs') (Join-Path $out 'dist\index.cjs')
  $shared = Join-Path $dest 'node_modules\@foundry-mcp\shared'
  New-Item -ItemType Directory -Force -Path $shared | Out-Null
  Copy-Item -Recurse (Join-Path $tmp 'shared\dist') (Join-Path $shared 'dist')
  Copy-Item (Join-Path $tmp 'shared\package.json') $shared
} finally {
  if ((Get-Location).Path -like "$tmp*") { Pop-Location }
  git -C $repo worktree remove --force $tmp
}

# Smoke check: the server answers initialize and lists tools without reaching a live bridge.
$node = Join-Path $Root 'node.exe'
if (-not (Test-Path $node)) { $node = 'node' }
$env:FOUNDRY_AI_TOOL_SETS = 'core'
$env:MCP_NO_SPAWN = '1'
$env:MCP_CONTROL_HOST = '127.0.0.1'
$env:MCP_CONTROL_PORT = "$SmokePort"
$init = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
$list = '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
$answer = "$init`n$list`n" | & $node (Join-Path $dest 'packages\mcp-server\dist\index.cjs') 2>$null | Select-Object -First 2
if (-not ($answer -join "`n").Contains('"tools"')) { throw "smoke check failed: no tool list from $dest" }

$version = (Get-Content (Join-Path $dest 'packages\mcp-server\package.json') -Raw | ConvertFrom-Json).version
Write-Host "Built $dest (version $version, $Ref @ $sha). Smoke check passed."
Write-Host "Repoint Claude Desktop (after the user says, then restart Desktop):"
Write-Host "  pwsh scripts/desktop/repoint-connectors.ps1 -Folder '$dest' -Apply"
