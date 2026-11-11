### Fixes

- **A spell with no slot no longer says "Attack sent":** `use-item` on a leveled slot spell now casts into the lowest higher slot when the slot at its level is empty, and refuses (nothing used or rolled) when no slot at that level or above is left, so the Attack form no longer toasts a cast Foundry would have dropped. A spell with an unknown level in the Attack form's list has no level suffix (Backlog `attack-form-no-slot`, `pr929-lows-67`).
