#Requires -Version 7
<#
.SYNOPSIS
  Plan B step 2: start Foundry, the bridge, the dashboard and the Assistant GM on this PC from the
  restored backup (docs/dev/PLAN-B.md).

.DESCRIPTION
  Runs restore.ps1's copy in <Root> (default C:\FoundryPlanB), in the background, with logs in
  <Root>\logs. The services are the Pi's, run the Pi's way:
    foundry      Foundry with --dataPath <Root>\data and the world
    bridge       the MCP bridge (control and Foundry link on 127.0.0.1), vault <Root>\tool\vault
    dashboard    the co-GM dashboard on 127.0.0.1, state <Root>\tool\dashboard
    assistant-gm a headless Edge logged into the world as the Assistant GM, so the module's link to
                 the bridge holds with no GM browser open (restarted when it exits, as systemd
                 does on the Pi)
    tunnel       with -Tunnel: the spare Cloudflare tunnel (only once Part C is live; runbook step 5)

  Rehearsal (the default) uses ports no other part of this PC uses: Foundry 30100, bridge 31614,
  link 31615, dashboard 3300; the module copy in <Root> gets a default port flag for the link.
  -GameNight uses the Pi's ports (30000, 31414, 31415, 3000) and refuses while the Pi's Foundry still
  answers, so two copies of the world never run at once. It also marks the data as played, so
  stop.ps1 -Clean and restore.ps1 refuse to delete it before it is back on the Pi.

  Refuses when a port is taken, when the Foundry here is not the version the world was last opened
  with, or when Plan B already runs. Never touches C:\FoundryTest or the Pi.

.EXAMPLE
  .\scripts\plan-b\start.ps1
  .\scripts\plan-b\start.ps1 -GameNight -Tunnel -PublicHost plan-b.example.com
#>
[CmdletBinding()]
param(
  [string]$Root = '',
  [switch]$GameNight,
  # The spare tunnel (Part C). Needs set-tunnel-token.ps1 first.
  [switch]$Tunnel,
  # The spare tunnel's public name: Foundry builds its links with it (as the Pi does after Part C).
  [string]$PublicHost = '',
  # Start even though the Pi's Foundry answers (only when you are sure it is not used tonight).
  [switch]$IgnorePi,
  [switch]$NoAssistantGm
)

. (Join-Path $PSScriptRoot 'lib.ps1')
if (-not $Root) { $Root = $PlanBDefaults.Root }
$L = Get-PlanBLayout $Root
$state = Read-PlanBState $L
if (-not $state -or -not $state.restoredAt) { throw "nothing restored in $Root yet: run restore.ps1 first" }
$World = [string]$state.world
$ports = Get-PlanBPorts -GameNight:$GameNight
if ($Tunnel -and -not $GameNight) { Write-Warning 'the spare tunnel points at port 30000: with rehearsal ports it reaches nothing. Use -GameNight for a full rehearsal of the tunnel.' }
if ($PublicHost -and $PublicHost -notmatch '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$') { throw "-PublicHost must be a host name like plan-b.example.com" }

