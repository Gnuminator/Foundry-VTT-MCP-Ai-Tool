<#
.SYNOPSIS
  Points Claude Desktop at a Foundry AI Tool bridge that runs on another machine.

.DESCRIPTION
  Adds (or updates) the five Foundry AI Tool entries in Claude Desktop's config file
  (foundry-mcp, foundry-mcp-play, -prep, -build, -admin). Every entry runs the bundled client
  with MCP_CONTROL_HOST, MCP_CONTROL_PORT and MCP_NO_SPAWN=1, so it only connects to the remote
  bridge and never starts a backend on this PC. Every other entry and key in the file is kept.
  A timestamped backup is made before each write.

  -Uninstall removes only those five entries.

  Exit codes: 0 done, 1 failed, 3 Claude Desktop is still running, 4 invalid address.
#>
[CmdletBinding(DefaultParameterSetName = 'Configure')]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'Configure')]
    [string]$InstallDir,

    [Parameter(Mandatory = $true, ParameterSetName = 'Configure')]
    [string]$BridgeHost,

    [Parameter(ParameterSetName = 'Configure')]
    [string]$BridgePort = '31414',

    [Parameter(Mandatory = $true, ParameterSetName = 'Uninstall')]
    [switch]$Uninstall,

    # Write only this file (for tests). Skips the "is Claude running" check.
    [string]$ConfigPath,

    # How long to wait for Claude Desktop to quit before giving up (exit 3). 0 = do not wait.
    [int]$WaitSeconds = 0
)

$ErrorActionPreference = 'Stop'

$LogFile = Join-Path $env:TEMP 'foundry-mcp-claude-config.log'

# Entry name -> tool set it serves (tool-sets.ts). "foundry-mcp" keeps its old name and serves core.
$ToolSetEntries = [ordered]@{
    'foundry-mcp'       = 'core'
    'foundry-mcp-play'  = 'play'
    'foundry-mcp-prep'  = 'prep'
    'foundry-mcp-build' = 'build'
    'foundry-mcp-admin' = 'admin'
}

function Write-LogMessage {
    param([string]$Message, [string]$Level = 'INFO')
    $line = '[{0}] [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue
}

function Test-BridgeHost {
    param([string]$Value)
    # Host name, IPv4 or bracketed IPv6. No spaces, quotes or shell characters.
    return ($Value -match '^[A-Za-z0-9._:\[\]-]+$')
}

function Test-BridgePort {
    param([string]$Value)
    $n = 0
    return ($Value -match '^[0-9]{1,5}$') -and [int]::TryParse($Value, [ref]$n) -and $n -ge 1 -and $n -le 65535
}

function Get-ClaudeDesktopProcess {
    # Claude Code's CLI is also called claude.exe, so look at where the program lives: the classic
    # install is under AnthropicClaude, the Microsoft Store build under WindowsApps\Claude_*.
    $found = @()
    try {
        $procs = Get-CimInstance -ClassName Win32_Process -Filter "Name = 'claude.exe'" -ErrorAction Stop
        foreach ($p in $procs) {
            if ($p.ExecutablePath -and $p.ExecutablePath -match 'AnthropicClaude|WindowsApps\\Claude_|\\Packages\\Claude_') {
                $found += $p
            }
        }
    }
    catch {
        Write-LogMessage "Could not list processes: $($_.Exception.Message)" 'WARN'
    }
    return $found
}

function Wait-ForClaudeToQuit {
    # Claude Desktop rewrites its config when it exits, which would undo our change, so we never
    # write while it runs and never kill it: the user quits it from the tray icon.
    $deadline = (Get-Date).AddSeconds($WaitSeconds)
    while ($true) {
        $running = Get-ClaudeDesktopProcess
        if (-not $running -or $running.Count -eq 0) { return $true }
        if ((Get-Date) -ge $deadline) { return $false }
        Start-Sleep -Seconds 2
    }
}

