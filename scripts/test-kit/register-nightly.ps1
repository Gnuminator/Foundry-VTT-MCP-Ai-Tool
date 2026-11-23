# Registers (or removes) the overnight kit run as a Windows scheduled task (D-102 line 5).
#
#   pwsh scripts/test-kit/register-nightly.ps1                 at every logon, 10 minutes after it
#   pwsh scripts/test-kit/register-nightly.ps1 -At 03:30       every day at a fixed time instead
#   pwsh scripts/test-kit/register-nightly.ps1 -WhatIf         show what it would register
#   pwsh scripts/test-kit/register-nightly.ps1 -Remove
#
# The task "Foundry AI Tool kit run" runs `kit-run.mjs --nightly` in the main checkout with the
# portable Node 24, only while you are logged on (no stored password), in a hidden console, and
# appends its output to <kit home>\nightly.log. It tests the main checkout as it is: pull main
# there to test the newest.
# This PC is not on all night, so the default trigger is the logon, with `--daily`: a run that
# already finished today makes the task do nothing, so it runs at most once a day. It uses test
# server B's lock and waits up to 2 hours for it; when a lane still holds B it records a skipped
# run (last-run.json says so) and the next logon or the 12:00 start tries again. With -At the task runs at that time
# and a PC that is off then skips the day (no catch-up, it could stop a server you are using).
[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$At,
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
# but no window opens.
$flag = if ($At) { '--nightly' } else { '--daily' }
$command = "`"$node`" `"$script`" $flag >> `"$log`" 2>&1"
$action = New-ScheduledTaskAction -Execute 'conhost.exe' `
  -Argument "--headless cmd.exe /d /s /c `"$command`"" -WorkingDirectory $repo
if ($At) {
  $trigger = New-ScheduledTaskTrigger -Daily -At $At
  $when = "every day at $At"
} else {
  $logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $logon.Delay = 'PT10M'
  # A PC that stays logged on for days (or sleeps and resumes) gets a midday retry; --daily makes
  # every extra start a no-op once a run has finished that day.
  $trigger = @($logon, (New-ScheduledTaskTrigger -Daily -At '12:00'))
  $when = 'at every logon (10 minutes after it) and daily at 12:00, at most one run a day'
}
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 6) -MultipleInstances IgnoreNew
if (-not $At) { $settings.StartWhenAvailable = $true }  # the 12:00 start runs on wake if it was missed
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
if ($PSCmdlet.ShouldProcess($name, "Register: $when, $script $flag, log $log")) {
  New-Item -ItemType Directory -Force $kitHome | Out-Null
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings `
    -Principal $principal -Description "Foundry AI Tool: the test kit run (kit-run.mjs $flag)." -Force | Out-Null
  Write-Host "Registered '$name': $when, $script $flag, log $log."
}
