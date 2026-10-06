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

  Exit codes: 0 done, 1 failed, 3 Claude Desktop is still running, 4 invalid address, 5 done, but
  the installer runs as a different account than the signed-in user (a warning only: the entries
  were written into the wrong profile, so the installer should be run again as the signed-in user).
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
    # A host name or IPv4 address (letters, digits, dots, dashes) or a bracketed IPv6 literal.
    # No spaces, quotes or shell characters.
    return ($Value -match '^[A-Za-z0-9.-]+$') -or ($Value -match '^\[[0-9A-Fa-f:.]+\]$')
}

function Test-BridgePort {
    param([string]$Value)
    # No leading zero (some tools read it as octal), 1 to 65535.
    $n = 0
    return ($Value -match '^[1-9][0-9]{0,4}$') -and [int]::TryParse($Value, [ref]$n) -and $n -le 65535
}

function Get-ClaudeDesktopProcess {
    # Claude Code's CLI is also called claude.exe (and a copy lives under the Store package's
    # Roaming\Claude\claude-code folder), so look at where the program lives: the classic install
    # is under AnthropicClaude, the Microsoft Store build under WindowsApps\Claude_*.
    # This fails closed: a claude.exe whose path cannot be read counts as running.
    # Another Windows user's session (a second logged-in user) has its own config, so only this
    # session's processes count.
    $mySession = (Get-Process -Id $PID).SessionId
    $candidates = @()   # objects with Id, Path and SessionId
    try {
        $procs = Get-CimInstance -ClassName Win32_Process -Filter "Name = 'claude.exe'" -ErrorAction Stop
        foreach ($p in $procs) {
            $candidates += [PSCustomObject]@{ Id = $p.ProcessId; Path = $p.ExecutablePath; SessionId = $p.SessionId }
        }
    }
    catch {
        Write-LogMessage "Process list through WMI failed ($($_.Exception.Message)), using Get-Process." 'WARN'
        foreach ($p in @(Get-Process -Name claude -ErrorAction SilentlyContinue)) {
            $path = $null
            try { $path = $p.Path } catch { $path = $null }
            $candidates += [PSCustomObject]@{ Id = $p.Id; Path = $path; SessionId = $p.SessionId }
        }
    }

    $found = @()
    foreach ($c in $candidates) {
        if ($null -ne $c.SessionId -and [int]$c.SessionId -ne [int]$mySession) { continue }
        if ([string]::IsNullOrWhiteSpace($c.Path)) {
            Write-LogMessage "A claude.exe (process $($c.Id)) has no readable path; counting it as Claude Desktop." 'WARN'
            $found += $c
        }
        elseif ($c.Path -match '\\claude-code\\') { continue }
        elseif ($c.Path -match 'AnthropicClaude|WindowsApps\\Claude_|\\Packages\\Claude_') { $found += $c }
    }
    return $found
}

function Get-OtherAccountName {
    # The Claude Desktop config lives in the profile of the account this script runs as
    # (%APPDATA%). If someone ran the installer with "Run as administrator" and typed another admin
    # account's password, that is not the account they use Claude Desktop with, and the entries land
    # in the wrong profile. The signed-in user is the owner of this session's explorer.exe. Returns
    # that account's name when it differs from the account running the script, else $null. It never
    # throws and stays quiet when it cannot tell (no explorer, no WMI): this is only a warning.
    try {
        $mySession = (Get-Process -Id $PID).SessionId
        $mySid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $explorer = @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'explorer.exe'" -ErrorAction Stop |
            Where-Object { [int]$_.SessionId -eq [int]$mySession }) | Select-Object -First 1
        if (-not $explorer) { return $null }
        $owner = Invoke-CimMethod -InputObject $explorer -MethodName GetOwner -ErrorAction Stop
        $ownerSid = Invoke-CimMethod -InputObject $explorer -MethodName GetOwnerSid -ErrorAction Stop
        if ($ownerSid.ReturnValue -ne 0 -or [string]::IsNullOrWhiteSpace($ownerSid.Sid)) { return $null }
        if ($ownerSid.Sid -eq $mySid) { return $null }
        if ($owner.ReturnValue -eq 0 -and $owner.User) { return ('{0}\{1}' -f $owner.Domain, $owner.User) }
        return $ownerSid.Sid
    }
    catch {
        Write-LogMessage "Could not check which account is signed in ($($_.Exception.Message))." 'WARN'
        return $null
    }
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
    # Writes every one that exists. The classic file is created only when no Store package was
    # found: %APPDATA%\Claude also exists on Store-only PCs (Claude Code lives there).
    $files = [System.Collections.Generic.List[string]]::new()
    $classicFile = Join-Path (Join-Path $env:APPDATA 'Claude') 'claude_desktop_config.json'
    $store = [System.Collections.Generic.List[string]]::new()

    $packagesRoot = Join-Path $env:LOCALAPPDATA 'Packages'
    if (Test-Path $packagesRoot) {
        $packages = Get-ChildItem -Path $packagesRoot -Directory -Filter 'Claude_*' -ErrorAction SilentlyContinue
        foreach ($pkg in $packages) {
            $roaming = Join-Path $pkg.FullName 'LocalCache\Roaming'
            if (Test-Path $roaming) { $store.Add((Join-Path $roaming 'Claude\claude_desktop_config.json')) }
        }
    }

    if ((Test-Path $classicFile) -or $store.Count -eq 0) { $files.Add($classicFile) }
    foreach ($f in $store) { $files.Add($f) }
    return $files
}

