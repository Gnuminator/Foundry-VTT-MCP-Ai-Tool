### Orange Pi

- **The Pi's campaign world is the truth:** `push-world.ps1` refuses `curse-of-strahd` unless it is a Plan B push-back, a copy newer than a named Pi backup (`-NewerThanSnapshot`), or the Pi has no campaign world yet (`-FirstInstall`). Stage 11 now runs its change check for every `REPLACE_WORLD=1` of a world the Pi already has, and refuses `REPLACE_WORLD=1` for a bundle that names no Pi backup, so newer play on the Pi is never replaced silently.
