#Requires -Version 7
<#
.SYNOPSIS
  Opens Foundry full screen on the TV at the table (tv-login, G1), signed in as the "Table" user.

.DESCRIPTION
  Runs Edge (or Chrome) with its own profile folder, so the TV's sign-ins are kept between runs and
  restarts: the Cloudflare Access email code lasts as long as the Access session (weeks), and
  Foundry's own login lasts 24 hours. When Foundry shows its join page again (a new day, a
  restart), this script fills in the user name "Table" and clicks Join, so nobody needs a
  keyboard. It does this only on the join page of the address you gave, never on another page.

  First time (a keyboard needed, once, for the Cloudflare email code):
    pwsh scripts\tv\start-table-viewer.ps1 -Url https://foundry.example.com -Setup
  A normal window opens. Enter the Table mailbox's email, then the code Cloudflare sends there.
  Foundry's join page follows and is filled in for you. Close the window when the map shows.

  Every time after (no keyboard):
    pwsh scripts\tv\start-table-viewer.ps1 -Url https://foundry.example.com
  Put that line in a shortcut in the Startup folder and the TV opens on the map after a restart.
  Leave the script's window open: it keeps watching for the join page. Closing the browser ends it.

  Nothing secret is stored by this script: the Table user has no password. The browser listens for
  this script on 127.0.0.1 only (a random port, for as long as the TV runs); -NoAutoJoin turns that
  off, and then the join page is filled in by hand. The profile folder holds the TV's session
  cookies, so keep it on the TV PC. To sign the TV out, delete the folder (-Profile, default below).

.PARAMETER Url
  Foundry's address, http or https, without a user name or password in it.
.PARAMETER Setup
  Open a normal window instead of full screen, for the first sign-in.
.PARAMETER UserName
  The Foundry user the TV joins as. Default: Table.
.PARAMETER NoAutoJoin
  Do not fill in the join page.
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
  [string]$UserName = 'Table',
  [switch]$NoAutoJoin,
  [ValidateSet('auto', 'edge', 'chrome')][string]$Browser = 'auto',
  [string]$Profile = '',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'table-viewer-lib.ps1')

$candidates = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$cmd = Get-TableViewerCommand -Url $Url -Setup $Setup.IsPresent -Browser $Browser -Profile $Profile `
  -Candidates $candidates -AutoJoin (-not $NoAutoJoin.IsPresent)

if ($DryRun) {
  Write-Host "$($cmd.Exe) $($cmd.Arguments -join ' ')"
  return
}

New-Item -ItemType Directory -Force -Path $cmd.Profile | Out-Null
$portFile = Join-Path $cmd.Profile 'DevToolsActivePort'
Remove-Item -LiteralPath $portFile -ErrorAction SilentlyContinue
Start-Process -FilePath $cmd.Exe -ArgumentList $cmd.Arguments
if ($Setup) { Write-Host 'Enter the email code if asked. Foundry then joins as the Table user by itself. Close the window when the map shows.' }
if ($NoAutoJoin) { return }

# Watch for the join page until the browser is gone (three failed looks in a row after it was up).
$port = 0
$misses = 0
$seenUp = $false
while ($true) {
  Start-Sleep -Seconds 3
  if (-not $port) {
    if (Test-Path -LiteralPath $portFile) { $port = [int](Get-Content -LiteralPath $portFile -TotalCount 1) }
    continue
  }
  try {
    $n = Invoke-AutoJoinOnce -Port $port -BaseUrl $Url -UserName $UserName
    $seenUp = $true
    $misses = 0
    if ($n -gt 0) { Write-Host "Joined as $UserName." }
  }
  catch {
    $misses++
    if ($seenUp -and $misses -ge 3) { break }
    if (-not $seenUp -and $misses -ge 20) { break }
  }
}