# --- refusals ---------------------------------------------------------------------------------
if ($state.PSObject.Properties['services'] -and $state.services) {
  foreach ($p in $state.services.PSObject.Properties) {
    $f = @{
      Exists = [bool](Get-Process -Id ([int]$p.Value.pid) -ErrorAction SilentlyContinue)
      StartTime = Get-PlanBStartTime ([int]$p.Value.pid)
      RecordedStart = $p.Value.started
      CommandLine = Get-PlanBCommandLine ([int]$p.Value.pid)
      Marker = $p.Value.log
    }
    if ((Resolve-PlanBStop $f).Action -in 'stop', 'unknown') {
      throw "Plan B already runs ($($p.Name), pid $($p.Value.pid)): see check.ps1, or stop.ps1 first"
    }
  }
}
$problems = Get-PortProblems $ports -GameNight:$GameNight -IsOpen { param($port) Test-PlanBPortOpen $port }
if ($problems.Count) {
  foreach ($p in $problems) { [Console]::Error.WriteLine("REFUSED: $p") }
  exit 1
}
if ($GameNight -and -not $IgnorePi) {
  $up = @($PlanBDefaults.PiAddresses | Where-Object { Test-PlanBPortOpen 30000 $_ 1500 })
  if ($up) {
    [Console]::Error.WriteLine("REFUSED: the Pi's Foundry answers on $($up -join ', '). Plan B is for a Pi that is down; two copies of the world would split the game. If the Pi is up but broken, stop its Foundry first, or use -IgnorePi.")
    exit 1
  }
}
$ver = Test-WorldVersion (Get-PlanBAppBuild $L) (Get-PlanBWorldCoreVersion $L $World)
if (-not $ver.Ok) { throw "refused: $($ver.Message)" }
$standalone = Join-Path $PlanBRepoRoot 'packages' 'mcp-server' 'dist' 'standalone.js'
$server = Join-Path $PlanBRepoRoot 'packages' 'cogm-dashboard' 'dist' 'server.js'
foreach ($f in $standalone, $server) {
  if (-not (Test-Path -LiteralPath $f)) { throw "not built: $f (run npm ci and npm run build in $PlanBRepoRoot)" }
}
$node = Get-PlanBNodeExe $L
$chromium = $null
if (-not $NoAssistantGm) {
  if (-not (Test-Path -LiteralPath $L.AssistantEnv)) { throw "no Assistant GM login in $($L.AssistantEnv) (restore.ps1 brings it); or start with -NoAssistantGm and keep a GM browser open" }
  $chromium = Get-PlanBChromium
  if (-not $chromium) { throw 'no Edge or Chrome found for the Assistant GM; or start with -NoAssistantGm' }
}
$tunnelToken = $null
if ($Tunnel) {
  $cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
  if (-not $cloudflared) { throw 'cloudflared is not installed: winget install Cloudflare.cloudflared (runbook, Part C step)' }
  if (-not (Test-Path -LiteralPath $PlanBDefaults.TunnelTokenFile)) { throw "no tunnel token: run scripts\plan-b\set-tunnel-token.ps1 first (runbook, Part C step)" }
  # DPAPI: only this Windows user on this PC can turn the file back into the token. Never printed.
  $secure = Get-Content -LiteralPath $PlanBDefaults.TunnelTokenFile -Raw | ConvertTo-SecureString
  $tunnelToken = [System.Net.NetworkCredential]::new('', $secure).Password
}

# --- configuration in the Plan B copy ---------------------------------------------------------
New-Item -ItemType Directory -Force -Path $L.LogDir, $L.VaultDir, $L.DashboardStateDir, (Split-Path $L.OptionsFile) | Out-Null
if (Test-Path -LiteralPath $L.ModuleJson) {
  $flag = if ($GameNight) { $null } else { $ports.Link }
  Set-Content -LiteralPath $L.ModuleJson -Value (Set-ModulePortFlag (Get-Content -LiteralPath $L.ModuleJson -Raw) $flag)
} else {
  Write-Warning "the world's data has no $PlanBModuleId module: Foundry runs, the bridge and dashboard get no link"
}
$optionsText = if (Test-Path -LiteralPath $L.OptionsFile) { Get-Content -LiteralPath $L.OptionsFile -Raw } else { '' }
Set-Content -LiteralPath $L.OptionsFile -Value (Update-FoundryOptions $optionsText $ports.Foundry ($L.DataDir -replace '\\', '/') $PublicHost)

# --- start ------------------------------------------------------------------------------------
$services = [ordered]@{}

