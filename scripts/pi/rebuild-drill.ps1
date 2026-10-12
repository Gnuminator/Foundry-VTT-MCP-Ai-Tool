#Requires -Version 7
<#
.SYNOPSIS
  Rebuild drill: rebuild the Orange Pi from the stage scripts and the newest backup, in a Docker
  container on this PC (docs/dev/PI-SETUP.md, "Rebuild drill"). Never contacts the Pi.

.DESCRIPTION
  1. Reads the newest snapshot of the PC's restic copy (E:\PiBackup\restic) on this PC into a
     scratch folder, proving this PC can read its own backups.
  2. Starts an ARM64 Debian 13 container named like the Pi (host name foundry-pi: the Foundry
     licence is bound to it), limited to -Cpus CPUs.
  3. Runs stages 1 to 3, restores the snapshot (restore.sh), then stages 5 to 8 and checks the
     result (check.sh). Stage 4 (Tailscale login) and stage 9 (a second SSH connection) need a
     person and a real Pi, so they are skipped. Wall time per stage goes to the report.
  4. Leaves the container stopped, not removed.

  The backup repository and its password file are mounted read-only; restic runs with --no-lock.
  Nothing is written to E:\PiBackup. Restored secrets stay in the container and in the scratch
  folder; the script prints none. It never touches an existing container, image or volume (every
  name starts with pi-drill-), publishes no port unless -HostPort is given, and needs no
  administrator rights.

  Run it from the repo folder. Takes about 10 minutes (measured 611 s; most of it the build in stage 5), plus Docker's first image pull.

.EXAMPLE
  .\scripts\pi\rebuild-drill.ps1
  .\scripts\pi\rebuild-drill.ps1 -HostPort 30090 -ToolRef v0.21.0
