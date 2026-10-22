# Functions of start-table-viewer.ps1 (tv-login, G1), kept apart so the tests can load them.

function Get-TableViewerCommand {
  param([string]$Url, [bool]$Setup, [string]$Browser, [string]$Profile, [string[]]$Candidates, [bool]$AutoJoin = $false)

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
  # Port 0: the browser picks a free port on 127.0.0.1 and writes it to <Profile>\DevToolsActivePort.
  if ($AutoJoin) { $arguments += '--remote-debugging-port=0' }
  if (-not $Setup) {
    $arguments += '--kiosk'
    if ($kind -eq 'edge') { $arguments += '--edge-kiosk-type=fullscreen' }
  }
  $arguments += $uri.AbsoluteUri

  [pscustomobject]@{ Exe = $exe; Arguments = $arguments; Profile = $Profile; Kind = $kind }
}

<#
  The path in front of Foundry's own pages when it sits behind a reverse proxy at a sub-path:
  '/foundry' for https://host/foundry or https://host/foundry/join, '' for https://host. A trailing
  Foundry page name (/join, or /game from the address bar while in the game) is that page itself,
  not part of the prefix.
#>
function Get-FoundryPrefix {
  param([string]$BaseUrl)
  $base = $null
  if (-not [Uri]::TryCreate($BaseUrl, [UriKind]::Absolute, [ref]$base)) { return '' }
  $path = $base.AbsolutePath.TrimEnd('/')
  return ($path -replace '(?i)/(join|game|setup|auth|players|license|stream|config)$', '')
}

<#
  True only for Foundry's join page of the configured game: same scheme, host and port as the
  address, path exactly <prefix>/join (the prefix is the address's own path, if any). Anything else
  (the Cloudflare sign-in page, the game, another site) is left alone, so the auto-join never types
  into a page it does not know.
#>
function Test-FoundryJoinPage {
  param([string]$PageUrl, [string]$BaseUrl)
  $page = $null
  $base = $null
  if (-not [Uri]::TryCreate($PageUrl, [UriKind]::Absolute, [ref]$page)) { return $false }
  if (-not [Uri]::TryCreate($BaseUrl, [UriKind]::Absolute, [ref]$base)) { return $false }
  $prefix = Get-FoundryPrefix -BaseUrl $BaseUrl
  return ($page.Scheme -eq $base.Scheme -and $page.Host -eq $base.Host -and $page.Port -eq $base.Port -and
    $page.AbsolutePath.TrimEnd('/') -eq "$prefix/join")
}

<#
  True when a browser still holds the profile: Chromium keeps <Profile>\lockfile open while it runs
  (this also catches a browser started with -NoAutoJoin or by hand, which writes no debug port).
  False when there is no lockfile or it can be opened for writing (a leftover of a crash).
#>
function Test-ProfileInUse {
  param([string]$Profile)
  $lock = Join-Path $Profile 'lockfile'
  if (-not (Test-Path -LiteralPath $lock)) { return $false }
  try {
    $stream = [System.IO.File]::Open($lock, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    $stream.Dispose()
    return $false
  }
  catch [System.IO.FileNotFoundException] { return $false } # gone as the browser closed
  catch [System.IO.DirectoryNotFoundException] { return $false }
  catch [System.IO.IOException] { return $true }
  catch [System.UnauthorizedAccessException] { return $true }
}

<# The page script that fills Foundry's join form for one user and clicks Join (no password). #>
function Get-JoinScript {
  param([string]$UserName, [string]$Origin = '', [string]$Prefix = '')
  $name = ConvertTo-Json -InputObject $UserName -Compress
  $origin = ConvertTo-Json -InputObject $Origin -Compress
  $joinPath = ConvertTo-Json -InputObject "$Prefix/join" -Compress
  # Checked again in the page: it may have moved on since the address was read.
  return "(() => { if (location.pathname.replace(/\/+$/, '') !== $joinPath || ($origin && location.origin !== $origin)) return 'wrong-page'; const u = document.querySelector('#join-username'); const b = document.querySelector('#join-game-form button[name=join]'); if (!u || !b) return 'no-form'; u.value = $name; b.click(); return 'joined'; })()"
}

<# Runs one Runtime.evaluate on a page target over the DevTools WebSocket (127.0.0.1 only). #>
function Invoke-PageScript {
  param([string]$WebSocketUrl, [string]$Script)
  $ws = [System.Net.WebSockets.ClientWebSocket]::new()
  try {
    $cts = [System.Threading.CancellationTokenSource]::new(10000)
    $ws.ConnectAsync([Uri]$WebSocketUrl, $cts.Token).GetAwaiter().GetResult()
    $msg = @{ id = 1; method = 'Runtime.evaluate'; params = @{ expression = $Script; returnByValue = $true } } | ConvertTo-Json -Depth 5 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($msg)
    $ws.SendAsync([ArraySegment[byte]]::new($bytes), 'Text', $true, $cts.Token).GetAwaiter().GetResult()
    $buf = [byte[]]::new(65536)
    $r = $ws.ReceiveAsync([ArraySegment[byte]]::new($buf), $cts.Token).GetAwaiter().GetResult()
    return [Text.Encoding]::UTF8.GetString($buf, 0, $r.Count)
  }
  finally { $ws.Dispose() }
}

<# One pass: for every page of the debug port that is the join page, fill it in. Returns the count. #>
function Invoke-AutoJoinOnce {
  param([int]$Port, [string]$BaseUrl, [string]$UserName)
  $joined = 0
  $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json" -TimeoutSec 5
  foreach ($t in $targets) {
    if ($t.type -ne 'page' -or -not (Test-FoundryJoinPage -PageUrl $t.url -BaseUrl $BaseUrl)) { continue }
    $reply = Invoke-PageScript -WebSocketUrl $t.webSocketDebuggerUrl -Script (Get-JoinScript -UserName $UserName -Prefix (Get-FoundryPrefix -BaseUrl $BaseUrl) -Origin ([Uri]$t.url).GetLeftPart([UriPartial]::Authority))
    if ($reply -match '"joined"') { $joined++ }
  }
  return $joined
}
