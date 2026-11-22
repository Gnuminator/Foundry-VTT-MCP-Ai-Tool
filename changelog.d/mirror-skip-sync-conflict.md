### Obsidian

- **The mirror ignores Syncthing conflict copies:** a `note.sync-conflict-<date>-<id>.md` next to a mirror note is no longer read as a mirror note (before, an unedited copy could win over the edited original). The copies are listed in `_status.md` under "Sync conflict copies (safe to delete)" (backlog `mirror-skip-sync-conflict`).
