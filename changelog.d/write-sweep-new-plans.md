### Tests

- **The live write sweep covers six more plan tools:** `plan-npc-turn`, `plan-scene-mood`, `plan-paper-sync`, `plan-room-setup`, `plan-macro` and `plan-foundry-setup` now run plan, apply, read back, undo and read back on a test server, with their switches turned on and put back. `plan-scene-restore` stays a recorded skip (it needs a backup copy of the world on disk), and the coverage test still fails for a `plan-*` tool that is in neither the sweep nor the skip list. The sweep takes `--server A|B|C` to run on a free test server (`write-sweep-new-plans`).
