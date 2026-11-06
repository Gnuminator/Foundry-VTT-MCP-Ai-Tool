### Fixes

- **Tarokka table:** a typed flip line is kept even when the reading fetch after the apply takes
  more than two seconds (the grace now counts from when the fetch began).
- **Dashboard header:** the live screen's Undo keeps its fixed width on a phone, the header button
  rule keeps `[hidden]` working, and the live play switch e2e spec checks `data-gm-actions` in
  every label test.
