### Fixes

- **Pi runner gate and Grave patch lows:** the gate logs a kept (vault) runner as "start queued", not "started", because the start is asynchronous; tests pin the stage read-back warning for a stopped vault runner and accept `--no-block` in the board-not-started checks. The Grave Domain patch comments name `world.player-items` and the domain spell grants, with tests for a non-Grave subclass, a subclass without spell grants, and an empty player-classes copy (Backlog `pr918-lows`, `grave-patch-lows-3`).
