### Test kit

- **The dashboard sweep drives the React dashboard:** `dashboard-controls`, `dashboard-login-split`
  and `dashboard-write-flows` open `/` instead of the old page, and the control table and page helpers use
  the React ids. Controls only the old page has (pause, the AI tab, tone, model, feature cards) are `skip`
  rows "old page only". The kit no longer names the old page anywhere.
