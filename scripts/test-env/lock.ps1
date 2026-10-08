# The test server lock: one session at a time may run live tests on the test environment.
# Take it before a live test, release it when done, queue when somebody else holds it.
#
#   pwsh scripts/test-env/lock.ps1 status
#   pwsh scripts/test-env/lock.ps1 take -Holder "<session title>" -Session <local_id> -Purpose "<text>"
#   pwsh scripts/test-env/lock.ps1 release -Session <local_id> [-Force]
#   pwsh scripts/test-env/lock.ps1 queue -Holder "<session title>" -Session <local_id> -Purpose "<text>"
#   pwsh scripts/test-env/lock.ps1 leave -Session <local_id>
#
# State is <Root>/lock.json: { holder, session, since, purpose, queue: [ { holder, session, since, purpose } ] }.
# Every change is serialised through lock.json.lck and written as lock.json.tmp, then moved over
# lock.json. -Root overrides the test environment root (used by the tests).
# Exit code 1: take or release refused (the lock is held by another session).
param(
  [Parameter(Mandatory, Position = 0)][ValidateSet('status', 'take', 'release', 'queue', 'leave')][string]$Command,
  [string]$Holder,
  [string]$Session,
  [string]$Purpose,
  [switch]$Force,
  [string]$Root
)
. (Join-Path $PSScriptRoot 'config.ps1')

$lockRoot = if ($Root) { $Root } else { $TestEnv.Root }
$lockFile = Join-Path $lockRoot 'lock.json'

function Limit([string]$Text) {
  $t = $Text.Trim()
  if (-not $t) { return $null }
  if ($t.Length -gt 120) { return $t.Substring(0, 120) }
  return $t
}

function Format-Since($Entry) {
  $mins = Get-LockMinutes $Entry.Since
  if ($Entry.Since -and $null -ne $mins) { return "$($Entry.Since) ($mins min ago)" }
  if ($Entry.Since) { return [string]$Entry.Since }
  return 'unknown time'
}

function Write-Lock($Lock) {
  $doc = [ordered]@{
    holder  = $Lock.Holder
    session = $Lock.Session
    since   = $Lock.Since
    purpose = $Lock.Purpose
    queue   = @($Lock.Queue | ForEach-Object {
        [ordered]@{ holder = $_.Holder; session = $_.Session; since = $_.Since; purpose = $_.Purpose }
      })
  }
  $tmp = "$lockFile.tmp"
  $doc | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $tmp -Encoding utf8NoBOM
  [System.IO.File]::Move($tmp, $lockFile, $true)
}

# Runs the body with lock.json.lck held (CreateNew is atomic); the body returns the exit code.
function Use-LockFile([scriptblock]$Body) {
  New-Item -ItemType Directory -Force $lockRoot | Out-Null
  $lck = "$lockFile.lck"
  $deadline = [DateTime]::UtcNow.AddSeconds(5)
  $stream = $null
  while ($null -eq $stream) {
    try {
      $stream = [System.IO.File]::Open($lck, 'CreateNew', 'Write', 'None')
    } catch [System.IO.IOException], [System.UnauthorizedAccessException] {
      try {
        if (([DateTime]::UtcNow - (Get-Item -LiteralPath $lck -ErrorAction Stop).LastWriteTimeUtc).TotalSeconds -gt 60) {
          Remove-Item -LiteralPath $lck -Force -ErrorAction Stop  # stale: a crashed run left it
          continue
        }
      } catch { }
      if ([DateTime]::UtcNow -gt $deadline) { throw "Could not get $lck within 5 seconds (another lock.ps1 run is writing)." }
      Start-Sleep -Milliseconds 100
    }
  }
  try {
    return (& $Body)
  } finally {
    $stream.Dispose()
    Remove-Item -LiteralPath $lck -Force -ErrorAction SilentlyContinue
  }
}

function Test-Needs([string]$Name, [string]$Value) {
  if (-not $Value -or -not $Value.Trim()) {
    [Console]::Error.WriteLine("lock.ps1 $Command needs -$Name.")
    return $false
  }
  return $true
}

function Remove-FromQueue($Lock, [string]$SessionId) {
  $Lock.Queue = @($Lock.Queue | Where-Object { $_.Session -ne $SessionId })
}

function Show-Status {
  $lock = Read-TestLock $lockRoot
  if (-not $lock.Holder) {
    Write-Host 'Test server lock: free'
  } else {
    Write-Host "Test server lock: held by $($lock.Holder) (session $($lock.Session))"
    Write-Host "  since:   $(Format-Since $lock)"
    Write-Host "  purpose: $(if ($lock.Purpose) { $lock.Purpose } else { '(none given)' })"
  }
  $queue = @($lock.Queue)
  if ($queue.Count -eq 0) {
    Write-Host '  queue:   empty'
  } else {
    Write-Host "  queue:   $($queue.Count) waiting"
    $i = 1
    foreach ($e in $queue) {
      Write-Host ("    {0}. {1} (session {2}), waiting since {3}, for {4}" -f $i, $e.Holder, $e.Session, (Format-Since $e), $(if ($e.Purpose) { $e.Purpose } else { '(none given)' }))
      $i++
    }
  }
}

