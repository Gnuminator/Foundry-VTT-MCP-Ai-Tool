#requires -Version 7
<#
.SYNOPSIS
  Drive the voice stack (tools/voice-stack, compose project "fvtt-voice") from PowerShell.

.DESCRIPTION
  init                 Create tools/voice-stack/.env from .env.example with random LiveKit dev keys (once).
  up <profile>         livekit (server, redis, egress, recorder), tls (livekit plus local TLS on 7443) or
                       transcribe (build the two job images only; the jobs run with the transcribe command).
  down                 Stop and remove this project's containers (not the Hugging Face model cache).
  status               Project containers, GPU memory, images and the sessions folder.
  logs [service]       Follow the logs.
  transcribe <session> Run the transcriber (GPU), then the session pipeline (CPU) on a session folder
                       (or a Craig .zip). Name a folder under the sessions folder, or give a full path.

  Refuses to run if .env points any port at a Foundry or bridge port (Foundry 30000-30001, dashboard
  3100, live bridge 31414-31416, test bridge 31514-31516). Never touches containers outside the
  fvtt-voice project. One GPU job at a time: transcribe warns when the GPU is already busy.

  transcribe options: -Model <name|path> (default large-v3-turbo), -Hotwords (use <session>/vocab.txt
  as Whisper hotwords), -Force (redo finished tracks), -NoPipeline (transcriber only).
  The pipeline picks up <session>/speakers.json, vocab.txt, rules.json and ordinary-words.txt if present.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('init', 'up', 'down', 'status', 'logs', 'transcribe')]
  [string]$Command = 'status',
  [Parameter(Position = 1)]
  [string]$Target,
  [string]$Model,
  [switch]$Hotwords,
  [switch]$Force,
  [switch]$NoPipeline
)

$ErrorActionPreference = 'Stop'
$Root = Join-Path (Split-Path -Parent $PSScriptRoot) 'tools/voice-stack'
$ComposeFile = Join-Path $Root 'docker-compose.yml'
$EnvFile = Join-Path $Root '.env'
$Project = 'fvtt-voice'
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

function Initialize-Env {
  if (Test-Path $EnvFile) { return }
  $text = Get-Content (Join-Path $Root '.env.example') -Raw
  $text = $text -replace 'LIVEKIT_API_KEY=.*', "LIVEKIT_API_KEY=devkey$(New-RandomString 8)"
  $text = $text -replace 'LIVEKIT_API_SECRET=.*', "LIVEKIT_API_SECRET=$(New-RandomString 48)"
  $sessions = Join-Path $env:USERPROFILE 'Documents/FoundrySessions'
  $text = $text -replace 'FVTT_SESSIONS_DIR=.*', "FVTT_SESSIONS_DIR=$($sessions -replace '\\', '/')"
  Set-Content -Path $EnvFile -Value $text -NoNewline
  Write-Host "Wrote $EnvFile (random dev keys, gitignored). Check FVTT_SESSIONS_DIR in it."
}

function Assert-SafePorts($envMap) {
  foreach ($name in $envMap.Keys) {
    if ($name -notmatch '_PORT$') { continue }
    $port = 0
    if ([int]::TryParse($envMap[$name], [ref]$port) -and ($ForbiddenPorts -contains $port)) {
      throw "$name=$port is a Foundry or bridge port. Pick another port in $EnvFile."
    }
  }
}

function Get-SessionsDir($envMap) {
  $dir = $envMap['FVTT_SESSIONS_DIR']
  if (-not $dir) { $dir = Join-Path $env:USERPROFILE 'Documents/FoundrySessions' }
  return $dir
}

function Assert-Docker {
  docker info *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Docker is not running. Start Docker Desktop and try again.' }
}

function Invoke-Compose {
  param([string[]]$ComposeArgs)
  & docker compose -f $ComposeFile --project-directory $Root -p $Project @ComposeArgs
  if ($LASTEXITCODE -ne 0) { throw "docker compose $($ComposeArgs -join ' ') failed ($LASTEXITCODE)" }
}

function Get-GpuLine {
  $smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
  if (-not $smi) { return $null }
  $line = & nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv,noheader 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  return ($line | Select-Object -First 1)
}

function Get-GpuUsedMiB {
  $smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
  if (-not $smi) { return 0 }
  $v = & nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits 2>$null
  if ($LASTEXITCODE -ne 0) { return 0 }
  return [int](($v | Select-Object -First 1).Trim())
}

$envMap = $null
if ($Command -ne 'init') {
  Initialize-Env   # compose needs the LiveKit variables to exist even for the transcribe jobs
  $envMap = Read-DotEnv
  Assert-SafePorts $envMap
  Assert-Docker
  # Compose refuses a bind mount whose host folder does not exist.
  $null = New-Item -ItemType Directory -Force -Path (Get-SessionsDir $envMap)
}

