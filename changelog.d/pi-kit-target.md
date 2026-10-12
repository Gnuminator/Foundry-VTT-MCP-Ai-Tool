### Test kit (I-028)

- **The kit can run against the Pi (tools only):** `kit run --target pi --not-game-night` runs the
  scenarios that only call bridge tools against the Orange Pi's throwaway world `strahd-kit`, to
  find out which tools need a canvas that the Pi's no-screen GM browser does not have. It is opt-in
  and never the default, refuses any other command than `run`, any other world, `--fake`, this PC as
  the host and the live bridge ports, and stops unless the Pi's Foundry is launching `strahd-kit`. A guard in front of the dashboard
  client lets a scenario call only the tools it declared, and only read or `plan-*` tools, and
  re-checks the world before each call.
  Host and ports come from a targets file outside the repo (no secret in it). The new scenario
  `canvas-tools-headless` calls ten read or plan tools and logs, per tool, whether it worked or
  failed for want of a canvas; it also runs in a normal local run as the baseline.
- **`fetch-kit-login.ps1`:** copies the kit session's `Kit GM` password to a file on this PC with one
  read-only command, without printing it; `-Remove` deletes it.

### Orange Pi (D-068)

- **The kit session gives the kit a GM:** `kit-session.sh MODE=up` also makes the GM user `Kit GM`
  in `strahd-kit` with a generated password (kept in a root-only file on the Pi), enables the bridge
  module there, makes `Kit GM` the bridge user and starts a transient headless browser that joins as
  `Kit GM` and holds the bridge link (the real Assistant GM browser stays stopped, as before).
  `MODE=down` stops that browser, resets the bridge user, deletes `Kit GM` and removes the password
  file and the browser profile. A failed or dropped `MODE=up` puts everything back.
