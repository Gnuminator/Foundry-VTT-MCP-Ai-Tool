# Stop the test environment (only the processes start.ps1 started).
#
#   pwsh scripts/test-env/stop.ps1
#   pwsh scripts/test-env/stop.ps1 -Only dashboard
#
# A recorded pid is stopped when it is still the process start.ps1 started: a node process that
# owns the service's port or whose command line shows the service (ours, but not on its port yet:
# Foundry still loading, a start that timed out), or the cmd.exe wrapper with our command line
# (start.ps1 could not find node's pid), whose node child is stopped first. A pid another process
# holds by now (its start time, in pids.started.json, differs from the recorded one, or its command
# line is something else) is reported as "not running" and forgotten. One that holds our port, or
# one whose command line cannot be read and listens on nothing, is refused with a line on stderr and
# exit code 1 (the pid is kept in the second case). A kill that did not take, or a port still open
# after our process was stopped (an orphaned child), is refused the same way. The decision table is
# Resolve-StopAction in config.ps1.
param([ValidateSet('all', 'foundry', 'bridge', 'dashboard')] [string]$Only = 'all')

. (Join-Path $PSScriptRoot 'config.ps1')
$pids = Read-Pids
$starts = Read-Starts
$ports = @{ foundry = $TestEnv.FoundryPort; bridge = $TestEnv.ControlPort; dashboard = $TestEnv.DashboardPort }
$refused = $false

# Stops one process; $true when it is gone afterwards.
function Stop-One([string]$Name, [int]$ProcessId, [string]$What) {
  $p = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if (-not $p) { return $true }
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  $p.WaitForExit(10000) | Out-Null
  if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
    [Console]::Error.WriteLine("REFUSED: $Name : could not stop $What (pid $ProcessId); it is still running. Stop it yourself (Stop-Process -Id $ProcessId -Force); the pid is kept.")
    return $false
  }
  Write-Host "$Name : stopped $What (pid $ProcessId)"
  return $true
}

# The node child of a cmd.exe wrapper that runs our service: its pid, $null when there is none,
# 'unknown' when the lookup failed.
function Get-OurNodeChild([string]$Name, [int]$WrapperId) {
  if (-not $IsWindows) { return $null }
  try {
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$WrapperId" -ErrorAction Stop |
      Where-Object { $_.Name -match '^node' -and (Test-OurServiceCommandLine $Name ([string]$_.CommandLine)) })
    if ($children.Count) { return [int]$children[0].ProcessId }
    return $null
  } catch {
    return 'unknown'
  }
}

foreach ($name in @('dashboard', 'bridge', 'foundry')) {
  if ($Only -ne 'all' -and $Only -ne $name) { continue }
  if (-not $pids.ContainsKey($name)) { continue }
  $port = $ports[$name]
  $recordedPid = [int]$pids[$name]
  $proc = Get-Process -Id $recordedPid -ErrorAction SilentlyContinue
  $facts = @{
    Name          = $name
    Port          = $port
    ProcessId     = $recordedPid
    Exists        = [bool]$proc
    ProcessName   = if ($proc) { $proc.ProcessName } else { '' }
    StartTime     = if ($proc) { Get-ProcessStartTime $recordedPid } else { $null }
    RecordedStart = if ($starts.ContainsKey($name)) { $starts[$name] } else { $null }
    Owners        = @(Get-PortOwners $port)
    CommandLine   = if ($proc) { Get-ProcessCommandLine $recordedPid } else { $null }
    ChildNode     = $null
  }
  if ($proc -and $proc.ProcessName -match '^cmd') { $facts.ChildNode = Get-OurNodeChild $name $recordedPid }
  $decision = Resolve-StopAction $facts
  $forget = $true
  $stoppedOurs = $false
  switch ($decision.Action) {
    'stop' {
      if (Stop-One $name $recordedPid '') { $stoppedOurs = $true } else { $refused = $true; $forget = $false }
    }
    'stop-wrapper' {
      $childGone = Stop-One $name $facts.ChildNode 'the node child'
      $wrapperGone = Stop-One $name $recordedPid 'the cmd.exe wrapper'
      if ($childGone -and $wrapperGone) { $stoppedOurs = $true } else { $refused = $true; $forget = $false }
    }
    'refuse'       { [Console]::Error.WriteLine($decision.Message); $refused = $true }
    'refuse-keep'  { [Console]::Error.WriteLine($decision.Message); $refused = $true; $forget = $false }
    default        { Write-Host "$name : $($decision.Message)" }
  }
  if ($forget) { $pids.Remove($name); $starts.Remove($name) }
  if (Test-PortOpen $port) {
    if ($stoppedOurs) {
      # Our process is gone and the port is still open: a child it left behind (the wrapper's node
      # child the lookup missed). Say so loudly; the next start.ps1 would otherwise fail on the port.
      [Console]::Error.WriteLine("REFUSED: $name : port $port is still open after our process was stopped (a child of it may run on); find it with Get-NetTCPConnection -LocalPort $port and stop it yourself.")
      $refused = $true
    } else {
      Write-Host "$name : WARNING, port $port is still in use by another process"
    }
  }
}
Write-Pids $pids
Write-Starts $starts
if ($refused) { exit 1 }
