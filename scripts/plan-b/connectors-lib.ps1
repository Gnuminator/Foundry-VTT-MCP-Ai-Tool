# Pure text functions for connectors.ps1 (dot-source; tested by scripts/plan-b/plan-b.test.mjs).
# They edit the two values in place with a regular expression instead of rewriting the JSON, so
# the rest of Claude Desktop's config (its own keys, order and spacing) stays byte for byte.

$ConnectorHostPattern = '("MCP_CONTROL_HOST"\s*:\s*")([^"]*)(")'
$ConnectorPortPattern = '("MCP_CONTROL_PORT"\s*:\s*")([^"]*)(")'

# The current target: @{ Host; Port; Count } from the first connector (Count = how many have one).
function Get-ConnectorTarget([string]$Text) {
  $hosts = [regex]::Matches($Text, $ConnectorHostPattern)
  $ports = [regex]::Matches($Text, $ConnectorPortPattern)
  if ($hosts.Count -eq 0) { return @{ Host = $null; Port = $null; Count = 0 } }
  $port = if ($ports.Count) { [int]$ports[0].Groups[2].Value } else { $null }
  return @{ Host = $hosts[0].Groups[2].Value; Port = $port; Count = $hosts.Count }
}

# The text with every MCP_CONTROL_HOST and MCP_CONTROL_PORT set; Changed = how many hosts it set.
function Set-ConnectorTarget([string]$Text, [string]$HostName, [int]$Port) {
  if ($HostName -notmatch '^[A-Za-z0-9.:-]+$') { throw "not a host name or address: $HostName" }
  $count = [regex]::Matches($Text, $ConnectorHostPattern).Count
  $out = [regex]::Replace($Text, $ConnectorHostPattern, { param($m) $m.Groups[1].Value + $HostName + $m.Groups[3].Value })
  $out = [regex]::Replace($out, $ConnectorPortPattern, { param($m) $m.Groups[1].Value + [string]$Port + $m.Groups[3].Value })
  return @{ Text = $out; Changed = $count }
}
