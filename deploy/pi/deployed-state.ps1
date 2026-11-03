# Runs the read-only deployed-state check on the Pi (deploy/pi/deployed-state.sh) and fills in what main has:
# the repo's version and the sha256 of scripts/pi/remote/assistant-gm.mjs. Changes nothing on the Pi.
#   .\deploy\pi\deployed-state.ps1            # ssh foundry-pi
#   .\deploy\pi\deployed-state.ps1 -Target other-host
param([string]$Target = 'foundry-pi')

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$version = (Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
$sha = (Get-FileHash -Algorithm SHA256 (Join-Path $repo 'scripts\pi\remote\assistant-gm.mjs')).Hash.ToLower()

# bash -s reads the script from stdin. PowerShell ends piped text with CRLF, so the Pi strips every CR first.
$script = (Get-Content (Join-Path $PSScriptRoot 'deployed-state.sh') -Raw) -replace "`r`n", "`n"
$script | ssh $Target "tr -d '\r' | EXPECT_VERSION=$version EXPECT_ASSISTANT_GM_SHA256=$sha bash -s"
exit $LASTEXITCODE
