### Fixes

- **Tool call log:** a player's `get-my-handouts` and `get-my-play-stats` calls (answered by the dashboard) now reach the call log through a new `record_call` bridge message; day files older than 90 days are deleted. `npm run usage:calls` prints the "bridge writes the log" note only when the PC log is empty.
- **Renown:** `get-renown` no longer returns the creature list (only the planner needs it), "who can join a faction" follows dnd5e's `system.isCreature`, and an unknown faction says that a faction in a compendium has to be imported into the world first.
- **Tools:** the `get-compendium-entry-full` alias now has an end release (0.31) that a test enforces; a relative `FVTT_DATA_DIR` gives an absolute portrait folder.
