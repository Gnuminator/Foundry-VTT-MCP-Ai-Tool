### Module

- **The creature index rebuilds when the world loads, not on the first query:** when the bridge GM's
  world loads and the saved creature index is missing or out of date (a module update changed its
  version, or the monster packs changed), the module rebuilds it in the background with its usual
  progress notes. The first creature search no longer runs into the 10 second query limit on a big
  world (18.8 s measured with seven monster packs). A search during the rebuild waits for that same
  rebuild instead of starting a second one, and so does the "Rebuild Creature Index" button.

### Test kit

- **The kit waits for the creature index:** before it picks monsters, the kit waits (with no time
  limit) for the module's creature index to be current, using the new `ensureCreatureIndex` GM
  action, and logs how long a rebuild took.
