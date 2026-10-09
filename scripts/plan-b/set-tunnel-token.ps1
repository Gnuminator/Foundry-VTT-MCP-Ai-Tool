#Requires -Version 7
<#
.SYNOPSIS
  Save the spare Cloudflare tunnel's token for Plan B (docs/dev/PLAN-B.md, step "Spare tunnel").
  YOU run this, in your own PowerShell window: Claude never types or sees the token.

.DESCRIPTION
  Part C must be live first (your domain in Cloudflare, Waiting item 13). In Zero Trust create a
  second tunnel named foundry-pc (Windows, 64-bit) and copy its token, or the whole install command
  it shows: this script picks out the token. Do not run Cloudflare's command itself (it would install
  an always-on Windows service).

  The token is saved encrypted for your Windows user on this PC (DPAPI) in
  %APPDATA%\foundry-ai-tool\plan-b-tunnel.token, readable by you only. start.ps1 -Tunnel reads it and
  hands it to cloudflared as an environment variable; it is never printed or logged.

.EXAMPLE
  .\scripts\plan-b\set-tunnel-token.ps1
  .\scripts\plan-b\set-tunnel-token.ps1 -Remove
#>
[CmdletBinding()]
param([switch]$Remove)

. (Join-Path $PSScriptRoot 'lib.ps1')
$file = $PlanBDefaults.TunnelTokenFile
if ($Remove) {
  if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force; Write-Host "removed $file" } else { Write-Host 'no token saved' }
  exit 0
}

$secure = Read-Host -AsSecureString 'Paste the foundry-pc tunnel token (or the whole install command), then Enter'
$plain = [System.Net.NetworkCredential]::new('', $secure).Password
# Cloudflare's tokens are one long base64 text (starting eyJ); pick it out of a pasted command.
$m = [regex]::Match($plain, 'eyJ[A-Za-z0-9+/=_-]{40,}')
$plain = $null
if (-not $m.Success) { throw 'that does not look like a tunnel token (a long text starting with eyJ); nothing saved' }
$token = ConvertTo-SecureString $m.Value -AsPlainText -Force
New-Item -ItemType Directory -Force -Path (Split-Path $file) | Out-Null
$token | ConvertFrom-SecureString | Set-Content -LiteralPath $file
Protect-PlanBPath $file
Write-Host "Saved (encrypted for your Windows user) in $file."
Write-Host 'Test it with a rehearsal: .\scripts\plan-b\start.ps1 -GameNight -IgnorePi -Tunnel -PublicHost <the plan-b name> (runbook, "Rehearsal").'
