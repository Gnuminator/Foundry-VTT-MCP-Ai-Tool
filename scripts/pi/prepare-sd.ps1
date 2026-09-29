#Requires -Version 7
<#
.SYNOPSIS
  Prepare a DietPi microSD card for the Orange Pi 5 Pro (docs/dev/PI-SETUP.md, Part A).

.DESCRIPTION
  -Download   downloads the DietPi image for the Orange Pi 5 Pro and checks its SHA-256.
  -Configure  writes first-boot settings into dietpi.txt on the card's DIETPISETUP drive:
              hostname, time zone, DHCP over Ethernet, OpenSSH with a new key for this PC,
              a random root password (saved on this PC), Avahi. Nothing else is installed.

  Files on this PC:
    ~\.ssh\foundry_pi(.pub)            SSH key used by Claude and you to log in
    ~\.foundry-pi\root-password.txt   root password (only needed at a monitor and keyboard)
    ~\.foundry-pi\state.json           hostname and key path, read by find-pi.ps1

.EXAMPLE
  .\scripts\pi\prepare-sd.ps1 -Download
  .\scripts\pi\prepare-sd.ps1 -Configure
#>
[CmdletBinding()]
param(
  [switch]$Download,
  [switch]$Configure,
  [string]$Hostname = 'foundry-pi',
  [string]$TimeZone = 'Europe/Copenhagen',
  # Testing only: a folder that holds dietpi.txt, instead of the DIETPISETUP drive.
  [string]$SetupPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ImageName = 'DietPi_OrangePi5Pro-ARMv8-Trixie.img.xz'
$ImageUrl = "https://dietpi.com/downloads/images/$ImageName"
$DownloadDir = Join-Path $HOME 'Downloads' 'foundry-pi'
$StateDir = Join-Path $HOME '.foundry-pi'
$KeyPath = Join-Path $HOME '.ssh' 'foundry_pi'

if (-not $Download -and -not $Configure) {
  Write-Host 'Use -Download (step 1) or -Configure (step 3). See docs/dev/PI-SETUP.md.'
  exit 1
}
if ($Hostname -notmatch '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$') {
  throw "Hostname '$Hostname' is not valid (lowercase letters, digits and dashes)."
}

function Invoke-Download {
  New-Item -ItemType Directory -Force -Path $DownloadDir | Out-Null
  $image = Join-Path $DownloadDir $ImageName
  $sumFile = "$image.sha256"
  Write-Host "Downloading the checksum from $ImageUrl.sha256"
  Invoke-WebRequest -Uri "$ImageUrl.sha256" -OutFile $sumFile
  $expected = ([regex]::Match((Get-Content $sumFile -Raw), '[0-9a-fA-F]{64}')).Value.ToLowerInvariant()
  if (-not $expected) { throw "No SHA-256 found in $sumFile." }

  if (Test-Path $image) {
    Write-Host 'The image is already downloaded; checking it.'
  } else {
    Write-Host "Downloading $ImageName (about 200 MB) to $DownloadDir"
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $ImageUrl -OutFile $image
  }
  $actual = (Get-FileHash -Algorithm SHA256 -Path $image).Hash.ToLowerInvariant()
  if ($actual -ne $expected) {
    Remove-Item $image
    throw "Checksum mismatch (expected $expected, got $actual). The file was deleted; run -Download again."
  }
  Write-Host ''
  Write-Host "OK: $image"
  Write-Host 'Checksum matches the one DietPi publishes.'
  Write-Host 'Next: write it to the microSD card with balenaEtcher, then run -Configure.'
}

function Get-SetupFolder {
  if ($SetupPath) { return (Resolve-Path $SetupPath).Path }
  $vol = Get-Volume -ErrorAction SilentlyContinue |
    Where-Object { $_.FileSystemLabel -eq 'DIETPISETUP' -and $_.DriveLetter }
  if (-not $vol) {
    throw @'
No drive named DIETPISETUP found. Take the card out, put it back in and run this again.
If Windows offers to format a drive, click Cancel. If the drive never appears, see
"If the script cannot find the Pi" in docs/dev/PI-SETUP.md (monitor and keyboard route).
'@
  }
  if (@($vol).Count -gt 1) { throw 'More than one DIETPISETUP drive is connected; keep only the Pi card in.' }
  return "$($vol.DriveLetter):\"
}

function New-RandomPassword([int]$Length = 24) {
  $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  $bytes = [byte[]]::new($Length)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
}

function Set-DietPiKey([string]$Text, [string]$Key, [string]$Value, [switch]$OnlyIfPresent) {
  $pattern = "(?m)^[ \t]*#?[ \t]*$([regex]::Escape($Key))=.*$"
  if ([regex]::IsMatch($Text, $pattern)) {
    $replacement = "$Key=$Value".Replace('$', '$$')
    return [regex]::Replace($Text, $pattern, $replacement, 1)
  }
  if ($OnlyIfPresent) { return $Text }
  Write-Warning "$Key was not in dietpi.txt; appended it."
  return $Text.TrimEnd("`n") + "`n$Key=$Value`n"
}

function Invoke-Configure {
  $folder = Get-SetupFolder
  $file = Join-Path $folder 'dietpi.txt'
  if (-not (Test-Path $file)) { throw "No dietpi.txt in $folder. Is this the DietPi card?" }

  New-Item -ItemType Directory -Force -Path $StateDir, (Split-Path $KeyPath) | Out-Null

  if (-not (Test-Path $KeyPath)) {
    Write-Host "Creating the SSH key $KeyPath"
    $keygenArgs = "-q -t ed25519 -f `"$KeyPath`" -N `"`" -C foundry-pi@$env:COMPUTERNAME"
    $p = Start-Process -FilePath 'ssh-keygen' -ArgumentList $keygenArgs -NoNewWindow -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw 'ssh-keygen failed. Is the Windows OpenSSH client installed?' }
  }
  $pubKey = (Get-Content "$KeyPath.pub" -Raw).Trim()

  $pwFile = Join-Path $StateDir 'root-password.txt'
  if (-not (Test-Path $pwFile)) { Set-Content -Path $pwFile -Value (New-RandomPassword) -NoNewline }
  $password = (Get-Content $pwFile -Raw).Trim()

  $text = (Get-Content $file -Raw).Replace("`r`n", "`n")
  $settings = [ordered]@{
    AUTO_SETUP_AUTOMATED           = '1'
    AUTO_SETUP_GLOBAL_PASSWORD     = $password
    AUTO_SETUP_NET_HOSTNAME        = $Hostname
    AUTO_SETUP_TIMEZONE            = $TimeZone
    AUTO_SETUP_LOCALE              = 'en_GB.UTF-8'
    AUTO_SETUP_KEYBOARD_LAYOUT     = 'dk'
    AUTO_SETUP_NET_ETHERNET_ENABLED = '1'
    AUTO_SETUP_NET_WIFI_ENABLED    = '0'
    AUTO_SETUP_NET_USESTATIC       = '0'
    AUTO_SETUP_SSH_SERVER_INDEX    = '-2'
    AUTO_SETUP_SSH_PUBKEY          = $pubKey
    AUTO_SETUP_INSTALL_SOFTWARE_ID = '152'
  }
  foreach ($k in $settings.Keys) { $text = Set-DietPiKey $text $k $settings[$k] }
  # Keys that exist only in some DietPi versions: set them when present.
  $text = Set-DietPiKey $text 'AUTO_SETUP_ACCEPT_LICENSE' '1' -OnlyIfPresent
  $text = Set-DietPiKey $text 'SURVEY_OPTED_IN' '0' -OnlyIfPresent

  [System.IO.File]::WriteAllText($file, $text, [System.Text.UTF8Encoding]::new($false))

  $state = [ordered]@{ Hostname = $Hostname; KeyPath = $KeyPath; ConfiguredAt = (Get-Date).ToString('s') }
  $state | ConvertTo-Json | Set-Content -Path (Join-Path $StateDir 'state.json')

  Write-Host ''
  Write-Host "OK: first-boot settings written to $file"
  Write-Host "  hostname   $Hostname"
  Write-Host "  time zone  $TimeZone"
  Write-Host "  SSH key    $KeyPath"
  Write-Host "  password   saved in $pwFile (not shown)"
  Write-Host ''
  Write-Host 'Next: eject the card safely, put it in the Pi, connect Ethernet, then power.'
  Write-Host 'Wait about 5 minutes, then run .\scripts\pi\find-pi.ps1'
}

if ($Download) { Invoke-Download }
if ($Configure) { Invoke-Configure }
