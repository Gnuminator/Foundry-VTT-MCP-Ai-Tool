# The test server lock: one session at a time may run live tests on the test environment.
# Take it before a live test, release it when done, queue when somebody else holds it.
#
#   pwsh scripts/test-env/lock.ps1 status
#   pwsh scripts/test-env/lock.ps1 take -Holder "<session title>" -Session <local_id> -Purpose "<text>" [-Force]
#   pwsh scripts/test-env/lock.ps1 release -Session <local_id> [-Force]
#   pwsh scripts/test-env/lock.ps1 queue -Holder "<session title>" -Session <local_id> -Purpose "<text>"
#   pwsh scripts/test-env/lock.ps1 leave -Session <local_id>
#   pwsh scripts/test-env/lock.ps1 publish   write this server's state to the vault note again (reads only)
#   ... -Server B   test server B's lock (<B's Root>/lock.json); default A, or FOUNDRY_TEST_SERVER
#
# State is <Root>/lock.json: { holder, session, since, purpose, queue: [ { holder, session, since, purpose } ] }.
# Every change is serialised through lock.json.lck and written as lock.json.tmp, then moved over
# lock.json. -Root overrides the test environment root (used by the tests).
# Crashed sessions: take -Force takes the lock over from a holder or skips a queue head that is
# gone (status flags entries older than 4 hours); leave -Session <their id> drops a dead queue
# entry. A lock.json that cannot be read is refused until take -Force or release -Force starts a
# fresh one.
# The PM board's Today page shows the three servers from the vault note
# `Dev/Foundry AI Tool/Test servers.md`: take, release, queue, leave and publish write this server's
# state there (free or held, the holder's title, since when, queue length; no paths, purposes or
# secrets): pull, commit only that file, push. A vault problem is a WARNING line and never fails or
# undoes the lock. The vault is $env:FOUNDRY_AI_OBSIDIAN_DIR or ~/Documents/Obsidian/vault; -Vault
# overrides it. With -Root (the tests) nothing is written unless -Vault names a checkout too.
# Exit code 1: refused (the lock is held by another session, or lock.json cannot be read).
param(
  [Parameter(Mandatory, Position = 0)][ValidateSet('status', 'take', 'release', 'queue', 'leave', 'publish')][string]$Command,
  [string]$Holder,
  [string]$Session,
  [string]$Purpose,
  [switch]$Force,
  [string]$Root,
  [string]$Vault,
  [ValidateSet('A', 'B', 'C')] [string]$Server
)
. (Join-Path $PSScriptRoot 'config.ps1')

$lockRoot = if ($Root) { $Root } else { $TestEnv.Root }
$lockFile = Join-Path $lockRoot 'lock.json'
$label = if ($TestEnv.Server -eq 'A') { 'Test server lock' } else { "Test server $($TestEnv.Server) lock" }
$cmd = "pwsh scripts/test-env/lock.ps1"
$sv = $TestEnv.ServerArg

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

function New-FreeLock {
  return [pscustomobject]@{ Holder = $null; Session = $null; Since = $null; Purpose = $null; Queue = @(); Unreadable = $false }
}

# Refuses (returns $true) when lock.json cannot be read and -Force was not given.
function Test-Unreadable($Lock) {
  if (-not $Lock.Unreadable -or $Force) { return $false }
  [Console]::Error.WriteLine("$lockFile cannot be read as a lock, so nobody can tell who holds the test server. Check with the other sessions, then start a fresh lock: $cmd take$sv -Holder `"...`" -Session <id> -Purpose `"...`" -Force")
  return $true
}

function Old-Note($Entry) {
  if (Test-LockOld $Entry.Since) { return ' (old: maybe a crashed session; take -Force takes over)' }
  return ''
}

function Show-Status {
  $lock = Read-TestLock $lockRoot
  if ($lock.Unreadable) {
    Write-Host "${label}: $lockFile cannot be read (take -Force or release -Force starts a fresh lock)"
    return
  }
  if (-not $lock.Holder) {
    Write-Host "${label}: free"
  } else {
    Write-Host "${label}: held by $($lock.Holder) (session $($lock.Session))$(Old-Note $lock)"
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
      Write-Host ("    {0}. {1} (session {2}), waiting since {3}, for {4}{5}" -f $i, $e.Holder, $e.Session, (Format-Since $e), $(if ($e.Purpose) { $e.Purpose } else { '(none given)' }), $(if ($i -eq 1) { Old-Note $e } else { '' }))
      $i++
    }
  }
}

