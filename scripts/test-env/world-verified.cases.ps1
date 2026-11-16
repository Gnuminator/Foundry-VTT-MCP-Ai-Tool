# Update-WorldVerified (config.ps1) over a list of world.json texts, printed as JSON for the unit
# test scripts/test-kit/test/world-verified.test.mjs.
#
#   pwsh scripts/test-env/world-verified.cases.ps1 < cases.json
#
# stdin: a JSON list of {World: "<world.json text>", App: "<app version>"}. stdout: a list of
# {Changed, Version, Warned, Text, Backup} in the same order, run on a temporary world folder. No real world is read.
. (Join-Path $PSScriptRoot 'config.ps1')

$cases = @(ConvertFrom-Json ([Console]::In.ReadToEnd()))
$out = foreach ($c in $cases) {
  $dir = Join-Path ([IO.Path]::GetTempPath()) ("world-verified-" + [Guid]::NewGuid().ToString('n'))
  New-Item -ItemType Directory -Force $dir | Out-Null
  $file = Join-Path $dir 'world.json'
  [IO.File]::WriteAllText($file, [string]$c.World)
  # Warnings (stream 3) are collected apart so stdout stays one JSON document.
  $result = @(Update-WorldVerified $dir ([string]$c.App) 3>&1)
  $warnings = @($result | Where-Object { $_ -is [System.Management.Automation.WarningRecord] })
  $changed = @($result | Where-Object { $_ -isnot [System.Management.Automation.WarningRecord] }) | Select-Object -First 1
  [pscustomobject]@{
    Changed = [bool]$changed
    Version = [string]$changed
    Warned  = ($warnings.Count -gt 0)
    Text    = [IO.File]::ReadAllText($file)
    Backup  = (Test-Path "$file.bak-verified")
  }
  Remove-Item -Recurse -Force $dir
}
ConvertTo-Json -InputObject @($out) -Depth 4 -Compress
