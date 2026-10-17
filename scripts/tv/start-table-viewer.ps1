#Requires -Version 7
<#
.SYNOPSIS
  Opens Foundry full screen on the TV at the table (tv-login, G1), signed in as the "Table" user.

.DESCRIPTION
  Runs Edge (or Chrome) with its own profile folder, so the TV's sign-ins (the Cloudflare Access
  email code and the Foundry "Table" user) are kept between runs and restarts. This is the whole
  "login": do it once with -Setup, then every later run goes straight to the map.

  First time (a keyboard needed, once):
    pwsh scripts\tv\start-table-viewer.ps1 -Url https://foundry.example.com -Setup
  A normal window opens. Enter the Table mailbox's email, then the code Cloudflare sends there, pick
  the user "Table" on Foundry's join page, click Join, then close the window.

  Every time after (no keyboard):
    pwsh scripts\tv\start-table-viewer.ps1 -Url https://foundry.example.com
  Put that line in a shortcut in the Startup folder and the TV opens on the map after a restart.

  Nothing secret is stored by this script: it only chooses the browser and the profile folder. The
  profile folder holds the TV's session cookies, so keep it on the TV PC and out of any backup you
  share. To sign the TV out, delete the folder (-Profile, default below).

.PARAMETER Url
  Foundry's address, http or https, without a user name or password in it.
.PARAMETER Setup
  Open a normal window instead of full screen, for the first sign-in.
.PARAMETER Browser
  edge, chrome or auto (default: Edge, then Chrome).
.PARAMETER Profile
  The browser profile folder. Default: %LOCALAPPDATA%\FoundryAiTool\table-viewer-profile.
.PARAMETER DryRun
  Print the browser and arguments, start nothing.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Url,
  [switch]$Setup,
  [ValidateSet('auto', 'edge', 'chrome')][string]$Browser = 'auto',
  [string]$Profile = '',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Get-TableViewerCommand {
  param([string]$Url, [bool]$Setup, [string]$Browser, [string]$Profile, [string[]]$Candidates)

  $uri = $null
  if (-not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -notin 'http', 'https') {
    throw "Url must be an http or https address, for example https://foundry.example.com (got '$Url')."
  }
  if ($uri.UserInfo) { throw 'Url must not contain a user name or password.' }

  if (-not $Profile) { $Profile = Join-Path $env:LOCALAPPDATA 'FoundryAiTool\table-viewer-profile' }

  $order = switch ($Browser) { 'edge' { 'edge' } 'chrome' { 'chrome' } default { 'edge', 'chrome' } }
  $exe = $null
  $kind = $null
  foreach ($k in $order) {
    foreach ($c in $Candidates | Where-Object { $_ -match $k }) {
      if (Test-Path -LiteralPath $c) { $exe = $c; $kind = $k; break }
    }
    if ($exe) { break }
  }
  if (-not $exe) { throw "No $($order -join ' or ') browser found. Install Microsoft Edge or Google Chrome." }

  $arguments = @("--user-data-dir=$Profile", '--no-first-run', '--no-default-browser-check',
    '--disable-session-crashed-bubble', '--noerrdialogs')
  if (-not $Setup) {
    $arguments += '--kiosk'
    if ($kind -eq 'edge') { $arguments += '--edge-kiosk-type=fullscreen' }
  }
  $arguments += $uri.AbsoluteUri

  [pscustomobject]@{ Exe = $exe; Arguments = $arguments; Profile = $Profile; Kind = $kind }
}

$candidates = @(
  "$env:ProgramFiles (x86)\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$cmd = Get-TableViewerCommand -Url $Url -Setup $Setup.IsPresent -Browser $Browser -Profile $Profile -Candidates $candidates

if ($DryRun) {
  Write-Host "$($cmd.Exe) $($cmd.Arguments -join ' ')"
  return
}

New-Item -ItemType Directory -Force -Path $cmd.Profile | Out-Null
Start-Process -FilePath $cmd.Exe -ArgumentList $cmd.Arguments
if ($Setup) {
  Write-Host 'Sign in as the Table user, click Join, then close the window. Then run this without -Setup.'
}
