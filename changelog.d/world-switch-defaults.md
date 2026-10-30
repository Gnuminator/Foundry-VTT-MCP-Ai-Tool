### Pi

- **World switches (G0):** stage 11 now sets the AI Tool and dnd5e switches a world starts with (Handouts,
  Party, Tarokka and the other live-play writes, Allow Write Operations, GM windows, Auto-apply downed set to
  all, Item Piles trading) in every world it installs or resets, so a reset training world no longer starts with
  them off. A kept world gets them with `WORLD_SWITCHES=1` (its settings are copied to prev first); a Plan B
  push-back never does. The list and the reason for each value is in `docs/dev/PI-SETUP.md`, "World switches".
  Upload `scripts/pi/remote/world-switches.mjs` to `/root/` before the run, or add `WORLD_SWITCHES=0`.
