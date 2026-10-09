#Requires -Version 7
<#
.SYNOPSIS
  Point this PC's Claude Desktop connectors (foundry-mcp, -play, -prep, -build, -admin) at Plan B's
  bridge, or back at the Pi (docs/dev/PLAN-B.md, "Claude on a Plan B night").

.DESCRIPTION
  The connectors reach the bridge through MCP_CONTROL_HOST and MCP_CONTROL_PORT in
  %APPDATA%\Claude\claude_desktop_config.json (today the Pi's Tailscale address and 31414). This
  script changes only those two values, in place, so the rest of the file stays as it is:
    -To planb   127.0.0.1 and Plan B's control port (31414 on game night, 31614 with -Rehearsal)
    -To pi      the values saved by the last -To planb (or -PiHost / -PiPort)
  Before a change it saves a copy of the file next to it (claude_desktop_config.plan-b-<time>.json)
  and the old values in claude_desktop_config.plan-b-saved.json. -DryRun shows the change only.

  Claude Desktop reads the file when it starts: quit it from the tray icon and start it again.
  That also ends every Claude Code session running inside the desktop app.

.EXAMPLE
  .\scripts\plan-b\connectors.ps1 -To planb -DryRun
  .\scripts\plan-b\connectors.ps1 -To planb
  .\scripts\plan-b\connectors.ps1 -To pi
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [ValidateSet('planb', 'pi')] [string]$To,
  [switch]$Rehearsal,
  [string]$PiHost = '',
  [int]$PiPort = 0,
  [string]$ConfigFile = '',
  [switch]$DryRun
)

. (Join-Path $PSScriptRoot 'lib.ps1')
. (Join-Path $PSScriptRoot 'connectors-lib.ps1')
if (-not $ConfigFile) { $ConfigFile = Join-Path $env:APPDATA 'Claude' 'claude_desktop_config.json' }
if (-not (Test-Path -LiteralPath $ConfigFile)) { throw "no Claude Desktop config at $ConfigFile" }
$savedFile = $ConfigFile -replace '\.json$', '.plan-b-saved.json'
$text = Get-Content -LiteralPath $ConfigFile -Raw
$now = Get-ConnectorTarget $text
if (-not $now.Count) { throw "no connector with MCP_CONTROL_HOST in $ConfigFile" }

if ($To -eq 'planb') {
  $newHost = '127.0.0.1'
  $newPort = (Get-PlanBPorts -GameNight:(-not $Rehearsal)).Control
} else {
  $saved = if (Test-Path -LiteralPath $savedFile) { Get-Content -LiteralPath $savedFile -Raw | ConvertFrom-Json } else { $null }
  $newHost = if ($PiHost) { $PiHost } elseif ($saved) { [string]$saved.host } else { $null }
  $newPort = if ($PiPort) { $PiPort } elseif ($saved) { [int]$saved.port } else { 31414 }
  if (-not $newHost) { throw "no saved Pi address in ${savedFile}: give -PiHost (the Pi's Tailscale address, 100.110.82.102 in October 2026)" }
}

$result = Set-ConnectorTarget $text $newHost $newPort
Write-Host ("{0} connector value(s): {1}:{2} -> {3}:{4}" -f $result.Changed, $now.Host, $now.Port, $newHost, $newPort)
if ($result.Changed -eq 0 -or $result.Text -eq $text) { Write-Host 'Nothing to change.'; exit 0 }
if ($DryRun) { Write-Host 'Dry run: nothing written.'; exit 0 }

Copy-Item -LiteralPath $ConfigFile -Destination ($ConfigFile -replace '\.json$', ".plan-b-$(Get-Date -Format 'yyyyMMdd-HHmmss').json")
if ($To -eq 'planb' -and $now.Host -ne '127.0.0.1') {
  [pscustomobject]@{ host = $now.Host; port = $now.Port; savedAt = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $savedFile
}
# Same encoding as Claude Desktop writes (UTF-8, no BOM).
[System.IO.File]::WriteAllText($ConfigFile, $result.Text, [System.Text.UTF8Encoding]::new($false))
Write-Host 'Written. Quit Claude Desktop from the tray icon and start it again (this ends the Claude Code sessions in the app).'