function Invoke-Take {
  if (-not ((Test-Needs 'Holder' $Holder) -and (Test-Needs 'Session' $Session))) { return 2 }
  $me = Limit $Session
  $lock = Read-TestLock $lockRoot
  if ($lock.Holder -and $lock.Session -eq $me) {
    # Already the holder: refresh the purpose (and the title), keep the original start time.
    $lock.Holder = Limit $Holder
    if ($Purpose) { $lock.Purpose = Limit $Purpose }
    Write-Lock $lock
    Write-Host "You already hold the lock (since $(Format-Since $lock)); purpose updated."
    return 0
  }
  if ($lock.Holder) {
    [Console]::Error.WriteLine("Test server lock is held by $($lock.Holder) (session $($lock.Session)) since $(Format-Since $lock) for $(if ($lock.Purpose) { $lock.Purpose } else { 'no stated purpose' }).")
    [Console]::Error.WriteLine("Wait, or join the queue: pwsh scripts/test-env/lock.ps1 queue -Holder `"$Holder`" -Session $Session -Purpose `"...`"")
    return 1
  }
  $queue = @($lock.Queue)
  if ($queue.Count -gt 0 -and $queue[0].Session -ne $me) {
    $head = $queue[0]
    [Console]::Error.WriteLine("Test server lock is free, but it is $($head.Holder)'s turn (session $($head.Session), waiting since $(Format-Since $head)).")
    [Console]::Error.WriteLine("Join the queue: pwsh scripts/test-env/lock.ps1 queue -Holder `"$Holder`" -Session $Session -Purpose `"...`"")
    return 1
  }
  Remove-FromQueue $lock $me
  $lock.Holder = Limit $Holder
  $lock.Session = $me
  $lock.Since = [DateTime]::UtcNow.ToString('o')
  $lock.Purpose = Limit $Purpose
  Write-Lock $lock
  Write-Host "Lock taken by $($lock.Holder) (session $me). Release it when done: pwsh scripts/test-env/lock.ps1 release -Session $me"
  return 0
}

function Invoke-Release {
  if (-not $Force -and -not (Test-Needs 'Session' $Session)) { return 2 }
  $lock = Read-TestLock $lockRoot
  if (-not $lock.Holder) {
    Write-Host 'The lock is already free.'
    return 0
  }
  if (-not $Force -and $lock.Session -ne (Limit $Session)) {
    [Console]::Error.WriteLine("Only the holder can release: $($lock.Holder) (session $($lock.Session)) holds it since $(Format-Since $lock). To take it over anyway: release -Force.")
    return 1
  }
  $was = "$($lock.Holder) (session $($lock.Session))"
  $lock.Holder = $null
  $lock.Session = $null
  $lock.Since = $null
  $lock.Purpose = $null
  Write-Lock $lock
  Write-Host "Released from $was.$(if (@($lock.Queue).Count -gt 0) { " Next in the queue: $(@($lock.Queue)[0].Holder)." })"
  return 0
}

function Invoke-Queue {
  if (-not ((Test-Needs 'Holder' $Holder) -and (Test-Needs 'Session' $Session))) { return 2 }
  $me = Limit $Session
  $lock = Read-TestLock $lockRoot
  if ($lock.Holder -and $lock.Session -eq $me) {
    Write-Host 'You hold the lock already; nothing to queue.'
    return 0
  }
  $queue = @($lock.Queue)
  for ($i = 0; $i -lt $queue.Count; $i++) {
    if ($queue[$i].Session -eq $me) {
      Write-Host "Already in the queue (position $($i + 1))."
      return 0
    }
  }
  $lock.Queue = $queue + [pscustomobject]@{
    Holder = Limit $Holder; Session = $me; Since = [DateTime]::UtcNow.ToString('o'); Purpose = Limit $Purpose
  }
  Write-Lock $lock
  Write-Host "Queued at position $(@($lock.Queue).Count)."
  return 0
}

function Invoke-Leave {
  if (-not (Test-Needs 'Session' $Session)) { return 2 }
  $me = Limit $Session
  $lock = Read-TestLock $lockRoot
  $before = @($lock.Queue).Count
  Remove-FromQueue $lock $me
  if (@($lock.Queue).Count -eq $before) {
    Write-Host 'Not in the queue.'
    return 0
  }
  Write-Lock $lock
  Write-Host 'Left the queue.'
  return 0
}

if ($Command -eq 'status') {
  Show-Status
  exit 0
}
$code = Use-LockFile {
  switch ($Command) {
    'take' { Invoke-Take }
    'release' { Invoke-Release }
    'queue' { Invoke-Queue }
    'leave' { Invoke-Leave }
  }
}
exit ([int]@($code)[-1])
