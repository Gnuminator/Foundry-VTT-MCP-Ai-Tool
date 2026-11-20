### Orange Pi

- **Veil look on Foundry's join page, built, not deployed:** a small Cloudflare Worker
  (`deploy/cloudflare/join-veil/`) adds The Veil stylesheet to `/join` at the edge. It changes
  only that page, passes everything else through, and falls back to Foundry's own page on any
  error or with the `VEIL_OFF` switch. Nothing is deployed yet; that needs the user's OK.
