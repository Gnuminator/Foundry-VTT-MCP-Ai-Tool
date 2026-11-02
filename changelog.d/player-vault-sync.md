### Obsidian (player vault sync, D-134)

- **The player vault reaches the players who want it:** a new Pi stage, `21-player-vault.sh`, switches on the dashboard's player
  vaults on the Pi and shares each player's folder with that player's own devices over Syncthing, Send Only on the Pi, so nothing
  a player changes reaches the Pi. A player who does not ask installs nothing. One device belongs to one player and never to the GM
  vault. It reports, adds, removes and switches everything off; changes need a snapshot and the user's OK. Tested with three real
  Syncthings in the ARM64 container.
- **Player guide:** `docs/player/obsidian.md` (English and Danish) covers installing Obsidian and Syncthing, accepting the share,
  what is in the vault and how to stop.
