### Development

- **The steward's leftovers are gone (D-122 phase 3):** the start hook no longer prints the
  "lanes over 200k context" line (each session's own context hook warns it instead); the old
  in-repo project dashboard drops the lanes table, `--lanes` and the steward's place in the lane
  cap; the `lane` skill's merge command is one `&&` chain that never runs an empty copy of the gate.
