### Fixes

- **Test servers use the portable Node 24:** `scripts/test-env` picks the newest `%LOCALAPPDATA%\node24`
  folder first and falls back to the older `node22` one. The Docker template builds on Node 24.22.2.
  Node 24.15.0 on Windows crashes the dashboard tests ("Channel closed", 17 of 30 runs); 24.22.2 passed
  30 of 30.
