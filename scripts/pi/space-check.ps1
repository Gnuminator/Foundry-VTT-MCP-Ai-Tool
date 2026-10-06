#Requires -Version 7
<#
.SYNOPSIS
  The PC's side of the storage space check (docs/dev/PI-SETUP.md, "Storage space check").

.DESCRIPTION
  The user's rule (2026-10-06): every backup, snapshot and sync checks its source and its destination
  for at least 20 % free space. Below 20 % the job still runs but warns; it stops only when space is
  critical (under 5 % free, or less free space than the job needs when that is known).

  This file is dot-sourced by pull-snapshot.ps1 and pull-restic.ps1 (it has no param block on
  purpose: a param block would overwrite the caller's variables when dot-sourced):

      . (Join-Path $PSScriptRoot 'space-check.ps1')
      $space = Invoke-SpaceCheck -Job 'restic copy' -Destinations @($Destination) -PiHost foundry-pi `
        -PiPaths @('/var/lib/foundry-backup/restic') -Log ${function:Write-Log}
      if ($space.Skip) { throw $space.SkipReason }

  It checks the local disks (the backup destination, and the folder Syncthing writes the GM vault
  into when it exists) with .NET's DriveInfo, and reads the Pi's status file
  (/var/lib/foundry-ai-tool/space/status.json, written hourly by stage 10) over read-only SSH. A
  missing, unreachable or stale (over 3 h) Pi status is a warning in the log, never an error.
  Below 20 % free on a Pi source or a local disk it logs a WARNING and shows a Windows notification;
  at critical on a local destination Skip is true and the caller must not run the copy.
  It never throws: a failing check only logs that it could not run.

  Run by hand (a real check, shows notifications; -Test only prints what it would notify):

      pwsh -NoProfile -File .\scripts\pi\space-check.ps1
      pwsh -NoProfile -File .\scripts\pi\space-check.ps1 -Test
      pwsh -NoProfile -File .\scripts\pi\space-check.ps1 -Test -SimulateFreePercent 3

  Options when run directly: -Test, -Destination <folder> (default E:\PiBackup), -PiHost <ssh name>
  (default foundry-pi), -SimulateFreePercent <number> (pretend every disk has that much free, to see
  the warnings; use with -Test), -NoPi (skip the Pi). The exit code is 1 when a copy would be skipped.
#>

# Thresholds (the user's rule, 2026-10-06; the Pi's checker uses the same numbers).
$script:SpaceThresholdPercent = 20
$script:SpaceCriticalPercent = 5
$script:SpaceStaleHours = 3

# The level of one disk: ok, low (under 20 % free) or critical (under 5 % free, or less free space
# than the job needs).
function Get-SpaceLevel {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][double]$FreePercent,
    [double]$FreeBytes = [double]::PositiveInfinity,
    [double]$NeedBytes = 0,
    [int]$ThresholdPercent = 20,
    [int]$CriticalPercent = 5
  )
  if ($FreePercent -lt $CriticalPercent -or ($NeedBytes -gt 0 -and $FreeBytes -lt $NeedBytes)) { return 'critical' }
  if ($FreePercent -lt $ThresholdPercent) { return 'low' }
  return 'ok'
}

# Free and total space of the drive a path is on; $null when the drive cannot be read (a UNC path,
# an unplugged drive): the job itself reports that, the check stays quiet.
function Get-LocalSpace {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Path)
  try {
    $full = [System.IO.Path]::GetFullPath($Path)
    $root = [System.IO.Path]::GetPathRoot($full)
    $drive = [System.IO.DriveInfo]::new($root)
    if (-not $drive.IsReady -or $drive.TotalSize -le 0) { return $null }
    $total = [double]$drive.TotalSize
    $free = [double]$drive.AvailableFreeSpace
    return [pscustomobject]@{
      Disk        = $root.TrimEnd('\')
      Path        = $Path
      TotalBytes  = $total
      FreeBytes   = $free
      FreePercent = [math]::Round($free * 100 / $total, 1)
    }
  } catch {
    return $null
  }
}

# The Pi's status file, read-only over SSH. State: ok (fresh), stale (older than -StaleHours),
# missing (the Pi answers but has no readable file: stage 10 not run?) or unreachable.
function Get-PiSpace {
  [CmdletBinding()]
  param(
    [string]$PiHost = 'foundry-pi',
    [string]$Ssh = 'ssh',
    [string]$StatusPath = '/var/lib/foundry-ai-tool/space/status.json',
    [int]$StaleHours = 3,
    [datetimeoffset]$Now = [datetimeoffset]::UtcNow
  )
  $result = [pscustomobject]@{ State = 'unreachable'; Status = $null; AgeHours = $null; Message = '' }
  try {
    $out = & $Ssh -o BatchMode=yes -o ConnectTimeout=10 $PiHost cat $StatusPath 2>$null
    $code = $LASTEXITCODE
    if ($code -eq 255) {
      $result.Message = "the Pi ($PiHost) does not answer over SSH"
      return $result
    }
    if ($code -ne 0 -or -not $out) {
      $result.State = 'missing'
      $result.Message = "the Pi has no space status yet ($StatusPath): run Pi stage 10"
      return $result
    }
    $status = (@($out) -join "`n") | ConvertFrom-Json
    $stamp = $status.checkedAt
    $when = if ($stamp -is [datetime]) { [datetimeoffset]::new($stamp.ToUniversalTime(), [timespan]::Zero) } else { [datetimeoffset]::Parse([string]$stamp, [cultureinfo]::InvariantCulture) }
    $age = ($Now - $when).TotalHours
    $result.Status = $status
    $result.AgeHours = [math]::Round($age, 1)
    if ($age -gt $StaleHours) {
      $result.State = 'stale'
      $result.Message = "the Pi's space status is $([math]::Round($age, 1)) hours old (limit $StaleHours): its hourly check may have stopped"
    } else {
      $result.State = 'ok'
    }
  } catch {
    $result.State = 'missing'
    $result.Message = "the Pi's space status could not be read: $($_.Exception.Message)"
  }
  return $result
}