function Get-ClaudeConfigFiles {
    # Every config file Claude Desktop may read: the classic %APPDATA%\Claude one and, for the
    # Microsoft Store build, the virtualised copy under Packages\Claude_*\LocalCache\Roaming.
    # Writes every one that exists; when none does, the classic one is created.
    $files = [System.Collections.Generic.List[string]]::new()

    $classicDir = Join-Path $env:APPDATA 'Claude'
    $classicFile = Join-Path $classicDir 'claude_desktop_config.json'
    if ((Test-Path $classicFile) -or (Test-Path $classicDir)) { $files.Add($classicFile) }

    $packagesRoot = Join-Path $env:LOCALAPPDATA 'Packages'
    if (Test-Path $packagesRoot) {
        $packages = Get-ChildItem -Path $packagesRoot -Directory -Filter 'Claude_*' -ErrorAction SilentlyContinue
        foreach ($pkg in $packages) {
            $roaming = Join-Path $pkg.FullName 'LocalCache\Roaming'
            if (Test-Path $roaming) {
                $files.Add((Join-Path $roaming 'Claude\claude_desktop_config.json'))
            }
        }
    }

    if ($files.Count -eq 0) { $files.Add($classicFile) }
    return $files
}

function Read-ConfigObject {
    param([string]$Path)
    # Returns $null for a missing or empty file. Throws for text that is not a JSON object, so a
    # damaged file is never overwritten (the caller leaves it alone).
    if (-not (Test-Path $Path)) { return $null }
    $text = Get-Content -Path $Path -Raw -ErrorAction Stop
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }
    try {
        $obj = $text | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        throw "$Path is not valid JSON ($($_.Exception.Message)). Fix or delete it, then run the installer again."
    }
    if ($obj -isnot [System.Management.Automation.PSCustomObject]) {
        throw "$Path does not hold a JSON object."
    }
    return $obj
}

function Set-Prop {
    param($Object, [string]$Name, $Value)
    if ($Object.PSObject.Properties.Name -contains $Name) {
        $Object.$Name = $Value
    }
    else {
        $Object | Add-Member -MemberType NoteProperty -Name $Name -Value $Value
    }
}

function Save-Config {
    param([string]$Path, $Config)
    $json = $Config | ConvertTo-Json -Depth 20
    $null = $json | ConvertFrom-Json   # throws if the text we are about to write is not valid
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [System.IO.File]::WriteAllText($Path, $json + "`n", [System.Text.UTF8Encoding]::new($false))
}

function New-Backup {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    $backup = '{0}.backup-{1}' -f $Path, (Get-Date -Format 'yyyyMMdd-HHmmss-fff')
    Copy-Item -Path $Path -Destination $backup
    Write-LogMessage "Backup: $backup"
    return $backup
}

function Set-FoundryEntries {
    param([string]$Path, [string]$NodeExe, [string]$ClientScript)

    $config = Read-ConfigObject -Path $Path
    $backup = New-Backup -Path $Path
    if ($null -eq $config) { $config = [PSCustomObject]@{} }

    if (-not ($config.PSObject.Properties.Name -contains 'mcpServers') -or $null -eq $config.mcpServers) {
        Set-Prop $config 'mcpServers' ([PSCustomObject]@{})
    }
    $servers = $config.mcpServers

    # Settings the user added to the old "foundry-mcp" entry (for example FOUNDRY_AI_OBSIDIAN_DIR)
    # go to every entry that lacks them.
    $sharedEnv = [ordered]@{}
    if ($servers.PSObject.Properties.Name -contains 'foundry-mcp' -and $servers.'foundry-mcp'.env) {
        foreach ($prop in $servers.'foundry-mcp'.env.PSObject.Properties) {
            if ($prop.Name -notin 'FOUNDRY_AI_TOOL_SETS', 'MCP_CONTROL_HOST', 'MCP_CONTROL_PORT', 'MCP_NO_SPAWN') {
                $sharedEnv[$prop.Name] = $prop.Value
            }
        }
    }

    foreach ($name in $ToolSetEntries.Keys) {
        $entryEnv = [ordered]@{}
        foreach ($k in $sharedEnv.Keys) { $entryEnv[$k] = $sharedEnv[$k] }
        if ($servers.PSObject.Properties.Name -contains $name -and $servers.$name.env) {
            foreach ($prop in $servers.$name.env.PSObject.Properties) { $entryEnv[$prop.Name] = $prop.Value }
        }
        $entryEnv['FOUNDRY_AI_TOOL_SETS'] = $ToolSetEntries[$name]
        $entryEnv['MCP_CONTROL_HOST'] = $BridgeHost
        $entryEnv['MCP_CONTROL_PORT'] = $BridgePort
        $entryEnv['MCP_NO_SPAWN'] = '1'

        $entry = [PSCustomObject]@{
            command = $NodeExe
            args    = @($ClientScript)
            env     = [PSCustomObject]$entryEnv
        }
        Set-Prop $servers $name $entry
    }

    try {
        Save-Config -Path $Path -Config $config
    }
    catch {
        if ($backup) { Copy-Item -Path $backup -Destination $Path -Force }
        throw "Could not write ${Path}: $($_.Exception.Message)"
    }
    Write-LogMessage "Configured: $Path"
}

