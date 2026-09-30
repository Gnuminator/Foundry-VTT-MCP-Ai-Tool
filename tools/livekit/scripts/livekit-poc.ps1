#requires -Version 7
<#
.SYNOPSIS
  Start, stop and check the LiveKit proof-of-concept stack (tools/livekit).

.DESCRIPTION
  init    Generate .env with random dev keys (once; never overwrites).
  up      Build and start livekit-server, redis, egress and the recorder. -Tls adds wss://localhost:7443.
  down    Stop and remove this stack's containers (only the fvtt-livekit project).
  status  Show containers, the recorder health check and the newest recordings.
  logs    Follow the logs (optionally one service: livekit, egress, recorder, redis).
  test    Publish a generated 20 second tone as a fake participant and check the recording.

  Refuses to run if .env points any host port at a Foundry or bridge port
  (Foundry test 30000-30001, test bridge 31514-31516, dashboard 3100, live bridge 31414-31416).
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('init', 'up', 'down', 'status', 'logs', 'test')]
  [string]$Command = 'status',
  [Parameter(Position = 1)]
  [string]$Service,
  [switch]$Tls
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $Root '.env'
$Project = 'fvtt-livekit'
$ForbiddenPorts = @(30000, 30001, 3100, 31414, 31415, 31416, 31514, 31515, 31516)

function Read-DotEnv {
  $map = @{}
  if (Test-Path $EnvFile) {
    foreach ($line in Get-Content $EnvFile) {
      if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') { $map[$Matches[1]] = $Matches[2] }
    }
  }
  return $map
}

function New-RandomString([int]$Length) {
  $chars = [char[]]'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  -join (1..$Length | ForEach-Object { $chars[[System.Security.Cryptography.RandomNumberGenerator]::GetInt32($chars.Length)] })
}

function Assert-SafePorts($envMap) {
  $ports = @{
    LIVEKIT_SIGNAL_PORT = [int]($envMap['LIVEKIT_SIGNAL_PORT'] ?? 7880)
    LIVEKIT_TCP_PORT    = [int]($envMap['LIVEKIT_TCP_PORT'] ?? 7881)
    LIVEKIT_UDP_PORT    = [int]($envMap['LIVEKIT_UDP_PORT'] ?? 7882)
    LIVEKIT_TLS_PORT    = [int]($envMap['LIVEKIT_TLS_PORT'] ?? 7443)
  }
  foreach ($name in $ports.Keys) {
    if ($ForbiddenPorts -contains $ports[$name]) {
      throw "$name=$($ports[$name]) is a Foundry or bridge port. Pick another port in .env."
    }
  }
}

function Require-Env {
  if (-not (Test-Path $EnvFile)) { throw ".env is missing. Run: pwsh tools/livekit/scripts/livekit-poc.ps1 init" }
  $envMap = Read-DotEnv
  foreach ($key in 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET') {
    if (-not $envMap[$key] -or $envMap[$key] -match 'REPLACEME') { throw "$key in .env is not set." }
  }
  Assert-SafePorts $envMap
  return $envMap
}

function Invoke-Compose {
  param([string[]]$ComposeArgs)
  & docker compose --project-directory $Root -p $Project @ComposeArgs
  if ($LASTEXITCODE -ne 0) { throw "docker compose $($ComposeArgs -join ' ') failed ($LASTEXITCODE)" }
}

function Assert-Docker {
  docker info *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Docker is not running. Start Docker Desktop and try again.' }
}

switch ($Command) {
  'init' {
    if (Test-Path $EnvFile) { Write-Host ".env already exists, leaving it alone."; break }
    $text = Get-Content (Join-Path $Root '.env.example') -Raw
    $text = $text -replace 'LIVEKIT_API_KEY=.*', "LIVEKIT_API_KEY=devkey$(New-RandomString 8)"
    $text = $text -replace 'LIVEKIT_API_SECRET=.*', "LIVEKIT_API_SECRET=$(New-RandomString 48)"
    Set-Content -Path $EnvFile -Value $text -NoNewline
    Write-Host "Wrote $EnvFile (random dev keys, gitignored)."
  }
  'up' {
    Assert-Docker
    if (-not (Test-Path $EnvFile)) { & $PSCommandPath init }
    [void](Require-Env)
    New-Item -ItemType Directory -Force (Join-Path $Root 'recordings') | Out-Null
    $upArgs = @('up', '-d', '--build')
    if ($Tls) { $upArgs = @('--profile', 'tls') + $upArgs }
    Invoke-Compose $upArgs
    Write-Host 'Stack is starting. Signalling: ws://localhost:7880. Check with: livekit-poc.ps1 status'
  }
  'down' {
    Assert-Docker
    Invoke-Compose @('--profile', 'tls', 'down')
  }
  'status' {
    Assert-Docker
    Invoke-Compose @('ps')
    try {
      $health = Invoke-RestMethod -Uri 'http://127.0.0.1:7880' -TimeoutSec 3 -ErrorAction Stop
      Write-Host "livekit-server answers on 7880: $health"
    } catch { Write-Host 'livekit-server does not answer on 7880.' }
    $rec = Join-Path $Root 'recordings'
    if (Test-Path $rec) {
      Write-Host 'Newest recordings:'
      Get-ChildItem $rec -Recurse -File -Include *.ogg, *.webm, *.mp4, done.json, session.jsonl |
        Sort-Object LastWriteTime -Descending | Select-Object -First 8 |
        ForEach-Object { '{0,10:N0} bytes  {1}' -f $_.Length, (Resolve-Path -Relative $_.FullName) }
    }
  }
  'logs' {
    Assert-Docker
    $composeArgs = @('logs', '-f', '--tail', '100')
    if ($Service) { $composeArgs += $Service }
    Invoke-Compose $composeArgs
  }
  'test' {
    Assert-Docker
    $envMap = Require-Env
    $testData = Join-Path $Root 'testdata'
    New-Item -ItemType Directory -Force $testData | Out-Null
    $tone = Join-Path $testData 'tone.ogg'
    if (-not (Test-Path $tone)) {
      if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { throw 'ffmpeg is needed to generate the test tone.' }
      & ffmpeg -v error -y -f lavfi -i 'sine=frequency=440:duration=20' -ar 48000 -ac 1 -c:a libopus -b:a 32k $tone
    }
    $room = 'poc-room'
    Write-Host "Joining $room as test-player-1 and publishing the tone for 20 seconds..."
    & docker run --rm --network "${Project}_default" -v "${testData}:/data:ro" livekit/livekit-cli:latest --quiet `
      room join --url ws://livekit:7880 --api-key $envMap['LIVEKIT_API_KEY'] --api-secret $envMap['LIVEKIT_API_SECRET'] `
      --identity test-player-1 --publish /data/tone.ogg --exit-after-publish $room
    Start-Sleep -Seconds 5
    $files = Get-ChildItem (Join-Path $Root "recordings/$room") -Recurse -File -Filter *.ogg -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $files) { throw 'No .ogg recording appeared. Check: livekit-poc.ps1 logs egress' }
    Write-Host "Recording: $($files.FullName)"
    if (Get-Command ffprobe -ErrorAction SilentlyContinue) {
      & ffprobe -v error -show_entries format=duration:stream=codec_name,channels,sample_rate -of default=nw=1 $files.FullName
    }
  }
}
