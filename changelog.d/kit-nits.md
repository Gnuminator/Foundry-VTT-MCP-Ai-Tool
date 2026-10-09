### Test kit

- **A species twin is never picked blind:** when the species list has no heading for the pack, or
  the item is a world item with no pack, and two entries show the same label (a 2014 and a 2024
  entry), `choosePick` used to take the first one; it now fails with a clear reason instead. A lone
  label is still taken. A full label ("Elf, High") that is on the list but cannot be placed now
  fails at once instead of falling through to the short label ("Elf").
- **`dashboard-controls` fails clearly on an old dashboard:** a dashboard whose `/api/state` has
  no `prefs` stops the scenario with a message to start it from the same checkout, instead of
  reading the page's label (the fallback #244 left behind).
