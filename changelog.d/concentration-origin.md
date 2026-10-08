### Undo for everything (I-109)

- **A concentration effect stays with the spell that ended it:** when one AI change deletes a
  concentration spell and the next deletes another item on the same actor in the same burst,
  dnd5e's late delete of the concentration effect (and the buffs it held) is filed under the
  change that deleted that spell, read from the effect's own data, so "just this" on either
  change puts back the right things.
