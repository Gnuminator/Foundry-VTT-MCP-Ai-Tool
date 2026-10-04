#Requires -Version 7
<#
.SYNOPSIS
  Set up Syncthing on this PC so it receives the GM vault from the Orange Pi (docs/dev/PI-SETUP.md,
  "The GM vault and Syncthing"), or remove the task again.

.DESCRIPTION
  Needs Syncthing installed (`winget install Syncthing.Syncthing`; this script does not install it).
  Setup mode, safe to run again:
  - registers the hidden scheduled task "Syncthing" (at logon, restarted if it stops, runs as you,
    no stored password, started through `conhost --headless`, so no window) and starts it now;
  - sets natEnabled=false (never asks the router to open a port), urAccepted=-1 (no usage
    reports) and crashReportingEnabled=false; the GUI stays on 127.0.0.1;
  - removes Syncthing's own "default" folder (a settings entry only; it never holds your files);
  - adds the Pi as a device (discovery plus its Tailscale name, so it works away from home) and the
    folder "foundry-gm-vault" at -VaultPath, send and receive, so your Prep notes go back to the Pi
    and into its backups; writes the .stignore that keeps Obsidian's per-device state out of the sync;
  - prints this PC's device ID. Give it to Claude: the Pi then adds this PC (7-vault.sh with PEER_ID).
  Syncthing 1.x (the Pi, Debian's) and 2.x (winget) sync with each other.
  The task starts this script again with -Run, which looks up syncthing.exe at every logon, so a
  winget upgrade (the exe's folder name carries the version) does not break it.

.EXAMPLE
  .\scripts\pi\setup-syncthing-pc.ps1 -PiDeviceId ABCDEFG-HIJKLMN-OPQRSTU-VWXYZ23-4567ABC-DEFGHIJ-KLMNOPQ-RSTUVWX
  .\scripts\pi\setup-syncthing-pc.ps1 -Remove
#>
[CmdletBinding(DefaultParameterSetName = 'Setup')]
param(
  [Parameter(Mandatory, ParameterSetName = 'Setup')][string]$PiDeviceId,
  [Parameter(ParameterSetName = 'Setup')][string]$VaultPath = (Join-Path $env:USERPROFILE 'Documents\Obsidian\Foundry GM vault'),
  [Parameter(ParameterSetName = 'Setup')][string]$PiName = 'foundry-pi',
  # The Pi's Tailscale name (docs/dev/PI-SETUP.md); Syncthing also finds it by discovery.
  [Parameter(ParameterSetName = 'Setup')][string]$PiAddress = 'tcp://foundry-pi.tailf949aa.ts.net:22000',
  [Parameter(ParameterSetName = 'Remove')][switch]$Remove,
  # Used by the scheduled task: start Syncthing and stay in the foreground.
  [Parameter(ParameterSetName = 'Run')][switch]$Run,
  [string]$TaskName = 'Syncthing',
  [string]$GuiAddress = '127.0.0.1:8384',
  # Test hook: the syncthing.exe to use (default: found automatically).
  [string]$Syncthing = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$folderId = 'foundry-gm-vault'
$folderLabel = 'Foundry GM vault'
# Differs between Syncthing 1.x and 2.x: 2.x has no --no-default-folder (the setup removes the
# default folder instead) and calls port probing --no-port-probing. --no-port-probing keeps the GUI
# address in config.xml equal to $GuiAddress, because `syncthing cli` reads it from there.
$serveArgs = @('serve', '--no-browser', '--no-restart', '--no-upgrade', '--no-port-probing', "--gui-address=$GuiAddress")

function Find-Syncthing {
  if ($Syncthing) {
    if (-not (Test-Path -LiteralPath $Syncthing)) { throw "No file at -Syncthing $Syncthing" }
    return (Resolve-Path -LiteralPath $Syncthing).Path
  }
  $cmd = Get-Command syncthing -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($cmd) { return $cmd.Source }
  $link = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\syncthing.exe'
  if (Test-Path -LiteralPath $link) { return $link }
  # winget unpacks the zip into Packages\Syncthing.Syncthing_<source>\syncthing-windows-amd64-v<version>\.
  $pkg = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\Syncthing.Syncthing_*\*\syncthing.exe') -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($pkg) { return $pkg.FullName }
  throw 'syncthing.exe not found. Install it first: winget install Syncthing.Syncthing'
}

if ($Run) {
  $exe = Find-Syncthing
  & $exe @serveArgs
  exit $LASTEXITCODE
}

if ($Remove) {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed task '$TaskName'. Syncthing's settings and your vault stay as they are; a copy still running stops when you sign out."
  } else {
    Write-Host "No task '$TaskName' to remove."
  }
  return
}

if ($PiDeviceId -notmatch '^[A-Z0-9]{7}(-[A-Z0-9]{7}){7}$') {
  throw 'PiDeviceId is not a Syncthing device ID (eight groups of seven letters and digits).'
}

$exe = Find-Syncthing
Write-Host "Syncthing: $exe"
Write-Host "  $((& $exe --version) -join ' ')"

# `syncthing cli` talks to the running instance; it reads the address and API key from the default
# home (%LOCALAPPDATA%\Syncthing). Returns the output text and fails on a non-zero exit.
function Invoke-St {
  param([Parameter(Mandatory)][string[]]$CliArgs)
  $out = (& $exe cli @CliArgs 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "syncthing cli $($CliArgs -join ' ') failed: $out" }
  return $out
}
function Test-StUp {
  try { $null = Invoke-St @('show', 'system'); return $true } catch { return $false }
}
function Get-StLines {
  param([string[]]$CliArgs)
  return @((Invoke-St $CliArgs) -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

# The task.
$alias = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\pwsh.exe'
$pwsh = if (Test-Path $alias) { $alias } else { (Get-Command pwsh).Source }
$conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
$taskArgs = "--headless `"$pwsh`" -NoProfile -NonInteractive -File `"$PSCommandPath`" -Run -GuiAddress $GuiAddress"
if ($Syncthing) { $taskArgs += " -Syncthing `"$Syncthing`"" }
$action = New-ScheduledTaskAction -Execute $conhost -Argument $taskArgs -WorkingDirectory $PSScriptRoot
$logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $logon -Settings $settings `
  -Principal $principal -Description 'Syncthing for the Foundry GM vault (scripts/pi/setup-syncthing-pc.ps1).' -Force | Out-Null
Write-Host "Task '$TaskName': at logon, hidden, restarts if it stops."

if (Test-StUp) {
  Write-Host 'Syncthing already runs.'
} else {
  Start-ScheduledTask -TaskName $TaskName
  Write-Host 'Started the task; waiting for Syncthing (the first start makes its keys, up to a minute).'
  for ($i = 0; $i -lt 90 -and -not (Test-StUp); $i++) { Start-Sleep -Seconds 1 }
  if (-not (Test-StUp)) { throw "Syncthing does not answer. Look in $env:LOCALAPPDATA\Syncthing\syncthing.log." }
}
$gui = Invoke-St @('config', 'gui', 'raw-address', 'get')
if ($gui -ne $GuiAddress) {
  throw "Syncthing's GUI address is $gui, not $GuiAddress (an older setup?). Fix it in %LOCALAPPDATA%\Syncthing\config.xml or pass -GuiAddress $gui."
}

# Syncthing's own "default" folder points at ~\Sync; nothing here uses it.
if ((Get-StLines @('config', 'folders', 'list')) -contains 'default') {
  $null = Invoke-St @('config', 'folders', 'default', 'delete')
  Write-Host "Removed Syncthing's 'default' folder entry."
}

# `--` lets the negative number through (urAccepted -1). Never ask the router to open a port, no
# usage or crash reports. Global discovery and relays stay on, so this PC and the Pi find each other
# outside the home; relays only carry end-to-end encrypted traffic.
function Set-StOption([string]$Name, [string]$Want) {
  $have = Invoke-St @('config', 'options', $Name, 'get')
  if ($have -eq $Want) {
    Write-Host "  $Name already $Want"
  } else {
    $null = Invoke-St @('config', 'options', $Name, 'set', '--', $Want)
    Write-Host "  ${Name}: $have -> $Want"
  }
}
Write-Host 'Settings:'
Set-StOption 'natenabled' 'false'
Set-StOption 'uraccepted' '-1'
Set-StOption 'crenabled' 'false'
Set-StOption 'global-ann-enabled' 'true'
Set-StOption 'relays-enabled' 'true'

# The Pi as a device. A new device starts with the address "dynamic" (discovery); the Tailscale
# name is added next to it. No --addresses flag: Syncthing 1.x's CLI panics on it.
$knownDevices = Get-StLines @('config', 'devices', 'list')
if ($knownDevices -contains $PiDeviceId) {
  Write-Host "Device $PiName already known."
} else {
  $null = Invoke-St @('config', 'devices', 'add', '--device-id', $PiDeviceId, '--name', $PiName)
  Write-Host "Added device $PiName."
}
$addresses = @()
try { $addresses = @(((Invoke-St @('config', 'devices', $PiDeviceId, 'dump-json')) | ConvertFrom-Json).addresses) } catch { }
if ($addresses -notcontains $PiAddress) {
  $null = Invoke-St @('config', 'devices', $PiDeviceId, 'addresses', 'add', $PiAddress)
  Write-Host "  address $PiAddress added."
}

# The vault folder, and the ignore file (Syncthing does not sync .stignore, so each PC writes it).
New-Item -ItemType Directory -Force -Path $VaultPath | Out-Null
$ignoreFile = Join-Path $VaultPath '.stignore'
$ignoreLines = @('.obsidian/workspace*.json', '.obsidian/cache', '.trash')
$have = if (Test-Path -LiteralPath $ignoreFile) { @(Get-Content -LiteralPath $ignoreFile) } else { @() }
$missing = @($ignoreLines | Where-Object { $have -notcontains $_ })
if ($missing.Count -gt 0) {
  if ($have.Count -eq 0) { $missing = @('// Per-device Obsidian state: each PC keeps its own (written by setup-syncthing-pc.ps1).') + $missing }
  Add-Content -LiteralPath $ignoreFile -Value $missing
  Write-Host "Wrote $ignoreFile"
}
if ((Get-StLines @('config', 'folders', 'list')) -contains $folderId) {
  Write-Host "Folder $folderId already there."
  $path = Invoke-St @('config', 'folders', $folderId, 'path', 'get')
  if ($path.TrimEnd('\') -ne $VaultPath.TrimEnd('\')) {
    Write-Warning "Folder $folderId points at $path, not $VaultPath. Change it in the Syncthing GUI if that is wrong."
  }
  if ((Invoke-St @('config', 'folders', $folderId, 'type', 'get')) -ne 'sendreceive') {
    $null = Invoke-St @('config', 'folders', $folderId, 'type', 'set', 'sendreceive')
  }
} else {
  $null = Invoke-St @('config', 'folders', 'add', '--id', $folderId, '--label', $folderLabel, '--path', $VaultPath, '--type', 'sendreceive')
  Write-Host "Added folder $folderId (send and receive) at $VaultPath."
}
if ((Get-StLines @('config', 'folders', $folderId, 'devices', 'list')) -contains $PiDeviceId) {
  Write-Host "Folder shared with $PiName already."
} else {
  $null = Invoke-St @('config', 'folders', $folderId, 'devices', 'add', '--device-id', $PiDeviceId)
  Write-Host "Shared the folder with $PiName."
}

$myId = ((Invoke-St @('show', 'system')) | ConvertFrom-Json).myID
Write-Host ''
Write-Host "This PC's device ID: $myId"
Write-Host 'Give it to Claude: the Pi then adds this PC (7-vault.sh with PEER_ID), and the vault starts to sync.'
Write-Host "Open $VaultPath as a vault in Obsidian. The Syncthing GUI: http://$GuiAddress/"
