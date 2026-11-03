### Fixes

- **The Docker template builds on Node 24:** `deploy/Dockerfile` uses `node:24.22.2-slim` (pinned by
  digest) in both stages. Node 24.15.0 on Windows crashes the dashboard tests natively ("Channel
  closed", 17 of 30 runs); 24.22.2 passed 30 of 30.
