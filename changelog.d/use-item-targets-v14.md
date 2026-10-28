### Fixes

- **use-item with targets works on Foundry 14:** `use-item` with named targets called `game.user.updateTokenTargets`, which Foundry 14 (14.368 and 14.369) does not have, so the call failed before the item was used. Targets are now set through `canvas.tokens.setTargets`. If the canvas is not ready, shows another scene than the active one, or Foundry refuses, the item is still used, the targets are left alone, and the answer says "targets not set" instead of claiming a target.
