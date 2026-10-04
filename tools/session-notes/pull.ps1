<#
.SYNOPSIS
  Copy finished recordings from the Orange Pi to this PC for transcription (D-068: the recorder
  bot runs on the Pi, which has no GPU; faster-whisper stays on the PC).

.DESCRIPTION
  Over SSH (the `foundry-pi` host from the Pi setup, through Tailscale), for every session folder
  in the Pi's recordings folder that is finished and converted (raw\convert-report.json exists:
  the bot writes it last, after the Ogg tracks, when the recording stops) and not pulled yet:

  1. copy it with scp into <sessions>\.incoming\<name>;
  2. check every file against the Pi's SHA-256 list; on any difference nothing is kept;
  3. move it to <sessions>\<name> (auto.ps1 then transcribes it and writes the notes);
  4. mark it pulled on the Pi (an empty `.pulled` file in the session folder).

  Pulled sessions are deleted on the Pi -KeepDays days after the pull (default 7): the audio's
  real retention clock (D-072, 14 days after the GM's approval) runs on the PC. A session folder
  that already exists on the PC is never overwritten.

  Needs: the OpenSSH client (built into Windows), key login to the Pi, and the SSH user in the
  Pi's `foundry` group (the recordings folder is group-writable). Nothing is ever deleted on the
  PC.

.PARAMETER PiHost
  SSH host of the Pi (default: FVTT_PI_HOST, else foundry-pi).

.PARAMETER RemoteDir
  The recordings folder on the Pi (default /var/lib/foundry-ai-tool/recordings).

.PARAMETER KeepDays
  Days a pulled session stays on the Pi (default 7; 0 deletes it right after the check).

.PARAMETER SshConfig
  An ssh config file to use instead of the user's (for tests against a stand-in Pi).

.PARAMETER DryRun
  Only list what would be copied and deleted.
#>
param(
  [string]$PiHost = $(if ($env:FVTT_PI_HOST) { $env:FVTT_PI_HOST } else { 'foundry-pi' }),
  [string]$RemoteDir = '/var/lib/foundry-ai-tool/recordings',
  [int]$KeepDays = 7,
  [string]$SshConfig = '',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$sessions = if ($env:FVTT_SESSIONS_DIR) { $env:FVTT_SESSIONS_DIR } else { Join-Path $env:USERPROFILE 'Documents\FoundrySessions' }
$namePattern = '^[A-Za-z0-9][A-Za-z0-9_.-]*$'
if ($RemoteDir -notmatch '^/[A-Za-z0-9_./-]+$') { throw "RemoteDir must be a plain absolute path: $RemoteDir" }

$sshOpts = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10')
if ($SshConfig) { $sshOpts = @('-F', $SshConfig) + $sshOpts }

function Invoke-Pi([string]$command) {
  $out = & ssh @sshOpts $PiHost $command 2>&1
  if ($LASTEXITCODE -ne 0) { throw "ssh $PiHost failed (exit $LASTEXITCODE): $out" }
  return @($out | ForEach-Object { "$_" })
}

# Finished, not yet pulled sessions on the Pi.
$listCmd = "cd '$RemoteDir' 2>/dev/null || exit 0; for d in */; do d=`${d%/}; " +
  "[ -f `"`$d/raw/convert-report.json`" ] && [ ! -e `"`$d/.pulled`" ] && echo `"`$d`"; done; true"
try {
  $ready = @(Invoke-Pi $listCmd | Where-Object { $_ -match $namePattern })
} catch {
  Write-Host "Pi not reachable, nothing pulled: $($_.Exception.Message)"
  exit 3
}

$pulled = 0
foreach ($name in $ready) {
  $target = Join-Path $sessions $name
  if (Test-Path $target) { Write-Host "$name`: already on this PC, left alone"; continue }
  if ($DryRun) { Write-Host "$name`: would copy"; continue }

  $incoming = Join-Path $sessions '.incoming'
  New-Item -ItemType Directory -Force -Path $incoming | Out-Null
  $stage = Join-Path $incoming $name
  if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
  & scp -q -r -p @sshOpts "${PiHost}:$RemoteDir/$name" $incoming
  if ($LASTEXITCODE -ne 0) { Write-Host "$name`: copy failed (exit $LASTEXITCODE)"; continue }

  # Every file's SHA-256 on the Pi against the copy.
  $sums = Invoke-Pi "cd '$RemoteDir/$name' && find . -type f ! -name .pulled -exec sha256sum {} +"
  $bad = @()
  $count = 0
  foreach ($line in $sums) {
    if ($line -notmatch '^([0-9a-f]{64})\s+\./(.+)$') { continue }
    $count += 1
    $file = Join-Path $stage ($Matches[2] -replace '/', '\')
    if (-not (Test-Path $file) -or (Get-FileHash -Algorithm SHA256 $file).Hash.ToLower() -ne $Matches[1]) {
      $bad += $Matches[2]
    }
  }
  if ($count -eq 0 -or $bad.Count -gt 0) {
    Write-Host "$name`: check failed ($($bad.Count) of $count files differ); the copy is removed, the Pi keeps it"
    Remove-Item -Recurse -Force $stage
    continue
  }
  Move-Item $stage $target
  $null = Invoke-Pi "touch '$RemoteDir/$name/.pulled'"
  Write-Host "$name`: copied and checked ($count files)"
  $pulled += 1
}

# Pulled sessions older than -KeepDays leave the Pi.
$pruneCmd = "cd '$RemoteDir' 2>/dev/null || exit 0; " +
  "find . -mindepth 2 -maxdepth 2 -name .pulled -mmin +$([Math]::Max($KeepDays, 0) * 1440) -printf '%h\n'"
$old = @(Invoke-Pi $pruneCmd | Where-Object { $_ -match '^\./[A-Za-z0-9][A-Za-z0-9_.-]*$' })
foreach ($dir in $old) {
  $n = $dir.Substring(2)
  if ($DryRun) { Write-Host "$n`: would delete on the Pi (pulled over $KeepDays days ago)"; continue }
  $null = Invoke-Pi "rm -rf -- '$RemoteDir/$n'"
  Write-Host "$n`: deleted on the Pi (pulled over $KeepDays days ago)"
}
if ($ready.Count -eq 0) { Write-Host 'No new finished recordings on the Pi.' }
exit 0
