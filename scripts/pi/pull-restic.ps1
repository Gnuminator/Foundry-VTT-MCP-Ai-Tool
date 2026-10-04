#Requires -Version 7
<#
.SYNOPSIS
  Copy the Pi's restic backups to this PC (docs/dev/PI-SETUP.md, "Restic copies on this PC").

.DESCRIPTION
  The Pi backs up Foundry's data every night into a restic repository on its own disk (stage 6).
  This script copies every snapshot the Pi has and this PC does not into a second repository,
  <Destination>\restic, over SFTP (restic uses this PC's ssh and ~/.ssh/config, host alias
  foundry-pi). It only reads on the Pi.

  - Passwords live in %APPDATA%\foundry-ai-tool, readable by you only:
      restic-pi.pass  the Pi repository's password, fetched from the Pi once, when missing
      restic-pc.pass  this PC repository's password, generated when missing. Store a copy in your
                      password manager: without it the copies cannot be read.
  - The first run creates the PC repository with the Pi's chunker settings, so copies deduplicate.
  - Every run ends with `restic forget --prune`: the newest -KeepDaily daily, -KeepWeekly weekly and
    -KeepMonthly monthly snapshots stay. It never changes anything on the Pi.
  - Every -TestEveryDays days (marker <Destination>\restic-last-test.txt) it also reads 10 % of the
    repository data and restores the newest snapshot's worlds into a temporary folder, checks that
    a world.json came back, and deletes the folder.
  - Logs to <Destination>\logs\restic-<yyyy-MM>.log (never a password) and writes
    restic-last-success.txt.

.EXAMPLE
  .\scripts\pi\pull-restic.ps1
  .\scripts\pi\pull-restic.ps1 -Destination D:\Test -DryRun
#>
[CmdletBinding()]
param(
  [string]$Destination = 'E:\PiBackup',
  [string]$SourceRepo = 'sftp:foundry-pi:/var/lib/foundry-backup/restic',
  [string]$PiPasswordFile = (Join-Path $env:APPDATA 'foundry-ai-tool\restic-pi.pass'),
  [string]$PcPasswordFile = (Join-Path $env:APPDATA 'foundry-ai-tool\restic-pc.pass'),
  # Where the Pi keeps the password, for the one-time fetch.
  [string]$PiHost = 'foundry-pi',
  [string]$PiPasswordPath = '/etc/foundry-ai-tool/restic-pi.pass',
  [int]$KeepDaily = 14,
  [int]$KeepWeekly = 8,
  [int]$KeepMonthly = 12,
  [int]$TestEveryDays = 30,
  [int]$WarnAfterDays = 3,
  # Test hooks: the restic and ssh programs to call (default: found automatically).
  [string]$Restic = '',
  [string]$Ssh = 'ssh',
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$destRepo = Join-Path $Destination 'restic'
$logDir = Join-Path $Destination 'logs'
New-Item -ItemType Directory -Force -Path $destRepo, $logDir | Out-Null
$logFile = Join-Path $logDir ('restic-{0}.log' -f (Get-Date -Format 'yyyy-MM'))
$successFile = Join-Path $Destination 'restic-last-success.txt'
$testFile = Join-Path $Destination 'restic-last-test.txt'

function Write-Log([string]$Message) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH\:mm\:ss'), $Message
  Add-Content -Path $logFile -Value $line
  Write-Host $line
}

# The restic.exe to run. The scheduled task's PATH can lack winget's link folder, so look there too.
function Find-Restic {
  if ($Restic) {
    if (-not (Test-Path $Restic)) { throw "restic not found at $Restic" }
    return $Restic
  }
  $cmd = Get-Command restic -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $link = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\restic.exe'
  if (Test-Path $link) { return $link }
  $pkg = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages') -Filter 'restic.restic_*' -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Get-ChildItem $_.FullName -Filter 'restic*.exe' } | Sort-Object Name -Descending | Select-Object -First 1
  if ($pkg) { return $pkg.FullName }
  throw 'restic is not installed: winget install restic.restic'
}

