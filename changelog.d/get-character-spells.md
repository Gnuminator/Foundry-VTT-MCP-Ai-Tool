### Fixes

- **`get-character` spells and creature type:** `stats.spellcasting.hasSpells` now follows the
  actor's spell items (and real spell slots) instead of the spellcasting ability, which the 2024
  monsters set on every NPC (a Wolf has one) while real casters can have spell items and no ability.
  An unset creature type is left out of `stats` instead of showing as `{}`.
