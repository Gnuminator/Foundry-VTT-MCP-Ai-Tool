### Pi

- **The Pi stack in containers (ready to rehearse, not switched on):** `deploy/pi/` has a Docker Compose file for Foundry,
  the bridge, the co-GM dashboard and the Assistant GM, each with a health check and `restart: unless-stopped`, so
  Foundry comes back after a clean exit. Stage 22 installs Docker and builds the images, stage 23 starts, stops,
  cuts over and rolls back the stack. A cutover stops and disables the systemd units but leaves them installed, and
  rollback is one command. Nothing changes on the Pi until a stage is run with the user's OK.
- **Assistant GM link check:** the bridge answers a new `link_status` control call with whether the Foundry module's
  socket is connected. In the container the Assistant GM restarts its browser when the bridge listens but has had no
  module socket for 2 minutes, and the container health check shows the same state.
