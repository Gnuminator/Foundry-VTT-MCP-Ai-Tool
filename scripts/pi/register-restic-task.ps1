#Requires -Version 7
<#
.SYNOPSIS
  Register (or remove) the Windows scheduled task that runs pull-restic.ps1 daily and at logon.

.DESCRIPTION
  Task "Foundry Pi restic copy": daily at 12:30 and 15 minutes after you log on, catches up a
  missed run, runs as you only while you are logged on (no stored password), and starts hidden
  through `conhost --headless`, so no window flashes. Running it again replaces the task. It runs
  half an hour after the snapshot pull (12:00), so the two rarely use the Pi's link together.

.EXAMPLE
  .\scripts\pi\register-restic-task.ps1
  .\scripts\pi\register-restic-task.ps1 -Remove
#>
[CmdletBinding()]
param(
  [string]$TaskName = 'Foundry Pi restic copy',
  [string]$Destination = 'E:\PiBackup',
  [string]$DailyAt = '12:30',
  [switch]$Remove
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed task '$TaskName'."
  return
}

$script = Join-Path $PSScriptRoot 'pull-restic.ps1'
# The Store build's own folder (WindowsApps\Microsoft.PowerShell_7.x.y.0_...) changes with every
# update; its App Execution Alias in %LOCALAPPDATA% stays put, so prefer that when it exists.
$alias = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\pwsh.exe'
$pwsh = if (Test-Path $alias) { $alias } else { (Get-Command pwsh).Source }
$conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
$taskArgs = "--headless `"$pwsh`" -NoProfile -NonInteractive -File `"$script`" -Destination `"$Destination`""

$action = New-ScheduledTaskAction -Execute $conhost -Argument $taskArgs -WorkingDirectory $PSScriptRoot
$daily = New-ScheduledTaskTrigger -Daily -At $DailyAt
$logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$logon.Delay = 'PT15M'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $daily, $logon -Settings $settings `
  -Principal $principal -Description 'Copies the Orange Pi''s restic backups to this PC (scripts/pi/pull-restic.ps1).' -Force | Out-Null
Write-Host "Registered task '$TaskName': daily at $DailyAt and 15 minutes after logon; logs in $Destination\logs."
