### Removed

- **WebRTC connection path (PB-09):** the Foundry module and the bridge now talk over one
  WebSocket (31415) only. The `werift` dependency, the WebRTC signaling port (31416, test 31516),
  the chunk reassembly code and the `FOUNDRY_CONNECTION_TYPE`, `FOUNDRY_STUN_SERVERS` and
  `FOUNDRY_WEBRTC_PORT` settings are gone, which clears the two audit findings tied to `werift`.
  The module setting "Connection Type" is no longer registered; a value still stored in a world
  is ignored and the module always uses the WebSocket. Nothing used WebRTC (Foundry runs on the
  Pi and is reached over Tailscale). Docs, the compose and Docker files and the test-environment
  scripts no longer mention it.
