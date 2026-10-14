### Docs

- **Part C guide matches how it was really set up:** `docs/dev/REMOTE-ACCESS.md` uses Cloudflare's
  new "Cloudflare One" menu paths, adds the missing One-time PIN step (Integrations, Identity
  providers), the `http://` in the route's Service URL and the "Validate the Access JWT at the
  tunnel" option (a 403 after the email code means a wrong AUD tag), and runs stage 12 once with the
  public name. `docs/dev/PI-SETUP.md` Part C now describes the token model (set with
  `set-tunnel-token.sh`) instead of "log in once".
