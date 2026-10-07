# The decision table of stop.ps1 (Resolve-StopAction in config.ps1) over a list of fact sets,
# printed as JSON for the kit's unit test (scripts/test-kit/test/stop-decision.test.mjs).
#
#   pwsh scripts/test-env/stop-decision.cases.ps1 < cases.json
#
# Reads a JSON list on stdin and writes a JSON list of {Action, Message} in the same order. An item
# with the fields of Resolve-StopAction is decided; an item {"RoundTrip": "<ISO 8601>"} writes that
# instant through Write-Starts into a temporary pids.started.json, reads it back with Read-Starts and
# answers {Action: "roundtrip", Message: <the text read back>}. No process is read or touched.
. (Join-Path $PSScriptRoot 'config.ps1')

$text = [Console]::In.ReadToEnd()
$cases = @(ConvertFrom-Json $text)
$out = foreach ($c in $cases) {
  if ($c.PSObject.Properties.Name -contains 'RoundTrip') {
    $dir = Join-Path ([IO.Path]::GetTempPath()) ("kit-starts-" + [Guid]::NewGuid().ToString('n'))
    New-Item -ItemType Directory -Force $dir | Out-Null
    $TestEnv.LogDir = $dir
    $TestEnv.PidFile = Join-Path $dir 'pids.json'
    # ConvertFrom-Json already made the value a DateTime (Local kind); store it and read it back.
    Write-Starts @{ x = $c.RoundTrip }
    $back = Read-Starts
    Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
    [pscustomobject]@{ Action = 'roundtrip'; Message = [string]$back['x'] }
    continue
  }
  $facts = @{}
  foreach ($p in $c.PSObject.Properties) {
    $facts[$p.Name] = if ($p.Name -eq 'Owners') { @($p.Value | ForEach-Object { [int]$_ }) } else { $p.Value }
  }
  $r = Resolve-StopAction $facts
  [pscustomobject]@{ Action = $r.Action; Message = $r.Message }
}
ConvertTo-Json -Compress @($out)
