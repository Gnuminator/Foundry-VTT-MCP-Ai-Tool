### Test kit

- **Tarokka offer dialog covered by the `foundry-controls` sweep:** `module.tarokka.offer-confirm` and
  `module.tarokka.offer-decline` now run instead of being skipped. The sweep lets the GM client see an
  active `tarokka-reading` module with a `secret` setting for the length of the two rows (the real module
  is used when the world has it and has nothing dealt), deals a new reading, and checks that Yes offers it and No says nothing.
- **Sweep review lows (#328) closed:** the player feature-switches row skips when the settings window was
  never read, `playerSettings` always closes its window, an announced console error is excused only inside
  its own row's time window, a skipped row hands its errors to the last step, the handout and Tarokka
  undo choose the new change against the Changes window's own row ids, the roll-card and open-document
  checks compare against what was there before the click, a reveal journal left behind by undo fails the
  Tarokka cleanup, and the row runner and dialog helpers have unit tests.
