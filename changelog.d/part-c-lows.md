### Obsidian

- **Pasted Cloudflare header lines work:** Cloudflare's copy buttons copy the header name too
  (`CF-Access-Client-Id: ...`). The plugin now drops a leading `CF-Access-Client-Id:` or
  `CF-Access-Client-Secret:` and the spaces after it from the two service token secrets before it
  sends them.

### Docs

- **Part C guide matches what was really set up on 2026-10-14:** no stage 5 rerun for the dashboard,
  the dashboard application also carries the players' policy (players get `/player`), the
  Tailscale-only GM link, instant auth set the same on both applications, removing a player also
  removes `cogm` when the players' policy is shared, the service token secret is shown once (Rotate makes a new one), and a 403 can
  also be a wrong team name. The GM's Obsidian guide explains the Add secret dialog and where the GM
  token comes from, with no password manager.
