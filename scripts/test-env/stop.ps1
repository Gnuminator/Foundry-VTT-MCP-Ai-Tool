# Stop the test environment (only the processes start.ps1 started).
#
#   pwsh scripts/test-env/stop.ps1
#   pwsh scripts/test-env/stop.ps1 -Only dashboard
#
# A recorded pid is stopped only when it is the process listening on that service's port. A pid
# from an old pids.json may have been reused by another process (another session's node, Claude
# Desktop's backend): that one is refused, with a line on stderr and exit code 1, and left alone.
param([ValidateSet('all', 'foundry', 'bridge', 'dashboard')] [string]$Only = 'all')

. (Join-Path $PSScriptRoot 'config.ps1')
$pids = Read-Pids
$ports = @{ foundry = $TestEnv.FoundryPort; bridge = $TestEnv.ControlPort; dashboard = $TestEnv.DashboardPort }
$refused = $false

foreach ($name in @('dashboard', 'bridge', 'foundry')) {
  if ($Only -ne 'all' -and $Only -ne $name) { continue }
  if (-not $pids.ContainsKey($name)) { continue }
  $port = $ports[$name]
  $proc = Get-Process -Id $pids[$name] -ErrorAction SilentlyContinue
  $owner = Get-PortOwner $port
  if (-not $proc) {
    Write-Host "$name : not running"
  } elseif ($proc.ProcessName -match '^node' -and $owner -eq $proc.Id) {
    # Still the node process we started, and it owns the port: ours to stop.
    Stop-Process -Id $proc.Id -Force
    $proc.WaitForExit(10000) | Out-Null
    Write-Host "$name : stopped (pid $($proc.Id))"
  } elseif ($owner) {
    [Console]::Error.WriteLine("REFUSED: $name : the recorded pid $($proc.Id) ($($proc.ProcessName)) does not own port $port (pid $owner does); nothing stopped. If that is yours, stop it yourself; the stale pid is forgotten.")
    $refused = $true
  } else {
    [Console]::Error.WriteLine("REFUSED: $name : the recorded pid $($proc.Id) ($($proc.ProcessName)) listens on nothing; it is not the service we started (or it never came up), so it is left alone. Check it with Get-Process -Id $($proc.Id); the stale pid is forgotten.")
    $refused = $true
  }
  $pids.Remove($name)
  if (Test-PortOpen $port) { Write-Host "$name : WARNING, port $port is still in use by another process" }
}
Write-Pids $pids
if ($refused) { exit 1 }
