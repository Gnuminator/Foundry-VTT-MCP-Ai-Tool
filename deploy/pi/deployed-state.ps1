# Runs the read-only deployed-state check on the Pi (deploy/pi/deployed-state.sh) and fills in what main has: the
# newest release tag (the Pi runs release tags, D-126), how many main commits come after it, and the sha256 of
# scripts/pi/remote/assistant-gm.mjs. Changes nothing on the Pi.
#   .\deploy\pi\deployed-state.ps1            # ssh foundry-pi
#   .\deploy\pi\deployed-state.ps1 -Target other-host
param([string]$Target = 'foundry-pi', [string]$Remote = 'aitool')

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$sha = (Get-FileHash -Algorithm SHA256 (Join-Path $repo 'scripts\pi\remote\assistant-gm.mjs')).Hash.ToLower()

# Newest plain vX.Y.Z tag by version, as stage 5 picks it.
$tag = git -C $repo ls-remote --tags --refs $Remote 'v*' |
  ForEach-Object { ($_ -split 'refs/tags/')[1] } |
  Where-Object { $_ -match '^v\d+\.\d+\.\d+$' } |
  Sort-Object { [version]($_ -replace '^v', '') } |
  Select-Object -Last 1
$ahead = ''
if ($tag) {
  git -C $repo fetch -q $Remote "refs/tags/${tag}:refs/tags/${tag}" 2>$null
  git -C $repo fetch -q $Remote main 2>$null
  $n = git -C $repo rev-list --count "${tag}..$Remote/main" 2>$null
  if ($LASTEXITCODE -eq 0) { $ahead = $n }
}

# bash -s reads the script from stdin. PowerShell ends piped text with CRLF, so the Pi strips every CR first.
$script = (Get-Content (Join-Path $PSScriptRoot 'deployed-state.sh') -Raw) -replace "`r`n", "`n"
$script | ssh $Target "tr -d '\r' | EXPECT_REF=$tag EXPECT_MAIN_AHEAD=$ahead EXPECT_ASSISTANT_GM_SHA256=$sha bash -s"
exit $LASTEXITCODE
