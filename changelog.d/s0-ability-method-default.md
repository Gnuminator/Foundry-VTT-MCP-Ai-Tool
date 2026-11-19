### Fixes

- **Actor Studio no longer opens on an empty Abilities tab:** with both Standard Array and Point Buy on, the tab starts on Standard Array (fork change on branch `l-s0/ability-default`, shipped with the next fork release). The player test run (`scripts/test-kit/player-run.mjs`) now picks Standard Array from the method list when the tab does not start on it.
