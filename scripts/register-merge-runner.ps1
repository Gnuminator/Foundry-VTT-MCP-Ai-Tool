# Registers (or removes) the merge runner as a Windows scheduled task at logon (D-140, D-141).
#
#   pwsh scripts/register-merge-runner.ps1            start the runner at every logon
#   pwsh scripts/register-merge-runner.ps1 -WhatIf    show what it would register
#   pwsh scripts/register-merge-runner.ps1 -Remove
#
# The task "Foundry AI Tool merge runner" runs `scripts/merge-runner.mjs` from the main checkout
# (also when this runs from a worktree) with the portable Node 24, only while you are logged on (no
# stored password), in a hidden console, and appends its output to
# %USERPROFILE%\.foundry-ai-tool\merge-runner.log. It has no time limit: the runner watches the
# Backlog all day and exits only at the merge train limit, on a red main or on a gate checkout
# problem (each posts one #pr-log line). Start it again by hand with
#   Start-ScheduledTask -TaskName 'Foundry AI Tool merge runner'
# A second copy exits at once (the runner's lock file), and the task ignores a second start.
[CmdletBinding(SupportsShouldProcess)]
param(
  [switch]$Remove
)
. (Join-Path $PSScriptRoot 'test-env' 'config.ps1')

$name = 'Foundry AI Tool merge runner'
if ($Remove) {
  if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
    if ($PSCmdlet.ShouldProcess($name, 'Remove the scheduled task')) {
      Unregister-ScheduledTask -TaskName $name -Confirm:$false
      Write-Host "Removed the scheduled task '$name'."
    }
  } else {
    Write-Host "No scheduled task '$name'."
  }
  exit 0
}

# The main checkout, also when this runs from a worktree (.claude\worktrees\<name>).
$repo = $RepoRoot -replace '[\\/]\.claude[\\/]worktrees[\\/].*$', ''
$script = Join-Path $repo 'scripts' 'merge-runner.mjs'
if (-not (Test-Path $script)) { throw "No $script in the main checkout; pull main there after the merge runner PR merged." }
$gate = "$repo-gate"
if (-not (Test-Path $gate)) {
  if ($PSCmdlet.ShouldProcess($gate, 'Create the gate checkout (git worktree add --detach aitool/main)')) {
    git -C $repo fetch -q aitool main
    git -C $repo worktree add --detach $gate aitool/main
    if ($LASTEXITCODE -ne 0) { throw "Could not create the gate checkout $gate" }
  }
}
if (-not (Test-Path (Join-Path $gate 'node_modules'))) {
  Write-Warning "The gate checkout $gate has no node_modules yet; the runner runs npm ci there on its first merge."
}
$node = Get-NodeExe
$logDir = Join-Path $env:USERPROFILE '.foundry-ai-tool'
$log = Join-Path $logDir 'merge-runner.log'

# conhost --headless: the console exists (the runner still gets Ctrl+Break and close signals) but no
# window opens.
$command = "`"$node`" `"$script`" >> `"$log`" 2>&1"
$action = New-ScheduledTaskAction -Execute 'conhost.exe' `
  -Argument "--headless cmd.exe /d /s /c `"$command`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
if ($PSCmdlet.ShouldProcess($name, "Register: at logon, $script, log $log")) {
  New-Item -ItemType Directory -Force $logDir | Out-Null
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings `
    -Principal $principal -Description 'Foundry AI Tool: the merge runner (D-140) merges ready PRs through the gate.' -Force | Out-Null
  Write-Host "Registered '$name': at logon, $script, log $log. Start it now with Start-ScheduledTask -TaskName '$name'."
}
