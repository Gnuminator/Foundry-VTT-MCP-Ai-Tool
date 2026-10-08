# Registers (or removes) the overnight kit run as a Windows scheduled task (D-102 line 5).
#
#   pwsh scripts/test-kit/register-nightly.ps1                 every night at 03:30
#   pwsh scripts/test-kit/register-nightly.ps1 -At 04:00
#   pwsh scripts/test-kit/register-nightly.ps1 -WhatIf         show what it would register
#   pwsh scripts/test-kit/register-nightly.ps1 -Remove
#
# The task "Foundry AI Tool kit run" runs `kit-run.mjs --nightly` in the main checkout with the
# portable Node 22, only while you are logged on (no stored password), in a hidden console, and
# appends its output to <kit home>\nightly.log. It tests the main checkout as it is: pull main
# there to test the newest. A PC that is asleep, off or logged off at that time skips the night;
# a missed run is not started later (it could stop a test server you are using during the day).
[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$At = '03:30',
  [switch]$Remove
)
. (Join-Path $PSScriptRoot '..' 'test-env' 'config.ps1')

$name = 'Foundry AI Tool kit run'
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
$script = Join-Path $repo 'scripts' 'test-kit' 'kit-run.mjs'
if (-not (Test-Path $script)) { throw "No $script in the main checkout; merge the kit run command first." }
$node = Get-NodeExe
$kitHome = if ($env:TEST_KIT_HOME) { $env:TEST_KIT_HOME } else { 'C:\FoundryTest\test-kit' }
$log = Join-Path $kitHome 'nightly.log'

# conhost --headless: the console exists (the kit run still gets Ctrl+Break and close signals)
# but no window opens at night.
$command = "`"$node`" `"$script`" --nightly >> `"$log`" 2>&1"
$action = New-ScheduledTaskAction -Execute 'conhost.exe' `
  -Argument "--headless cmd.exe /d /s /c `"$command`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 6) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
if ($PSCmdlet.ShouldProcess($name, "Register: every day at $At, $script --nightly, log $log")) {
  New-Item -ItemType Directory -Force $kitHome | Out-Null
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings `
    -Principal $principal -Description 'Foundry AI Tool: the nightly test kit run (npm run kit:run -- --nightly).' -Force | Out-Null
  Write-Host "Registered '$name': every day at $At, $script --nightly, log $log."
}
