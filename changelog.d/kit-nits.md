### Test kit

- **A species twin is never picked blind:** when the species list has no heading for the pack and
  two books show the same label (a 2014 and a 2024 entry), `choosePick` used to take the first
  one when the pack had only one entry with that label; it now fails with a clear reason instead.
- **`dashboard-controls` fails clearly on an old dashboard:** a dashboard whose `/api/state` has
  no `prefs` stops the combat rows with a message to start it from the same checkout, instead of
  reading the page's label (the fallback #244 left behind).
