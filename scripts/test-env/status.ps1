# Show the test environment's state, and (read-only) whether the live bridge is up.
#
#   pwsh scripts/test-env/status.ps1
. (Join-Path $PSScriptRoot 'config.ps1')
Assert-SafePorts
$pids = Read-Pids

function Show([string]$Name, [int]$Port) {
  $up = Test-PortOpen $Port
  $pidText = if ($pids.ContainsKey($Name)) { "pid $($pids[$Name])" } elseif ($Name -eq 'link') { 'part of the bridge' } else { 'not started by start.ps1' }
  Write-Host ('{0,-10} {1,-6} {2,-5} {3}' -f $Name, $Port, $(if ($up) { 'UP' } else { 'down' }), $pidText)
}

Write-Host 'Test environment'
Show 'foundry' $TestEnv.FoundryPort
Show 'bridge' $TestEnv.ControlPort
Show 'link' $TestEnv.LinkPort  # opened by the bridge (Foundry module connects here)
Show 'dashboard' $TestEnv.DashboardPort
Write-Host ''
$live = $LivePorts | Where-Object { Test-PortOpen $_ }
Write-Host ("Live bridge (31414-31416, never touched): {0}" -f $(if ($live) { "UP on $($live -join ', ')" } else { 'down' }))
Write-Host ''
$main = Find-FoundryMain
$manifest = Join-Path $TestEnv.ModuleDir 'module.json'
Write-Host "Foundry app:  $(if ($main) { $main } else { 'not installed' })"
Write-Host "Test world:   $(if (Test-Path (Join-Path $TestEnv.DataDir 'Data' 'worlds' $TestEnv.WorldId)) { $TestEnv.WorldId } else { 'not created' })"
Write-Host "Module copy:  $(if (Test-Path $manifest) { 'v' + (Get-Content $manifest -Raw | ConvertFrom-Json).version } else { 'not synced' })"
Write-Host "Logs:         $($TestEnv.LogDir)"
$blocked = Test-FoundryFirewallBlock
if ($blocked -ne $null) {
  Write-Host "Firewall:     $(if ($blocked) { "port $($TestEnv.FoundryPort) blocked from the network" } else { "port $($TestEnv.FoundryPort) reachable from the network (GM decision; optional rule: $(Get-FirewallCommand))" })"
}
