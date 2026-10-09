### Fixes

- **dnd5e 6 spells:** the "My character" sheet and the character tools no longer show innate,
  at-will and ritual spells as unprepared; prepared and always-prepared spells read dnd5e 6's
  `method` and `prepared`. Class spell lists group spells by the class that grants them
  (`sourceItem` "class:wizard", subclasses resolved to their class), so they no longer all
  land in "general"; spells from species or feats show under "Other Spells" instead of
  vanishing, and each class entry carries its spell save DC and attack bonus.
- **dnd5e 6 resources:** a character's hit die type is read from its class items (it was
  empty for player characters; a multiclass shows "d10/d8"), NPC hit dice read the numeric
  die, and recharge abilities read as "recharge 5-6" from `uses.recovery`.
- **dnd5e 6 cleanups:** the play log drops update paths dnd5e 6 never sends (`uses.value`,
  `hitDiceUsed`), and the creature index stores the biography text instead of dnd5e 6's
  `{value, public}` object, so creature search results carry a text description.