# Start one service in a hidden cmd.exe that does its own redirection (so this shell never waits
# for it), with extra environment variables for that process only. The wrapper's command line
# holds the log path, which is how stop.ps1 knows it is ours.
function Start-PlanBService([string]$Name, [string]$Command, [hashtable]$EnvVars, [string]$WorkDir) {
  $out = Join-Path $L.LogDir "$Name.out.log"
  $err = Join-Path $L.LogDir "$Name.err.log"
  $saved = @{}
  foreach ($k in $EnvVars.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, [string]$EnvVars[$k]) }
  try {
    $shell = Start-Process -FilePath 'cmd.exe' -WindowStyle Hidden -WorkingDirectory $WorkDir -PassThru `
      -ArgumentList '/d', '/s', '/c', "`"$Command 1>`"$out`" 2>`"$err`" <nul`""
  } finally {
    foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
  }
  $script:services[$Name] = [pscustomobject]@{ pid = $shell.Id; started = (Get-PlanBStartTime $shell.Id); log = $out }
  Set-StateValue $script:state 'services' ([pscustomobject]$script:services)
  Write-PlanBState $L $script:state
}

function Wait-Service([string]$Name, [int]$Port, [int]$Timeout) {
  if (Wait-PlanBPort $Port $Timeout) { Write-Host ('{0,-12} listening on 127.0.0.1:{1}' -f $Name, $Port) }
  else { Write-Host ('{0,-12} NOT listening on {1} after {2} s; see {3}' -f $Name, $Port, $Timeout, (Join-Path $L.LogDir "$Name.err.log")) -ForegroundColor Yellow }
}

Set-StateValue $state 'mode' $(if ($GameNight) { 'game-night' } else { 'rehearsal' })
Set-StateValue $state 'ports' ([pscustomobject]$ports)
Set-StateValue $state 'startedAt' (Get-Date).ToString('o')
if ($GameNight) {
  Set-StateValue $state 'played' $true
  Set-StateValue $state 'playedAt' (Get-Date).ToString('yyyy-MM-dd')
}
Write-PlanBState $L $state

# Foundry locks its data folder and refreshes the lock while it runs; right after a stop the lock is
# still fresh and a new start fails. Wait until it has gone stale.
$lock = Join-Path $L.DataDir 'Config' 'options.json.lock'
$deadline = (Get-Date).AddSeconds(30)
while ((Test-Path $lock) -and ((Get-Date) - (Get-Item $lock).LastWriteTime).TotalSeconds -lt 12 -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 1 }

$main = Join-Path $L.AppDir 'main.js'
Start-PlanBService 'foundry' "`"$node`" `"$main`" --dataPath=`"$($L.DataDir)`" --port=$($ports.Foundry) --noupnp --noupdate --world=$World" @{} $L.AppDir
Start-PlanBService 'bridge' "`"$node`" `"$standalone`" --port $($ports.Control)" @{
  NODE_ENV                = 'production'
  MCP_CONTROL_HOST        = '127.0.0.1'
  MCP_CONTROL_PORT        = $ports.Control
  FOUNDRY_PORT            = $ports.Link
  FOUNDRY_LINK_HOST       = '127.0.0.1'
  FOUNDRY_AI_DATA_DIR     = $L.VaultDir
  # The Obsidian mirror stays off: the GM vault on the Pi is shared by Syncthing, this copy is not.
  FOUNDRY_AI_OBSIDIAN_DIR = ''
  FOUNDRY_AI_FOUNDRY_URL  = "http://127.0.0.1:$($ports.Foundry)"
  FOUNDRY_AI_OPEN_BASE    = "http://localhost:$($ports.Dashboard)"
  LOG_LEVEL               = 'info'
} $PlanBRepoRoot
Start-PlanBService 'dashboard' "`"$node`" `"$server`"" @{
  NODE_ENV                = 'production'
  PORT                    = $ports.Dashboard
  DASHBOARD_HOST          = '127.0.0.1'
  MCP_CONTROL_HOST        = '127.0.0.1'
  MCP_CONTROL_PORT        = $ports.Control
  COGM_STATE_DIR          = $L.DashboardStateDir
  FOUNDRY_AI_OBSIDIAN_DIR = ''
} (Join-Path $PlanBRepoRoot 'packages' 'cogm-dashboard')
Wait-Service 'foundry' $ports.Foundry 120
Wait-Service 'bridge' $ports.Control 30
Wait-Service 'dashboard' $ports.Dashboard 30

if (-not $NoAssistantGm) {
  $loop = Join-Path $PSScriptRoot 'assistant-gm-loop.ps1'
  $pwsh = (Get-Process -Id $PID).Path
  Start-PlanBService 'assistant-gm' "`"$pwsh`" -NoProfile -File `"$loop`" -Node `"$node`" -Root `"$Root`"" @{
    TOOL_APP           = $PlanBRepoRoot
    FOUNDRY_URL        = "http://127.0.0.1:$($ports.Foundry)"
    CHROMIUM           = $chromium
    GM_BROWSER_PROFILE = $L.GmBrowserDir
  } $PlanBRepoRoot
  Write-Host ('{0,-12} started (joins the world within a minute; check.ps1 shows the link)' -f 'assistant-gm')
}

if ($Tunnel) {
  try {
    Start-PlanBService 'tunnel' "`"$($cloudflared.Source)`" tunnel --no-autoupdate run" @{ TUNNEL_TOKEN = $tunnelToken } $Root
  } finally {
    $tunnelToken = $null
  }
  Write-Host ('{0,-12} started (the Cloudflare dashboard shows the foundry-pc tunnel as Healthy within a minute)' -f 'tunnel')
}

Write-Host ''
Write-Host "Plan B ($($state.mode)) runs '$World' from the backup of $(([datetimeoffset]$state.snapshot.time).ToLocalTime().ToString('yyyy-MM-dd HH\:mm'))."
Write-Host "Foundry:   http://localhost:$($ports.Foundry)$(if ($PublicHost) { "   players: https://$PublicHost" })"
Write-Host "Dashboard: http://localhost:$($ports.Dashboard)"
Write-Host 'Check:     .\scripts\plan-b\check.ps1'
