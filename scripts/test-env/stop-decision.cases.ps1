# The decision table of stop.ps1 (Resolve-StopAction in config.ps1) over a list of fact sets,
# printed as JSON for the kit's unit test (scripts/test-kit/test/stop-decision.test.mjs).
#
#   pwsh scripts/test-env/stop-decision.cases.ps1 < cases.json
#
# Reads a JSON list of fact objects on stdin (the fields of Resolve-StopAction) and writes a JSON
# list of {Action, Message} in the same order. No process is read or touched.
. (Join-Path $PSScriptRoot 'config.ps1')

$text = [Console]::In.ReadToEnd()
$cases = @(ConvertFrom-Json $text)
$out = foreach ($c in $cases) {
  $facts = @{}
  foreach ($p in $c.PSObject.Properties) {
    $facts[$p.Name] = if ($p.Name -eq 'Owners') { @($p.Value | ForEach-Object { [int]$_ }) } else { $p.Value }
  }
  $r = Resolve-StopAction $facts
  [pscustomobject]@{ Action = $r.Action; Message = $r.Message }
}
ConvertTo-Json -Compress @($out)
