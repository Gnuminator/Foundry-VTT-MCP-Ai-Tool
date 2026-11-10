### Fixes

- **Pi runner gate, follow-ups:** the gate now starts the board-keeping vault runner without waiting (`--no-block`), so a slow start can no longer delay stopping the board runner. Its journal line says "(kept)" instead of "idle" during play. Tests cover the vault runner in the unknown state and no longer pick up `GATE_KEEP_UNITS` from the environment. Stale "both runners" wording is fixed in the stage 17 script and PI-SETUP. Needs a stage 17 rerun on the Pi to take effect.
