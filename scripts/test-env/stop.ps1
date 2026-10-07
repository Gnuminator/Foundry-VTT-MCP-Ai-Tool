# Stop the test environment (only the processes start.ps1 started).
#
#   pwsh scripts/test-env/stop.ps1
#   pwsh scripts/test-env/stop.ps1 -Only dashboard
#
# A recorded pid is stopped when it is a node process listening on that service's port, or when
# its command line shows the service start.ps1 starts (ours, but not on its port yet: Foundry still
# loading, a start that timed out), or when it is the cmd.exe wrapper whose node child owns the
# port. A pid from an old pids.json that another process now holds (another session's node, Claude
# Desktop's backend, anything after a reboot) is left alone: an unrelated process is reported as
# "not running" and forgotten; one that holds our port, or one whose command line cannot be read,
# is refused with a line on stderr and exit code 1 (the pid is kept when it may still be ours).
param([ValidateSet('all', 'foundry', 'bridge', 'dashboard')] [string]$Only = 'all')

. (Join-Path $PSScriptRoot 'config.ps1')
$pids = Read-Pids
$ports = @{ foundry = $TestEnv.FoundryPort; bridge = $TestEnv.ControlPort; dashboard = $TestEnv.DashboardPort }
$refused = $false

function Stop-Recorded([string]$Name, [System.Diagnostics.Process]$Proc) {
  Stop-Process -Id $Proc.Id -Force
  $Proc.WaitForExit(10000) | Out-Null
  Write-Host "$Name : stopped (pid $($Proc.Id))"
}

foreach ($name in @('dashboard', 'bridge', 'foundry')) {
  if ($Only -ne 'all' -and $Only -ne $name) { continue }
  if (-not $pids.ContainsKey($name)) { continue }
  $port = $ports[$name]
  $proc = Get-Process -Id $pids[$name] -ErrorAction SilentlyContinue
  $owners = @(Get-PortOwners $port)
  $forget = $true
  if (-not $proc) {
    Write-Host "$name : not running"
  } else {
    $isNode = $proc.ProcessName -match '^node'
    $cmd = Get-ProcessCommandLine $proc.Id
    $wrapped = $null
    if (-not $isNode) {
      # start.ps1 records the cmd.exe wrapper when it could not find node's pid: its node child owns the port.
      $wrapped = $owners | Where-Object { (Get-ParentProcessId $_) -eq $proc.Id } | Select-Object -First 1
    }
    if ($isNode -and $owners -contains $proc.Id) {
      # The node process we started, and it owns the port.
      Stop-Recorded $name $proc
    } elseif (Test-OurServiceCommandLine $name $cmd) {
      # Ours by its command line, not (yet) on its port.
      Stop-Recorded $name $proc
    } elseif ($wrapped) {
      $child = Get-Process -Id $wrapped -ErrorAction SilentlyContinue
      if ($child) { Stop-Recorded $name $child }
      Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    } elseif ($owners -contains $proc.Id) {
      [Console]::Error.WriteLine("REFUSED: $name : the recorded pid $($proc.Id) ($($proc.ProcessName)) holds port $port but is not the service we started; nothing stopped. If that is yours, stop it yourself; the stale pid is forgotten.")
      $refused = $true
    } elseif ($cmd) {
      # The pid was reused by something else (after a reboot, or another program): not ours, not running.
      Write-Host "$name : not running (pid $($proc.Id) is now $($proc.ProcessName), not the service we started)"
    } else {
      [Console]::Error.WriteLine("REFUSED: $name : the recorded pid $($proc.Id) ($($proc.ProcessName)) listens on nothing and its command line cannot be read, so it is left alone (it may still be ours, loading). Check it with Get-Process -Id $($proc.Id) and run stop.ps1 again; the pid is kept.")
      $refused = $true
      $forget = $false
    }
  }
  if ($forget) { $pids.Remove($name) }
  if (Test-PortOpen $port) { Write-Host "$name : WARNING, port $port is still in use by another process" }
}
Write-Pids $pids
if ($refused) { exit 1 }
