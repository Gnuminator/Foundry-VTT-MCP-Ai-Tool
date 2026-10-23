### Rules check (I-126; second PR)

- **Spent actions:** with the `rules-check` switch on, `check-action` (and the pre-check in front of use-item and attack requests) now warns when the creature has already used its action, bonus action or reaction this turn. The module keeps a short ledger of the activities used through Foundry and counts them from the start of the creature's own turn, so a reaction stays spent until its next turn. A second weapon attack is treated as Extra Attack, not a second action.
- **Stated limit:** only what was used through Foundry is seen. Dash, Dodge, Help, hand-rolled attacks and extra actions (Action Surge, haste) are not, and the report says so.
- **2014 and 2024:** the report adds a rules-version line and warns when an item follows different rules from the creature using it.
- **Fixes:** two same-named combatants are now reported as "cannot tell whose turn" instead of picking the first; the `check-action` description mentions concentration and spent actions again.
- **Module:** new read-only bridge query `getSpentActions`.
