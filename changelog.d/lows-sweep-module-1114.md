### Module

- **Casting a spell with a pact slot:** a multiclass warlock's pact slot now counts for a spell cast with a normal slot when it is the lowest slot that fits. `spellLevel` must be a whole number from 1 to 9 and may not be lower than the spell's own level (the item is not used). With an attack form (`rollAttack`), with no dialog (no-canvas browser) or with one usable activity, only that activity's "consume spell slot" box counts; with a dialog and several activities, a spell with any no-slot activity is left to dnd5e. The no-canvas message names the level when a slot was switched.
- **Character creation:** a class that sits inside a container no longer becomes the character's original class.
- **Live window:** it follows Foundry's light or dark change through the `core.uiConfig` setting hook (also when only the interface theme changes) instead of the settings-window close hook.
- **Error buffer:** a world without an id now logs a warning instead of silently not saving the buffer.

### Fixes

- **Live window and dashboard:** the Live window's light theme beats the theme file load order and drops an unused block; the Live-views guide (English and Danish) says the window follows Foundry's light or dark setting. The studio pin check accepts `--stage=x` and `--base=x` and exits 2 on an unknown argument.
