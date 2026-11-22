# Source hash of a voice image's build context, and the check against the label on the built image.
# Dot-sourced by voice-stack.ps1. The same files the Docker build copies count (the .dockerignore
# folders and file types are left out), so a change to a source file changes the hash and an edit
# to a test or a recording does not.

$script:VoiceHashSkipDirs = @('.venv', '__pycache__', '.pytest_cache', 'build', 'dist', 'tests', 'transcripts', 'scratch', 'local', 'data', 'out')
$script:VoiceHashSkipExt = @('.wav', '.flac', '.mp3', '.ogg', '.zip', '.pyc')
$script:VoiceHashLabel = 'fvtt.source-hash'

function Get-VoiceSourceHash {
  param([Parameter(Mandatory)][string]$Dir)
  $base = (Resolve-Path -LiteralPath $Dir).Path.TrimEnd('\', '/')
  $lines = foreach ($f in (Get-ChildItem -LiteralPath $base -Recurse -File -Force)) {
    $rel = $f.FullName.Substring($base.Length + 1) -replace '\\', '/'
    $parts = $rel.Split('/')
    if ($parts.Count -gt 1 -and ($parts[0..($parts.Count - 2)] | Where-Object { $script:VoiceHashSkipDirs -contains $_ -or $_ -like '*.egg-info' })) { continue }
    if ($script:VoiceHashSkipExt -contains $f.Extension.ToLowerInvariant()) { continue }
    # Line endings do not change what the image runs, so a checkout with CRLF hashes like one with LF.
    $text = [System.IO.File]::ReadAllText($f.FullName) -replace "`r`n", "`n"
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $h = [BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($text))).Replace('-', '').ToLowerInvariant()
    "$rel $h"
  }
  $joined = (($lines | Sort-Object -Culture ([cultureinfo]::InvariantCulture) -CaseSensitive) -join "`n")
  $sha = [System.Security.Cryptography.SHA256]::Create()
  return ([BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($joined))).Replace('-', '').ToLowerInvariant()).Substring(0, 16)
}

# The label on a built image, or '' when the image or the label is missing.
function Get-ImageSourceHash {
  param([Parameter(Mandatory)][string]$Image)
  $v = & docker image inspect --format ('{{index .Config.Labels "' + $script:VoiceHashLabel + '"}}') $Image 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $v) { return '' }
  $v = ($v | Select-Object -First 1).Trim()
  if ($v -eq '<no value>') { return '' }
  return $v
}

# Pure comparison, for the tests: returns the names of the images whose label differs from the checkout.
function Compare-VoiceImageHashes {
  param([hashtable]$Expected, [hashtable]$Actual)
  @($Expected.Keys | Sort-Object | Where-Object { $Actual[$_] -ne $Expected[$_] })
}
