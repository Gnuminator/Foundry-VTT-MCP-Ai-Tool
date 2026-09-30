#Requires -Version 7
<#
.SYNOPSIS
  Zip the bridge vault into a dated backup and keep the newest 8 (PB-06).

.DESCRIPTION
  The bridge vault holds the AI Tool's own game state: the audit log with every undo, the
  Tarokka reading, reveals, session logs, the play log. It lives outside Foundry and outside
  git, so this weekly zip is its only backup.

  The vault folder is found the same way the backend does it (packages/mcp-server/src/vault/paths.ts):
    1. -VaultDir, if given
    2. the FOUNDRY_AI_DATA_DIR environment variable
    3. %APPDATA%\foundry-ai-tool\vault on Windows,
       $XDG_DATA_HOME (or ~/.local/share)/foundry-ai-tool/vault elsewhere

  The zip goes to  %USERPROFILE%\Documents\Foundry AI Tool backups\bridge-vault-YYYY-MM-DD.zip
  (a second run on the same day replaces that day's zip). Files that are being written at that
  moment are read without locking them; a file that still cannot be read is skipped and named
  in the output. After the zip, only the newest -Keep (default 8) bridge-vault-*.zip files stay.
  The result of the last run is written to last-backup.json next to the zips (for the later
  Discord bot's failed-backup alert).

  -Register creates a Windows scheduled task "Foundry AI Tool bridge vault backup" for the
  current user: weekly, and with StartWhenAvailable, so a run that was missed because the PC was
  off starts as soon as possible after the PC is on again. It never runs by itself; you run
  -Register once. -Unregister removes the task again.

  -WhatIf (and -Confirm) work on every action: a dry run prints what would be zipped, deleted
  or registered and changes nothing.

.EXAMPLE
  .\scripts\backup\backup-bridge-vault.ps1 -WhatIf        # dry run
  .\scripts\backup\backup-bridge-vault.ps1                # back up now
  .\scripts\backup\backup-bridge-vault.ps1 -Register      # once: weekly task, catches up after a missed start
  .\scripts\backup\backup-bridge-vault.ps1 -Register -Day Friday -At 18:30
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$VaultDir,
  [string]$BackupDir,
  [ValidateRange(1, 1000)][int]$Keep = 8,
  [switch]$Register,
  [switch]$Unregister,
  [ValidateSet('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')]
  [string]$Day = 'Sunday',
  [ValidatePattern('^\d{1,2}:\d{2}$')][string]$At = '12:00'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TaskName = 'Foundry AI Tool bridge vault backup'

function Resolve-VaultDir {
  param([string]$Explicit)
  if ($Explicit) { return [System.IO.Path]::GetFullPath($Explicit) }
  $fromEnv = $env:FOUNDRY_AI_DATA_DIR
  if ($fromEnv -and $fromEnv.Trim()) { return [System.IO.Path]::GetFullPath($fromEnv.Trim()) }
  if ($IsWindows) {
    $appData = if ($env:APPDATA -and $env:APPDATA.Trim()) { $env:APPDATA.Trim() }
    else { Join-Path $HOME 'AppData' 'Roaming' }
    return Join-Path $appData 'foundry-ai-tool' 'vault'
  }
  $xdg = $env:XDG_DATA_HOME
  $base = if ($xdg -and [System.IO.Path]::IsPathRooted($xdg)) { $xdg } else { Join-Path $HOME '.local' 'share' }
  return Join-Path $base 'foundry-ai-tool' 'vault'
}

function Resolve-BackupDir {
  param([string]$Explicit)
  if ($Explicit) { return [System.IO.Path]::GetFullPath($Explicit) }
  $docs = [Environment]::GetFolderPath('MyDocuments')
  if (-not $docs) { $docs = Join-Path $HOME 'Documents' }
  return Join-Path $docs 'Foundry AI Tool backups'
}

function Write-Status {
  param([string]$Dir, [hashtable]$Status)
  if (-not (Test-Path $Dir)) { return }
  $Status['at'] = (Get-Date).ToString('o')
  $Status | ConvertTo-Json | Set-Content -Path (Join-Path $Dir 'last-backup.json') -Encoding utf8
}

# --- -Unregister / -Register ----------------------------------------------------

if ($Unregister) {
  if (-not $IsWindows) { throw 'Scheduled tasks need Windows.' }
  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $existing) { Write-Host "No task named '$TaskName'."; return }
  if ($PSCmdlet.ShouldProcess($TaskName, 'Unregister scheduled task')) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed the scheduled task '$TaskName'."
  }
  return
}

