#Requires -Version 7
# Plan B's Assistant GM (started by start.ps1, stopped by stop.ps1): runs the Pi's driver,
# scripts/pi/remote/assistant-gm.mjs, and starts it again 10 seconds after it exits, as systemd does
# on the Pi. The login comes from <Root>\secrets\assistant-gm.env (restored from the Pi's backup)
# and goes to the driver as environment variables of this process only; it is never printed.
# start.ps1 sets TOOL_APP, FOUNDRY_URL, CHROMIUM and GM_BROWSER_PROFILE.
param(
  [Parameter(Mandatory)] [string]$Node,
  [Parameter(Mandatory)] [string]$Root
)

. (Join-Path $PSScriptRoot 'lib.ps1')
$L = Get-PlanBLayout $Root
$driver = Join-Path $PlanBRepoRoot 'scripts' 'pi' 'remote' 'assistant-gm.mjs'
$login = ConvertFrom-EnvText (Get-Content -LiteralPath $L.AssistantEnv -Raw)
foreach ($k in 'ASSISTANT_GM_USER', 'ASSISTANT_GM_PASSWORD') {
  if (-not $login.ContainsKey($k)) { Write-Host "[plan-b] $($L.AssistantEnv) has no $k"; exit 1 }
  [Environment]::SetEnvironmentVariable($k, $login[$k])
}
$login = $null
New-Item -ItemType Directory -Force -Path $env:GM_BROWSER_PROFILE | Out-Null

while ($true) {
  Write-Host "[plan-b] $(Get-Date -Format s) starting the Assistant GM"
  & $Node $driver run
  Write-Host "[plan-b] $(Get-Date -Format s) the Assistant GM exited ($LASTEXITCODE); again in 10 s"
  Start-Sleep -Seconds 10
}
