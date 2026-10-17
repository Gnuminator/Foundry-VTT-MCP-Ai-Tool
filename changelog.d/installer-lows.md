### Installer (audit L2, L3, L4)

- **The token file is deleted after use:** a silent install with `/TUNNELTOKENFILE=` removes the plain-text file as soon as the encrypted copy is stored (a failed delete prints a warning).
- **Warning for a bridge address that may be on the internet:** `configure-claude.ps1` warns when the address is not loopback, private, Tailscale or a LAN name, and points to the Cloudflare tunnel.
- **Shared install folders are refused:** the tunnel setup stops with exit 2 when the folder holding `tunnel-client.ps1` or `cloudflared.exe` can be changed by anyone besides you, SYSTEM and Administrators, before the logon task is registered.
