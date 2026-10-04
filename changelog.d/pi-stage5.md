### Orange Pi (D-068)

- **Stage 5, the tool on the Pi** (`scripts/pi/remote/5-tool.sh`): builds a release tag on the Pi
  (default `v0.21.0`), copies the module into Foundry from the same build, and runs the bridge, the
  dashboard and a headless Chromium logged in as the Assistant GM user (`assistant-gm.mjs`, role
  Assistant, no canvas) as services. Everything listens on loopback; Tailscale serve shares the
  control port and the dashboard with the tailnet only. `5-check-world.sh` proves the chain in a
  throwaway world `pi-check` (dnd5e, launched by `options.json`, generated passwords in root-only
  files, nothing typed).
