### Orange Pi (D-068)

- **No tunnel while a GM has no password (#273):** stage 12 now checks every world on the Pi first
  and stops, before it installs anything, while any Gamemaster or Assistant GM user has no password
  or a world has no Gamemaster (its next launch would make one with no password). It names the world
  and the user, never a password hash. `gm-passwords.sh` runs the same read-only check on its own.
  On the Pi on 2026-10-10 all four worlds passed.
