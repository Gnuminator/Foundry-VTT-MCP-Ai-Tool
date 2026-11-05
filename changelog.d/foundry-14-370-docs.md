### Docs

- **Foundry 14.370 on the test server:** the Pi setup and Plan B notes name the 14.370 Node.js zip, and the Pi setup notes say 14.370 needs Node 24.22.1 or newer (stage 2 with `NODE_VERSION=v24.22.2`) before stage 3.

### Fixes

- **Test server finds the newer portable Node:** `start.ps1` looks in `%LOCALAPPDATA%\node24` for a Node that fits Foundry's `engines.node`, so Foundry 14.370 (Node 24.22.1 or newer) starts when the node on PATH is older.
