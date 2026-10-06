<#
.SYNOPSIS
  Builds a world bundle from this PC's Foundry test server and uploads it to the Pi, ready for stage 11.

.DESCRIPTION
  Part of "Licensed content (the books and Curse of Strahd)" in docs/dev/PI-SETUP.md. It runs on this PC
  and never runs stage 11 itself: it prints the exact command for it.

  What goes into the bundle (a plain .tar, no compression; the images are already compressed):
    - the world:            Data/worlds/<World>
    - the modules:          Data/modules/<id> for each id in -Modules
    - the asset folders:    the Data/ddb-images and Data/tokenizer folders the world uses (found by
                            scripts/pi/world-refs.mjs), plus any in -Assets
    - MANIFEST.txt          world, modules with versions, folders, file count, size, time, repo commit
    - SHA256SUMS            one line per file under Data/, checked by stage 11 after the upload
  What never goes in: the foundry-mcp-bridge module (stage 5 installs it from the release), ddb-importer
  (its settings can hold the D&D Beyond cookie, so it stays on this PC), and any env file, ddb-proxy or
  Adventure Muncher file.

  Foundry must not have the world open: its LevelDB files are in use then. Stop the world first.

.PARAMETER DataPath    Foundry's Data folder on this PC (default C:\FoundryTest\data\Data).
.PARAMETER World       The world id to ship (default curse-of-strahd).
.PARAMETER Modules     Module ids to ship (default aitool-content, dnd-players-handbook, foundryvtt-actor-studio).
.PARAMETER Assets      Extra asset folders under Data, for example ddb-images/adventures/Curse_of_Strahd.
                       They are added to the folders world-refs finds.
.PARAMETER PiHost      The SSH name of the Pi (default foundry-pi).
.PARAMETER OutDir      Where the bundle is built (default a new folder under $env:TEMP). It is kept.
.PARAMETER NoUpload    Build and check only.
.PARAMETER FoundryUrl  This PC's Foundry, to check that the world is not running (default http://localhost:30001).
.PARAMETER AllowSettingKeys  World setting keys that world-refs flags as secret-looking but that you reviewed (a trailing * is a prefix,
                       for example ddb-importer.entity-*). Only ddb-importer.* settings can be excused, and
                       never one with cookie, token, secret, password or key in its name.
.PARAMETER AllowMissing  Reviewed "known missing" asset paths (an exact path, or a prefix ending in *, for example assets/cos13*). A path that
                       matches is not a problem for world-refs (missing, letter case, other module or root) and is only counted. No
                       .., no leading slash. The list is written into MANIFEST.txt (allow-missing:).
.PARAMETER GmUser     The world's GM user (default Gamemaster). Stage 11 joins it with an empty password, so it must have none here
                       (the hash Foundry 14 stores for a user with no password does not count as one).
.PARAMETER SkipRefs    FOR TESTS ONLY: skip the asset scan (the script's own test uses a fake Data folder with no
                       LevelDB). The real run never uses it, because the scan is what proves nothing is left behind.
#>
[CmdletBinding()]
param(
  [string]$DataPath = 'C:\FoundryTest\data\Data',
  [string]$World = 'curse-of-strahd',
  [string[]]$Modules = @('aitool-content', 'dnd-players-handbook', 'foundryvtt-actor-studio'),
  [string[]]$Assets = @(),
  [string]$PiHost = 'foundry-pi',
  [string]$OutDir = '',
  [switch]$NoUpload,
  [string]$FoundryUrl = 'http://localhost:30001',
  [string[]]$AllowSettingKeys = @(),
  [string[]]$AllowMissing = @(),
  [string]$GmUser = 'Gamemaster',
  [switch]$SkipRefs
)

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
# The storage rule's levels and wording (Get-SpaceLevel, Get-LocalSpace, Format-SpaceFinding): 20 % low, 5 % critical.
. (Join-Path $PSScriptRoot 'space-check.ps1')