# The folder Syncthing writes the GM vault into on this PC: from Syncthing's config when the folder
# is configured, else the default of setup-syncthing-pc.ps1 when it exists, else $null.
function Get-SyncthingVaultPath {
  [CmdletBinding()]
  param([string]$FolderId = 'foundry-gm-vault')
  try {
    $cfg = Join-Path $env:LOCALAPPDATA 'Syncthing\config.xml'
    if (Test-Path -LiteralPath $cfg) {
      $xml = [xml](Get-Content -Raw -LiteralPath $cfg)
      foreach ($f in @($xml.configuration.folder)) {
        if ($f.GetAttribute('id') -eq $FolderId) {
          $p = $f.GetAttribute('path')
          if ($p) {
            if ($p.StartsWith('~')) { $p = $env:USERPROFILE + $p.Substring(1) }
            return $p
          }
        }
      }
    }
  } catch {
    # fall through to the default location
  }
  $default = Join-Path $env:USERPROFILE 'Documents\Obsidian\Foundry GM vault'
  if (Test-Path -LiteralPath $default) { return $default }
  return $null
}

# Show a Windows toast. Dependency-free and safe from a scheduled task that runs as you while you
# are signed in: Windows PowerShell 5.1 (a built-in program) is started hidden and shows the toast
# under its own, always registered, application id; if that fails a notification-area balloon is
# tried. The text goes in through environment variables, so no quoting can break it. Returns $true
# when the child reported success.
function Send-SpaceToast {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$Title, [Parameter(Mandatory)][string]$Message)
  $child = @'
$ErrorActionPreference = 'Stop'
$title = $env:FVTT_SPACE_TITLE
$text = $env:FVTT_SPACE_TEXT
try {
  [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
  $t = [Security.SecurityElement]::Escape($title)
  $m = [Security.SecurityElement]::Escape($text)
  $xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>$t</text><text>$m</text></binding></visual></toast>")
  $toast = New-Object Windows.UI.Notifications.ToastNotification $xml
  $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
  Start-Sleep -Milliseconds 800
} catch {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $icon = New-Object System.Windows.Forms.NotifyIcon
  $icon.Icon = [System.Drawing.SystemIcons]::Warning
  $icon.Visible = $true
  $icon.ShowBalloonTip(15000, $title, $text, [System.Windows.Forms.ToolTipIcon]::Warning)
  Start-Sleep -Seconds 8
  $icon.Dispose()
}
'@
  $ps51 = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if (-not (Test-Path -LiteralPath $ps51)) { return $false }
  $oldTitle = $env:FVTT_SPACE_TITLE
  $oldText = $env:FVTT_SPACE_TEXT
  try {
    $env:FVTT_SPACE_TITLE = $Title
    $env:FVTT_SPACE_TEXT = $Message
    $encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($child))
    $p = Start-Process -FilePath $ps51 -PassThru -WindowStyle Hidden -ArgumentList @(
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded)
    if (-not $p.WaitForExit(30000)) {
      $p.Kill()
      return $false
    }
    return ($p.ExitCode -eq 0)
  } catch {
    return $false
  } finally {
    $env:FVTT_SPACE_TITLE = $oldTitle
    $env:FVTT_SPACE_TEXT = $oldText
  }
}

