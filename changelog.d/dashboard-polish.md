### Dashboard

- **Lighter danger text:** one new colour, `--bad-text` (the danger red mixed toward the text colour, as the Enemy tag already did), is used for red text on its own tint on both dashboards: the Damage and Death chip, the module error badge, death saves, Destructive tags, the Not ready line and the Pre-flight button. They now pass the contrast check, and their entries are gone from the known-violation lists.
- **Keyboard and screen reader fixes (React dashboard):** the change list in the confirm window and the Module Diagnostics list can be scrolled with the keyboard, and an empty picker no longer announces an empty listbox.
- **Old dashboard:** a first failed play-session read now shows Before instead of no screen, and Stop (or Use) on the layout trial gives the page back instead of pinning it to During.
