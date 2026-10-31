### Fixes

- **Use item with a target, no canvas:** `use-item` with `targets` now sets the target when the only GM online is the headless Assistant GM on the Pi (no canvas). It fills the user's target set with the scene's token documents, which dnd5e reads for the use card and the attack. If Foundry refuses, the answer still says the targets were not set.
