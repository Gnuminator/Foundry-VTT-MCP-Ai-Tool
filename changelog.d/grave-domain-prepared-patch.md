### Orange Pi

- **Grave Domain spells always prepared:** the Grave Domain content patch (`MODE=grave-patch`) now also sets the five Domain Spells grants on the subclass to always prepared (they came from the D&D Beyond import as not prepared, so a cleric rebuilt through Actor Studio got the domain spells unprepared). `MODE=grave-check` looks at the player copy too. Existing characters keep what they have; the Pi gets it in a later sitting (Backlog `grave-domain-prepared-patch`).
- **Grave patch test lows:** the check error says "run the baseline" when only the player copies are behind, the Use activity check is one helper for the module pack and the player copy, and new tests cover the `<hr />` form and the player-copy message (Backlog `grave-patch-lows-2`).
