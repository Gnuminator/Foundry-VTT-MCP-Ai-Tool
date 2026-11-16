### Fixes

- **Merge runner: no wait for main's running CI when the PR was tested on main's tip:** while main's
  newest CI run is still going and the run before it passed, the runner now gates a ready PR at once
  when that PR's green CI ran on top of main's current tip (its head contains the tip, or a green
  pull request run was created after the tip commit). A red main still stops the runner, and the gate
  still reads main itself.
