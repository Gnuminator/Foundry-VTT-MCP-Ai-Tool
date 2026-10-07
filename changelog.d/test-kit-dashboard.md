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
