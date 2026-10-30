### Dashboard

- **Danni's picks are the defaults (2026-10-30):** the During screen starts on the Auto layout (the layout is counted as picked, so the "try the layouts" card stays away), the Combat buttons start on, and players no longer see a health band on enemies (`PLAYER_SHOW_ENEMY_HP_BANDS` now defaults to false; set it to true to bring the bands back). A world that already saved its own choices keeps them.
- **Quick Undo checked:** undoing a normal HP or condition change already needs no "I understand" tick; it only shows for undoing a created or deleted thing and for undo-all rewinds. No change needed.

### Modules

- **Not Your Turn blocks players:** `scripts/modules/strahd-modules.json` records `BlockPlayer` and `BlockTrusted` as Autoblock (3) and `BlockAssistant` and `BlockGM` as Warning Only (1), so AI token moves are never blocked. The foundry-modules page says so. Applying it to the Pi world is a separate step.
