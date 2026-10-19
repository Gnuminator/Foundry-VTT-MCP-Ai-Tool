### Test environment

- **Three local test servers (A, B, C):** server C (`C:\FoundryTestC`, Foundry 30003, bridge
  31534/31535, dashboard 3102) joins A and B, all with the same `ai-tool-test` world and package
  versions. Every `scripts/test-env` script takes `-Server A|B|C`; each server has its own lock, so
  a lane takes any free one. `server-b.ps1 -Server C` sets C up from A. Owner-only on localhost.
