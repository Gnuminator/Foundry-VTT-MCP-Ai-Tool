### Pi

- **Player connector: email sign-in on the Pi:** stage 30 merges the remote part (`appAudience`, `emailPlayers`, `remoteEndpoint`) into the installed player table without touching the service-token players, allows `player-remote.spennerit.com` in `DASHBOARD_ALLOWED_HOSTS`, checks the table (counts only, never an email) and the 401 on the remote host. `player-connector-cloudflare.mjs --remote` reads the Access application's AUD tag and sends only that part (backlog `remote-player-connector-pi`).
