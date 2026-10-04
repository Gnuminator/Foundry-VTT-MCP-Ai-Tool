#Requires -Version 7
<#
.SYNOPSIS
  Register (or remove) the Windows scheduled task that runs pull-snapshot.ps1 daily and at logon.

.DESCRIPTION
  Task "Foundry Pi snapshot pull": daily at 12:00 and 10 minutes after you log on, catches up a
  missed run, runs as you only while you are logged on (no stored password), and starts hidden
  through `conhost --headless`, so no window flashes. Running it again replaces the task.

.EXAMPLE
  .\scripts\pi\register-snapshot-task.ps1
  .\scripts\pi\register-snapshot-task.ps1 -Remove
#>
[CmdletBinding()]
param(
  [string]$TaskName = 'Foundry Pi snapshot pull',
  [string]$Destination = 'E:\PiBackup',
  [string]$DailyAt = '12:00',
  [switch]$Remove
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed task '$TaskName'."
  return
}

$script = Join-Path $PSScriptRoot 'pull-snapshot.ps1'
$pwsh = (Get-Command pwsh).Source
$conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
$taskArgs = "--headless `"$pwsh`" -NoProfile -NonInteractive -File `"$script`" -Destination `"$Destination`""

$action = New-ScheduledTaskAction -Execute $conhost -Argument $taskArgs -WorkingDirectory $PSScriptRoot
$daily = New-ScheduledTaskTrigger -Daily -At $DailyAt
$logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$logon.Delay = 'PT10M'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $daily, $logon -Settings $settings `
  -Principal $principal -Description 'Copies the Orange Pi''s newest dietpi-backup snapshot to this PC (scripts/pi/pull-snapshot.ps1).' -Force | Out-Null
Write-Host "Registered task '$TaskName': daily at $DailyAt and 10 minutes after logon; logs in $Destination\logs."
