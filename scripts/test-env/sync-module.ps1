# Copy this repo's Foundry module build into the test Foundry's data folder.
#
# The copy's module.json gets flags.foundry-mcp-bridge.defaultServerPort = the
# test link port, so the test world dials the test bridge (31515), never the
# live one (31415). Run after changing module code, then reload the browser.
#
#   pwsh scripts/test-env/sync-module.ps1            build, then copy
#   pwsh scripts/test-env/sync-module.ps1 -NoBuild   copy the existing build
#   pwsh scripts/test-env/sync-module.ps1 -Watch -Session <local_id> [-NoBuild]
#   ... -Server B                                    test server B's module folder and lock (default A)
#
# -Watch (sync on save, D-102): runs the module's TypeScript build in watch mode (not with
# -NoBuild) and copies the module again after every change to its build (dist, lang, styles,
# templates, module.json), once the files have been quiet for 1.5 seconds. It copies only while
# the session -Session holds the test server lock (lock.ps1), so a half-saved edit never reaches
# another lane's live test. Otherwise it waits, says who holds the lock, and copies once this
# session holds it. It never takes the lock itself. Ctrl+C stops it.
# The build runs with --noEmitOnError (a save with type errors changes nothing, tsc prints the
# errors) through tsc-watch-child.cjs, which exits when this pwsh is gone, even after a hard kill.
# With the build, the first copy waits for its first output, so an older dist/ is never copied;
# with -NoBuild the existing build is copied at once.
# -Root and -Source are for the tests: the lock is read from <Root>/lock.json and the module goes
# to <Root>/modules/foundry-mcp-bridge; -Source replaces packages/foundry-module.
param(
  [switch]$NoBuild,
  [switch]$Watch,
  [string]$Session,
  [string]$Root,
  [string]$Source,
  [ValidateSet('A', 'B')] [string]$Server
)

. (Join-Path $PSScriptRoot 'config.ps1')
Assert-SafePorts

$source = if ($Source) { $Source } else { Join-Path $RepoRoot 'packages' 'foundry-module' }
$dest = if ($Root) { Join-Path $Root 'modules' 'foundry-mcp-bridge' } else { $TestEnv.ModuleDir }
$lockRoot = if ($Root) { $Root } else { $TestEnv.Root }
$parts = 'dist', 'lang', 'styles', 'templates'
# The copy is built here, outside Foundry's modules folder (Foundry never sees a second
# foundry-mcp-bridge), on the same drive, then moved over the old copy in one step.
$stage = Join-Path $lockRoot 'module-sync-staging'

function Copy-ModuleBuild {
  if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
  New-Item -ItemType Directory -Force $stage | Out-Null
  foreach ($item in $parts) {
    $from = Join-Path $source $item
    if (Test-Path $from) { Copy-Item -Recurse $from (Join-Path $stage $item) }
  }

  $manifest = Get-Content (Join-Path $source 'module.json') -Raw | ConvertFrom-Json -AsHashtable
  if (-not $manifest.Contains('flags')) { $manifest['flags'] = @{} }
  $manifest['flags']['foundry-mcp-bridge'] = @{ defaultServerPort = $TestEnv.LinkPort; testInstall = $true }
  # A test copy must never update itself from the release manifest.
  $manifest.Remove('manifest')
  $manifest.Remove('download')
  $manifest | ConvertTo-Json -Depth 20 | Set-Content (Join-Path $stage 'module.json')

  if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
  New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
  Move-Item -LiteralPath $stage -Destination $dest
  return $manifest.version
}

# Every file of the module build as path, size and write time: a change to any of them changes it.
function Get-BuildFingerprint {
  $files = @()
  foreach ($item in $parts) {
    $dir = Join-Path $source $item
    if (Test-Path $dir) { $files += @(Get-ChildItem -LiteralPath $dir -Recurse -File -ErrorAction SilentlyContinue) }
  }
  $manifest = Join-Path $source 'module.json'
  if (Test-Path $manifest) { $files += Get-Item -LiteralPath $manifest }
  return (@($files | Sort-Object FullName | ForEach-Object { "$($_.FullName)|$($_.Length)|$($_.LastWriteTimeUtc.Ticks)" }) -join "`n")
}

