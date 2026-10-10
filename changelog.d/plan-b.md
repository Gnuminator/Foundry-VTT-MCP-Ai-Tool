### Orange Pi (D-097)

- **Plan B, the Pi is down on game night:** `scripts/plan-b/` runs the Curse of Strahd world on
  the admin's PC from the Pi's newest backup copy (`E:\PiBackup\restic`, read without a lock).
  `restore.ps1` restores Foundry's data, the bridge vault, the dashboard state and the Assistant GM
  login into `C:\FoundryPlanB` and installs the Foundry version the world needs; `start.ps1` starts
  Foundry, the bridge, the dashboard and a headless Assistant GM (rehearsal ports by default, the
  Pi's own ports with `-GameNight`, which refuses while the Pi still answers); `check.ps1` says
  whether the world and the module link are up; `stop.ps1 -Clean` refuses to delete a world a
  night was played on until it is back on the Pi; `connectors.ps1` points Claude Desktop's
  connectors at Plan B and back. The spare tunnel (`-Tunnel`, `set-tunnel-token.ps1`) is finished
  once Part C is live. Runbook: `docs/dev/PLAN-B.md`; the GM's side is in the game night runbook.
