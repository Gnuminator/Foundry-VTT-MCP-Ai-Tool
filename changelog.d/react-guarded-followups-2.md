### Dashboard

- **React dashboard: guarded changes after the #243 review:** an apply or undo whose answer got
  lost on the way back (the bridge link dropped, a proxy gave up, or the network failed) now says
  it may have applied and points to Recent Changes, as a timeout already did. Opening Pre-flight
  before the live stream has sent its settings no longer leaves the GM Actions gate shut while
  Pre-flight shows GM Actions on. A tool answer that says it failed is logged with its kind, not
  as a network error.
