### Test servers

- **Safer test server setup (PR #435 review lows):** `config.ps1` refuses a server Root that is, or
  sits inside, another server's Root (they would share data and one lock). The start-of-session
  alerts hook now reads server C's lock like B's ("Test server C lock"). The forbidden-port lists
  of the voice stack, the LiveKit proof of concept and the Pi rebuild drill include test servers B
  and C, a test checks that Plan B and those lists cover every port in `servers.json`, and the
  `local.json` example names `local.B.json` / `local.C.json` with a free port.
