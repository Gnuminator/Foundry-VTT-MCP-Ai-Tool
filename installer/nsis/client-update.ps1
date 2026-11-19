<#
.SYNOPSIS
  Updates this PC's Foundry AI Tool client installer to the version the table runs (layer 3 of
  item client-autoupdate). Started by the tunnel logon task, or on direct (no tunnel) installs by
  its own sign-in task (-Action Install); also runnable by hand (update-client-now.cmd adds -Now).

.DESCRIPTION
  Off by default. It does nothing unless the file <StateDir>\autoupdate.on exists (create it with
  -Action Enable, remove it with -Action Disable). Steps, each of which stops quietly on failure
  and leaves the old install in place:

    1. the Pi's version: `wrapper_status` over the tunnel's control port, or on a direct install
       from the host and port in <StateDir>\direct.json (read-only, no login of its own; the
       tunnel or the private network is the login). Newest is what the Pi runs, never GitHub latest.
    2. this install's version: DisplayVersion in HKCU Uninstall\FoundryMCPServer.
    3. only when the Pi is newer, and only when Claude Desktop is not running.
    4. downloads that release's FoundryMCPServer-Setup-v<ver>.exe and SHA256SUMS.txt from GitHub
       (this project's release page only), checks the SHA-256, runs the installer silently
       (/S /TUNNEL= /PORT=, or /HOST= /PORT= on a direct install; no token argument, so the
       installer keeps the stored token).
    5. if the installer fails, the files it replaced are put back.

  The checksum file and the installer come from the same release page, so the check catches a damaged
  or cut-off download, not a tampered release: it is an integrity check only, not a signature.

  Writes one line per run to <StateDir>\update.log and the result to <StateDir>\update-status.json
  (names and version numbers only). Never reads, prints or changes the token or Client ID/secret.

  Exit codes: 0 fine (updated, or nothing to do), 1 failed, 2 bad input.
#>
[CmdletBinding()]
param(
  [ValidateSet('Check', 'Enable', 'Disable', 'Status', 'Install', 'Uninstall')]
  [string]$Action = 'Check',
  [string]$StateDir = (Join-Path $env:LOCALAPPDATA 'FoundryMCPServer\tunnel'),
  [string]$InstallDir,
  [string]$ReleaseBase = 'https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool/releases/download',
  # Test hooks: the installed version (instead of the registry), the Pi version (instead of the tunnel)
  # and a Claude Desktop process name that counts as running.
  [string]$InstalledVersion,
  [string]$PiVersion,
  [string]$ClaudeProcess = 'Claude',
  # Direct installs (no tunnel): the bridge host and port, written by -Action Install.
  [string]$ControlHost,
  [int]$ControlPort,
  # Install: leave auto-update off. Check: run even when it is off (the manual run).
  [switch]$NoEnable,
  [switch]$Now,
  [string]$TaskName = 'Foundry AI Tool client update',
  [switch]$NoTask,
  # Tries (5 seconds apart) to read the table's version: about a minute at sign-in.
  [int]$ReadAttempts = 12,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($StateDir.Length -gt 3) { $StateDir = $StateDir.TrimEnd('\') }
if (-not $InstallDir) { $InstallDir = Split-Path -Parent $StateDir }

$flagPath = Join-Path $StateDir 'autoupdate.on'
$logPath = Join-Path $StateDir 'update.log'
$statusPath = Join-Path $StateDir 'update-status.json'
$configPath = Join-Path $StateDir 'tunnel.json'
$directPath = Join-Path $StateDir 'direct.json'
# Host names and addresses only: this value ends up in the installer's command line.
$hostPattern = '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$'

function Write-Log([string]$text) {
  $line = '{0} {1}' -f (Get-Date -Format 's'), $text
  try {
    New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
    if ((Test-Path -LiteralPath $logPath) -and ((Get-Item -LiteralPath $logPath).Length -gt 256KB)) { Remove-Item -LiteralPath $logPath -Force }
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
  } catch { }
  Write-Host $line
}

# result: updated | current | skipped | failed. The dashboard banner reads the same facts from the
# version notice; this file is for the Status action and for support.
function Set-Status([string]$result, [string]$detail, [string]$from = '', [string]$to = '') {
  $o = [ordered]@{ at = (Get-Date -Format 's'); result = $result; detail = $detail; from = $from; to = $to }
  try { ($o | ConvertTo-Json) | Set-Content -LiteralPath $statusPath -Encoding UTF8 } catch { }
  Write-Log "$result : $detail"
}

function Test-Version([string]$v) { return ($v -match '^\d{1,4}\.\d{1,4}\.\d{1,4}$') }

function Compare-Version([string]$a, [string]$b) {
  return ([version]$a).CompareTo([version]$b)
}

# One JSON-lines request to the control port the tunnel listens on; returns the parsed result or $null.
function Invoke-Control([string]$controlHost, [int]$port, [string]$method, [int]$timeoutMs = 8000) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect($controlHost, $port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(3000)) { return $null }
    $client.EndConnect($async)
    $stream = $client.GetStream()
    $stream.ReadTimeout = $timeoutMs
    $bytes = [System.Text.Encoding]::UTF8.GetBytes((@{ id = 'upd'; method = $method } | ConvertTo-Json -Compress) + "`n")
    $stream.Write($bytes, 0, $bytes.Length)
    $line = (New-Object System.IO.StreamReader($stream)).ReadLine()
    if (-not $line) { return $null }
    return ($line | ConvertFrom-Json).result
  } catch { return $null } finally { $client.Close() }
}

function Get-InstalledVersion {
  if ($InstalledVersion) { return $InstalledVersion }
  try { return [string](Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\FoundryMCPServer' -ErrorAction Stop).DisplayVersion } catch { return '' }
}

# Claude Code's claude.exe has the same process name as Claude Desktop but lives under the user's
# .local\bin or .claude folder (or node_modules); it does not lock the install, so it is not counted.
# Only those three folders are skipped: the Claude Code that Claude Desktop bundles still counts.
# A process whose path cannot be read counts as Claude Desktop, the safe side.
$claudeCodePath = '[\\/](\.local[\\/]bin|\.claude|node_modules)[\\/]'
function Test-ClaudeRunning {
  foreach ($proc in @(Get-Process -Name $ClaudeProcess -ErrorAction SilentlyContinue)) {
    $procPath = ''
    try { $procPath = [string]$proc.Path } catch { }
    if (-not $procPath -or $procPath -notmatch $claudeCodePath) { return $true }
  }
  return $false
}

function Get-Sha256Line([string]$sums, [string]$file) {
  foreach ($l in ($sums -split "`n")) {
    if ($l -match '^\s*([0-9A-Fa-f]{64})\s+\*?(\S+)\s*$' -and $Matches[2] -eq $file) { return $Matches[1].ToLowerInvariant() }
  }
  return $null
}

switch ($Action) {
  'Install' {
    # Direct (no tunnel) installs: remember where the bridge is, switch auto-update on the first
    # time (unless -NoEnable) and register a sign-in task of its own. An upgrade keeps the on/off
    # choice made earlier.
    if (-not $ControlHost -or $ControlHost -notmatch $hostPattern) { Write-Host 'Install needs -ControlHost <name or IP>'; exit 2 }
    if ($ControlPort -lt 1 -or $ControlPort -gt 65535) { Write-Host 'Install needs a valid -ControlPort'; exit 2 }
    New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
    $first = -not (Test-Path -LiteralPath $directPath)
    ([ordered]@{ host = $ControlHost; port = $ControlPort } | ConvertTo-Json) | Set-Content -LiteralPath $directPath -Encoding UTF8
    if ($NoEnable) { Remove-Item -LiteralPath $flagPath -Force -ErrorAction SilentlyContinue }
    elseif ($first) { Set-Content -LiteralPath $flagPath -Value 'on' -Encoding ASCII }
    if (-not $NoTask) {
      $conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
      $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
      $taskArgs = "--headless `"$powershell`" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Action Check -StateDir `"$StateDir`""
      $user = "$env:USERDOMAIN\$env:USERNAME"
      try {
        $taskAction = New-ScheduledTaskAction -Execute $conhost -Argument $taskArgs -WorkingDirectory (Split-Path -Parent $PSCommandPath)
        $logon = New-ScheduledTaskTrigger -AtLogOn -User $user
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
        $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
        Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $logon -Settings $settings -Principal $principal `
          -Description 'Checks at sign-in whether the Foundry AI Tool client is older than the table and updates it (client-update.ps1).' -Force | Out-Null
      } catch {
        Write-Log "could not register the task '$TaskName': $($_.Exception.Message)"
        exit 1
      }
    }
    Write-Log ("direct install: auto-update is " + $(if (Test-Path -LiteralPath $flagPath) { 'on' } else { 'off' }) + ", table $($ControlHost):$ControlPort")
    exit 0
  }
  'Uninstall' {
    try { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop } catch { }
    Remove-Item -LiteralPath $directPath, $flagPath -Force -ErrorAction SilentlyContinue
    exit 0
  }
  'Enable' {
    New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
    Set-Content -LiteralPath $flagPath -Value 'on' -Encoding ASCII
    Write-Log 'auto-update switched on'
    exit 0
  }
  'Disable' {
    Remove-Item -LiteralPath $flagPath -Force -ErrorAction SilentlyContinue
    Write-Log 'auto-update switched off'
    exit 0
  }
  'Status' {
    Write-Host ("auto-update: " + $(if (Test-Path -LiteralPath $flagPath) { 'on' } else { 'off' }))
    if (Test-Path -LiteralPath $statusPath) { Get-Content -LiteralPath $statusPath -Raw | Write-Host }
    exit 0
  }
}

# --- Check ---
if (-not $Now -and -not (Test-Path -LiteralPath $flagPath)) { exit 0 }  # off: say nothing, touch nothing

# One check at a time per user.
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\FoundryAiToolClientUpdate', [ref]$created)
if (-not $created) { exit 0 }
try {
  $installed = Get-InstalledVersion
  if (-not (Test-Version $installed)) { Set-Status 'skipped' "this install's version is unknown ($installed)"; exit 0 }

  $pi = $PiVersion
  $port = 31414
  $tunnelHost = ''
  $directHost = ''
  if (Test-Path -LiteralPath $configPath) {
    try { $cfg = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json; $port = [int]$cfg.port; $tunnelHost = [string]$cfg.host } catch { }
  } elseif (Test-Path -LiteralPath $directPath) {
    try { $cfg = Get-Content -LiteralPath $directPath -Raw | ConvertFrom-Json; $port = [int]$cfg.port; $directHost = [string]$cfg.host } catch { }
  }
  # The tunnel listens on this PC; a direct install asks the table itself (read-only).
  $readHost = if ($directHost -match $hostPattern) { $directHost } else { '127.0.0.1' }
  if (-not $pi -and -not ($tunnelHost -or $directHost)) { Set-Status 'skipped' 'no tunnel name or bridge address on file for this install: update by hand'; exit 0 }
  if (-not $pi) {
    # The tunnel (or the private network) may still be starting at logon: try for about a minute.
    for ($i = 0; $i -lt $ReadAttempts -and -not $pi; $i++) {
      $st = Invoke-Control $readHost $port 'wrapper_status'
      if ($st -and $st.PSObject.Properties['current']) { $pi = [string]$st.current } else { Start-Sleep -Seconds 5 }
    }
  }
  if (-not (Test-Version $pi)) { Set-Status 'skipped' 'the table did not answer with a version'; exit 0 }

  if ((Compare-Version $installed $pi) -ge 0) { Set-Status 'current' "this install is $installed, the table runs $pi" $installed $pi; exit 0 }
  $tunnelOk = $tunnelHost -and ($tunnelHost -match '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$')
  $directOk = $directHost -and ($directHost -match $hostPattern)
  if (-not $tunnelOk -and -not $directOk) {
    Set-Status 'skipped' 'no valid tunnel name or bridge address on file for this install: update by hand' $installed $pi; exit 0
  }
  if (Test-ClaudeRunning) {
    Set-Status 'skipped' "Claude Desktop is running; will try again at the next sign-in ($installed -> $pi)" $installed $pi
    if ($Now) { Write-Host 'Quit Claude Desktop completely (tray icon, Quit), then run this again.' }
    exit 0
  }
  if ($DryRun) { Set-Status 'skipped' "dry run: would update $installed -> $pi" $installed $pi; exit 0 }

  $tag = "v$pi"
  $exeName = "FoundryMCPServer-Setup-$tag.exe"
  $work = Join-Path ([IO.Path]::GetTempPath()) ("foundry-update-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $work | Out-Null
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $exe = Join-Path $work $exeName
    Invoke-WebRequest -UseBasicParsing -Uri "$ReleaseBase/$tag/$exeName" -OutFile $exe -TimeoutSec 300
    $sums = (Invoke-WebRequest -UseBasicParsing -Uri "$ReleaseBase/$tag/SHA256SUMS.txt" -TimeoutSec 60).Content
    if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
    $want = Get-Sha256Line ([string]$sums) $exeName
    if (-not $want) { Set-Status 'failed' "SHA256SUMS.txt has no line for $exeName; nothing installed" $installed $pi; exit 1 }
    $got = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($got -ne $want) { Set-Status 'failed' "the download does not match SHA256SUMS.txt; nothing installed" $installed $pi; exit 1 }

    # Last look before the point of no return: Claude Desktop may have been opened during the download.
    if (Test-ClaudeRunning) { Set-Status 'skipped' "Claude Desktop was opened during the download; will try again at the next sign-in" $installed $pi; exit 0 }

    # Back up what the installer replaces (not the tunnel state folder, which holds the token).
    $backup = Join-Path $work 'backup'
    New-Item -ItemType Directory -Path $backup | Out-Null
    $stateLeaf = Split-Path -Leaf $StateDir
    Get-ChildItem -LiteralPath $InstallDir -Force | Where-Object { $_.Name -ne $stateLeaf } |
      ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $backup -Recurse -Force }

    # Silent upgrade with the same tunnel and port; no token argument, so the installer keeps the stored one.
    $target = if ($tunnelOk) { "/TUNNEL=$tunnelHost" } else { "/HOST=$directHost" }
    $installerArgs = @('/S', $target, "/PORT=$port", "/D=$InstallDir")
    # The installer writes its registry values before it sets up the tunnel, so keep a copy to put back.
    $regKeys = @('HKCU\Software\FoundryMCPServer', 'HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\FoundryMCPServer')
    $regFiles = @()
    for ($k = 0; $k -lt $regKeys.Count; $k++) {
      $rf = Join-Path $work "reg$k.reg"
      & reg.exe export $regKeys[$k] $rf /y 2>&1 | Out-Null
      if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $rf)) { $regFiles += $rf }
    }
    $p = Start-Process -FilePath $exe -ArgumentList $installerArgs -Wait -PassThru
    # Exit 4 means installed, but the bridge did not answer through the tunnel just then (for example the
    # table was restarting). The files are in place, so it counts as updated and is not rolled back.
    if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 4) {
      Get-ChildItem -LiteralPath $backup -Force | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $InstallDir -Recurse -Force }
      foreach ($rf in $regFiles) { & reg.exe import $rf 2>&1 | Out-Null }
      if ($tunnelOk) { try { Start-ScheduledTask -TaskName 'Foundry AI Tool tunnel' -ErrorAction Stop } catch { } }
      Set-Status 'failed' "the installer exited with code $($p.ExitCode); the old files were put back" $installed $pi
      exit 1
    }
    Set-Status 'updated' "updated $installed -> $pi (token kept); restart Claude Desktop to load it" $installed $pi
    exit 0
  } catch {
    Set-Status 'failed' "update stopped: $($_.Exception.Message); the old install is unchanged" $installed $pi
    exit 1
  } finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }
} finally {
  $mutex.ReleaseMutex()
}
