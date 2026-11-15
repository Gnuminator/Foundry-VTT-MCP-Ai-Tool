# Dot-sourced by scripts/plan-b/connectors.ps1 and scripts/desktop/repoint-connectors.ps1.
# Claude Desktop rewrites its config file when it quits, which would undo a change made while it runs,
# so both scripts refuse to write then (a dry run is fine). The process check is the installer's own
# (Get-ClaudeDesktopProcess in installer/nsis/configure-claude.ps1), taken from that file so the two
# never disagree about what counts as Claude Desktop. That file runs its installer when executed, so it
# is parsed, not dot-sourced.

if (-not (Get-Command Write-LogMessage -ErrorAction SilentlyContinue)) {
  function Write-LogMessage { param([string]$Message, [string]$Level = 'INFO') Write-Host "[$Level] $Message" }
}
# Loaded on first use, not when this file is dot-sourced, so a dry run works without the installer file.
function Import-ClaudeDesktopProcessCheck {
  if (Get-Command Get-ClaudeDesktopProcess -ErrorAction SilentlyContinue) { return }
  $installerScript = Join-Path $PSScriptRoot '..\..\installer\nsis\configure-claude.ps1'
  if (-not (Test-Path -LiteralPath $installerScript)) { throw "cannot find $installerScript, so Claude Desktop cannot be checked: nothing was changed" }
  $parseErrors = $null
  $parsedInstaller = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path -LiteralPath $installerScript).Path, [ref]$null, [ref]$parseErrors)
  if ($parseErrors -and $parseErrors.Count) { throw "cannot check Claude Desktop: $installerScript has a parse error ($($parseErrors[0].Message)): nothing was changed" }
  $processCheck = $parsedInstaller.FindAll({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $a.Name -eq 'Get-ClaudeDesktopProcess' }, $true) | Select-Object -First 1
  if (-not $processCheck) { throw "Get-ClaudeDesktopProcess is missing from $installerScript, so Claude Desktop cannot be checked: nothing was changed" }
  # Defined in the global scope: a function made inside this function would vanish when it returns.
  Invoke-Expression ($processCheck.Extent.Text -replace '^function\s+Get-ClaudeDesktopProcess', 'function global:Get-ClaudeDesktopProcess')
}

# Throws while Claude Desktop runs. Call it before anything is written, and not on a dry run.
function Assert-ClaudeDesktopClosed {
  Import-ClaudeDesktopProcessCheck
  $running = @(Get-ClaudeDesktopProcess)
  if ($running.Count) {
    throw "refused: Claude Desktop is running (process $(($running | ForEach-Object { $_.Id }) -join ', ')). It rewrites its config file when it quits, which would undo this change. Quit it from the tray icon (Quit), run this again, then start it. Nothing was changed."
  }
}
