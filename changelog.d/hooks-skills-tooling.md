### Fixes

- **Start alert when main CI is red:** the start-alerts hook prints `main CI red since <sha> (<step>)`
  when the newest finished CI run on main failed (cancelled runs are passed over; it stays silent when
  `gh` is missing or offline). `START_ALERTS_MAIN_CI=off` skips it.
- **Planner skill: "Main is red" step:** within 15 minutes revert the last merge or raise the limit by
  one line with a Backlog item, no other merges while main is red, then the proper fix as a normal lane.
- **Edit guard test no longer flakes on a slow runner:** the "100 KB single token" test keeps its
  unread-over-the-cap assertion and uses a generous time bound.
