### Pi

- **The Pi stack in containers (ready to rehearse, not switched on):** `deploy/pi/` has a Docker Compose file for Foundry,
  the bridge, the co-GM dashboard and the Assistant GM, each with a health check and `restart: unless-stopped`, so
  Foundry comes back after a clean exit. Stage 23 installs Docker and builds the images, stage 24 starts and stops
  the stack for a rehearsal on other ports (its own compose project) and rolls back to the units in one command. The
  switch itself (`MODE=cutover`) is refused until the nightly backup and the other stages know the stack. Nothing
  changes on the Pi until a stage is run with the user's OK.
- **Assistant GM link check:** the bridge answers a new `link_status` control call with whether the Foundry module's
  socket is connected. In the container the Assistant GM, when it is the module's bridge user, restarts its browser
  when the bridge listens but has had no module socket for 2 minutes (at most 3 times in 6 hours), and the container
  health check shows the same state.
