### Docs

- **`.env.example` explains `DASHBOARD_ALLOWED_HOSTS` for a Tailscale name or a LAN address:** the dashboard refuses any other name with 421 `host-not-allowed`, so the example now shows the full Tailscale name and a LAN address, and says the short name needs its own entry.