# One finding as plain text. Names the disk, the free percentage, the free GB and the job.
function Format-SpaceFinding {
  [CmdletBinding()]
  param([Parameter(Mandatory)]$Finding)
  $f = $Finding
  $inv = [cultureinfo]::InvariantCulture
  $gb = '{0} GB of {1} GB' -f ($f.FreeBytes / 1GB).ToString('N1', $inv), ($f.TotalBytes / 1GB).ToString('N1', $inv)
  $pct = ([double]$f.FreePercent).ToString('N1', $inv)
  $where = if ($f.Side -eq 'Pi') { "the Pi's disk $($f.Disk)" } else { "this PC's disk $($f.Disk)" }
  return "$where has $pct% free ($gb). Job: $($f.Jobs)."
}

# The whole check for one job. Returns Level (worst of the findings, or unknown), Skip (a local
# destination is critical: do not run the copy), SkipReason, Findings and Notifications (the
# title and text of each toast). -Test logs what it would notify and shows nothing.
#   -Destinations      local folders the job writes into; critical here sets Skip
#   -Extra             @{ Path = ...; Job = ... } other local disks to warn about (the vault)
#   -PiHost / -PiPaths the Pi's status (empty host: no Pi check); only Pi disks that hold one of the
#                      paths count (all disks when none match)
#   -SimulateFreePercent  pretend every disk has this much free (to see the warnings); -1 = real
function Invoke-SpaceCheck {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Job,
    [string[]]$Destinations = @(),
    [hashtable[]]$Extra = @(),
    [string]$PiHost = '',
    [string]$Ssh = 'ssh',
    [string[]]$PiPaths = @(),
    [scriptblock]$Log = { param($m) Write-Host $m },
    [switch]$Test,
    [double]$SimulateFreePercent = -1,
    [int]$MaxToasts = 3
  )
  $result = [pscustomobject]@{
    Level = 'unknown'; Skip = $false; SkipReason = ''; Findings = @(); Notifications = @()
  }
  try {
    $findings = [System.Collections.Generic.List[object]]::new()

    # Local disks: one entry per drive, listing the jobs that use it.
    $local = [ordered]@{}
    $wanted = @($Destinations | ForEach-Object { @{ Path = $_; Job = "$Job (destination)"; Blocks = $true } }) +
    @($Extra | ForEach-Object { @{ Path = $_.Path; Job = $_.Job; Blocks = $false } })
    foreach ($w in $wanted) {
      $space = Get-LocalSpace $w.Path
      if (-not $space) { continue }
      if (-not $local.Contains($space.Disk)) {
        $local[$space.Disk] = [pscustomobject]@{ Space = $space; Jobs = [System.Collections.Generic.List[string]]::new(); Blocks = $false }
      }
      if (-not $local[$space.Disk].Jobs.Contains($w.Job)) { $local[$space.Disk].Jobs.Add($w.Job) }
      if ($w.Blocks) { $local[$space.Disk].Blocks = $true }
    }
    foreach ($entry in $local.Values) {
      $s = $entry.Space
      $free = $s.FreeBytes
      $pct = $s.FreePercent
      if ($SimulateFreePercent -ge 0) { $pct = $SimulateFreePercent; $free = $s.TotalBytes * $pct / 100 }
      $findings.Add([pscustomobject]@{
          Side = 'PC'; Disk = $s.Disk; TotalBytes = $s.TotalBytes; FreeBytes = $free; FreePercent = $pct
          Jobs = ($entry.Jobs -join ', '); Level = (Get-SpaceLevel -FreePercent $pct -FreeBytes $free); Blocks = $entry.Blocks
        })
    }

    # The Pi: its own hourly check wrote the status; a missing or old one is only a warning.
    if ($PiHost) {
      $pi = Get-PiSpace -PiHost $PiHost -Ssh $Ssh -StaleHours $script:SpaceStaleHours
      if ($pi.State -in @('stale', 'missing', 'unreachable')) {
        $tail = if ($pi.State -eq 'stale') { 'its numbers are used anyway' } else { "the Pi's side was not checked" }
        & $Log "WARNING: space check: $($pi.Message); $tail"
      }
      if ($pi.Status -and $pi.State -in @('ok', 'stale')) {
        $disks = @($pi.Status.disks)
        $mine = @($disks | Where-Object { $d = $_; @($PiPaths | Where-Object { @($d.paths) -contains $_ }).Count -gt 0 })
        if ($mine.Count -eq 0) { $mine = $disks }
        foreach ($d in $mine) {
          $total = [double]$d.totalBytes
          $free = [double]$d.freeBytes
          $pct = [double]$d.freePercent
          if ($SimulateFreePercent -ge 0) { $pct = $SimulateFreePercent; $free = $total * $pct / 100 }
          $level = if ($SimulateFreePercent -ge 0) { Get-SpaceLevel -FreePercent $pct -FreeBytes $free } else { [string]$d.level }
          $jobs = @($d.jobs) -join ', '
          if (-not $jobs) { $jobs = $Job }
          $findings.Add([pscustomobject]@{
              Side = 'Pi'; Disk = [string]$d.mount; TotalBytes = $total; FreeBytes = $free; FreePercent = $pct
              Jobs = $jobs; Level = $level; Blocks = $false
            })
        }
      }
    }

    # Report: one log line per disk; warnings (and toasts) for everything below 20 %.
    $levelRank = @{ ok = 0; low = 1; critical = 2; unknown = 0 }
    $worst = 'ok'
    $toasts = [System.Collections.Generic.List[object]]::new()
    foreach ($f in $findings) {
      if (-not $levelRank.ContainsKey([string]$f.Level)) { $f.Level = Get-SpaceLevel -FreePercent $f.FreePercent -FreeBytes $f.FreeBytes }
      if ($levelRank[$f.Level] -gt $levelRank[$worst]) { $worst = $f.Level }
      $text = Format-SpaceFinding $f
      if ($f.Level -eq 'ok') {
        & $Log "space ok: $($text.Substring(0, 1).ToUpper() + $text.Substring(1))"
        continue
      }
      $word = if ($f.Level -eq 'critical') { 'CRITICAL' } else { 'WARNING' }
      & $Log "${word}: space is $($f.Level): $text"
      $title = if ($f.Level -eq 'critical') { 'Foundry AI Tool: disk space critical' } else { 'Foundry AI Tool: low disk space' }
      $body = ($text.Substring(0, 1).ToUpper() + $text.Substring(1))
      if ($f.Level -eq 'critical' -and $f.Blocks) { $body += " The $Job is skipped." }
      $toasts.Add([pscustomobject]@{ Title = $title; Message = $body })
      if ($f.Level -eq 'critical' -and $f.Blocks -and -not $result.Skip) {
        $result.Skip = $true
        $result.SkipReason = "the $Job is skipped: space is critical on $text Free up space on $($f.Disk) and run it again."
      }
    }
    $shown = 0
    foreach ($t in $toasts) {
      if ($shown -ge $MaxToasts) {
        & $Log "space: $($toasts.Count - $shown) more warning(s) not shown as notifications; see the lines above"
        break
      }
      $shown++
      if ($Test) {
        & $Log "test: would notify: $($t.Title) | $($t.Message)"
      } elseif (-not (Send-SpaceToast -Title $t.Title -Message $t.Message)) {
        & $Log 'WARNING: space check: the Windows notification could not be shown (the warning above is still in this log)'
      }
    }
    $result.Level = if ($findings.Count -eq 0) { 'unknown' } else { $worst }
    $result.Findings = @($findings)
    $result.Notifications = @($toasts)
  } catch {
    & $Log "WARNING: the space check could not run: $($_.Exception.Message)"
  }
  return $result
}

