### Module

- **The creature index build no longer freezes the GM's browser** (#302 follow-up): a build
  loaded each monster pack with one call, which built every creature at once and froze the bridge
  GM's browser for about 10 seconds per big pack, so a creature query in that time could time out.
  It now loads 50 creatures at a time and lets the browser work in between, and skips pack entries
  that are no creatures. Also from the #302 review: a query on a world with no saved index can no
  longer get an empty answer when the build ends while it reads the file; a file read that began
  before a build ended no longer replaces the newer index (which cost one extra build); a current
  index in memory is served without reading the file again; and after a failed first build,
  creature queries use the basic search for 60 seconds instead of starting (and failing) a full
  build each time. The warm-up at `ready` and the rebuild after a pack change still build.