#>
[CmdletBinding()]
param(
  [string]$Name = ('pi-drill-' + (Get-Date -Format 'yyyyMMdd-HHmm')),
  [string]$FoundryZip = (Join-Path $env:USERPROFILE 'Downloads\FoundryVTT-Node-14.368.zip'),
  [string]$Repo = 'E:\PiBackup\restic',
  [string]$PassFile = (Join-Path $env:APPDATA 'foundry-ai-tool\restic-pc.pass'),
  [string]$Scratch = ('E:\Restore\' + (Get-Date -Format 'yyyy-MM-dd') + '-drill'),
  [string]$ToolRef = 'v0.21.0',
  [string]$Snapshot = 'latest',
  [string]$Image = 'debian:trixie',
  [int]$Cpus = 4,
  # Publish Foundry on 127.0.0.1:<port> (30090 is free; never 30001, 3100 or 31414 to 31416).
  [int]$HostPort = 0,
  [switch]$SkipPcRestore,
  # Test hook: the restic program to call (default: found automatically).
  [string]$Restic = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$remoteDir = Join-Path $repoRoot 'scripts\pi\remote'
$drillDir = Join-Path $repoRoot 'scripts\pi\drill'
$timings = [System.Collections.Generic.List[string]]::new()
$totalStart = Get-Date

function Write-Step([string]$Text) { Write-Host ("==> " + $Text) -ForegroundColor Cyan }

function Invoke-Native {
  # Runs a native command, throws on a non-zero exit code.
  param([string]$File, [string[]]$Arguments)
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$File $($Arguments -join ' ') failed with exit code $LASTEXITCODE" }
}

function Invoke-Timed([string]$Label, [scriptblock]$Block) {
  $start = Get-Date
  & $Block
  $seconds = [int]((Get-Date) - $start).TotalSeconds
  $timings.Add(('{0,-34} {1,6} s' -f $Label, $seconds))
}

function Invoke-InContainer([string]$Command) {
  Invoke-Native docker @('exec', $Name, 'bash', '-c', $Command)
}

# --- preflight -------------------------------------------------------------------------------
Write-Step 'preflight'
foreach ($p in @($FoundryZip, $PassFile)) {
  if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { throw "missing file: $p" }
}
if (-not (Test-Path -LiteralPath (Join-Path $Repo 'config'))) { throw "$Repo is not a restic repository" }
if (-not $Name.StartsWith('pi-drill-')) { throw "-Name must start with pi-drill- (so no other container is ever touched)" }
if (Test-Path -LiteralPath $Scratch) { throw "$Scratch exists already: pick another -Scratch (nothing is overwritten)" }
$existing = docker ps -a --filter "name=^$Name$" --format '{{.Names}}'
if ($existing) { throw "a container named $Name exists already: pick another -Name" }
Invoke-Native docker @('version', '--format', '{{.Server.Version}}')
if (-not $Restic) {
  $cmd = Get-Command restic -ErrorAction SilentlyContinue
  if ($cmd) { $Restic = $cmd.Source } else {
    $Restic = (Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\restic*') -Recurse -Filter 'restic*.exe' -ErrorAction SilentlyContinue |
        Select-Object -First 1).FullName
  }
}
if (-not $Restic) { throw 'restic is not installed (winget install restic.restic)' }

# --- 1. read the backup on this PC ----------------------------------------------------------
if (-not $SkipPcRestore) {
  Write-Step "restoring $Snapshot from $Repo into $Scratch (read-only, --no-lock)"
  Invoke-Timed 'PC: restic restore to scratch' {
    New-Item -ItemType Directory -Path $Scratch | Out-Null
    $oldRepo = $env:RESTIC_REPOSITORY
    $oldPass = $env:RESTIC_PASSWORD_FILE
    try {
      $env:RESTIC_REPOSITORY = $Repo
      $env:RESTIC_PASSWORD_FILE = $PassFile
      & $Restic snapshots --no-lock --compact
      # Windows cannot create the symlink in Chromium's pulse folder (no privilege); it is not needed.
      & $Restic restore $Snapshot --no-lock --target $Scratch --exclude '/var/lib/foundry-ai-tool/.config/pulse'
      if ($LASTEXITCODE -ne 0) { throw 'restic restore on this PC failed' }
    } finally {
      # Put the caller's own restic settings back (null removes the variable again).
      $env:RESTIC_REPOSITORY = $oldRepo
      $env:RESTIC_PASSWORD_FILE = $oldPass
    }
    $worlds = Get-ChildItem (Join-Path $Scratch 'var\lib\foundry\Data\worlds') -Directory
    if (-not ($worlds | Where-Object { Test-Path (Join-Path $_.FullName 'world.json') })) { throw 'no world.json in the restored worlds' }
    Write-Host ('    worlds on this PC: ' + (($worlds | ForEach-Object Name) -join ', '))
  }
}

# --- 2. the container ------------------------------------------------------------------------
Write-Step "starting $Name (ARM64 Debian 13, host name foundry-pi, $Cpus CPUs)"
$run = @('run', '-d', '--name', $Name, '--hostname', 'foundry-pi', '--platform', 'linux/arm64', '--cpus', "$Cpus",
  '-v', "${remoteDir}:/stages:ro", '-v', "${drillDir}:/drill-scripts:ro",
  '-v', "${Repo}:/drill/pc-repo:ro", '-v', "${PassFile}:/drill/restic-pc.pass:ro")
if ($HostPort -gt 0) {
  if ($HostPort -in 3000, 3100, 3190, 30000, 30001, 31414, 31415, 31416, 31514, 31515, 31516) { throw "port $HostPort is not free to use" }
  $run += @('-p', "127.0.0.1:${HostPort}:30000")
}
$run += @($Image, 'sleep', 'infinity')
Invoke-Timed 'container start' { Invoke-Native docker $run | Out-Null }

function Invoke-Stage([string]$File) {
  Invoke-Timed "stage $File" { Invoke-InContainer "TOOL_REF=$ToolRef bash /drill-scripts/stage.sh $File" }
}

$checkOk = $true
try {
  Invoke-Native docker @('cp', $FoundryZip, "${Name}:/root/foundryvtt.zip")
  Invoke-Native docker @('cp', (Join-Path $remoteDir 'assistant-gm.mjs'), "${Name}:/root/assistant-gm.mjs")

  # --- 3. stages and restore -------------------------------------------------------------------
  foreach ($s in '1-health.sh', '2-node.sh', '3-foundry.sh') { Write-Step $s; Invoke-Stage $s }
  Write-Step 'restore the newest snapshot (before stage 6, so the old restic password is kept)'
  Invoke-Timed 'restore (restic in the container)' {
    Invoke-InContainer "PC_REPO=/drill/pc-repo PC_PASS=/drill/restic-pc.pass SNAPSHOT=$Snapshot bash /drill-scripts/restore.sh"
  }
  foreach ($s in '5-tool.sh', '6-backup.sh', '7-vault.sh', '8-recorder.sh') { Write-Step $s; Invoke-Stage $s }

  # --- 4. start and check ----------------------------------------------------------------------
  Write-Step 'start the services and check'
  Invoke-Timed 'start and check' {
    & docker exec $Name bash /drill-scripts/check.sh
    if ($LASTEXITCODE -ne 0) { $script:checkOk = $false }
  }
} finally {
  # Whatever happened, stop the container (never remove it: the user keeps it for inspection).
  docker stop $Name 2>&1 | Out-Null
  Write-Host ''
  Write-Host "Left for you (nothing was deleted): container $Name (stopped; docker rm when done), and the" -ForegroundColor Yellow
  Write-Host "earlier pi-drill-* containers and images. Scratch folder: $Scratch (if it exists). It holds the" -ForegroundColor Yellow
  Write-Host 'RESTORED SECRETS (the Foundry licence, /etc/foundry-ai-tool, tokens); so does each drill container.' -ForegroundColor Yellow
  Write-Host 'Delete them yourself when you are done; keep them private until then.' -ForegroundColor Yellow
}

$size = docker ps -a --size --filter "name=^$Name$" --format '{{.Size}}'
$total = [int]((Get-Date) - $totalStart).TotalSeconds
$report = @(
  "Rebuild drill $(Get-Date -Format 'yyyy-MM-dd HH:mm')",
  "container $Name (stopped, not removed), size $size; snapshot $Snapshot; tool $ToolRef",
  "stages skipped: 4-tailscale (needs a login), 9-ssh-log (needs a second SSH connection)",
  ''
) + $timings + @('', ('{0,-34} {1,6} s' -f 'total', $total), "checks: $(if ($checkOk) { 'all passed' } else { 'SOME FAILED' })")
$report | ForEach-Object { Write-Host $_ }
if (Test-Path -LiteralPath $Scratch) { $report | Set-Content -Path (Join-Path $Scratch 'drill-report.txt') -Encoding utf8 }
if (-not $checkOk) { exit 1 }
