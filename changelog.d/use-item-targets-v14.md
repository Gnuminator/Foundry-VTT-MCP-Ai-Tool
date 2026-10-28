### Fixes

- **use-item with targets works on Foundry 14:** `use-item` with named targets called `game.user.updateTokenTargets`, which Foundry 14 (14.368 and 14.369) does not have, so the call failed before the item was used. Targets are now set through `canvas.tokens.setTargets`. If the canvas is not ready the targets are skipped with a warning and the item is still used.
