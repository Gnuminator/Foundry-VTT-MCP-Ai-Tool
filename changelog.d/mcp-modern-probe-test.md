### Tooling (I-138)

- **MCP modern-client probe test:** a test starts the built stdio server and sends it what an MCP 2026-07-28 client would (`server/discover`, `tools/list` and `tools/call` with `_meta` and no `initialize`, `initialize` asking for the new version), next to the normal handshake. It checks nothing crashes or hangs and that `tools/list` keeps the same order on repeated calls. It pins what the connectors do today, so the later move to the new protocol starts from facts.
