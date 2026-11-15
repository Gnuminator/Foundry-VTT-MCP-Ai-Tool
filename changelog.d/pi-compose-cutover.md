### Orange Pi

- **The Docker cutover can run:** stage 24 `MODE=cutover` is no longer refused. Once the stack runs as containers, every stage
  that would start, restart or enable Foundry, the bridge, the dashboard or the Assistant GM stops at once ("the stack runs
  as containers") before it changes anything, also with `FORCE=1`, also for a stopped container, and also when the Docker
  daemon does not answer. A test fails for a new stage that starts a unit without the guard. The Discord bot stays a unit and
  its stages are not guarded.
- **The nightly backup knows the containers:** it stops and starts the Foundry container, checks that it is stopped before
  restic copies the worlds, leaves the Assistant GM out of the player count, and reports an error when the Docker daemon is
  silent and `foundry.service` is not running. Run stage 6 again before the cutover to get the new script: `MODE=cutover` refuses, dry run
  too, while the installed script does not know the containers.
- **Cutover and rollback are written down as two sittings** (a rehearsal on other ports, then the switch with a dry run first)
  in `deploy/pi/README.md` and `docs/dev/PI-SETUP.md`. Nothing was run on the Pi; the new tests run stand-ins in an ARM64
  container (Backlog `pi-compose-cutover`).
