### Fixes

- **Item rarity reads as a label in compendium search summaries:** an item's summary says
  "Very Rare" instead of dnd5e's key `veryRare` (all six dnd5e rarities). It also reads the
  `rarities` list that dnd5e 6 source data holds, so world items keep their rarity too.
