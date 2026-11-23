### Orange Pi

- **A release, module update, world switch or kit run works with the stack in containers:** stage 5, stage 21, stage 25,
  `switch-world` and `kit-session` no longer refuse after the Docker cutover. They stop and start the existing containers,
  stage 5 builds the images before it stops anything and recreates only the containers that changed, and stage 21 keeps the
  player vault switch in `deploy/pi/.env` (D-149; Backlog `pi-compose-day-two`). Systemd Pis behave as before.
