#Requires -Version 7
<#
.SYNOPSIS
  Switch the world the Orange Pi's Foundry runs (docs/dev/PI-SETUP.md, "Switching the running world").

.DESCRIPTION
  Sends lib.sh and scripts/pi/remote/switch-world.sh to `ssh <PiHost> 'WORLD=<id> bash -s'`. On the Pi the
  stage sets the world in options.json (so a reboot keeps it), restarts Foundry and the Assistant GM browser
  and waits for "joined world <id>"; the bridge and the dashboard follow. It never edits world data. It prints
  which world runs before and after. It refuses while people are online or a recording runs; -Force goes on
  anyway. Each use needs the user's OK (docs: pi-work); a snapshot is only warned about, because only the
  launch choice changes. Never on a game-night day: after a test, switch back to curse-of-strahd.

.PARAMETER World
  curse-of-strahd, frostmaiden-training or strahd-kit.

.PARAMETER DryRun
  Prints the world before and what would change; changes nothing.

.PARAMETER Force
  Puts FORCE=1 in front of bash on the Pi, so the players-online and recording checks only warn.

.EXAMPLE
  .\scripts\pi\switch-world.ps1 -World frostmaiden-training -DryRun

.EXAMPLE
  .\scripts\pi\switch-world.ps1 -World curse-of-strahd
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidateSet('curse-of-strahd', 'frostmaiden-training', 'strahd-kit')]
  [string]$World,
  [string]$PiHost = $(if ($env:FVTT_PI_HOST) { $env:FVTT_PI_HOST } else { 'foundry-pi' }),
  [switch]$DryRun,
  [switch]$Force,
  # The ssh program (tests put a fake one here).
  [string]$Ssh = 'ssh'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$World = $World.ToLowerInvariant() # ValidateSet ignores case
$remote = Join-Path $PSScriptRoot 'remote'
$lib = Get-Content -Raw (Join-Path $remote 'lib.sh')
$body = Get-Content -Raw (Join-Path $remote 'switch-world.sh')

# World is one of the three ids above (ValidateSet), so it is safe in the ssh command line. LF line ends for bash;
# the final `exit` stops bash before the CRLF that PowerShell appends to piped native input.
$script = ($lib + "`n" + $body + "`nexit 0`n") -replace "`r`n", "`n"
$envText = "WORLD=$World"
if ($DryRun) { $envText += ' DRY_RUN=1' }
if ($Force) { $envText += ' FORCE=1' }
$script | & $Ssh $PiHost "$envText bash -s"
if ($LASTEXITCODE -ne 0) { throw "ssh $PiHost failed (exit $LASTEXITCODE); see the lines above" }
