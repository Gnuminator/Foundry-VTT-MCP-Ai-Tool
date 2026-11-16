### Obsidian

- **A stale mirror or player vault now shows in the pre-flight:** the Obsidian line warns when the Foundry mirror has not finished a cycle for ten minutes while Foundry is connected, or its last cycle failed. The dashboard pre-flight gets a "Player vaults up to date" line that warns when a player's vault was not written or no clean pass ran for ten minutes. Nobody had to open `_status.md` before to find out.
- **Sync check on the Pi:** `scripts/pi/remote/sync-check.sh` is a read-only report of when Syncthing last synced each vault folder and when each PC was last seen. It warns about a PC that never connected, was last seen more than 48 hours ago (`STALE_HOURS`), or is still catching up. `STRICT=1` makes a warning exit 1.
