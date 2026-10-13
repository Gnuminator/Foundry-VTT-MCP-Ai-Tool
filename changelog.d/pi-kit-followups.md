### Orange Pi (D-068)

- **Pi kit follow-ups (after the first live kit session, 2026-10-13):** the health check (`1-health.sh`) warns
  "kit session up since" plus the time while a kit session was never taken down (Foundry would launch `strahd-kit` on game
  night). Stages 11 and 13 now change `options.json` as the `foundry` user through a temp file and a rename, like
  `kit-session.sh`, so root never writes through a folder the foundry user owns. The nightly backup (stage 6) leaves out
  the Kit GM browser profile like the Assistant GM's. The test kit docs now say the Pi target's `host` must be the Pi's
  full Tailscale name (the dashboard answers anything else with HTTP 421) and that the dashboard token file is optional.
  The stage scripts are changed in the repo only; they are deployed on the next reviewed stage run.
