#Requires -Version 7
<#
.SYNOPSIS
  Put the recorder bot's Discord token on the Orange Pi and start the bot (docs/dev/PI-SETUP.md,
  stage 8). You run this yourself; Claude never types or sees the token.

.DESCRIPTION
  Asks for the bot token without showing it (Discord developer page, your application, Bot, Reset
  Token, Copy) and, optionally, the Discord server id (Discord: Settings, Advanced, Developer Mode on;
  then right-click the server, Copy Server ID). With a server id, /record shows up at once; without
  one it registers everywhere the bot is, which can take up to an hour.
  Sends lib.sh, the two values and scripts/pi/remote/set-discord-token.sh to `ssh <PiHost> 'bash -s'`
  on stdin, so the token is not on any command line and not written to a file on this PC. On the Pi it
  replaces DISCORD_TOKEN (and DISCORD_GUILD_ID when given) in /etc/foundry-ai-tool/discord-bot.env,
  keeps the other lines, and starts the bot. Stage 8 (8-recorder.sh) must have run first.
  Run it again to change the token (after Reset Token on the Discord page).

.EXAMPLE
  .\scripts\pi\set-discord-token.ps1
#>
[CmdletBinding()]
param(
  [string]$PiHost = $(if ($env:FVTT_PI_HOST) { $env:FVTT_PI_HOST } else { 'foundry-pi' })
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$remote = Join-Path $PSScriptRoot 'remote'
$lib = Get-Content -Raw (Join-Path $remote 'lib.sh')
$body = Get-Content -Raw (Join-Path $remote 'set-discord-token.sh')

$secure = Read-Host -AsSecureString 'Discord bot token (not shown; paste, then Enter)'
$token = (ConvertFrom-SecureString -SecureString $secure -AsPlainText).Trim()
if ($token -notmatch '^[A-Za-z0-9._-]{50,100}$') {
  throw 'That does not look like a Discord bot token (letters, digits, dots, dashes, 50 to 100 characters). Nothing was sent.'
}
$guild = (Read-Host 'Discord server id (Enter to keep the one on the Pi, or none)').Trim()
if ($guild -and $guild -notmatch '^[0-9]{15,22}$') {
  throw 'The server id must be 15 to 22 digits. Nothing was sent.'
}

# Both values were checked above, so single quotes hold them safely. LF line ends for bash.
# The final `exit` stops bash before the CRLF that PowerShell appends to piped native input (a lone
# CR line would fail as a command under set -e).
$script = ($lib + "`nTOKEN_IN='$token'`nGUILD_IN='$guild'`n" + $body + "`nexit 0`n") -replace "`r`n", "`n"
try {
  # `-- no-log`: the Pi's SSH log (stage 9) records this command by name but never saves its input.
  $script | ssh $PiHost 'bash -s -- no-log'
  if ($LASTEXITCODE -ne 0) { throw "ssh $PiHost failed (exit $LASTEXITCODE); see the lines above" }
} finally {
  $token = $null
  $script = $null
}
