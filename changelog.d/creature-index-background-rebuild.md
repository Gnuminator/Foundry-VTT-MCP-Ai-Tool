### Module

- **The creature index sees pack changes again and rebuilds them in the background** (#283
  lows 1, 3, 4): the index listened to `createDocument`, `updateDocument`, `deleteDocument`,
  `createCompendium` and `deleteCompendium`, hooks Foundry 14 does not have, so a changed Actor
  pack never invalidated it. It now listens to `updateCompendium`. The old invalidation sent a
  `DELETE` for the saved index, which Foundry's server ignores, so a creature change now writes
  its time to a hidden world setting (`creatureIndexDirtyAt`) from every GM browser, and a saved
  index built before that time counts as stale in every browser. Five seconds after the last
  change the bridge GM's browser (with Bridge User "Any GM": the active GM's) builds the index
  again. Creature queries no longer wait for that build: they get the saved index until the new
  one is ready, and only a world with no usable saved index waits. The warm-up at `ready` still
  runs in every GM browser with "Any GM". Still not seen: an edit to a feature or spell inside a
  compendium creature (Foundry fires no `updateCompendium` for it); a later pack change or
  "Rebuild Creature Index" in the Enhanced Index window picks it up. Tests cover the warm-up gates, the
  hook, the stale stamp, stale reads and the background rebuild.
