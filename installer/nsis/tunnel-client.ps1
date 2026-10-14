<#
.SYNOPSIS
  Keeps the Cloudflare Access TCP tunnel to the home server's bridge open on this PC (D-095).

.DESCRIPTION
  The bridge's control port (31414) has no login of its own, so it is never published. Instead this
  PC runs `cloudflared access tcp`, which listens on 127.0.0.1:<Port> and carries the connection
  through Cloudflare, where an Access policy only lets the owner and the GM in (a service token for
  this program, no password). Claude Desktop's five entries then use MCP_CONTROL_HOST=127.0.0.1.

  Actions:
    Install    asks for the service token (Client ID, then the secret, typed hidden), stores it for
               this Windows user only (DPAPI), registers a scheduled task that starts the tunnel at
               logon, and starts it now. -TokenFile <file> (line 1 = Client ID, line 2 = secret) is for
               a silent install; the file is not deleted, delete it yourself. -KeepToken reuses the
               token stored earlier (an upgrade), -Pause waits for Enter before the window closes.
    Uninstall  stops the tunnel, removes the task and the stored token.
    Run        what the logon task runs: keeps cloudflared running and restarts it if it stops.
    Stop       stops the tunnel now (it starts again at the next logon).
    Status     task, token, the local port, and a ping through the tunnel. Prints no secret.

  The token is never an argument or printed: cloudflared gets it from two environment variables of
  its own process. Windows PowerShell 5.1 and PowerShell 7 both work.

  Exit codes: 0 fine, 1 failed, 2 bad input, 4 Status found a problem.

.EXAMPLE
  .\tunnel-client.ps1 -Action Install -TunnelHost mcp.example.com
  .\tunnel-client.ps1 -Action Status
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Install', 'Uninstall', 'Run', 'Stop', 'Status')]
  [string]$Action,
  [string]$TunnelHost,
  [int]$Port = 31414,
  [string]$CloudflaredPath,
  [string]$TokenFile,
  [string]$StateDir = (Join-Path $env:LOCALAPPDATA 'FoundryMCPServer\tunnel'),
  [string]$TaskName = 'Foundry AI Tool tunnel',
  [switch]$KeepToken,
  [switch]$Pause,
  [switch]$NoTask,
  [switch]$NoStart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$configPath = Join-Path $StateDir 'tunnel.json'
$tokenPath = Join-Path $StateDir 'token.dpapi'
$logPath = Join-Path $StateDir 'tunnel.log'

function Fail([string]$message, [int]$code = 1) {
  [Console]::Error.WriteLine("ERROR: $message")
  if ($Pause) { Read-Host 'Press Enter to close this window' | Out-Null }
  exit $code
}

function Test-HostName([string]$name) {
  return ($name -match '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$')
}

