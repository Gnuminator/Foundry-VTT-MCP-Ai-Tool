### Pi

- **Vault sync check and time zone (stage 20, Obsidian O8):** `scripts/pi/remote/20-vault-sync.sh` reports where the GM vault
  sits and on which disk, which PCs are connected, every `.sync-conflict-*` file (the same note changed on two PCs) and whether
  the Pi is on `Europe/Copenhagen`. It only reads unless `SET_TIMEZONE=1` (snapshot and OK first), and never touches a vault
  file. Tested with two real Syncthings in the ARM64 container.
