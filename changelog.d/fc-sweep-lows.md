### Test kit

- **`foundry-controls` sweep lows (#328 review) closed:** `foundry.changes.filter` now runs after the
  window's own Undo and Redo and also picks the GM from the Show list (only that person's rows, none of the
  AI's), and `foundry.tarokka.open-doc` is a row of its own after the first reveal was undone (it does a
  second reveal and undoes it) instead of a row nested inside `foundry.tarokka.reveal`, so a console error is
  no longer counted for both rows.
