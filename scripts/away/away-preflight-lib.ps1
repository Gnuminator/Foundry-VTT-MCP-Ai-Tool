# Functions of away-preflight.ps1 (away-game-preflight), kept apart so the tests can load them.

<#
  What a reply from the game's address means for a night away. A sign-in page (Cloudflare Access
  redirect, 401 or 403) is the expected answer from a laptop that is not signed in: the address is
  reachable. A 5xx or an error means the server or the network is not.
#>
function Get-GameReachVerdict {
  param([int]$StatusCode, [string]$Location = '', [int]$ElapsedMs = 0, [string]$Error = '')
  if ($Error) { return [pscustomobject]@{ Level = 'fail'; Text = "Cannot reach the game: $Error" } }
  if ($StatusCode -ge 500) { return [pscustomobject]@{ Level = 'fail'; Text = "The game's address answers with an error ($StatusCode)." } }
  $signIn = (($StatusCode -in 301, 302, 303, 307, 308) -and $Location -match 'cloudflareaccess\.com|/cdn-cgi/access') -or $StatusCode -in 401, 403
  $what = if ($signIn) { 'sign-in page reached (as expected before you sign in)' } else { "answers ($StatusCode)" }
  if ($ElapsedMs -gt 2500) { return [pscustomobject]@{ Level = 'warn'; Text = "The game's address $what, but slowly ($ElapsedMs ms). Try the phone hotspot." } }
  [pscustomobject]@{ Level = 'ok'; Text = "The game's address $what in $ElapsedMs ms." }
}

# Displays: a laptop with only its own screen has no TV attached yet.
function Get-DisplayVerdict {
  param([int]$Count)
  if ($Count -ge 2) { return [pscustomobject]@{ Level = 'ok'; Text = "$Count screens connected (the TV is attached)." } }
  [pscustomobject]@{ Level = 'warn'; Text = 'Only one screen found. Plug in the TV (HDMI) and press Win + P, Extend or Duplicate.' }
}

# The night's verdict: ready when nothing failed.
function Get-AwayReady {
  param([object[]]$Checks)
  -not (@($Checks | Where-Object { $_.Level -eq 'fail' }).Count -gt 0)
}

function Get-PackList {
  @(
    'Laptop with its charger, signed in to the game once (email code) on the night before',
    'HDMI cable (and a USB-C or other adapter if the laptop needs one) for the TV',
    'Headset or speaker with a cable or its own charger, for sound and Discord voice',
    'Phone with a hotspot (data plan checked) as the second network',
    'Extension cord with several sockets',
    'Printed or saved page of the Game night runbook and the Plan B address, in case the network fails'
  )
}
