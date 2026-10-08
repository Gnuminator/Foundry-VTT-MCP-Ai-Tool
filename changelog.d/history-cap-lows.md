### Undo for everything (I-109)

- **No half undo after a history cap:** when the change history had to leave out an AI change's
  own records (its size cap, a day's cut, or the journal start), or the journal lost them, "just
  this" on that change is refused if it deleted an item or effect, because what dnd5e ended with
  it (concentration, a Bless on another character) would not come back. Other such changes are still undone, with a
  note that what Foundry and dnd5e did with them does not come back.
- **A stream of changes is no longer one endless action:** a browser starts a new change group
  after 30 seconds or 2000 operations even without a pause, so a module or macro that updates a
  document several times a second can no longer hide every later change from that browser once
  a cap drops its group. A guarded AI write is never split from what dnd5e does right after it,
  however long the apply runs.
- **A concentration effect cast from a wand, or named by the base actor's uuid, stays with its
  own change** when a later AI change in the same burst deletes another item on that actor: the
  effect is matched by item id, and a wand's cached spell by the wand it was cast from.
- **No partial action at the history's start:** an action with a record within a few seconds
  after the journal start (retention removed the day before, or Foundry's buffer wrapped) may
  have lost its first records, so it is left out whole and the history says it is complete only after it.
