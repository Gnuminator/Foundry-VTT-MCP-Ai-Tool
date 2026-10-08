### Dashboard

- **The React dashboard gets Module diagnostics and Help (D-109):** the new page at `/next/`
  shows the Foundry module errors and warnings from the live stream (with the overdue space-check
  note) and opens the GM guides in a Help pane, with a "?" on each panel heading. One live stream
  connection feeds every panel. Playwright covers both panels, and a server test checks that the
  player-links routes answer 401 when a player token is set and the caller has none.
