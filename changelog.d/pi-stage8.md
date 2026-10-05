### Orange Pi (D-068)

- **Stage 8, the recorder bot** (`scripts/pi/remote/8-recorder.sh`): installs the Discord recorder
  bot from the stage 5 build into `/opt/foundry-ai-tool/discord-bot` (its dependencies pinned to the
  versions that build installed; the previous copy kept for a rollback), checks that discord.js and
  its native part load on the board, makes `/var/lib/foundry-ai-tool/recordings` (2770), writes
  `/etc/foundry-ai-tool/discord-bot.env` from the example when it is missing and installs the
  service from `packages/discord-bot/deploy`. The service stays off until the env file has a token;
  an update stops a running bot first, which closes and converts a recording in progress.
- **`scripts/pi/set-discord-token.ps1`:** asks for the bot token without showing it (and optionally
  the server id), sends it to the Pi on stdin (never on a command line or in a file on the PC),
  replaces only those lines in the env file and starts the bot; it shows only the bot's login line
  from the journal.
