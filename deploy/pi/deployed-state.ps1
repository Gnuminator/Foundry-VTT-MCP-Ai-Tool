# Runs the read-only deployed-state check on the Pi (deploy/pi/deployed-state.sh) and fills in what the repo has: the
# newest release tag (the Pi runs release tags, D-126), how many main commits come after it, and the sha256 of
# scripts/pi/remote/assistant-gm.mjs as the tag (or main) has it, never the checked-out branch. Changes nothing on the Pi.
#   .\deploy\pi\deployed-state.ps1            # ssh foundry-pi
#   .\deploy\pi\deployed-state.ps1 -Target other-host
param([string]$Target = 'foundry-pi', [string]$Remote = 'aitool')

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')

# Newest plain vX.Y.Z tag by version, as stage 5 picks it. Native commands run with Continue: Windows PowerShell 5.1
# turns a native command's stderr into a terminating error under Stop.
$ErrorActionPreference = 'Continue'
$tag = git -C $repo ls-remote --tags --refs $Remote 'v*' |
  ForEach-Object { ($_ -split 'refs/tags/')[1] } |
  Where-Object { $_ -match '^v\d+\.\d+\.\d+$' } |
  Sort-Object { [version]($_ -replace '^v', '') } |
  Select-Object -Last 1
if (-not $tag) {
  Write-Warning "No release tag came back from '$Remote' (git ls-remote failed or found no vX.Y.Z tag): the build lines will not compare the deployed ref."
}
$ahead = ''
$fetchedMain = $false
git -C $repo fetch -q $Remote main 2>$null
if ($LASTEXITCODE -eq 0) { $fetchedMain = $true }
if ($tag) {
  git -C $repo fetch -q $Remote "refs/tags/${tag}:refs/tags/${tag}" 2>$null
  $n = git -C $repo rev-list --count "${tag}..$Remote/main" 2>$null
  if ($LASTEXITCODE -eq 0) { $ahead = $n }
}

# sha256 of the helper from the git object, byte for byte (no line-ending or branch surprises from the working tree).
function Get-GitBlobSha256([string]$Ref, [string]$Path) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'git'
  $psi.Arguments = "-C `"$repo`" show ${Ref}:${Path}"
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $p = [System.Diagnostics.Process]::Start($psi)
  $ms = New-Object System.IO.MemoryStream
  $p.StandardOutput.BaseStream.CopyTo($ms)
  $null = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  if ($p.ExitCode -ne 0) { return $null }
  $hash = [System.Security.Cryptography.SHA256]::Create().ComputeHash($ms.ToArray())
  return ([BitConverter]::ToString($hash) -replace '-', '').ToLower()
}
$helperPath = 'scripts/pi/remote/assistant-gm.mjs'
$sha = ''
$source = ''
if ($tag) {
  $sha = Get-GitBlobSha256 $tag $helperPath
  if ($sha) { $source = "the $tag copy of assistant-gm.mjs" }
}
if (-not $sha -and $fetchedMain) {
  $sha = Get-GitBlobSha256 "$Remote/main" $helperPath
  if ($sha) { $source = "the $Remote/main copy of assistant-gm.mjs" }
}
if (-not $sha) {
  Write-Warning 'Could not read assistant-gm.mjs from the release tag or main: the helper is not compared.'
  $sha = ''
}
$ErrorActionPreference = 'Stop'

# bash -s reads the script from stdin. PowerShell ends piped text with CRLF, so the Pi strips every CR first.
$script = (Get-Content (Join-Path $PSScriptRoot 'deployed-state.sh') -Raw) -replace "`r`n", "`n"
$script | ssh $Target "tr -d '\r' | EXPECT_REF=$tag EXPECT_MAIN_AHEAD=$ahead EXPECT_ASSISTANT_GM_SHA256=$sha EXPECT_ASSISTANT_GM_SOURCE='$source' bash -s"
exit $LASTEXITCODE
