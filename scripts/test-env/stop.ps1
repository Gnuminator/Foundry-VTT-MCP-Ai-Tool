# Stop the test environment (only the processes start.ps1 started).
#
#   pwsh scripts/test-env/stop.ps1
#   pwsh scripts/test-env/stop.ps1 -Only dashboard
param([ValidateSet('all', 'foundry', 'bridge', 'dashboard')] [string]$Only = 'all')

. (Join-Path $PSScriptRoot 'config.ps1')
$pids = Read-Pids
$ports = @{ foundry = $TestEnv.FoundryPort; bridge = $TestEnv.ControlPort; dashboard = $TestEnv.DashboardPort }

foreach ($name in @('dashboard', 'bridge', 'foundry')) {
  if ($Only -ne 'all' -and $Only -ne $name) { continue }
  if (-not $pids.ContainsKey($name)) { continue }
  $proc = Get-Process -Id $pids[$name] -ErrorAction SilentlyContinue
  # Only stop it if it is still the node process we started.
  if ($proc -and $proc.ProcessName -match '^node') {
    Stop-Process -Id $proc.Id -Force
    $proc.WaitForExit(10000) | Out-Null
    Write-Host "$name : stopped (pid $($proc.Id))"
  } else {
    Write-Host "$name : not running"
  }
  $pids.Remove($name)
  if (Test-PortOpen $ports[$name]) { Write-Host "$name : WARNING, port $($ports[$name]) is still in use by another process" }
}
Write-Pids $pids