# One JSON-lines ping to 127.0.0.1:<port> (the bridge's own `ping`). True only on {"ok":true}.
function Test-Ping([int]$port, [int]$timeoutMs = 8000) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect('127.0.0.1', $port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(3000)) { return $false }
    $client.EndConnect($async)
    $stream = $client.GetStream()
    $stream.ReadTimeout = $timeoutMs
    $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"id":"ping","method":"ping"}' + "`n")
    $stream.Write($bytes, 0, $bytes.Length)
    $reader = New-Object System.IO.StreamReader($stream)
    $line = $reader.ReadLine()
    return ($null -ne $line -and $line -match '"ok"\s*:\s*true')
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Test-PortListening([int]$port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect('127.0.0.1', $port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(1500)) { return $false }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Read-Config {
  if (-not (Test-Path -LiteralPath $configPath)) { Fail "no tunnel is set up for this user ($configPath is missing): run -Action Install" }
  $cfg = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  if (-not (Test-HostName ([string]$cfg.host))) { Fail "$configPath holds a bad host name: run -Action Install again" }
  return $cfg
}

# Returns @{ Id = ...; Secret = ... } read from the DPAPI file (this Windows user on this PC only).
function Read-Token {
  if (-not (Test-Path -LiteralPath $tokenPath)) { Fail "the service token is missing ($tokenPath): run -Action Install again" }
  $lines = @(Get-Content -LiteralPath $tokenPath)
  if ($lines.Count -lt 2) { Fail "$tokenPath is damaged: run -Action Install again" }
  try {
    $idSecure = ConvertTo-SecureString -String $lines[0].Trim()
    $secretSecure = ConvertTo-SecureString -String $lines[1].Trim()
  } catch {
    Fail 'the stored service token cannot be read by this Windows user: run -Action Install again'
  }
  $plain = {
    param($secure)
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  }
  return @{ Id = (& $plain $idSecure); Secret = (& $plain $secretSecure) }
}

# Stops this tunnel: the scheduled task, its launcher and its cloudflared. A process counts as ours
# only when it matches exactly: the launcher by this StateDir, cloudflared by `access tcp` with the
# host name and local port of the stored config (and of the one being installed, the two arguments).
# Any other `cloudflared access tcp` the user runs is left alone.
function Stop-Tunnel([string]$extraHost = '', [int]$extraPort = 0) {
  try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction Stop } catch { }
  $own = $PID
  $stateMatch = [regex]::Escape($StateDir)
  # The launcher first (so it does not restart cloudflared), then cloudflared.
  $procs = @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'pwsh.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.ProcessId -ne $own -and $_.CommandLine -match 'tunnel-client\.ps1' -and $_.CommandLine -match '-Action\s+Run' -and $_.CommandLine -match $stateMatch })
  foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  $targets = @()
  if ($extraHost -and $extraPort) { $targets += , @($extraHost, $extraPort) }
  if (Test-Path -LiteralPath $configPath) {
    try {
      $old = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
      $targets += , @([string]$old.host, [int]$old.port)
    } catch { }
  }
  foreach ($t in $targets) {
    $hostMatch = '--hostname\s+' + [regex]::Escape($t[0]) + '(\s|$)'
    $urlMatch = '--url\s+127\.0\.0\.1:' + $t[1] + '(\s|$)'
    $procs = @(Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'access\s+tcp' -and $_.CommandLine -match $hostMatch -and $_.CommandLine -match $urlMatch })
    foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  }
}

# The name of the process listening on 127.0.0.1:<port>, or $null when it cannot be told.
function Get-ListenerName([int]$port) {
  try {
    $c = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop | Select-Object -First 1
    return (Get-Process -Id $c.OwningProcess -ErrorAction Stop).ProcessName
  } catch { return $null }
}

function Get-TaskState {
  try { return (Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop).State.ToString() } catch { return $null }
}