# Make a file readable and writable by the current user only.
function Protect-File([string]$Path) {
  $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls.exe $Path /inheritance:r /grant:r "${me}:(R,W)" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "could not restrict the permissions of $Path" }
}

# Run restic, log its output (restic never prints passwords), return the exit code.
function Invoke-Restic([string[]]$ResticArgs, [switch]$Quiet) {
  $lines = & $script:resticExe @ResticArgs 2>&1 | ForEach-Object { "$_" }
  $code = $LASTEXITCODE
  if (-not $Quiet) { foreach ($l in @($lines)) { if ($l.Trim()) { Write-Log "  $l" } } }
  $script:lastOutput = @($lines)
  return $code
}

function Assert-Restic([string[]]$ResticArgs, [string]$What) {
  $code = Invoke-Restic $ResticArgs
  if ($code -ne 0) { throw "$What failed (restic exit $code)" }
}

try {
  $script:resticExe = Find-Restic
  $script:lastOutput = @()
  Write-Log ('start: ' + ((& $script:resticExe version) -join ' '))

  # sftp sources go through ssh without prompts: a hidden task has no one to answer one.
  $srcOpts = @()
  if ($SourceRepo -match '^sftp:([^:]+):') {
    $srcOpts = @('-o', "sftp.command=ssh -o BatchMode=yes -o ConnectTimeout=10 $($Matches[1]) -s sftp")
  }

  New-Item -ItemType Directory -Force -Path (Split-Path $PiPasswordFile), (Split-Path $PcPasswordFile) | Out-Null

  # The Pi repository's password: fetched once, straight into a file only you can read.
  if (-not (Test-Path $PiPasswordFile) -or (Get-Item $PiPasswordFile).Length -eq 0) {
    if ($SourceRepo -notmatch '^sftp:') { throw "no password file at $PiPasswordFile for the source repository" }
    if ($DryRun) {
      Write-Log "dry run: would fetch the Pi repository password from $PiHost into $PiPasswordFile"
    } else {
      New-Item -ItemType File -Force -Path $PiPasswordFile | Out-Null
      Protect-File $PiPasswordFile
      # cmd's redirect writes the bytes as they come and keeps the password out of PowerShell.
      $sshExe = (Get-Command $Ssh).Source
      & cmd.exe /d /c "`"$sshExe`" -o BatchMode=yes -o ConnectTimeout=10 $PiHost cat $PiPasswordPath > `"$PiPasswordFile`" 2>nul"
      if ($LASTEXITCODE -ne 0 -or (Get-Item $PiPasswordFile).Length -eq 0) {
        Remove-Item -Force $PiPasswordFile -ErrorAction SilentlyContinue
        throw "could not fetch the Pi repository password from $PiHost (run Pi stage 6 first?)"
      }
      Write-Log "fetched the Pi repository password into $PiPasswordFile"
    }
  }

  # This PC repository's password: generated once. Losing it makes the copies unreadable.
  if (-not (Test-Path $PcPasswordFile) -or (Get-Item $PcPasswordFile).Length -eq 0) {
    if ($DryRun) {
      Write-Log "dry run: would generate the PC repository password in $PcPasswordFile"
    } else {
      New-Item -ItemType File -Force -Path $PcPasswordFile | Out-Null
      Protect-File $PcPasswordFile
      $bytes = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
      [System.IO.File]::WriteAllText($PcPasswordFile, [Convert]::ToBase64String($bytes))
      Write-Log "generated the PC repository password in ${PcPasswordFile}: STORE A COPY IN YOUR PASSWORD MANAGER, the copies cannot be read without it"
    }
  }

  $repoExists = Test-Path (Join-Path $destRepo 'config')
  if (-not $repoExists) {
    if ($DryRun) {
      Write-Log "dry run: would create $destRepo from $SourceRepo"
    } else {
      Write-Log "init: $destRepo (same chunker settings as the Pi)"
      Assert-Restic ($srcOpts + @('init', '--repo', $destRepo, '--password-file', $PcPasswordFile,
          '--from-repo', $SourceRepo, '--from-password-file', $PiPasswordFile, '--copy-chunker-params')) 'init'
    }
  }

  $dest = @('--repo', $destRepo, '--password-file', $PcPasswordFile)
  if ($DryRun) {
    Write-Log "dry run: would copy new snapshots from $SourceRepo and apply keep $KeepDaily daily, $KeepWeekly weekly, $KeepMonthly monthly"
    if ($repoExists) {
      Assert-Restic ($dest + @('forget', '--dry-run', '--keep-daily', $KeepDaily, '--keep-weekly', $KeepWeekly,
          '--keep-monthly', $KeepMonthly)) 'forget (dry run)'
    }
  } else {
    Write-Log "copy: new snapshots from $SourceRepo"
    Assert-Restic ($srcOpts + $dest + @('copy', '--from-repo', $SourceRepo, '--from-password-file', $PiPasswordFile)) 'copy'

    Write-Log "forget: keep $KeepDaily daily, $KeepWeekly weekly, $KeepMonthly monthly"
    Assert-Restic ($dest + @('forget', '--compact', '--keep-daily', $KeepDaily, '--keep-weekly', $KeepWeekly,
        '--keep-monthly', $KeepMonthly, '--prune')) 'forget'

    # How fresh is the newest copy? A warning line when the Pi's backups stopped arriving.
    $code = Invoke-Restic ($dest + @('snapshots', '--json', '--latest', '1')) -Quiet
    $newest = $null
    if ($code -eq 0) {
      $snaps = (@($script:lastOutput) -join "`n") | ConvertFrom-Json
      $count = @($snaps).Count
      if ($count -gt 0) {
        $newest = (@($snaps) | ForEach-Object { [datetimeoffset]$_.time } | Sort-Object -Descending | Select-Object -First 1)
      }
    }
    if (-not $newest) {
      Write-Log 'WARNING: the PC repository has no snapshots'
    } elseif ($newest -lt [datetimeoffset]::Now.AddDays(-$WarnAfterDays)) {
      Write-Log "WARNING: the newest snapshot is from $($newest.ToLocalTime().ToString('yyyy-MM-dd HH:mm')): the Pi has made none for $WarnAfterDays days"
    }
    Set-Content -Path $successFile -Value ('{0}  newest snapshot {1}' -f (Get-Date -Format 's'),
      $(if ($newest) { $newest.ToLocalTime().ToString('s') } else { 'none' }))

    # Monthly proof that the copies can be restored, not only listed.
    $due = $true
    if (Test-Path $testFile) {
      $last = [datetime]::Parse((Get-Content $testFile -TotalCount 1), [cultureinfo]::InvariantCulture)
      $due = $last -lt (Get-Date).AddDays(-$TestEveryDays)
    }
    if ($due) {
      Write-Log 'test: checking 10 % of the data, then restoring the newest snapshot''s worlds'
      Assert-Restic ($dest + @('check', '--read-data-subset=10%')) 'check'
      $tmp = Join-Path $Destination 'restore-test'
      if (Test-Path $tmp) { Remove-Item -Recurse -Force -LiteralPath $tmp }
      try {
        Assert-Restic ($dest + @('restore', 'latest', '--target', $tmp, '--include', '/var/lib/foundry/Data/worlds')) 'test restore'
        $worlds = @(Get-ChildItem -LiteralPath $tmp -Recurse -Filter 'world.json' -File -ErrorAction SilentlyContinue)
        if ($worlds.Count -lt 1) { throw 'the test restore brought back no world.json' }
        Write-Log "test ok: restored $($worlds.Count) world(s): $(($worlds | ForEach-Object { $_.Directory.Name }) -join ', ')"
      } finally {
        if (Test-Path $tmp) { Remove-Item -Recurse -Force -LiteralPath $tmp }
      }
      Set-Content -Path $testFile -Value (Get-Date -Format 's')
    }
    Write-Log 'ok'
  }
} catch {
  Write-Log "FAILED: $($_.Exception.Message)"
  $exitCode = 1
}

if (Get-Variable exitCode -ErrorAction SilentlyContinue) { exit $exitCode }