function Remove-FoundryEntries {
    param([string]$Path)
    if (-not (Test-Path $Path)) { Write-LogMessage "No config file at $Path"; return }
    $config = Read-ConfigObject -Path $Path
    if ($null -eq $config -or -not ($config.PSObject.Properties.Name -contains 'mcpServers') -or $null -eq $config.mcpServers) {
        Write-LogMessage "No mcpServers in $Path, nothing to remove"
        return
    }
    $present = @($ToolSetEntries.Keys | Where-Object { $config.mcpServers.PSObject.Properties.Name -contains $_ })
    if ($present.Count -eq 0) {
        Write-LogMessage "None of the Foundry AI Tool entries are in $Path"
        return
    }
    $backup = New-Backup -Path $Path
    foreach ($name in $present) { $config.mcpServers.PSObject.Properties.Remove($name) }
    try {
        Save-Config -Path $Path -Config $config
    }
    catch {
        if ($backup) { Copy-Item -Path $backup -Destination $Path -Force }
        throw "Could not write ${Path}: $($_.Exception.Message)"
    }
    Write-LogMessage "Removed $($present.Count) entries from $Path"
}

function Test-BridgeReachable {
    # Informational only: the bridge may be reachable only once the private network (Tailscale)
    # is up, so a failure here is a warning, never an error.
    try {
        $client = [System.Net.Sockets.TcpClient]::new()
        $task = $client.ConnectAsync($BridgeHost, [int]$BridgePort)
        $ok = $task.Wait(4000) -and $client.Connected
        $client.Close()
        return $ok
    }
    catch { return $false }
}

try {
    Write-LogMessage '=============================================='
    Write-LogMessage ("Foundry AI Tool, Claude Desktop {0}" -f $(if ($Uninstall) { 'cleanup' } else { 'setup' }))

    if ($Uninstall) {
        # no address to check
    }
    else {
        if (-not (Test-BridgeHost $BridgeHost)) {
            Write-LogMessage "Invalid bridge address: '$BridgeHost' (letters, digits, dots, dashes and colons only)" 'ERROR'
            exit 4
        }
        if (-not (Test-BridgePort $BridgePort)) {
            Write-LogMessage "Invalid bridge port: '$BridgePort' (1 to 65535)" 'ERROR'
            exit 4
        }
        $nodeExe = Join-Path $InstallDir 'node.exe'
        $clientScript = Join-Path $InstallDir 'foundry-mcp-client\index.cjs'
        if (-not (Test-Path $nodeExe)) { throw "Node.js runtime not found: $nodeExe" }
        if (-not (Test-Path $clientScript)) { throw "Client not found: $clientScript" }
        Write-LogMessage "Bridge: ${BridgeHost}:${BridgePort}"
    }

    if (-not $ConfigPath) {
        if (-not (Wait-ForClaudeToQuit)) {
            Write-LogMessage 'Claude Desktop is running. Quit it from the tray icon (right-click, Quit), then run this again.' 'WARN'
            exit 3
        }
    }

    $files = if ($ConfigPath) { @($ConfigPath) } else { @(Get-ClaudeConfigFiles) }
    $failures = @()
    foreach ($file in $files) {
        Write-LogMessage "Config file: $file"
        try {
            if ($Uninstall) { Remove-FoundryEntries -Path $file }
            else { Set-FoundryEntries -Path $file -NodeExe $nodeExe -ClientScript $clientScript }
        }
        catch {
            Write-LogMessage $_.Exception.Message 'ERROR'
            $failures += $file
        }
    }
    if ($failures.Count -eq $files.Count) { throw 'No Claude Desktop config file could be updated.' }
    if ($failures.Count -gt 0) { Write-LogMessage "Some files failed: $($failures -join '; ')" 'WARN' }

    if (-not $Uninstall) {
        if (Test-BridgeReachable) { Write-LogMessage 'The bridge answered.' }
        else { Write-LogMessage "The bridge at ${BridgeHost}:${BridgePort} did not answer from this PC. Check the address and that your private network (for example Tailscale) is connected." 'WARN' }
        Write-LogMessage 'Restart Claude Desktop to load the new entries.'
    }
    exit 0
}
catch {
    Write-LogMessage "Failed: $($_.Exception.Message)" 'ERROR'
    Write-LogMessage "Details: $LogFile" 'ERROR'
    exit 1
}
