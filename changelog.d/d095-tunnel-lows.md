### Remote access (D-095)

- **Tunnel client, three small fixes:** a direct `tunnel-client.ps1 -Action Install` now stops the old
  tunnel before it writes the new `tunnel.json` (a changed host or port no longer leaves the old
  cloudflared running), waits up to about 3 seconds for the old listener to go before it refuses a
  port in use, and the `-NoTask` start quotes its arguments (a user folder with a space works).
