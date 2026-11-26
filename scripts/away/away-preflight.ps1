#Requires -Version 7
<#
.SYNOPSIS
  Away game preflight: the day before a night at someone else's place, run this on the laptop that
  goes there. Read-only: it reads the network, the screens and the game's address, and prints a
  short pack list.

.DESCRIPTION
  Run it on the network you will use (the host's Wi-Fi) and again on your phone's hotspot, so you
  know the second network works too:
    pwsh scripts\away\away-preflight.ps1 -Url https://your-game-address
  Nothing is written, nobody is signed in and the game itself is not touched. Exit code 0 when
  nothing failed, 1 when something did.

.PARAMETER Url
  The game's address (http or https, without a user name or password).
.PARAMETER SkipDiscord
  Leave out the check that discord.com is reachable.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Url,
  [switch]$SkipDiscord
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'away-preflight-lib.ps1')

$uri = $null
if (-not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -notin 'http', 'https') {
  throw "Url must be an http or https address, for example https://foundry.example.com (got '$Url')."
}
if ($uri.UserInfo) { throw 'Url must not contain a user name or password.' }

$checks = [System.Collections.Generic.List[object]]::new()
function Add-Check([string]$Name, $Verdict) {
  $checks.Add([pscustomobject]@{ Name = $Name; Level = $Verdict.Level; Text = $Verdict.Text })
}

# 1. The game's address
$sw = [Diagnostics.Stopwatch]::StartNew()
try {
  # A redirect (the Cloudflare Access sign-in) raises a non-terminating "maximum redirection" error
  # but still returns the response, so errors are collected, not stopped on; no response is a failure.
  $r = Invoke-WebRequest -Uri $uri -Method Get -MaximumRedirection 0 -SkipHttpErrorCheck -TimeoutSec 15 -ErrorAction SilentlyContinue -ErrorVariable iwrErr
  if (-not $r) { throw $(if ($iwrErr) { $iwrErr[0].Exception.Message } else { 'no answer' }) }
  $loc = [string]($r.Headers['Location'] | Select-Object -First 1)
  Add-Check 'Game address' (Get-GameReachVerdict -StatusCode ([int]$r.StatusCode) -Location $loc -ElapsedMs ([int]$sw.ElapsedMilliseconds))
} catch {
  Add-Check 'Game address' (Get-GameReachVerdict -Error $_.Exception.Message)
}

# 2. Discord (voice and the table's bot) is not blocked on this network
if (-not $SkipDiscord) {
  try {
    $d = Test-NetConnection -ComputerName 'discord.com' -Port 443 -WarningAction SilentlyContinue
    Add-Check 'Discord' ([pscustomobject]@{
        Level = $(if ($d.TcpTestSucceeded) { 'ok' } else { 'fail' })
        Text  = $(if ($d.TcpTestSucceeded) { 'discord.com reachable on this network.' } else { 'discord.com is blocked on this network. Use the phone hotspot.' })
      })
  } catch {
    Add-Check 'Discord' ([pscustomobject]@{ Level = 'warn'; Text = "Could not test Discord: $($_.Exception.Message)" })
  }
}

# 3. Screens (the TV)
Add-Type -AssemblyName System.Windows.Forms
Add-Check 'TV' (Get-DisplayVerdict -Count ([System.Windows.Forms.Screen]::AllScreens.Count))

# 4. A browser for the game and the TV viewer
$pf = $env:ProgramFiles
$pf86 = ${env:ProgramFiles(x86)}
$browser = @("$pf86\Microsoft\Edge\Application\msedge.exe", "$pf\Microsoft\Edge\Application\msedge.exe",
  "$pf\Google\Chrome\Application\chrome.exe", "$pf86\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") |
  Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
Add-Check 'Browser' ([pscustomobject]@{
    Level = $(if ($browser) { 'ok' } else { 'fail' })
    Text  = $(if ($browser) { 'Edge or Chrome found.' } else { 'No Edge or Chrome found.' })
  })

# 5. Power
try {
  $b = Get-CimInstance Win32_Battery -ErrorAction Stop | Select-Object -First 1
  if ($b) {
    $onAc = $b.BatteryStatus -in 2, 3, 6, 7, 8, 9, 11
    Add-Check 'Power' ([pscustomobject]@{
        Level = $(if ($onAc) { 'ok' } else { 'warn' })
        Text  = $(if ($onAc) { "On mains power, battery $($b.EstimatedChargeRemaining)%." } else { "On battery ($($b.EstimatedChargeRemaining)%). Bring the charger and plug in." })
      })
  }
} catch { }

Write-Host ''
foreach ($c in $checks) {
  $mark = switch ($c.Level) { 'ok' { 'OK  ' } 'warn' { 'WARN' } default { 'FAIL' } }
  Write-Host ('[{0}] {1}: {2}' -f $mark, $c.Name, $c.Text)
}
$ready = Get-AwayReady -Checks $checks
Write-Host ''
Write-Host $(if ($ready) { 'Ready: nothing failed. Run it again on the phone hotspot.' } else { 'Not ready: fix the FAIL lines, then run it again.' })
Write-Host ''
Write-Host 'Pack list:'
Get-PackList | ForEach-Object { Write-Host "  [ ] $_" }
exit $(if ($ready) { 0 } else { 1 })
