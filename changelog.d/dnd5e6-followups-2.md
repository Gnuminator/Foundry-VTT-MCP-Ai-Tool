### Fixes

- **dnd5e 6 self-centred spells:** a spell that targets the caster and has an area (Detect Magic,
  Globe of Invulnerability) reads "self" plus its area again, not "area".
- **dnd5e 6 armor in compendium results:** `search-compendium` summaries show the AC of armor and
  shields ("AC 16", "AC +2"), and `get-compendium-item` lists the armor type, AC, strength
  requirement and stealth disadvantage. dnd5e 6 keeps armor as `equipment` with an armor type, so
  the old `armor` item type matched nothing. The `search-character-items` type and category hints
  now list dnd5e 6 item types.
