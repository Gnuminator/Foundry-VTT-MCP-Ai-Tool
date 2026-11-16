#Requires -Version 7
<#
.SYNOPSIS
  Point this PC's Claude Desktop connectors (foundry-mcp, -play, -prep, -build, -admin) at Plan B's
  bridge, or back at the Pi (docs/dev/PLAN-B.md, "Claude on a Plan B night").

.DESCRIPTION
  The connectors reach the bridge through MCP_CONTROL_HOST and MCP_CONTROL_PORT in
  %LOCALAPPDATA%\Claude-Data\claude_<package family>\claude_desktop_config.json (the Store build; older
  builds: %APPDATA%\Claude\claude_desktop_config.json) (today the Pi's Tailscale address and 31414). This
  script changes only those two values, in place, so the rest of the file stays as it is:
    -To planb   127.0.0.1 and Plan B's control port (31414 on game night, 31614 with -Rehearsal)
    -To pi      the values saved by the last -To planb (or -PiHost / -PiPort); without -ConfigFile it
                also finds values saved next to the classic %APPDATA%\Claude file by an older run
  Before a change it saves a copy of the file next to it (claude_desktop_config.plan-b-<time>.json)
  and the old values in claude_desktop_config.plan-b-saved.json. -DryRun shows the change only.

  The script refuses to write while Claude Desktop runs (it rewrites the file when it quits, which would
  undo the change); -DryRun works either way. Quit it from the tray icon, run the script, then start
  Claude Desktop again: it reads the file when it starts. Quitting also ends every Claude Code session
  running inside the desktop app.

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
. (Join-Path $PSScriptRoot '..\desktop\desktop-guard.ps1')
if (-not $ConfigFile) {
  # Current Claude Desktop (Store build) reads %LOCALAPPDATA%\Claude-Data\claude_<family>\; %APPDATA%\Claude is a stale copy there.
  $dataDirs = @(Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'Claude-Data') -Directory -Filter 'claude_*' -ErrorAction SilentlyContinue | Sort-Object Name)
  $current = @($dataDirs | ForEach-Object { Join-Path $_.FullName 'claude_desktop_config.json' } | Where-Object { Test-Path -LiteralPath $_ })
  if ($dataDirs.Count -and -not $current.Count) { throw "Claude Desktop keeps its data in $($dataDirs[0].FullName) but has no claude_desktop_config.json there; pass -ConfigFile to choose one" }
  $ConfigFile = if ($current.Count) { $current[0] } else { Join-Path $env:APPDATA 'Claude' 'claude_desktop_config.json' }
  Write-Host "Config: $ConfigFile"
}
if (-not (Test-Path -LiteralPath $ConfigFile)) { throw "no Claude Desktop config at $ConfigFile" }
$savedFile = $ConfigFile -replace '\.json$', '.plan-b-saved.json'
# A -To planb run before Desktop moved to Claude-Data saved its values next to the classic file: -To pi still finds them there.
$oldSavedFile = Join-Path $env:APPDATA 'Claude' 'claude_desktop_config.plan-b-saved.json'
if ($To -eq 'pi' -and -not $PSBoundParameters.ContainsKey('ConfigFile') -and -not (Test-Path -LiteralPath $savedFile) -and (Test-Path -LiteralPath $oldSavedFile)) { $savedFile = $oldSavedFile }
$text = Get-Content -LiteralPath $ConfigFile -Raw
$now = Get-ConnectorTarget $text
if (-not $now.Count) { throw "no connector with MCP_CONTROL_HOST in $ConfigFile" }

if ($To -eq 'planb') {
  $spawning = Get-ConnectorsThatSpawn $text
  if ($spawning.Count) { throw "refused: these connectors have no MCP_NO_SPAWN=1 in their env, so they could start a bridge of their own on this PC: $($spawning -join ', '). Add ""MCP_NO_SPAWN"": ""1"" to their env first." }
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
Assert-ClaudeDesktopClosed

Copy-Item -LiteralPath $ConfigFile -Destination ($ConfigFile -replace '\.json$', ".plan-b-$(Get-Date -Format 'yyyyMMdd-HHmmss').json")
if ($To -eq 'planb' -and $now.Host -ne '127.0.0.1') {
  [pscustomobject]@{ host = $now.Host; port = $now.Port; savedAt = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $savedFile
}
# Same encoding as Claude Desktop writes (UTF-8, no BOM).
[System.IO.File]::WriteAllText($ConfigFile, $result.Text, [System.Text.UTF8Encoding]::new($false))
Write-Host 'Written (Claude Desktop was closed, so it will not undo this). Start Claude Desktop now.'
