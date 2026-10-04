#Requires -Version 7
<#
.SYNOPSIS
  Find the Orange Pi on the home network and set up `ssh <hostname>` (docs/dev/PI-SETUP.md, step 5).

.DESCRIPTION
  Tries <hostname>.local first, then scans this PC's /24 network for SSH servers and tries the
  key from prepare-sd.ps1 on each. Only the Pi accepts that key, so a successful login is the proof.
  Keeps trying while the Pi's first boot finishes. On success it writes a managed block to
  ~\.ssh\config so that `ssh foundry-pi` works.

.EXAMPLE
  .\scripts\pi\find-pi.ps1
  .\scripts\pi\find-pi.ps1 -Address 192.168.1.50
#>
[CmdletBinding()]
param(
  [string]$Address,
  [int]$TimeoutMinutes = 20
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$StateDir = Join-Path $HOME '.foundry-pi'
$stateFile = Join-Path $StateDir 'state.json'
if (-not (Test-Path $stateFile)) { throw 'Run .\scripts\pi\prepare-sd.ps1 -Configure first.' }
$state = Get-Content $stateFile -Raw | ConvertFrom-Json
$Hostname = $state.Hostname
$KeyPath = $state.KeyPath
$KnownHosts = Join-Path $StateDir 'known_hosts'

function Test-PiLogin([string]$Target) {
  # BatchMode: never prompt. A throwaway known_hosts while probing unknown hosts.
  $out = & ssh -i $KeyPath -o BatchMode=yes -o ConnectTimeout=5 -o IdentitiesOnly=yes `
    -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o LogLevel=ERROR `
    "root@$Target" hostname 2>$null
  if ($LASTEXITCODE -eq 0 -and $out) { return ($out | Select-Object -First 1).Trim() }
  return $null
}

function Get-SshHostsOnLan {
  $cfg = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } |
    Select-Object -First 1
  if (-not $cfg) { return @() }
  $ip = @($cfg.IPv4Address)[0].IPAddress
  $prefix = $ip.Substring(0, $ip.LastIndexOf('.'))
  1..254 | ForEach-Object -Parallel {
    $candidate = "$($using:prefix).$_"
    if ($candidate -eq $using:ip) { return }
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
      if ($client.ConnectAsync($candidate, 22).Wait(400)) { $candidate }
    } catch {
    } finally {
      $client.Dispose()
    }
  } -ThrottleLimit 64
}

function Write-SshConfig([string]$Ip) {
  $sshDir = Join-Path $HOME '.ssh'
  $config = Join-Path $sshDir 'config'
  $begin = "# BEGIN $Hostname (managed by scripts/pi/find-pi.ps1)"
  $end = "# END $Hostname"
  $keyForConfig = $KeyPath.Replace('\', '/')
  $knownForConfig = $KnownHosts.Replace('\', '/')
  $block = @(
    $begin
    "Host $Hostname"
    "  HostName $Ip"
    '  User root'
    "  IdentityFile `"$keyForConfig`""
    '  IdentitiesOnly yes'
    "  UserKnownHostsFile `"$knownForConfig`""
    '  StrictHostKeyChecking accept-new'
    '  ServerAliveInterval 30'
    $end
  ) -join "`n"
  $existing = if (Test-Path $config) { (Get-Content $config -Raw).Replace("`r`n", "`n") } else { '' }
  $pattern = "(?s)$([regex]::Escape($begin)).*?$([regex]::Escape($end))\n?"
  if ([regex]::IsMatch($existing, $pattern)) {
    $existing = [regex]::Replace($existing, $pattern, $block.Replace('$', '$$') + "`n")
  } else {
    $existing = ($existing.TrimEnd("`n") + "`n`n" + $block + "`n").TrimStart("`n")
  }
  [System.IO.File]::WriteAllText($config, $existing, [System.Text.UTF8Encoding]::new($false))
}

$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
$found = $null
$round = 0
while (-not $found -and (Get-Date) -lt $deadline) {
  $round++
  $targets = @()
  if ($Address) {
    $targets = @($Address)
  } else {
    $targets = @("$Hostname.local")
    $targets += @(Get-SshHostsOnLan)
  }
  Write-Host "Round $round`: trying $($targets.Count) address(es)..."
  foreach ($t in $targets) {
    $name = Test-PiLogin $t
    if ($name) {
      $ip = if ($t -match '^\d+\.\d+\.\d+\.\d+$') { $t } else {
        (Resolve-DnsName -Name $t -Type A -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress
      }
      if (-not $ip) { $ip = $t }
      $found = [pscustomobject]@{ Address = $ip; Name = $name }
      break
    }
  }
  if (-not $found) { Start-Sleep -Seconds 30 }
}

if (-not $found) {
  Write-Host ''
  Write-Host "The Pi did not answer within $TimeoutMinutes minutes."
  Write-Host 'Plug in a monitor and keyboard, log in as root (password in ~\.foundry-pi\root-password.txt),'
  Write-Host 'run: hostname -I   and then: .\scripts\pi\find-pi.ps1 -Address <that address>'
  exit 1
}

Write-SshConfig $found.Address

# DietPi's first boot swaps its built-in SSH server (Dropbear) for OpenSSH and restarts, which
# brings a new host key. Wait until the first boot is done (install stage 2) before recording the
# key, or the first `ssh foundry-pi` afterwards fails with "host key has changed" (2026-10-04).
Write-Host "Found the Pi at $($found.Address); waiting for its first boot to finish..."
$stage = $null
while ((Get-Date) -lt $deadline.AddMinutes(10)) {
  $stage = & ssh -i $KeyPath -o BatchMode=yes -o ConnectTimeout=5 -o IdentitiesOnly=yes `
    -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o LogLevel=ERROR `
    "root@$($found.Address)" 'cat /boot/dietpi/.install_stage 2>/dev/null' 2>$null
  if ($LASTEXITCODE -eq 0 -and "$stage".Trim() -eq '2') { break }
  Start-Sleep -Seconds 20
}
if ("$stage".Trim() -ne '2') {
  throw "The Pi at $($found.Address) has not finished its first boot. Wait a few minutes and run this again."
}
# Forget any key recorded before the switch, then record the real one.
if (Test-Path $KnownHosts) {
  & ssh-keygen -R $found.Address -f $KnownHosts 2>$null | Out-Null
  & ssh-keygen -R $Hostname -f $KnownHosts 2>$null | Out-Null
}
& ssh -o BatchMode=yes -o LogLevel=ERROR $Hostname true | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Found the Pi at $($found.Address), but 'ssh $Hostname' failed afterwards." }

Write-Host ''
Write-Host "OK: the Pi answers at $($found.Address) (its hostname is '$($found.Name)')."
Write-Host "      'ssh $Hostname' now works from this PC."
if ($found.Name -ne $Hostname) {
  Write-Host "      The first boot has not applied the hostname yet; that is fine, it finishes on its own."
}
Write-Host ''
Write-Host 'Tell Claude: "The Pi is up."'