function Read-ConfigObject {
    param([string]$Path, [ref]$TextOut)
    # Returns $null for a missing or empty file. Throws for text that is not a JSON object, so a
    # damaged file is never overwritten (the caller leaves it alone). The raw text goes to $TextOut.
    $TextOut.Value = ''
    if (-not (Test-Path $Path)) { return $null }
    # Windows PowerShell 5.1 reads a file without a BOM as ANSI, which garbles every non-ASCII
    # character, so read it as UTF-8 explicitly.
    $text = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    $TextOut.Value = $text
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
    param([string]$Path, $Config, [string]$OriginalText)
    $json = $Config | ConvertTo-Json -Depth 100
    # ConvertTo-Json turns an object nested too deeply into the text "@{...}"; refuse to write that.
    if ($json.Contains('"@{') -and -not $OriginalText.Contains('"@{')) {
        throw 'The settings could not be serialised safely (nested data was flattened). The file was not changed.'
    }
    $null = $json | ConvertFrom-Json   # throws if the text we are about to write is not valid
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    # Write a temporary file next to it, then replace: a crash never leaves a half-written config.
    # UTF-8 without a BOM in both PowerShell versions.
    $tmp = "$Path.tmp"
    try {
        [System.IO.File]::WriteAllText($tmp, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
        Move-Item -Path $tmp -Destination $Path -Force -ErrorAction Stop
    }
    catch {
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
        throw
    }
}

function New-Backup {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    $backup = '{0}.backup-{1}' -f $Path, (Get-Date -Format 'yyyyMMdd-HHmmss-fff')
    Copy-Item -Path $Path -Destination $backup
    Write-LogMessage "Backup: $backup"
    # Keep the newest five (the stamp sorts by time; Copy-Item keeps the source's file time).
    # Only files in exactly the format this script writes; look-alikes made by hand are left alone.
    $pattern = '^' + [regex]::Escape((Split-Path -Leaf $Path)) + '\.backup-\d{8}-\d{6}-\d{3}$'
    $old = @(Get-ChildItem -Path (Split-Path -Parent $Path) -Filter ((Split-Path -Leaf $Path) + '.backup-*') -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -cmatch $pattern } |
        Sort-Object Name -Descending | Select-Object -Skip 5)
    foreach ($f in $old) { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction SilentlyContinue }
    return $backup
}

function Set-FoundryEntries {
    param([string]$Path, [string]$NodeExe, [string]$ClientScript)

    $original = ''
    $config = Read-ConfigObject -Path $Path -TextOut ([ref]$original)
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
        $entryEnv['MCP_CONTROL_HOST'] = $script:HostValue
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
        Save-Config -Path $Path -Config $config -OriginalText $original
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
    $original = ''
    $config = Read-ConfigObject -Path $Path -TextOut ([ref]$original)
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
        Save-Config -Path $Path -Config $config -OriginalText $original
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
        $task = $client.ConnectAsync($script:HostValue, [int]$BridgePort)
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
            Write-LogMessage "Invalid bridge address: '$BridgeHost' (letters, digits, dots and dashes, or an IPv6 literal in brackets)" 'ERROR'
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
        # An IPv6 literal is written without its brackets (the client takes a bare host).
        $script:HostValue = $BridgeHost.Trim('[', ']')
        Write-LogMessage "Bridge: ${script:HostValue}:${BridgePort}"
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
        # Only a warning: the entries were written, but into this account's profile.
        if (-not $ConfigPath) {
            $other = Get-OtherAccountName
            if ($other) {
                Write-LogMessage ("This installer runs as '{0}', but '{1}' is signed in. Claude Desktop reads its settings from the signed-in user's profile, so it will not see the new entries. Run the installer again without 'Run as administrator' (as {1})." -f [System.Security.Principal.WindowsIdentity]::GetCurrent().Name, $other) 'WARN'
                exit 5
            }
        }
    }
    exit 0
}
catch {
    Write-LogMessage "Failed: $($_.Exception.Message)" 'ERROR'
    Write-LogMessage "Details: $LogFile" 'ERROR'
    exit 1
}
