### Orange Pi (Part C, D-075)

- **Stage 12, Cloudflare Tunnel:** `scripts/pi/remote/12-tunnel.sh` installs `cloudflared` from
  Cloudflare's signed apt repository (key pinned by fingerprint) as the service
  `foundry-ai-tool-cloudflared`, in token mode. The tunnel token is read from a root-only file
  through systemd's `LoadCredential`, never from an argument or an environment variable, and the
  unit does not start without it. Optional `FOUNDRY_PUBLIC_HOST` sets Foundry's `hostname`,
  `proxySSL` and `proxyPort` 443. It opens no port and changes no firewall, SSH, network or
  Tailscale setting. `set-tunnel-token.sh` is the helper the user runs in their own SSH session:
  it reads the token without showing it. Nothing was run on the Pi.
- **Docs:** [Remote access](../docs/dev/REMOTE-ACCESS.md) has a "Part C" section with plain steps
  (domain, Zero Trust team, tunnel, Access policies for the players and the GM, a service token
  for the GM's Obsidian plugin, testing from a phone, removing a player); the Pi guide lists stage 12.
