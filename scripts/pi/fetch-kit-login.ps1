#Requires -Version 7
<#
.SYNOPSIS
  Copy the Pi kit session's Kit GM password to a file on this PC, or delete that file
  (docs/dev/PI-SETUP.md, "Kit session"; docs/dev/TEST-KIT.md, "Running it on the Pi").

.DESCRIPTION
  The Pi's kit session (kit-session.sh MODE=up) makes a GM user "Kit GM" with a password it generated and
  keeps in /etc/foundry-ai-tool/kit-gm.env (root only). The test kit's Pi target reads the password from a
  file on this PC (kitGmPasswordFile in kit-targets.json). This script puts it there.

  - Fetch (default): ONE read-only ssh command, `sed -n 's/^ASSISTANT_GM_PASSWORD=//p' <that file>`, whose
    output goes into a variable and from there into the file. The password is checked (32 hex characters), never
    printed, never put on a command line; the file is limited to your Windows user.
  - -Remove: deletes the file on this PC (do this after MODE=down; the Pi has deleted the user and its own file).

  Never throws on a Pi that does not answer: it says so and exits 1.

  Functions: Get-KitLogin, Remove-KitLogin

.EXAMPLE
  .\scripts\pi\fetch-kit-login.ps1
  .\scripts\pi\fetch-kit-login.ps1 -Remove
#>
[CmdletBinding()]
param(
  [string]$PiHost = 'foundry-pi',
  [string]$Destination = (Join-Path $env:LOCALAPPDATA 'foundry-ai-tool\kit-gm-password.txt'),
  [switch]$Remove,
  # Test hook: the ssh program (or a script block) to call.
  [object]$Ssh = 'ssh'
)

Set-StrictMode -Version Latest

$script:KitGmEnvFile = '/etc/foundry-ai-tool/kit-gm.env'

# Returns $true when the password file is in place. Prints a plain line either way, never the password.
function Get-KitLogin {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$PiHost,
    [Parameter(Mandatory)][string]$Destination,
    [object]$Ssh = 'ssh'
  )
  # No leading dash: a value like -Fsomefile would become an ssh option.
  if ($PiHost -notmatch '^[A-Za-z0-9][A-Za-z0-9.-]*$') {
    Write-Host "REFUSED: '$PiHost' is not a host name."
    return $false
  }
  # One absolute path for every step below: .NET and PowerShell resolve a relative one against different folders.
  $Destination = [System.IO.Path]::GetFullPath($Destination, (Get-Location).ProviderPath)
  $remote = "sed -n 's/^ASSISTANT_GM_PASSWORD=//p' $script:KitGmEnvFile"
  try {
    $out = & $Ssh -o BatchMode=yes -o ConnectTimeout=10 $PiHost $remote 2>$null
    $code = $LASTEXITCODE
  } catch {
    Write-Host "could not reach the Pi: $($_.Exception.Message)"
    return $false
  }
  if ($code -ne 0) {
    Write-Host "could not read the Kit GM file on the Pi (ssh exit $code): is the kit session up (kit-session.sh MODE=up)?"
    return $false
  }
  $value = (@($out) -join '').Trim()
  if ($value -cnotmatch '^[0-9a-f]{32}$') {
    Write-Host 'the Pi has no Kit GM password (empty or not the expected form): is the kit session up?'
    return $false
  }
  # Written without a final newline, to a file only this user can read. Replaced whole through a temp file.
  # Any failure removes the temp file and reports no success: the file is never left open to others.
  $tmp = "$Destination.tmp"
  try {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) -ErrorAction Stop | Out-Null
    [System.IO.File]::WriteAllText($tmp, $value)
    if ($IsWindows) {
      & icacls $tmp /inheritance:r /grant:r "$($env:USERNAME):(R,W)" 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "icacls failed (exit $LASTEXITCODE)" }
    } else {
      & chmod 600 $tmp
      if ($LASTEXITCODE -ne 0) { throw "chmod failed (exit $LASTEXITCODE)" }
    }
    Move-Item -Force -LiteralPath $tmp -Destination $Destination -ErrorAction Stop
  } catch {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    Write-Host "could not put the password file in place: $($_.Exception.Message)"
    return $false
  }
  Write-Host "the Kit GM password is in $Destination (not shown here)"
  return $true
}

function Remove-KitLogin {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Destination)
  if (Test-Path -LiteralPath $Destination) {
    Remove-Item -LiteralPath $Destination -Force
    Write-Host "removed $Destination"
  } else {
    Write-Host "nothing to remove: $Destination is not there"
  }
  return $true
}

# Run only as a script; dot-sourcing (the tests) defines the functions and runs nothing.
if ($MyInvocation.InvocationName -ne '.') {
  $ok = if ($Remove) { Remove-KitLogin -Destination $Destination } else { Get-KitLogin -PiHost $PiHost -Destination $Destination -Ssh $Ssh }
  exit ($ok ? 0 : 1)
}
