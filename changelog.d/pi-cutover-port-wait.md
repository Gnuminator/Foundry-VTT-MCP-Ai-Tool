### Fixes

- **Pi cutover (stage 24):** the port wait and the port checks ignore listeners on the Pi's own tailscale interface (Tailscale serve holds 3000 and 31414 there for good), so `MODE=cutover` no longer rolls back on them. Values wholly wrapped in double quotes with a safe inside (as stages 5 and 7 write them) pass the env check. Stage 5's tailnet check reads the `%tailscale0` scope, and the README says how to make the rehearsal data folders.