if ($Register) {
  if (-not $IsWindows) { throw 'Scheduled tasks need Windows. On the Pi use a systemd timer or cron.' }
  $pwsh = (Get-Command pwsh -ErrorAction Stop).Source
  $script = $PSCommandPath
  $argList = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
  if ($VaultDir) { $argList += " -VaultDir `"$VaultDir`"" }
  if ($BackupDir) { $argList += " -BackupDir `"$BackupDir`"" }
  if ($Keep -ne 8) { $argList += " -Keep $Keep" }
  $when = [datetime]::ParseExact($At, 'H:mm', [System.Globalization.CultureInfo]::InvariantCulture)
  $description = "Weekly $Day $($when.ToString('HH:mm', [System.Globalization.CultureInfo]::InvariantCulture)), run as soon as possible after a missed start. Zips the bridge vault, keeps the newest $Keep."
  if ($PSCmdlet.ShouldProcess($TaskName, "Register scheduled task: $description")) {
    $action = New-ScheduledTaskAction -Execute $pwsh -Argument $argList -WorkingDirectory (Split-Path $script)
    $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Day -At $when
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
      -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
    $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
      -Principal $principal -Description $description -Force | Out-Null
    Write-Host "Registered '$TaskName' for $user. $description"
    Write-Host 'Check it with: Get-ScheduledTask -TaskName ''Foundry AI Tool bridge vault backup'' | Get-ScheduledTaskInfo'
  }
  return
}

# --- The backup -------------------------------------------------------------------

$vault = Resolve-VaultDir -Explicit $VaultDir
$backups = Resolve-BackupDir -Explicit $BackupDir
$zipName = 'bridge-vault-{0}.zip' -f (Get-Date -Format 'yyyy-MM-dd')
$zipPath = Join-Path $backups $zipName

if (-not (Test-Path -LiteralPath $vault -PathType Container)) {
  Write-Host "Bridge vault folder not found: $vault"
  Write-Host 'Set FOUNDRY_AI_DATA_DIR or pass -VaultDir if the backend uses another folder.'
  Write-Status -Dir $backups -Status @{ ok = $false; error = "vault folder not found: $vault" }
  exit 2
}

$files = @(Get-ChildItem -LiteralPath $vault -Recurse -File -Force)
Write-Host "Vault:   $vault ($($files.Count) files)"
Write-Host "Backup:  $zipPath"

if (-not $PSCmdlet.ShouldProcess($zipPath, "Zip $($files.Count) files from $vault")) {
  $old = @(Get-ChildItem -LiteralPath $backups -Filter 'bridge-vault-*.zip' -File -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending)
  $wouldKeep = @($zipName) + @($old | Where-Object { $_.Name -ne $zipName } | Select-Object -ExpandProperty Name)
  $wouldKeep = @($wouldKeep | Select-Object -First $Keep)
  foreach ($o in $old) {
    if ($wouldKeep -notcontains $o.Name) { Write-Host "What if: would delete old backup $($o.FullName)" }
  }
  return
}

New-Item -ItemType Directory -Force -Path $backups | Out-Null
Add-Type -AssemblyName System.IO.Compression
$tmpPath = "$zipPath.partial"
if (Test-Path -LiteralPath $tmpPath) { Remove-Item -LiteralPath $tmpPath -Force }
$skipped = New-Object System.Collections.Generic.List[string]
$added = 0
try {
  $out = [System.IO.File]::Open($tmpPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
  try {
    $zip = New-Object System.IO.Compression.ZipArchive($out, [System.IO.Compression.ZipArchiveMode]::Create, $false)
    try {
      $root = [System.IO.Path]::GetFullPath($vault).TrimEnd('\', '/')
      foreach ($f in $files) {
        $rel = $f.FullName.Substring($root.Length).TrimStart('\', '/').Replace('\', '/')
        try {
          # FileShare.ReadWrite: the bridge may be writing to the vault while we read it.
          $in = [System.IO.File]::Open($f.FullName, [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete)
          try {
            $entry = $zip.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
            $entry.LastWriteTime = $f.LastWriteTime
            $es = $entry.Open()
            try { $in.CopyTo($es) } finally { $es.Dispose() }
            $added++
          } finally { $in.Dispose() }
        } catch {
          $skipped.Add("$rel ($($_.Exception.Message))")
        }
      }
    } finally { $zip.Dispose() }
  } finally { $out.Dispose() }
  Move-Item -LiteralPath $tmpPath -Destination $zipPath -Force
} catch {
  if (Test-Path -LiteralPath $tmpPath) { Remove-Item -LiteralPath $tmpPath -Force -ErrorAction SilentlyContinue }
  Write-Host "Backup FAILED: $($_.Exception.Message)"
  Write-Status -Dir $backups -Status @{ ok = $false; error = $_.Exception.Message }
  exit 1
}

$size = [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1KB, 1)
Write-Host "Zipped $added files ($size KB)."
foreach ($s in $skipped) { Write-Host "Skipped: $s" }

# Keep the newest $Keep (names sort by date), delete the rest.
$all = @(Get-ChildItem -LiteralPath $backups -Filter 'bridge-vault-*.zip' -File | Sort-Object Name -Descending)
foreach ($old in ($all | Select-Object -Skip $Keep)) {
  if ($PSCmdlet.ShouldProcess($old.FullName, 'Delete old backup')) {
    Remove-Item -LiteralPath $old.FullName -Force
    Write-Host "Deleted old backup $($old.Name)"
  }
}

Write-Status -Dir $backups -Status @{
  ok = ($skipped.Count -eq 0)
  zip = $zipPath
  files = $added
  skipped = $skipped.Count
  kept = [math]::Min($all.Count, $Keep)
}
if ($skipped.Count -gt 0) { exit 1 }