switch ($Action) {
  'Install' {
    if (-not (Test-HostName $TunnelHost)) { Fail '-TunnelHost must be a plain host name such as mcp.example.com' 2 }
    if ($Port -lt 1 -or $Port -gt 65535) { Fail '-Port must be 1 to 65535' 2 }
    if ($Port -in 31415, 31416) { Fail "port $Port is the Foundry link or the dashboard link of a local bridge: pick another one" 2 }
    if (-not $CloudflaredPath) { $CloudflaredPath = Join-Path $PSScriptRoot 'cloudflared.exe' }
    if (-not (Test-Path -LiteralPath $CloudflaredPath -PathType Leaf)) { Fail "cloudflared.exe is not at $CloudflaredPath (-CloudflaredPath)" 2 }
    $CloudflaredPath = (Resolve-Path -LiteralPath $CloudflaredPath).Path

    $secretSecure = $null
    $clientId = $null
    $storedExists = Test-Path -LiteralPath $tokenPath
    # A token file always wins (a mistyped or rotated token is replaced by running Install again);
    # -KeepToken reuses the stored one only when no file is given.
    $haveStored = $false
    if ($TokenFile) {
      $haveStored = $false
    } elseif ($KeepToken -and $storedExists) {
      $haveStored = $true
    }
    if ($haveStored) {
      Write-Host 'Keeping the service token stored earlier.'
    } elseif ($TokenFile) {
      if (-not (Test-Path -LiteralPath $TokenFile -PathType Leaf)) { Fail "-TokenFile $TokenFile does not exist" 2 }
      $lines = @(Get-Content -LiteralPath $TokenFile | Where-Object { $_.Trim() -ne '' })
      if ($lines.Count -lt 2) { Fail 'the token file needs two lines: the Client ID, then the Client Secret' 2 }
      $clientId = $lines[0].Trim()
      $secretSecure = ConvertTo-SecureString -String $lines[1].Trim() -AsPlainText -Force
    } else {
      # Under the installer's silent mode stdin is a pipe nobody writes to: never wait on it.
      if (-not [Environment]::UserInteractive -or [Console]::IsInputRedirected) { Fail 'no terminal to ask for the token: give -TokenFile' 2 }
      Write-Host ''
      Write-Host 'Paste the service token you were given. Nothing you type for the secret is shown.'
      if ($storedExists) { Write-Host 'A token is already stored: press Enter at the Client ID to keep it.' }
      $clientId = (Read-Host 'Client ID').Trim()
      if ($clientId -eq '' -and $storedExists) {
        $haveStored = $true
        Write-Host 'Keeping the service token stored earlier.'
      } else {
        $secretSecure = Read-Host 'Client Secret' -AsSecureString
      }
    }
    New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
    if (-not $haveStored) {
      if ($clientId -notmatch '^[A-Za-z0-9._-]{8,}$') { Fail 'the Client ID looks wrong (it ends in .access)' 2 }
      if ($secretSecure.Length -lt 16) { Fail 'the Client Secret looks too short' 2 }
      # Both lines are DPAPI blobs: only this Windows user, on this PC, can read them back.
      $idLine = ConvertFrom-SecureString -SecureString (ConvertTo-SecureString -String $clientId -AsPlainText -Force)
      $secretLine = ConvertFrom-SecureString -SecureString $secretSecure
      [System.IO.File]::WriteAllLines($tokenPath, [string[]]@($idLine, $secretLine))
      Write-Host "Stored the token for $env:USERNAME only ($tokenPath)."
    }
    $cfg = [ordered]@{ host = $TunnelHost; port = $Port; cloudflared = $CloudflaredPath; script = $PSCommandPath }
    ($cfg | ConvertTo-Json) | Set-Content -LiteralPath $configPath -Encoding UTF8

    if (-not $NoTask) {
      $conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
      $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
      $taskArgs = "--headless `"$powershell`" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Action Run -StateDir `"$StateDir`""
      $user = "$env:USERDOMAIN\$env:USERNAME"
      $taskAction = New-ScheduledTaskAction -Execute $conhost -Argument $taskArgs -WorkingDirectory (Split-Path -Parent $PSCommandPath)
      $logon = New-ScheduledTaskTrigger -AtLogOn -User $user
      $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
      $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
      Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $logon -Settings $settings -Principal $principal `
        -Description 'Keeps the Cloudflare Access tunnel to the Foundry AI Tool bridge open (tunnel-client.ps1).' -Force | Out-Null
      Write-Host "Registered the task '$TaskName': it starts the tunnel when you sign in."
    }

    if (-not $NoStart) {
      Stop-Tunnel $TunnelHost $Port
      $holder = if (Test-PortListening $Port) { Get-ListenerName $Port } else { $null }
      if (Test-PortListening $Port) {
        Fail "127.0.0.1:$Port is already in use$(if ($holder) { " by $holder" }): pick another -Port, or stop that program" 2
      }
      if ($NoTask) {
        Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -WindowStyle Hidden `
          -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-Action', 'Run', '-StateDir', $StateDir)
      } else {
        Start-ScheduledTask -TaskName $TaskName
      }
      $up = $false
      for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Seconds 1
        if (Test-PortListening $Port) { $up = $true; break }
      }
      if (-not $up) { Fail "the tunnel did not start listening on 127.0.0.1:$Port in 20 seconds: see $logPath" }
      if (Test-Ping $Port) {
        Write-Host "The bridge answers through the tunnel ($TunnelHost -> 127.0.0.1:$Port)."
      } else {
        Write-Warning "The tunnel is up but the bridge did not answer a ping. Wrong token, or the server's owner has not added it to the Access policy yet. See $logPath"
        if ($Pause) { Read-Host 'Press Enter to close this window' | Out-Null }
        exit 4
      }
    }
    if ($TokenFile) { Write-Host "Delete $TokenFile now: it still holds the token in plain text." }
    if ($Pause) { Read-Host 'Press Enter to close this window' | Out-Null }
    exit 0
  }

  'Uninstall' {
    Stop-Tunnel
    try { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop; Write-Host "Removed the task '$TaskName'." } catch { }
    # The token first, so a failure further down never leaves it behind
    Remove-Item -LiteralPath $tokenPath -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $StateDir) {
      Start-Sleep -Milliseconds 500  # the just-killed cloudflared may still hold the log
      try { Remove-Item -LiteralPath $StateDir -Recurse -Force -ErrorAction Stop }
      catch {
        Start-Sleep -Seconds 2
        try { Remove-Item -LiteralPath $StateDir -Recurse -Force -ErrorAction Stop }
        catch { Write-Warning "Could not remove $StateDir ($($_.Exception.Message)); the stored token is gone, delete the folder by hand." }
      }
      if (-not (Test-Path -LiteralPath $StateDir)) { Write-Host "Removed $StateDir (the stored token with it)." }
    }
    exit 0
  }

  'Stop' {
    Stop-Tunnel
    Write-Host 'The tunnel is stopped. It starts again when you next sign in.'
    exit 0
  }

  'Status' {
    $problems = 0
    $cfg = Read-Config
    $listenPort = [int]$cfg.port
    $state = Get-TaskState
    if ($state) { Write-Host "task '$TaskName': $state" } else { Write-Host "task '$TaskName': not registered"; $problems++ }
    if (Test-Path -LiteralPath $tokenPath) { Write-Host "token: stored for $env:USERNAME (not shown)" } else { Write-Host 'token: missing'; $problems++ }
    Write-Host "tunnel: $($cfg.host) -> 127.0.0.1:$listenPort"
    if (Test-PortListening $listenPort) {
      $holder = Get-ListenerName $listenPort
      if ($holder -and $holder -ne 'cloudflared') {
        Write-Host "local port $listenPort`: held by $holder, not by the tunnel"; $problems++
      } else {
        Write-Host "local port $listenPort`: listening"
      }
    } else { Write-Host "local port $listenPort`: not listening"; $problems++ }
    if (Test-Ping $listenPort) { Write-Host 'ping through the tunnel: ok' } else { Write-Host 'ping through the tunnel: no answer'; $problems++ }
    if ($problems -gt 0) { exit 4 }
    exit 0
  }

  'Run' {
    $cfg = Read-Config
    $exe = [string]$cfg.cloudflared
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { Fail "cloudflared.exe is missing ($exe)" }
    $token = Read-Token
    $created = $false
    $mutex = New-Object System.Threading.Mutex($true, 'Local\FoundryAiToolTunnelClient', [ref]$created)
    if (-not $created) { exit 0 }  # already running for this user
    try {
      $backoff = 5
      while ($true) {
        foreach ($f in @($logPath, "$logPath.out")) {
          if ((Test-Path -LiteralPath $f) -and ((Get-Item -LiteralPath $f).Length -gt 1MB)) { Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue }
        }
        $env:TUNNEL_SERVICE_TOKEN_ID = $token.Id
        $env:TUNNEL_SERVICE_TOKEN_SECRET = $token.Secret
        $started = Get-Date
        $proc = $null
        try {
          $proc = Start-Process -FilePath $exe -WindowStyle Hidden -PassThru -RedirectStandardError $logPath -RedirectStandardOutput "$logPath.out" `
            -ArgumentList @('access', 'tcp', '--hostname', [string]$cfg.host, '--url', "127.0.0.1:$([int]$cfg.port)", '--loglevel', 'info')
        } catch {
          # A start error (antivirus, a locked log) must not end the loop: back off and try again.
        }
        Remove-Item Env:\TUNNEL_SERVICE_TOKEN_ID, Env:\TUNNEL_SERVICE_TOKEN_SECRET -ErrorAction SilentlyContinue
        if ($proc) { $proc.WaitForExit() }
        # A run that lasted a minute was a good one: start the back-off over.
        if (((Get-Date) - $started).TotalSeconds -gt 60) { $backoff = 5 } else { $backoff = [Math]::Min($backoff * 2, 120) }
        Start-Sleep -Seconds $backoff
      }
    } finally {
      $mutex.ReleaseMutex()
    }
  }
}
