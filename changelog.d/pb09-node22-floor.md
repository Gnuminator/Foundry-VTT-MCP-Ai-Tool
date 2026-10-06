### Fixes

- **Node 22 is the floor everywhere (PB-09):** `engines.node` is `>=22` in the root, dashboard and
  bridge packages (and the LiveKit recorder), the standalone bridge zip says Node 22, the Docker
  image is `node:22-slim`, and the client installer bundles Node 22.23.3 (was 20.12.2). The installer
  build now checks the downloaded Node zip against a pinned SHA-256 and stops on a mismatch. The
  bundled bridge and client are built for the `node22` target, and `@types/node` is the 22 line.
