### Fixes

- **get-compendium-item shows the same rarity as the search:** the item detail gives the label
  ("Very Rare") from `rarity` or dnd5e 6's `rarities` list instead of the raw key, and a blank
  `rarity` no longer hides a filled `rarities` list (search summary and detail).
