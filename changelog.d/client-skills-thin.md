### Skills

- **Thin skills:** the GM coach and D&D helper skills you upload to claude.ai are now small stubs. Their
  rules and reference pages are served by the table's server through the read-only tools
  `get-skill-guide` (core set; GM coach and GM D&D helper) and `get-player-skill-guide` (player
  set; the player edition only), so a server update changes them and nobody uploads a zip again.
  A stub that is older than the server's gets one "Update available" line with the zip to upload.
  The zips (`foundry-gm-coach.zip`, `foundry-dnd-helper.zip`, `foundry-dnd-helper-player.zip`) are
  now stubs and are release files; `--full` on the build scripts still builds the old full zips.
  The core tool set budget rises from 18,500 to 19,500 characters for the new tool.
- **Plugin install (Pro and Max):** the GM coach and the player helper also ship as plugins in the
  public marketplace `Gnuminator/foundry-ai-tool-plugins` (stubs only, synced from the same sources
  as the zips with `node scripts/sync-skill-plugins.mjs <repo>`). Free accounts keep the zip.