function Write-Stamped([string]$Text) {
  Write-Host "[$((Get-Date).ToString('HH:mm:ss', [Globalization.CultureInfo]::InvariantCulture))] $Text"
}

if (-not $Watch) {
  if (-not $NoBuild) {
    $node = Get-NodeExe
    $env:PATH = "$(Split-Path $node)$([IO.Path]::PathSeparator)$env:PATH"
    Push-Location $RepoRoot
    try {
      npm run build:foundry | Out-Host
      if ($LASTEXITCODE -ne 0) { throw 'Module build failed.' }
    } finally { Pop-Location }
  }
  if (-not (Test-Path (Join-Path $source 'dist' 'main.js'))) { throw 'No module build (packages/foundry-module/dist). Run without -NoBuild.' }
  $version = Copy-ModuleBuild
  Write-Host "Module $version copied to $dest (bridge port $($TestEnv.LinkPort))."
  exit 0
}

if (-not $Session -or -not $Session.Trim()) { throw 'sync-module.ps1 -Watch needs -Session <your session id> (the id you take the test server lock with).' }
$Session = $Session.Trim()

$quietMs = 1500
$build = $null
try {
  if (-not $NoBuild) {
    $node = Get-NodeExe
    $tsc = Join-Path $RepoRoot 'node_modules' 'typescript' 'bin' 'tsc'
    if (-not (Test-Path $tsc)) { throw "TypeScript not found at $tsc (run npm ci in this checkout)." }
    $build = Start-Process -FilePath $node -NoNewWindow -PassThru -ArgumentList @(
      "`"$(Join-Path $PSScriptRoot 'tsc-watch-child.cjs')`"", $PID, "`"$tsc`"",
      '-p', "`"$(Join-Path $source 'tsconfig.json')`"", '--watch', '--preserveWatchOutput', '--noEmitOnError')
  }
  Write-Stamped "Watching $source for module build changes; syncing to $dest only while session $Session holds the test server lock. Ctrl+C stops."
  if ($build) { Write-Stamped "Build watch started (pid $($build.Id)); the first copy waits for its first build." }

  $fingerprint = Get-BuildFingerprint
  # Without the build, copy the existing build at once (the test server may hold an older one).
  # With it, wait for tsc's first output: the dist/ on disk may be older than the source.
  $pending = [bool]$NoBuild
  $changedAt = [DateTime]::MinValue
  $said = $null
  while ($true) {
    if ($build -and $build.HasExited) { throw "The module watch build stopped (exit code $($build.ExitCode))." }
    $now = Get-BuildFingerprint
    if ($now -ne $fingerprint) {
      $fingerprint = $now
      $pending = $true
      $changedAt = [DateTime]::UtcNow
    } elseif ($pending -and ([DateTime]::UtcNow - $changedAt).TotalMilliseconds -ge $quietMs) {
      if (-not (Test-Path (Join-Path $source 'dist' 'main.js'))) {
        if ($said -ne 'nobuild') { Write-Stamped 'Waiting: no module build yet (dist/main.js).'; $said = 'nobuild' }
      } else {
        $decision = Resolve-WatchSync (Read-TestLock $lockRoot) $Session
        if ($decision.Action -eq 'sync') {
          try {
            $version = Copy-ModuleBuild
            Write-Stamped "Synced module $version to $dest (bridge port $($TestEnv.LinkPort)). Reload the world to load it."
            $pending = $false
            $said = $null
          } catch {
            # A file still being written, or Foundry reading one: try again after the next quiet spell.
            Write-Stamped "Sync failed, trying again: $($_.Exception.Message)"
            $changedAt = [DateTime]::UtcNow
          }
        } elseif ($decision.Key -ne $said) {
          Write-Stamped $decision.Message
          $said = $decision.Key
        }
      }
    }
    Start-Sleep -Milliseconds 1000
  }
} finally {
  if ($build -and -not $build.HasExited) { Stop-Process -Id $build.Id -Force -ErrorAction SilentlyContinue }
}
