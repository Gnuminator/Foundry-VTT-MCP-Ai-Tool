### Dev tooling

- **`usage:week` target labels read `TARGETS` (#315 round 2 L1):** the text after each figure in the targets line (`<=75k`, `<=18`, `~15`, `~14`) is built from `TARGETS`, so changing a target changes the line. A new test puts every figure exactly on its target (all `ok`) and checks the labels follow a changed `TARGETS`.
