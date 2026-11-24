### Tests

- **Tests lows sweep:** the recorder rehearsal exits 1 when the vault push fails and reads the
  discord-bot version; the demo rehearsal wakes from its lock queue on a stop signal, handles
  SIGHUP and falls back when taskkill fails; the live write sweep skips the foundry-setup step
  without dnd5e and checks `--server` with `Object.hasOwn`; the Obsidian mirror scenario scopes its
  skipped check to its own notes (lows-sweep-tests-2026-11-24).
