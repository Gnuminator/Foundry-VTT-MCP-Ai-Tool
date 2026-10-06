### Obsidian

- **Plugin through Cloudflare Access (R1, D-094):** the Obsidian plugin can reach a dashboard
  behind Cloudflare Access, such as the one on the Pi. It sends a service token's Client ID and
  Client Secret (`CF-Access-Client-Id`, `CF-Access-Client-Secret`) from Obsidian's secret storage,
  to https addresses only, and the dashboard's GM token for the GM role, so the dashboard needs no
  change. An answer that is not the dashboard's own (Access's login or refusal page) now says to
  check the Access token instead of "HTTP 200". New GM guide `docs/gm/obsidian.md`: what is in
  the vault, where prep goes, and connecting the plugin.
