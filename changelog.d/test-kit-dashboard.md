### Test kit (D-090 lane 2)

- **Dashboard pages in a real browser (slice 4 plumbing):** test kit scenarios can open dashboard and
  player pages in Edge (`t.browser`, also in a separate browser with no login) and attach screenshots
  to the report (`t.attachFile`). Console errors of those pages show in the report with the page they
  came from and are never merged with Foundry errors.
