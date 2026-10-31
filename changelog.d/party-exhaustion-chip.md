### Fixes

- **Party: one Exhaustion chip, however often the drawer redraws:** the chip was added to the
  member's own condition list on every render, so a second render showed "Exhaustion 1" twice and a
  third thrice. It is added to a copy now. This was also what made the Live screen screenshots flake.
