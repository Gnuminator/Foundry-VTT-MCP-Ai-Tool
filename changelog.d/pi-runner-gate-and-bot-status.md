### Pi

- **The GitHub runner gate sees players, not only a marked session:** on the Pi the runners now stay stopped
  while a non-GM player is connected (the play log's `user-join` without a later `user-leave`, a join
  younger than 14 hours), so an unmarked game night is covered too. The unknown-state ceiling is now 14 hours
  and still logged. Takes effect when stage 17 is run again on the Pi.
- **Stage 27, the recorder status endpoint:** a reviewed stage script (`27-bot-status.sh`) sets
  `FOUNDRY_AI_BOT_STATUS_PORT` in the bot's settings and `DASHBOARD_BOT_STATUS_URL` for the dashboard
  (a systemd drop-in), restarts both only when quiet, and checks the endpoint, so the Recorder dot works
  on the Pi. Dry run and undo included; see `docs/dev/PI-SETUP.md`.
