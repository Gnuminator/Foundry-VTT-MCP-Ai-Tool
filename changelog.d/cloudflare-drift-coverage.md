### Remote access

- **The Cloudflare drift check covers the whole live setup:** besides applications, policies, DNS and route
  hostname and service, it now compares route path, the tunnel's origin Access check, every tunnel by name,
  the Transform Rules, Worker routes and each service token's expiry, and prints a `WARN` line for a token
  under 60 days from expiry. A test fails when the read code gets a field the compare does not check.
  `docs/dev/REMOTE-ACCESS.md` says to run it before each gate and at the weekly check (backlog item
  cloudflare-drift-coverage).