function Step([string]$m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Fail([string]$m) { throw $m }
function Format-Size([double]$b) {
  if ($b -ge 1GB) { '{0:N2} GB' -f ($b / 1GB) } elseif ($b -ge 1MB) { '{0:N1} MB' -f ($b / 1MB) } else { '{0:N0} KB' -f ($b / 1KB) }
}

# --- 1. what is asked for ----------------------------------------------------------------------
Step 'checking the request'
if (-not (Test-Path -LiteralPath $DataPath -PathType Container)) { Fail "no Data folder at $DataPath" }
$DataPath = (Resolve-Path -LiteralPath $DataPath).Path
$Modules = @($Modules | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
$Assets = @($Assets | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
foreach ($id in @($World) + $Modules) {
  if ($id -notmatch '^[a-z0-9-]+$') { Fail "id '$id' is not lowercase letters, digits and dashes (the ids stage 11 accepts)" }
}
foreach ($id in $Modules) {
  if ($id -eq 'foundry-mcp-bridge') { Fail 'foundry-mcp-bridge is not shipped: stage 5 installs it from the release' }
  if ($id -eq 'ddb-importer') { Fail 'ddb-importer is not shipped: its settings can hold the D&D Beyond cookie, so it stays on this PC' }
}
$worldSrc = Join-Path $DataPath "worlds\$World"
if (-not (Test-Path -LiteralPath (Join-Path $worldSrc 'world.json'))) { Fail "no world.json in $worldSrc" }
foreach ($id in $Modules) {
  if (-not (Test-Path -LiteralPath (Join-Path $DataPath "modules\$id\module.json"))) { Fail "no module.json for module $id under $DataPath\modules" }
}

# --- 2. the world must not be running on this PC -------------------------------------------------
Step "checking that $World is not running on this PC ($FoundryUrl)"
$status = $null
try { $status = Invoke-RestMethod -Uri "$FoundryUrl/api/status" -TimeoutSec 3 } catch { }
if ($status -and $status.world -eq $World) { Fail "stop the world first, LevelDB files are in use ($World is the active world on $FoundryUrl)" }
if ($status) { Write-Host "    Foundry answers; active world: $(if ($status.world) { $status.world } else { 'none' })" } else { Write-Host '    no Foundry answers (fine)' }

# --- 3. the asset scan ------------------------------------------------------------------------------
$assetFolders = [System.Collections.Generic.SortedSet[string]]::new()
if ($SkipRefs) {
  Write-Host '    -SkipRefs: asset scan skipped (tests only)' -ForegroundColor Yellow
} else {
  Step 'scanning the world and the module packs for asset paths (scripts/pi/world-refs.mjs)'
  $refsJson = & node (Join-Path $PSScriptRoot 'world-refs.mjs') --data $DataPath --world $World --modules ($Modules -join ',') --allow-secret-keys ($AllowSettingKeys -join ',') --allow-missing ($AllowMissing -join ',') --gm-user $GmUser --json
  $refsRc = $LASTEXITCODE
  if ($refsRc -eq 1 -or -not $refsJson) { Fail "world-refs failed to run (exit $refsRc); see the message above" }
  $refs = ($refsJson -join "`n") | ConvertFrom-Json
  Write-Host ("    {0} asset paths in {1} databases; per root: {2}" -f $refs.pathCount, $refs.dbsScanned, (($refs.counts.PSObject.Properties | ForEach-Object { "$($_.Name) $($_.Value)" }) -join ', '))
  if ($refs.allowedMissingCount) { Write-Host "    $($refs.allowedMissingCount) known missing paths allowed by -AllowMissing (not problems)" -ForegroundColor Yellow }
  if ($refsRc -ne 0) {
    $p = $refs.problems
    Write-Host 'world-refs found problems:' -ForegroundColor Red
    if ($p.foreignModules.Count) { Write-Host ('  modules not in -Modules: ' + ($p.foreignModules -join ', ')) }
    if ($p.foreignWorlds.Count) { Write-Host ('  other worlds referenced: ' + ($p.foreignWorlds -join ', ')) }
    if ($p.missingCount) { Write-Host "  $($p.missingCount) missing files (first $($p.missing.Count)):"; $p.missing | ForEach-Object { Write-Host "    $_" } }
    if ($p.caseMismatchCount) { Write-Host "  $($p.caseMismatchCount) paths whose letter case differs from the file (the Pi is case-sensitive):"; $p.caseMismatch | ForEach-Object { Write-Host "    $_" } }
    if ($p.activeNotShipped.Count) { Write-Host ('  modules active in the world but not shipped (turn them off in the world, or add them to -Modules): ' + ($p.activeNotShipped -join ', ')) }
    if ($p.gmUser.Count) { $p.gmUser | ForEach-Object { Write-Host "  $_" } }
    if ($p.otherRootsCount) { Write-Host "  $($p.otherRootsCount) paths in unknown roots:"; $p.otherRoots | ForEach-Object { Write-Host "    $_" } }
    if ($p.secretSettingKeys.Count) { Write-Host ('  world settings that look like secrets (names only): ' + ($p.secretSettingKeys -join ', ')) }
    Fail 'fix these first (or add the missing module or folder), then run again'
  }
  foreach ($f in $refs.assetFolders) { [void]$assetFolders.Add($f) }
}
foreach ($a in $Assets) {
  $rel = ($a -replace '\\', '/').Trim('/')
  if ($rel -notmatch '^(ddb-images|tokenizer)(/[^/]+)*$' -or $rel -match '(^|/)\.\.(/|$)') { Fail "asset folder '$a' must be under ddb-images/ or tokenizer/ (stage 11 accepts only those)" }
  [void]$assetFolders.Add($rel)
}
foreach ($f in $assetFolders) {
  if (-not (Test-Path -LiteralPath (Join-Path $DataPath $f) -PathType Container)) { Fail "asset folder $f does not exist under $DataPath" }
}

# --- 4. the sources: refuse files that must never leave this PC ------------------------------------
Step 'looking for files that must stay on this PC'
$sources = @([pscustomobject]@{ Rel = "worlds/$World"; Abs = $worldSrc })
$sources += $Modules | ForEach-Object { [pscustomobject]@{ Rel = "modules/$_"; Abs = Join-Path $DataPath "modules\$_" } }
$sources += $assetFolders | ForEach-Object { [pscustomobject]@{ Rel = $_; Abs = Join-Path $DataPath ($_ -replace '/', '\') } }
$total = 0L
$count = 0
foreach ($s in $sources) {
  $items = Get-ChildItem -LiteralPath $s.Abs -Recurse -Force -File -ErrorAction Stop | Where-Object { $_.Name -ne 'LOCK' -and $_.Name -notlike '*.lock' }
  $bad = $items | Where-Object { $_.Name -like '*.env' -or $_.Name -like 'dbb.env*' -or $_.FullName.Substring($DataPath.Length) -match '(?i)ddb-proxy|adventure-muncher|cookie' }
  if ($bad) {
    $examples = ($bad | Select-Object -First 3 | ForEach-Object { $_.FullName.Substring($DataPath.Length + 1) }) -join ', '
    Fail "refusing $($s.Rel): it holds files that must stay on this PC, for example $examples"
  }
  $total += ($items | Measure-Object Length -Sum).Sum
  $count += $items.Count
  Write-Host ("    {0,-60} {1,8} files {2,10}" -f $s.Rel, $items.Count, (Format-Size (($items | Measure-Object Length -Sum).Sum)))
}
Write-Host ("    total {0} files, {1}" -f $count, (Format-Size $total))

# --- 5. the work folder and its space ---------------------------------------------------------------
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if (-not $OutDir) { $OutDir = Join-Path $env:TEMP "foundry-world-bundle-$stamp" }
$stage = Join-Path $OutDir 'stage'
if (Test-Path -LiteralPath $stage) { Fail "$stage already exists: pick another -OutDir (nothing is deleted here)" }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
# The user's storage rule (2026-10-06, same numbers as space-check.ps1): every job checks its source and its
# destination for 20 % free; below 20 % it warns and goes on, below 5 % (or less than the job needs) it stops.
function Test-SpaceLevel([string]$Side, [string]$Disk, [double]$Free, [double]$Size, [double]$Need, [string]$Job) {
  $pct = if ($Size -gt 0) { [math]::Round($Free * 100 / $Size, 1) } else { 100 }
  $level = Get-SpaceLevel -FreePercent $pct -FreeBytes $Free -NeedBytes $Need
  $f = [pscustomobject]@{ Side = $Side; Disk = $Disk; FreePercent = $pct; FreeBytes = $Free; TotalBytes = $Size; Jobs = $Job }
  $text = Format-SpaceFinding $f
  if ($level -eq 'critical') { Fail "space is critical: $text It needs about $(Format-Size $Need). Free up space and run this again." }
  if ($level -eq 'low') { Write-Host "    WARNING: space is low: $text" -ForegroundColor Yellow } else { Write-Host "    space ok: $text" }
}
Step 'checking free space (the 20 % rule)'
$need = 2L * $total + 100MB
$outSpace = Get-LocalSpace $OutDir
if ($outSpace) { Test-SpaceLevel 'PC' $outSpace.Disk $outSpace.FreeBytes $outSpace.TotalBytes $need 'world bundle (the copy and the tar)' }
else { Write-Host "    WARNING: could not read the free space of the drive of $OutDir" -ForegroundColor Yellow }
if (-not $NoUpload) {
  $dfOut = & ssh -o BatchMode=yes -o ConnectTimeout=10 $PiHost 'df --output=avail,size -B1 /var/lib/foundry-import 2>/dev/null || df --output=avail,size -B1 /var/lib' 2>$null
  $dfCode = $LASTEXITCODE
  $dfLine = @($dfOut | Where-Object { $_ -match '^\s*\d+\s+\d+\s*$' }) | Select-Object -Last 1
  if ($dfCode -ne 0 -or -not $dfLine) {
    Write-Host "    WARNING: could not read the Pi's free space over SSH (exit $dfCode); the upload will fail if it is full" -ForegroundColor Yellow
  } else {
    $nums = ($dfLine.Trim() -split '\s+') | ForEach-Object { [double]$_ }
    Test-SpaceLevel 'Pi' '/var/lib/foundry-import' $nums[0] $nums[1] (3.0 * $total) 'world bundle (the tar, its copy and the installed world)'
  }
}

# --- 6. stage the files -------------------------------------------------------------------------------
Step "copying into $stage"
foreach ($s in $sources) {
  $dest = Join-Path $stage ('Data\' + ($s.Rel -replace '/', '\'))
  New-Item -ItemType Directory -Path $dest -Force | Out-Null
  & robocopy $s.Abs $dest /E /XF LOCK '*.lock' /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Fail "robocopy failed for $($s.Rel) (exit $LASTEXITCODE)" }
}
$global:LASTEXITCODE = 0

Step 'checksums'
$dataRoot = Join-Path $stage 'Data'
$files = Get-ChildItem -LiteralPath $dataRoot -Recurse -File -Force
$prefix = $stage.TrimEnd('\') + '\'
$prefixLen = $prefix.Length
$sums = $files | ForEach-Object -ThrottleLimit 8 -Parallel {
  $h = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  [pscustomobject]@{ Rel = $_.FullName.Substring($using:prefixLen).Replace('\', '/'); Hash = $h }
} | Sort-Object Rel -CaseSensitive
$utf8 = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText((Join-Path $stage 'SHA256SUMS'), (($sums | ForEach-Object { "$($_.Hash)  $($_.Rel)" }) -join "`n") + "`n", $utf8)

$sha = (& git -C $repo rev-parse --short HEAD 2>$null)
$moduleLines = $Modules | ForEach-Object {
  $v = (Get-Content -LiteralPath (Join-Path $DataPath "modules\$_\module.json") -Raw | ConvertFrom-Json).version
  "  $_ $v"
}
$bytes = ($files | Measure-Object Length -Sum).Sum
$manifest = @(
  "world: $World", 'modules:') + $moduleLines + @('asset folders:') + ($assetFolders | ForEach-Object { "  $_" }) + @(
  "files: $($files.Count)", "bytes: $bytes", "built (UTC): $([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ', [CultureInfo]::InvariantCulture))",
  "repo commit: $(if ($sha) { $sha } else { 'unknown' })")
if ($AllowMissing.Count) { $manifest += "allow-missing: $($AllowMissing -join ', ')" }
[System.IO.File]::WriteAllText((Join-Path $stage 'MANIFEST.txt'), ($manifest -join "`n") + "`n", $utf8)

Step 'tar (no compression)'
$bundle = Join-Path $OutDir "$World-$stamp.tar"
# Windows' own bsdtar by full path: a tar from Git Bash's PATH reads "C:" as a remote host.
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
if (-not (Test-Path -LiteralPath $tar)) { $tar = 'tar.exe' }
& $tar -cf $bundle -C $stage .
if ($LASTEXITCODE -ne 0) { Fail "tar failed (exit $LASTEXITCODE)" }
$first = (& $tar -tf $bundle | Select-Object -First 3) -join ', '
Write-Host "    first entries: $first (stage 11 accepts both ./Data/... and Data/...)"
$size = (Get-Item -LiteralPath $bundle).Length
Write-Host ("    bundle {0}, {1} files" -f (Format-Size $size), $files.Count)
Write-Host "    kept at $bundle (the staged copy is in $stage)"

if ($NoUpload) {
  Write-Host '-NoUpload: nothing was sent to the Pi.' -ForegroundColor Yellow
  return
}

# --- 7. upload -----------------------------------------------------------------------------------------
$remoteName = "$World-$stamp.tar"
$minutes = [math]::Max(1, [math]::Ceiling($size / 10MB / 60))
Step ("uploading {0} to {1}:/var/lib/foundry-import/ (about {2} min at 10 MB/s; longer over Tailscale)" -f (Format-Size $size), $PiHost, $minutes)
& ssh $PiHost 'install -d -m 700 /var/lib/foundry-import'
if ($LASTEXITCODE -ne 0) { Fail 'ssh to the Pi failed' }
& scp -q $bundle "${PiHost}:/var/lib/foundry-import/$remoteName"
if ($LASTEXITCODE -ne 0) { Fail 'scp failed' }
Write-Host 'uploaded. Stage 11 has NOT been run. After a snapshot (dietpi-backup 1) and your OK:' -ForegroundColor Green
Write-Host "  cat scripts/pi/remote/lib.sh scripts/pi/remote/11-world.sh | ssh $PiHost 'BUNDLE=/var/lib/foundry-import/$remoteName WORLD=$World bash -s'"
