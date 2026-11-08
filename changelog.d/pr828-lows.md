### Orange Pi (pr828 lows)

- **Plan B restore keeps an app folder:** if the final rename of the freshly unpacked Foundry app fails (a file lock), `restore.ps1` retries three times, then moves the old app folder back and says where the new one is, instead of leaving none.
- **Stage 26 UNDO:** an unreadable saved file now stops the undo with a message, instead of reading as "key absent" and dropping all six keys.
- **Seven books trim:** the dry run's "packs the real run hides" line now includes `dnd5e.items` and `dnd5e.monsters` when a copied creature links into them.
- **Docs:** the runner gate, stage 27 and stage 26 sections of the Pi setup guide describe the session-end cutoff, the busy-port check, the UNDO rerun and the six managed keys.
