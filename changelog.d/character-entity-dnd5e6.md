### Fixes

- **`get-character-entity` works on dnd5e 6:** the tool now asks the module for the one item or
  effect (a new `getCharacterEntity` query) instead of reading pf2e fields (traits, action
  types) out of the whole character. Items come with their dnd5e details (spell level and school,
  rarity, quantity, equipped, attunement, uses left) and their activities as the sheet shows them
  (activation, range, target, to-hit, save DC, damage), plus the description and the full system
  data. The character resolves as in `get-character` (partial names, a token on the current
  scene first). A module older than the bridge gets a "update the module" hint.
