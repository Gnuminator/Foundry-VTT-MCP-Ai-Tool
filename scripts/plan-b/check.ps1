#Requires -Version 7
<#
.SYNOPSIS
  Plan B check: is everything up, and is it the right world (docs/dev/PLAN-B.md). Read-only.

.DESCRIPTION
  One line per part, OK or a problem with what to do. Exit 0 when Foundry runs the world and the
  bridge has its link; 1 otherwise. Changes nothing.

.EXAMPLE
  .\scripts\plan-b\check.ps1
#>
[CmdletBinding()]
param([string]$Root = '')

. (Join-Path $PSScriptRoot 'lib.ps1')
if (-not $Root) { $Root = $PlanBDefaults.Root }
$L = Get-PlanBLayout $Root
$state = Read-PlanBState $L
$bad = 0

function Line([string]$Part, [bool]$Ok, [string]$Text, [switch]$Info) {
  $mark = if ($Info) { 'info' } elseif ($Ok) { 'OK' } else { 'PROBLEM' }
  $color = if ($Info) { 'Gray' } elseif ($Ok) { 'Green' } else { 'Yellow' }
  Write-Host ('{0,-13} {1,-8} {2}' -f $Part, $mark, $Text) -ForegroundColor $color
  if (-not $Ok -and -not $Info) { $script:bad++ }
}

function Get-Json([string]$Url) {
  try { return Invoke-RestMethod -Uri $Url -TimeoutSec 5 } catch { return $null }
}

if (-not $state -or -not $state.restoredAt) {
  Line 'restore' $false "nothing restored in ${Root}: run restore.ps1"
  exit 1
}
$snapTime = ([datetimeoffset]$state.snapshot.time).ToLocalTime()
Line 'backup' $true ("world '{0}' from the backup of {1} ({2} hours old)" -f $state.world, $snapTime.ToString('yyyy-MM-dd HH\:mm'), [math]::Round(([datetimeoffset]::Now - $snapTime).TotalHours, 1))
if (-not ($state.PSObject.Properties['ports'] -and $state.ports)) {
  Line 'services' $false 'not started yet: run start.ps1'
  exit 1
}
$ports = $state.ports
$svc = if ($state.PSObject.Properties['services'] -and $state.services) { @($state.services.PSObject.Properties) } else { @() }
$svcNames = @($svc | ForEach-Object Name)
Line 'mode' $true ("{0}{1}" -f $state.mode, $(if ($state.played) { " (played on $($state.playedAt): push it back to the Pi before stop.ps1 -Clean)" }))

# The processes start.ps1 recorded.
foreach ($p in $svc) {
  $id = [int]$p.Value.pid
  $alive = [bool](Get-Process -Id $id -ErrorAction SilentlyContinue)
  $err = $p.Value.log -replace '\.out\.log$', '.err.log'
  Line $p.Name $alive $(if ($alive) { "running (pid $id)" } else { "not running: see $err, then stop.ps1 and start.ps1" })
}

# Foundry: the port, and the world it serves.
$fs = Get-Json "http://127.0.0.1:$($ports.Foundry)/api/status"
if (-not $fs) {
  Line 'foundry' $false "no answer on port $($ports.Foundry) (it needs up to a minute after start; see $(Join-Path $L.LogDir 'foundry.err.log'))"
} elseif (-not $fs.active -or $fs.world -ne $state.world) {
  Line 'foundry' $false "answers, but the world '$($state.world)' is not active (active world: '$($fs.world)')"
} else {
  Line 'foundry' $true ("world '{0}' active, Foundry {1}, {2} {3}, {4} user(s) connected" -f $fs.world, $fs.version, $fs.system, $fs.systemVersion, $fs.users)
}

# The dashboard and, through it, the bridge and the module's link.
$health = Get-Json "http://127.0.0.1:$($ports.Dashboard)/api/health"
if (-not $health) {
  Line 'dashboard' $false "no answer on port $($ports.Dashboard)"
} else {
  Line 'dashboard' $true "http://localhost:$($ports.Dashboard)"
  Line 'bridge' ($health.controlChannel -eq 'connected') "control channel $($health.controlChannel) (port $($ports.Control))"
  $st = Get-Json "http://127.0.0.1:$($ports.Dashboard)/api/state"
  if ($st -and $st.PSObject.Properties['status']) {
    $linked = $st.status.foundry -eq 'reachable'
    $hint = if ($linked) { '' } elseif ($svcNames -contains 'assistant-gm') {
      " (the Assistant GM joins within a minute; if it stays down see $(Join-Path $L.LogDir 'assistant-gm.out.log'), or log in to Foundry as the GM in a browser on this PC)"
    } else { ' (open Foundry as the GM in a browser on this PC: the module there holds the link)' }
    Line 'module link' $linked "Foundry $($st.status.foundry) through port $($ports.Link)$hint"
  } else {
    Line 'module link' $true 'cannot be read (the dashboard asks for a login)' -Info
  }
}

# The spare tunnel (Part C).
if ($svcNames -contains 'tunnel') {
  $log = Join-Path $L.LogDir 'tunnel.err.log'
  $registered = (Test-Path $log) -and (Select-String -LiteralPath $log -Pattern 'Registered tunnel connection' -Quiet)
  Line 'tunnel' $registered $(if ($registered) { 'connected to Cloudflare' } else { "not connected yet; see $log" })
}

# The Pi, for information: Plan B is for a Pi that is down.
$piUp = @($PlanBDefaults.PiAddresses | Where-Object { Test-PlanBPortOpen 30000 $_ 1500 })
Line 'pi' $true $(if ($piUp) { "the Pi's Foundry answers ($($piUp -join ', ')): make sure nobody plays there tonight" } else { "the Pi's Foundry does not answer" }) -Info

if ($bad) { Write-Host "$bad problem(s)." -ForegroundColor Yellow; exit 1 }
Write-Host 'Plan B is up.' -ForegroundColor Green