function Invoke-Take {
  if (-not ((Test-Needs 'Holder' $Holder) -and (Test-Needs 'Session' $Session))) { return 2 }
  $me = Limit $Session
  $lock = Read-TestLock $lockRoot
  if (Test-Unreadable $lock) { return 1 }
  if ($lock.Unreadable) { $lock = New-FreeLock }
  if ($lock.Holder -and $lock.Session -eq $me) {
    # Already the holder: refresh the purpose (and the title), keep the original start time.
    $lock.Holder = Limit $Holder
    if ($Purpose) { $lock.Purpose = Limit $Purpose }
    Write-Lock $lock
    Write-Host "You already hold the lock (since $(Format-Since $lock)); purpose updated."
    return 0
  }
  $takenFrom = $null
  if ($lock.Holder -and $Force) {
    $takenFrom = "$($lock.Holder) (session $($lock.Session), since $(Format-Since $lock))"
  } elseif ($lock.Holder) {
    [Console]::Error.WriteLine("$label is held by $($lock.Holder) (session $($lock.Session)) since $(Format-Since $lock) for $(if ($lock.Purpose) { $lock.Purpose } else { 'no stated purpose' }).$(Old-Note $lock)")
    [Console]::Error.WriteLine("Wait, or join the queue: $cmd queue$sv -Holder `"$Holder`" -Session $Session -Purpose `"...`"")
    [Console]::Error.WriteLine('If that session has crashed, take it over with take -Force.')
    return 1
  }
  $queue = @($lock.Queue)
  if (-not $Force -and $queue.Count -gt 0 -and $queue[0].Session -ne $me) {
    $head = $queue[0]
    [Console]::Error.WriteLine("$label is free, but it is $($head.Holder)'s turn (session $($head.Session), waiting since $(Format-Since $head)).$(Old-Note $head)")
    [Console]::Error.WriteLine("Join the queue: $cmd queue$sv -Holder `"$Holder`" -Session $Session -Purpose `"...`"")
    [Console]::Error.WriteLine("If that session is gone, drop its entry (leave -Session $($head.Session)) or take the lock with take -Force.")
    return 1
  }
  Remove-FromQueue $lock $me
  $lock.Holder = Limit $Holder
  $lock.Session = $me
  $lock.Since = [DateTime]::UtcNow.ToString('o')
  $lock.Purpose = Limit $Purpose
  Write-Lock $lock
  if ($takenFrom) { Write-Host "Took the lock over from $takenFrom." }
  Write-Host "Lock taken by $($lock.Holder) (session $me). Release it when done: $cmd release$sv -Session $me"
  return 0
}

function Invoke-Release {
  if (-not $Force -and -not (Test-Needs 'Session' $Session)) { return 2 }
  $lock = Read-TestLock $lockRoot
  if (Test-Unreadable $lock) { return 1 }
  if ($lock.Unreadable) {
    Write-Lock (New-FreeLock)
    Write-Host 'lock.json could not be read; wrote a fresh, free lock with an empty queue.'
    return 0
  }
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
  if (Test-Unreadable $lock) { return 1 }
  if ($lock.Unreadable) { $lock = New-FreeLock }
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
  if ($lock.Unreadable) {
    [Console]::Error.WriteLine("$lockFile cannot be read; nothing to leave (take -Force or release -Force starts a fresh lock).")
    return 1
  }
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

$NotePath = 'Dev/Foundry AI Tool/Test servers.md'

# git in the vault with a time limit, so a hung network never holds up a lock command.
function Invoke-VaultGit([string]$Dir, [string[]]$GitArgs) {
  $psi = [System.Diagnostics.ProcessStartInfo]::new('git')
  foreach ($a in (@('-C', $Dir) + $GitArgs)) { $psi.ArgumentList.Add($a) }
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.Environment['GIT_TERMINAL_PROMPT'] = '0'
  $p = [System.Diagnostics.Process]::Start($psi)
  $out = $p.StandardOutput.ReadToEndAsync()
  $err = $p.StandardError.ReadToEndAsync()
  if (-not $p.WaitForExit(30000)) {
    try { $p.Kill($true) } catch { }
    return [pscustomobject]@{ Ok = $false; Text = 'timed out after 30 seconds' }
  }
  $p.WaitForExit()
  $text = (("$($err.Result)").Trim() + "`n" + ("$($out.Result)").Trim()).Trim().Split("`n")[0]
  return [pscustomobject]@{ Ok = ($p.ExitCode -eq 0); Text = $text }
}

# The holder as the note carries it: one line, 60 characters at most (not cut inside a surrogate pair),
# in double quotes so a "#" or ": " in a session title survives YAML, the board and Obsidian.
function Get-NoteHolder([string]$Text) {
  $t = ("$Text" -replace '\p{Cc}', ' ').Trim()
  if ($t.Length -gt 60) {
    $t = $t.Substring(0, 60)
    if ([char]::IsHighSurrogate($t[$t.Length - 1])) { $t = $t.Substring(0, $t.Length - 1) }
    $t = $t.TrimEnd()
  }
  return '"' + ($t -replace '([\\"])', '\$1') + '"'
}

# The note text: this server's lines replaced, the other servers' lines kept as they are.
function Get-NoteText([string]$Existing, $Lock, [string]$Name) {
  $keep = [ordered]@{}
  if ($Existing -match '(?s)^---\r?\n(.*?)\r?\n---') {
    foreach ($line in ($Matches[1] -split '\r?\n')) {
      if ($line -match '^(server-[abc](?:-[a-z]+)?): (.*)$') { $keep[$Matches[1]] = $Matches[2].TrimEnd() }
    }
  }
  $id = "server-$($Name.ToLowerInvariant())"
  foreach ($k in @($keep.Keys)) { if ($k -eq $id -or $k.StartsWith("$id-")) { $keep.Remove($k) } }
  if ($Lock.Holder) {
    $keep[$id] = 'held'
    $keep["$id-holder"] = Get-NoteHolder $Lock.Holder
    if ($Lock.Since) { $keep["$id-since"] = $Lock.Since }
  } else {
    $keep[$id] = 'free'
  }
  $keep["$id-queue"] = [string]@($Lock.Queue).Count
  $lines = @('type: test-servers', "updated: $([DateTime]::UtcNow.ToString('o'))")
  foreach ($k in ($keep.Keys | Sort-Object)) { $lines += "${k}: $($keep[$k])" }
  return "---`n$($lines -join "`n")`n---`n`nWritten by scripts/test-env/lock.ps1 on every take, release, queue, leave and publish. Do not edit by hand.`n"
}

# Runs the body with <vault>/.git/test-servers-note.lck held, so two lock.ps1 runs (two servers) never
# rewrite the shared note at the same time. $null when the lock could not be had in time (the caller warns).
function Use-NoteLock([string]$Dir, [scriptblock]$Body) {
  $lck = Join-Path $Dir '.git/test-servers-note.lck'
  $deadline = [DateTime]::UtcNow.AddSeconds(150)
  $stream = $null
  while ($null -eq $stream) {
    try {
      $stream = [System.IO.File]::Open($lck, 'CreateNew', 'Write', 'None')
    } catch [System.IO.IOException], [System.UnauthorizedAccessException] {
      try {
        if (([DateTime]::UtcNow - (Get-Item -LiteralPath $lck -ErrorAction Stop).LastWriteTimeUtc).TotalSeconds -gt 240) {
          Remove-Item -LiteralPath $lck -Force -ErrorAction Stop  # stale: a killed run left it
          continue
        }
      } catch { }
      if ([DateTime]::UtcNow -gt $deadline) { return $null }
      Start-Sleep -Milliseconds 200
    }
  }
  try {
    & $Body
    return $true
  } finally {
    $stream.Dispose()
    Remove-Item -LiteralPath $lck -Force -ErrorAction SilentlyContinue
  }
}

function Write-NoteWarning([string]$Text) { [Console]::Error.WriteLine("WARNING: $Text") }

# Writes this server's state to the vault note and pushes it. Never throws; a problem is a warning.
# The vault is left as it was found: no rebase and no autostash (fetch plus a fast-forward works with a
# dirty tree), and a commit that could not be pushed is taken back.
function Publish-LockNote {
  try {
    $dir = if ($Vault) { $Vault } elseif ($Root) { $null } elseif ($env:FOUNDRY_AI_OBSIDIAN_DIR) { $env:FOUNDRY_AI_OBSIDIAN_DIR } else { Join-Path $HOME 'Documents/Obsidian/vault' }
    if (-not $dir -or -not (Test-Path -LiteralPath (Join-Path $dir '.git'))) { return }
    $file = Join-Path $dir ($NotePath -replace '/', [IO.Path]::DirectorySeparatorChar)
    $done = Use-NoteLock $dir {
      # read the lock inside the note lock: the run that writes last writes the newest state
      $lock = Read-TestLock $lockRoot
      if ($lock.Unreadable) { return }
      $name = $TestEnv.Server
      $state = if ($lock.Holder) { 'held' } else { 'free' }
      $subject = "Test server ${name}: $state, queue $(@($lock.Queue).Count)"
      $pushError = ''
      foreach ($attempt in 1, 2) {
        [void](Invoke-VaultGit $dir @('restore', '--staged', '--worktree', '--', $NotePath))  # an earlier failed try; fine to fail
        $fetched = Invoke-VaultGit $dir @('fetch')
        if (-not $fetched.Ok) { Write-NoteWarning "test servers note not written: vault fetch failed ($($fetched.Text))"; return }
        $merged = Invoke-VaultGit $dir @('merge', '--ff-only', '@{u}')
        if (-not $merged.Ok) { Write-NoteWarning "test servers note not written: vault pull failed ($($merged.Text))"; return }
        $existing = if (Test-Path -LiteralPath $file) { Get-Content -LiteralPath $file -Raw } else { '' }
        New-Item -ItemType Directory -Force (Split-Path $file) | Out-Null
        [System.IO.File]::WriteAllText($file, (Get-NoteText $existing $lock $name), [System.Text.UTF8Encoding]::new($false))
        $added = Invoke-VaultGit $dir @('add', '--', $NotePath)
        if (-not $added.Ok) { Write-NoteWarning "test servers note not committed ($($added.Text))"; return }
        $committed = Invoke-VaultGit $dir @('commit', '-m', $subject, '--', $NotePath)
        if (-not $committed.Ok) { Write-NoteWarning "test servers note not committed ($($committed.Text))"; return }
        $pushed = Invoke-VaultGit $dir @('push')
        if ($pushed.Ok) { return }
        $pushError = $pushed.Text
        # take our own commit back, so the vault is left as it was and the next try starts clean
        [void](Invoke-VaultGit $dir @('reset', '--soft', 'HEAD~1'))
        [void](Invoke-VaultGit $dir @('restore', '--staged', '--', $NotePath))
      }
      Write-NoteWarning "test servers note not pushed ($pushError)"
    }
    if ($null -eq $done) { Write-NoteWarning 'test servers note not written: another lock.ps1 run held the vault note for over 2 minutes' }
  } catch {
    Write-NoteWarning "test servers note not written ($($_.Exception.Message))"
  }
}

if ($Command -eq 'status') {
  Show-Status
  exit 0
}
if ($Command -eq 'publish') {
  Publish-LockNote
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
$exitCode = [int]@($code)[-1]
if ($exitCode -eq 0) { Publish-LockNote }
exit $exitCode
