### Module

- **The creature index sees pack changes again and rebuilds them in the background** (#283
  lows 1, 3, 4): the index listened to `createDocument`, `updateDocument`, `deleteDocument`,
  `createCompendium` and `deleteCompendium`, hooks Foundry 14 does not have, so a changed Actor
  pack never invalidated it. It now listens to `updateCompendium`. After a creature change the
  saved index is deleted as before, and five seconds after the last change the bridge GM's
  browser (with Bridge User "Any GM": the active GM's) builds it again, so the next creature
  query does not wait on the build. The warm-up at `ready` still runs in every GM browser with
  "Any GM". Tests cover the warm-up gates, the hook and the background rebuild.
