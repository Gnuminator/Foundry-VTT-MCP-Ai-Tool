### Module

- **Creature index: fewer and safer background builds** (#293 delta review 2 lows): after a
  failed build, creature queries serve the saved index and start no new build for 60 seconds, so
  a build that keeps failing (an upload denied, a full disk) no longer runs and shows its error on
  every query. While a build runs, queries serve the index already in memory instead of reading
  and parsing the file again. The `creatureIndexDirtyAt` stamp now only goes up, and a build saves
  the stamp it saw instead of its own start time, so clock differences between GM PCs neither hide
  a creature change nor cause extra builds. The warm-up builds once more when the build it waited
  for turned stale meanwhile. A new test runs the whole loop (edit, stamp, old index served, real
  rebuild, new index) with no stubbed build.
