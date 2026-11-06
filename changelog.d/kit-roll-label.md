### Module

- **An empty Tarokka reveal text is a warning:** the Tarokka window shows "Write the text the players will read first." as a warning notification, no longer as an error, so it does not log a console error.

### Test kit

- **The roll request card sweep** looks for dnd5e's own label ("Strength Ability Check") and still finds the card after the player has rolled and the card has been rewritten.
- **Advancement names:** the kit reads an advancement's `name` before its old `title`.
- **Known upstream module findings:** the module list in `scripts/modules/expected.json` now covers Actor Studio's level-up trace lines and "FSM not in idle state" warning and dnd5e 6's "Advancement title moved to name" notice, so `module-load` no longer fails on them.
