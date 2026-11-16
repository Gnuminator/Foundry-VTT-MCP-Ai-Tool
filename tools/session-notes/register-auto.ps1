# Registers (or removes) the automatic session-notes pass as a Windows scheduled task.
#
#   pwsh tools/session-notes/register-auto.ps1                 every hour, and at logon
#   pwsh tools/session-notes/register-auto.ps1 -EveryHours 2
#   pwsh tools/session-notes/register-auto.ps1 -WhatIf         show what it would register
#   pwsh tools/session-notes/register-auto.ps1 -Remove
#
# The task "Foundry AI Tool session notes" runs `auto.ps1` from the main checkout, only while you
# are logged on (no stored password), in a hidden console, and appends its output to
# <sessions>\auto-task.log. Each pass does nothing when nothing is due, so an hourly run costs
# nothing; a recording made on Sunday night is therefore written up the next time the PC is on
# (Monday morning at the latest), a pass cut short by the usage limit continues the next hour, and
# a pass missed because the PC was off or asleep starts when it is back (StartWhenAvailable).
# Nothing runs for a session unless every speaker has a recorded yes (auto.ps1, consent.json).
#
# The task sees your user environment, not a shell profile: `python`, `claude` and `pwsh` must be
# on the user PATH, and FVTT_SESSIONS_DIR / FVTT_PI_HOST / FOUNDRY_AI_CONTROL_PORT / FVTT_WORLD
# (when you use them) must be user environment variables. Docker Desktop must be running for the
# transcription step; a pass without it reports the failure and tries again.
[CmdletBinding(SupportsShouldProcess)]
param(
  [int]$EveryHours = 1,
  [switch]$Remove
)

$name = 'Foundry AI Tool session notes'
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
if ($EveryHours -lt 1) { throw '-EveryHours must be 1 or more.' }

# The main checkout, also when this runs from a worktree (.claude\worktrees\<name>).
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path -replace '[\\/]\.claude[\\/]worktrees[\\/].*$', ''
$script = Join-Path $repo 'tools' 'session-notes' 'auto.ps1'
if (-not (Test-Path $script)) { throw "No $script in the main checkout; merge this change and pull main there first." }
$pwsh = (Get-Command pwsh -ErrorAction Stop).Source
$sessions = if ($env:FVTT_SESSIONS_DIR) { $env:FVTT_SESSIONS_DIR } else { Join-Path $env:USERPROFILE 'Documents\FoundrySessions' }
$log = Join-Path $sessions 'auto-task.log'

$command = "`"$pwsh`" -NoProfile -File `"$script`" >> `"$log`" 2>&1"
$action = New-ScheduledTaskAction -Execute 'conhost.exe' `
  -Argument "--headless cmd.exe /d /s /c `"$command`"" -WorkingDirectory $repo
$every = New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
  -RepetitionInterval (New-TimeSpan -Hours $EveryHours)
$logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
  -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 8) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
if ($PSCmdlet.ShouldProcess($name, "Register: every $EveryHours h and at logon, $script, log $log")) {
  New-Item -ItemType Directory -Force $sessions | Out-Null
  Register-ScheduledTask -TaskName $name -Action $action -Trigger @($every, $logon) -Settings $settings `
    -Principal $principal -Description 'Foundry AI Tool: transcribe and write the notes of recorded sessions (tools/session-notes/auto.ps1).' -Force | Out-Null
  Write-Host "Registered '$name': every $EveryHours h and at logon, $script, log $log."
}
