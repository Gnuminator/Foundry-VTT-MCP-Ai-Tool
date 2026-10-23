### NPC turn assistant (I-125; lows from the PR #456 review)

- **A creature's square costs one more, as in dnd5e:** a creature inside a core movement-cost region
  now adds a square on top of the region's cost (2x makes 3x); only dnd5e's own Difficult Terrain
  already counts as that square.
- **Creatures at another height are left out:** a creature outside the NPC's elevation band (one grid
  distance) neither blocks nor slows, and a token with no actor is no creature. The drawn map and the
  scene-data fallback now agree.
- **The plan note says the real rules:** "a creature of another disposition (neutral too) blocks
  unless ..."; "creatures do not block" when dnd5e movement automation is not full; and, when the map
  is drawn, that tokens selected in Foundry are ignored.

### Module (lows from the PR #455 review)

- **User-create check is stricter:** a created User may carry a `permissions` entry only when its
  value is exactly `false`, so Foundry's serialized operator objects cannot get through.

### Obsidian (lows from the PR #445 review)

- **Redo without a Recap page:** when an undone then redone notes journal comes back without its Recap
  page, the put is restored without queuing the Recap and the notes show an error naming the missing
  page, instead of dropping the put.
