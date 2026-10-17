### Security (audit H1, L5)

- **Docker template publishes the Foundry link on loopback only:** `deploy/docker-compose.yml.template` maps `127.0.0.1:31415:31415` instead of `31415:31415`, so the unauthenticated link is no longer open on every host interface. Use the tailnet IP or an SSH tunnel to reach it on purpose. The container still listens on `0.0.0.0` inside (a loopback bind inside the container breaks the published port), now explained in the Dockerfile.
- **Pinned base images:** the Dockerfile uses `node:22.23.3-slim` and compose uses `cloudflared:2026.10.1`, both by digest.
