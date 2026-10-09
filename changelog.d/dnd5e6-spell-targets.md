### Fixes

- **dnd5e 6 spell targets:** spell results from `get-character` and `search-character-items`
  read dnd5e 6's `target.affects`, so single-target spells show their target again ("3
  creatures" for Bless, "1 creature" for Charm Person, "self" for Shield); area spells keep
  "area" plus the size ("20-ft sphere"), and a counted target inside an area keeps its count.
- **dnd5e 6 cleanups:** dropped reads of fields dnd5e 6 does not have: the creature index's
  old CR, type, size, HP, AC, spellcasting and legendary fallbacks (and the `creature` actor
  type), the character entity lookup in `system.actions`, `attributes.spelldc`, the `armor`
  item type (armor is `equipment`; tools and containers now count as equipment in item
  search) and item-level `system.activation` on stat block features.
