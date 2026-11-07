### Pi

- **Stage 24 reads `deploy/pi/.env` like compose:** a trailing `# comment` and spaces around a value no longer slip a live data folder past the refusal, and a shell value that is set but empty is no longer replaced by the `.env` value. The "must be an absolute path" rule now applies only to `up` and `cutover`, so `down` and `rollback` are never blocked by it.
- **Stage 23 checks what `daemon.json` says:** it looks for `live-restore` instead of only that the file exists, and asks `docker info` a few times after the reload.
- **Remote-command guard:** docker's `--tlscacert`, `--tlscert` and `--tlskey` options no longer hide `compose down` or `docker rm` from the ask rule.

### Docs

- **Cloudflare Access policy:** notes that a request is refused when `PLAYER_DASHBOARD_TOKEN` is set and not presented.

### Tooling

- **`npm run green`:** the `installIsFresh` comment and test name now say exactly what the freshness check catches.
