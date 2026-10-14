### Remote access (D-095)

- **The GM's Claude Desktop reaches the bridge on the Pi:** the Windows client installer has a
  Cloudflare tunnel option. It bundles a pinned `cloudflared`, keeps `cloudflared access tcp`
  running from a logon task (`installer/nsis/tunnel-client.ps1`) and stores the GM's service token
  per Windows user (DPAPI). The bridge's control port stays on loopback on the Pi; it is reached
  only through an Access application of its own.
- **Stage 12** now also checks that the control port answers on loopback and nothing listens beyond it.