# Direct run: the whole PC check by hand (docs/dev/PI-SETUP.md, "Storage space check").
if ($MyInvocation.InvocationName -ne '.') {
  $destination = 'E:\PiBackup'
  $piHost = 'foundry-pi'
  $test = $false
  $noPi = $false
  $simulate = -1.0
  for ($i = 0; $i -lt $args.Count; $i++) {
    switch -Regex ([string]$args[$i]) {
      '^-Test$' { $test = $true }
      '^-NoPi$' { $noPi = $true }
      '^-Destination$' { $i++; $destination = [string]$args[$i] }
      '^-PiHost$' { $i++; $piHost = [string]$args[$i] }
      '^-SimulateFreePercent$' { $i++; $simulate = [double]$args[$i] }
      default { Write-Error "unknown option $($args[$i]); see the help at the top of this file"; exit 2 }
    }
  }
  $extra = @()
  $vault = Get-SyncthingVaultPath
  if ($vault) { $extra = @(@{ Path = $vault; Job = 'Syncthing vault (destination)' }) }
  $log = { param($m) Write-Host $m }
  $r = Invoke-SpaceCheck -Job 'backup copy' -Destinations @($destination) -Extra $extra `
    -PiHost $(if ($noPi) { '' } else { $piHost }) -PiPaths @('/mnt/dietpi-backup', '/var/lib/foundry-backup/restic') `
    -Log $log -Test:$test -SimulateFreePercent $simulate
  Write-Host "overall: $($r.Level)$(if ($r.Skip) { '; a copy would be skipped' })"
  exit $(if ($r.Skip) { 1 } else { 0 })
}
