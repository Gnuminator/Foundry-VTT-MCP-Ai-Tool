### Test kit (D-110)

- **Module control sweep inside Foundry:** a new scenario, `foundry-controls`, opens, clicks and checks every
  control the module adds inside Foundry as the GM and as a player: the AI Tool scene controls, the Changes,
  Handouts and Tarokka windows (with a guarded damage change planned, applied, undone and redone from the
  window), the settings section and its menus, the join page look, the journal status toggle and the roll
  request card. A player must not see or call any of them. The sweep puts back what it changed in cleanups
  that try every put-back, and a row fails on a console error of either page. The GM guide link is read
  without opening a tab. Sizes: smoke, full and long (the scenario adds several minutes to a smoke run).
- **Report numbers:** the scenario attaches `foundry-controls` (one row per control and role),
  `foundry-timings` (milliseconds for opening each window and for the guarded round trip) and
  `foundry-control-classes`. A unit test keeps the table in step with the usage catalog and with the drivers.
