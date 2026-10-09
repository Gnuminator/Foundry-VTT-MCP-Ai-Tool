#Requires -Version 7
<#
.SYNOPSIS
  Plan B's last step: stop what start.ps1 started, and with -Clean delete the restored copy
  (docs/dev/PLAN-B.md).

.DESCRIPTION
  Stops only the processes start.ps1 recorded in <Root>\state.json, and only while they are still
  ours: the recorded start time matches and the command line holds the service's own log path under
  <Root>\logs. Each one is stopped with its child processes (the wrapper shell, node, Edge). A pid
  another program has by now is forgotten; one that cannot be checked is left alone and reported
  (exit 1).

  -Clean then deletes the restored data, the logs and the staging folder. It keeps the Foundry app
  and the licence file for next time. It refuses while anything still runs, and refuses data a game
  night was played on until you say it is back on the Pi (-PushedBack; runbook, "After the night").

.EXAMPLE
  .\scripts\plan-b\stop.ps1
  .\scripts\plan-b\stop.ps1 -Clean
#>
[CmdletBinding()]
param(
  [string]$Root = '',
  [switch]$Clean,
  [switch]$PushedBack
)

. (Join-Path $PSScriptRoot 'lib.ps1')
if (-not $Root) { $Root = $PlanBDefaults.Root }
$L = Get-PlanBLayout $Root
$state = Read-PlanBState $L
$refused = $false

if ($state -and $state.PSObject.Properties['services'] -and $state.services) {
  $left = [ordered]@{}
  $names = @($state.services.PSObject.Properties.Name)
  [array]::Reverse($names)
  foreach ($name in $names) {
    $s = $state.services.$name
    $id = [int]$s.pid
    $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
    $d = Resolve-PlanBStop @{
      Exists        = [bool]$proc
      StartTime     = if ($proc) { Get-PlanBStartTime $id } else { $null }
      RecordedStart = $s.started
      CommandLine   = if ($proc) { Get-PlanBCommandLine $id } else { $null }
      Marker        = $s.log
    }
    switch ($d.Action) {
      'stop' {
        & taskkill.exe /PID $id /T /F *> $null
        $proc.WaitForExit(10000) | Out-Null
        if (Get-Process -Id $id -ErrorAction SilentlyContinue) {
          [Console]::Error.WriteLine("REFUSED: $name : pid $id is still running after taskkill; stop it yourself (Stop-Process -Id $id -Force)")
          $left[$name] = $s; $refused = $true
        } else {
          Write-Host ('{0,-12} stopped' -f $name)
        }
      }
      'unknown' { [Console]::Error.WriteLine("REFUSED: $name : pid $id $($d.Message)"); $left[$name] = $s; $refused = $true }
      default   { Write-Host ('{0,-12} {1}' -f $name, $d.Message) }
    }
  }
  Set-StateValue $state 'services' $(if ($left.Count) { [pscustomobject]$left } else { $null })
  Write-PlanBState $L $state
  if ($state.PSObject.Properties['ports'] -and $state.ports) {
    foreach ($p in $state.ports.PSObject.Properties) {
      if (Test-PlanBPortOpen ([int]$p.Value)) { Write-Host "WARNING: port $($p.Value) ($($p.Name)) is still in use" -ForegroundColor Yellow }
    }
  }
} else {
  Write-Host 'Plan B is not running (nothing recorded in state.json).'
}

if ($Clean) {
  if ($refused) { [Console]::Error.WriteLine('REFUSED: not cleaning while a Plan B process may still run'); exit 1 }
  $ok = Resolve-PlanBClean $state -PushedBack:$PushedBack
  if (-not $ok.Ok) { [Console]::Error.WriteLine("REFUSED: $($ok.Message)"); exit 1 }
  # Foundry may hold its lock file a moment after the stop.
  Start-Sleep -Seconds 2
  foreach ($p in @((Join-Path $L.DataDir 'Data'), (Join-Path $L.DataDir 'Logs'), $L.ToolDir, $L.SecretsDir, $L.StagingDir, $L.LogDir)) {
    if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force; Write-Host "removed $p" }
  }
  Write-PlanBState $L ([pscustomobject]@{ cleanedAt = (Get-Date).ToString('o'); restoredAt = $null })
  Write-Host "Clean. Kept: $($L.AppDir) (Foundry) and $($L.LicenseFile)."
}
if ($refused) { exit 1 }
