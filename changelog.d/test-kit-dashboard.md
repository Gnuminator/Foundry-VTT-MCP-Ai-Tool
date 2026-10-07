### Test kit (D-090 lane 2)

- **Dashboard pages in a real browser (slice 4 plumbing):** test kit scenarios can open dashboard and
  player pages in Edge (`t.browser`, also in a separate browser with no login) and attach screenshots
  to the report (`t.attachFile`). Console errors of those pages show in the report with the page they
  came from and are never merged with Foundry errors.
- **Dashboard write flows and the login split in a real browser (slice 4):** two new test kit
  scenarios click the dashboard's write flows (confirm window, Undo, Tarokka, party, handouts, notes,
  player links) and check the login split with random tokens in a fresh browser; the dashboard is
  restarted for the split and put back in the normal mode afterwards.
- **Dashboard control sweep and rendered player check in a real browser (slice 4):** a new test kit
  scenario opens or checks every dashboard and player control of the usage catalog in Edge (a table
  classifies each one; a unit test keeps it complete) and attaches a result row per control and one
  screenshot per drawer, view and During layout; a second scenario checks that the drawn `/player`
  page names no hidden token, canary or true monster name.
- **The write flows switch their own features on (slice 4):** `dashboard-write-flows` turns the
  Tarokka, handouts and party features on for the run and puts them back afterwards, and makes a kit
  party group when the world has none, so no flow is skipped for a switch or a missing group. The page
  the login split opens with no token keeps its expected 401 errors out of the report, and the player
  checks delete their canary token by id.
- **Safer test dashboard restart (slice 4 review):** `scripts/test-env/stop.ps1` stops a recorded pid
  only when it owns that service's port (a stale pid that another process has by now is refused with
  exit code 1 and forgotten); the kit refuses to restart the dashboard from a checkout with no built
  dashboard and leaves a split it did not make alone. A write flow that is refused for a switch the run
  turned on itself now fails instead of skipping; the login split reads the player page once it has
  drawn and checks that the no-token page logs nothing but 401 and failed-resource errors; the control
  sweep fails a row on a console error even when the row was skipped, and the Pick button and the
  player name picker are required rows.
- **The control sweep covers the Everyone tab and the undo window (slice 4 delta review):** the
  I-109 controls (the AI and Everyone tabs, the person filter, the Everyone rows' Undo, Redo and
  lines, and the undo window's Cancel, Just this, Everything since, Advanced, the rewind questions,
  the destructive tick and Escape) are classified; the sweep turns GM Actions on for the run and
  walks the undo window read-only (Apply and Redo stay with the guarded undo checks). `stop.ps1`
  also stops our own process when its command line shows the service but it is not on its port
  yet (and the `cmd.exe` wrapper whose node child owns the port), reports a pid another process
  holds as not running instead of refusing, compares against every listener on the port, keeps the
  pid when it cannot tell, and `reset-demo-world.ps1` stops on a refusal instead of copying over an
  open world.
