### Fixes

- **Use item with a target, no canvas:** `use-item` with `targets` now sets the target when the only GM online is the headless Assistant GM on the Pi (client setting `core.noCanvas`). It fills the user's target set with the scene's token documents, which dnd5e reads for the use card and the attack. On that client no usage dialog is opened (nobody can click it) and the answer says so; leftover targets are cleared when a call names none. A GM whose canvas is still loading keeps the old "targets not set" answer.
