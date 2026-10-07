# Stop the test environment (only the processes start.ps1 started).
#
#   pwsh scripts/test-env/stop.ps1
#   pwsh scripts/test-env/stop.ps1 -Only dashboard
#
# A recorded pid is stopped when it is still the process start.ps1 started: a node process that
# owns the service's port or whose command line shows the service (ours, but not on its port yet:
# Foundry still loading, a start that timed out), or the cmd.exe wrapper with our command line
# (start.ps1 could not find node's pid), whose node child is stopped first. A pid another process
# holds by now (its start time differs from the recorded one, or its command line is something
# else) is reported as "not running" and forgotten. One that holds our port, or one whose command
# line cannot be read and listens on nothing, is refused with a line on stderr and exit code 1
# (the pid is kept in the second case). The decision table is Resolve-StopAction in config.ps1.
param([ValidateSet('all', 'foundry', 'bridge', 'dashboard')] [string]$Only = 'all')

. (Join-Path $PSScriptRoot 'config.ps1')
$pids = Read-Pids
$ports = @{ foundry = $TestEnv.FoundryPort; bridge = $TestEnv.ControlPort; dashboard = $TestEnv.DashboardPort }
$refused = $false

function Stop-One([string]$Name, [int]$ProcessId, [string]$What) {
  $p = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if (-not $p) { return }
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  $p.WaitForExit(10000) | Out-Null
  Write-Host "$Name : stopped $What (pid $ProcessId)"
}

# The node child of a cmd.exe wrapper that runs our service, or $null.
function Get-OurNodeChild([string]$Name, [int]$WrapperId) {
  if (-not $IsWindows) { return $null }
  try {
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$WrapperId" -ErrorAction Stop |
      Where-Object { $_.Name -match '^node' -and (Test-OurServiceCommandLine $Name ([string]$_.CommandLine)) })
    if ($children.Count) { return [int]$children[0].ProcessId }
  } catch { }
  return $null
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
    RecordedStart = if ($pids.ContainsKey("$name.started")) { $pids["$name.started"] } else { $null }
    Owners        = @(Get-PortOwners $port)
    CommandLine   = if ($proc) { Get-ProcessCommandLine $recordedPid } else { $null }
    ChildNode     = $null
  }
  if ($proc -and $proc.ProcessName -match '^cmd') { $facts.ChildNode = Get-OurNodeChild $name $recordedPid }
  $decision = Resolve-StopAction $facts
  $forget = $true
  switch ($decision.Action) {
    'stop'         { Stop-One $name $recordedPid '' }
    'stop-wrapper' { Stop-One $name $facts.ChildNode 'the node child'; Stop-One $name $recordedPid 'the cmd.exe wrapper' }
    'refuse'       { [Console]::Error.WriteLine($decision.Message); $refused = $true }
    'refuse-keep'  { [Console]::Error.WriteLine($decision.Message); $refused = $true; $forget = $false }
    default        { Write-Host "$name : $($decision.Message)" }
  }
  if ($forget) { $pids.Remove($name); $pids.Remove("$name.started") }
  if (Test-PortOpen $port) { Write-Host "$name : WARNING, port $port is still in use by another process" }
}
Write-Pids $pids
if ($refused) { exit 1 }
