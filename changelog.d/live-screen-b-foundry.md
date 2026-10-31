### Module

- **Live window (live screen B, off by default):** turn on "AI Tool: Live window" in the module
  settings and the GM gets a Live button in the AI Tool group and a small pin at the screen edge.
  It opens the dashboard's live strip in a window about 400 px wide next to the map, the same strip
  as the Live page. Controlling tokens on the map picks the same creatures in the strip, the window
  remembers its place and comes back after a reload, and the Combat, Party and Session windows are
  unchanged. "AI Tool: Live window address" holds the dashboard address when it is not this host on
  port 3100.

### Dashboard

- **The live strip page can be framed by Foundry:** `/?strip=1` now sends
  `Content-Security-Policy: frame-ancestors <DASHBOARD_FOUNDRY_URL origin>` (the dashboard itself
  when that is not set); no other page changes.
