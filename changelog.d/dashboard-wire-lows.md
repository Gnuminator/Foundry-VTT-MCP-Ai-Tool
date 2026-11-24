### Dashboard

- **Spotlight matches characters by actor id:** the tally now sends each character's actor id, and
  the card pairs it with the party roster by id, so a log name that shares a first word with
  another character no longer folds into the wrong row (dashboard-wire-lows).
- **Changes link waits for the note:** `list-recent-changes` adds `notePartWritten`, and the
  Obsidian export records which Changes notes it wrote. The note link opens the month note until a
  new `-pN` part exists, instead of a note that is not there yet.

### Module

- **Picture change says "100 of N":** the player-portrait upload reply adds `placedTotal`, so the
  plan for a character with more than 100 placed tokens says how many were left out.