switch ($Command) {
  'init' {
    if (Test-Path $EnvFile) { Write-Host '.env already exists, leaving it alone.' } else { Initialize-Env }
  }
  'up' {
    if (-not $Target) { throw 'Usage: voice-stack.ps1 up <livekit|tls|transcribe>' }
    switch ($Target) {
      'livekit' {
        foreach ($key in 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET') {
          if (-not $envMap[$key] -or $envMap[$key] -match 'REPLACEME') { throw "$key in $EnvFile is not set." }
        }
        Invoke-Compose @('--profile', 'livekit', 'up', '-d', '--build')
      }
      'tls' {
        Invoke-Compose @('--profile', 'livekit', '--profile', 'tls', 'up', '-d', '--build')
      }
      'transcribe' {
        Invoke-Compose @('--profile', 'transcribe', 'build')
        Write-Host 'Images built. Run a job with: voice-stack.ps1 transcribe <session folder>'
      }
      'media' { throw 'The media profile (ComfyUI) is a placeholder and not built yet.' }
      default { throw "Unknown profile '$Target'. Use livekit, tls or transcribe." }
    }
  }
  'down' {
    Invoke-Compose @('--profile', '*', 'down', '--remove-orphans')
    Write-Host "Stopped project $Project. The model cache volume fvtt-voice-hf-cache is kept."
  }
  'status' {
    Write-Host "Project $Project"
    Invoke-Compose @('--profile', '*', 'ps', '-a')
    $gpu = Get-GpuLine
    if ($gpu) { Write-Host "GPU: $gpu (one GPU job at a time)" }
    Write-Host 'Images:'
    docker images --filter 'reference=fvtt-transcriber' --filter 'reference=fvtt-session-pipeline' --format '  {{.Repository}}:{{.Tag}}  {{.Size}}'
    $sessions = Get-SessionsDir $envMap
    Write-Host "Sessions folder: $sessions $(if (Test-Path $sessions) { '' } else { '(does not exist yet)' })"
  }
  'logs' {
    $logArgs = @('--profile', '*', 'logs', '-f', '--tail', '100')
    if ($Target) { $logArgs += $Target }
    Invoke-Compose $logArgs
  }
  'transcribe' {
    if (-not $Target) { throw 'Usage: voice-stack.ps1 transcribe <session folder name or path>' }
    $sessionsRoot = Get-SessionsDir $envMap
    $resolved = $null
    foreach ($candidate in @($Target, (Join-Path $sessionsRoot $Target))) {
      if (Test-Path -LiteralPath $candidate) { $resolved = (Resolve-Path -LiteralPath $candidate).Path; break }
    }
    if (-not $resolved) { throw "Session not found: '$Target' (also looked in $sessionsRoot)." }
    $item = Get-Item -LiteralPath $resolved
    if ($item.PSIsContainer) { $folder = $item.FullName; $inputName = '' }
    elseif ($item.Extension -eq '.zip') { $folder = $item.DirectoryName; $inputName = $item.Name }
    else { throw 'Give a session folder or a Craig .zip.' }
    $inside = if ($inputName) { "/session/$inputName" } else { '/session' }

    $gpu = Get-GpuLine
    if ($gpu) {
      Write-Host "GPU: $gpu"
      if ((Get-GpuUsedMiB) -gt 6000) {
        Write-Warning 'The GPU already holds more than 6 GB. Another GPU job may be running; the transcriber may run out of memory or slow down.'
      }
    }

    $tArgs = @('--profile', 'transcribe', 'run', '--rm', '-T', '-v', "${folder}:/session", 'transcriber',
      $inside, '--out', '/session/transcripts')
    if ($Model) { $tArgs += @('--model', $Model) }
    if ($Hotwords) {
      if (-not (Test-Path (Join-Path $folder 'vocab.txt'))) { throw "-Hotwords needs $folder\vocab.txt" }
      $tArgs += @('--hotwords', '/session/vocab.txt')
    }
    if ($Force) { $tArgs += '--force' }
    Invoke-Compose $tArgs

    if ($NoPipeline) {
      Write-Host "Transcripts: $(Join-Path $folder 'transcripts/json')"
      break
    }
    $pArgs = @('--profile', 'transcribe', 'run', '--rm', '-T', '-v', "${folder}:/session", 'pipeline',
      'merge', '/session/transcripts/json', '--out', '/session/timeline')
    foreach ($pair in @(@('speakers.json', '--speakers'), @('vocab.txt', '--vocab'), @('rules.json', '--rules'),
        @('ordinary-words.txt', '--ordinary-words'))) {
      if (Test-Path (Join-Path $folder $pair[0])) { $pArgs += @($pair[1], "/session/$($pair[0])") }
    }
    Invoke-Compose $pArgs
    Write-Host ''
    Write-Host "Per-speaker JSON: $(Join-Path $folder 'transcripts/json')"
    Write-Host "Merged timeline:  $(Join-Path $folder 'timeline/timeline.md')"
    Write-Host 'Next: the Claude writing step (clean-up, translation, notes) runs on the host.'
  }
}
