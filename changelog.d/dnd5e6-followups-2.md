### Fixes

- **dnd5e 6 self-centred spells:** a spell that targets the caster and has an area (Detect Magic,
  Globe of Invulnerability) reads "self" plus its area again, not "area".
- **Compendium search summaries work again:** dnd5e's compendium index holds no spell, weapon
  or armor fields, so `search-compendium` summaries were only "spell from Spells". The module now
  indexes Item packs once with those fields, so summaries show spell level ("Cantrip", "Level
  1") and school, weapon damage, the AC of armor and shields ("AC 16", "AC +2"), rarity and
  price. dnd5e 6 keeps armor as `equipment` with an armor type, so `get-compendium-item` now
  lists the armor type, AC, strength requirement and stealth disadvantage (the old `armor` item
  type matched nothing). The `search-character-items` type and category hints list dnd5e 6 item
  types.
- **Item properties and activities in tool output:** dnd5e 6 keeps item `properties` in a Set
  and `activities` in a Collection, which tool output turned into `{}`. They now come through as
  arrays (weapon properties, stealth disadvantage, each activity's data).
