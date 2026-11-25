### Test kit

- **Pi soak:** `kit-session.sh MODE=up SOAK_PLAYERS=5` makes the passwordless players `Kit Player 2` to `Kit Player 5` in the Pi's `strahd-kit`, and `MODE=down` removes them again. `node scripts/test-kit/pi-soak.mjs --not-game-night` then runs five headless players against the Pi for three hours, samples the Pi over read-only ssh and writes a pass or fail report against the I-098 bar. With `--writes` it also times a small plan, apply and undo and an NPC roll on `strahd-kit` only, through a guard of its own.
