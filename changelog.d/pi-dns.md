### Orange Pi (D-068)

- **Stage 4 turns Tailscale DNS off on the Pi:** a DHCP lease renewal emptied `/etc/resolv.conf`,
  Tailscale rewrote it with no upstream resolver, and from then on every public name failed on the
  Pi (github.com for a stage 5 build, apt, a Discord reconnect for the bot). Stage 4 now runs
  `tailscale set --accept-dns=false`, so the Pi asks the router for names; Tailscale itself, SSH and
  the tailnet shares are unchanged. The Pi needs no tailnet names. Applied by hand on the Pi on
  2026-10-06 with the user's OK.
- **Stage files are readable by the services again:** stage 9's SSH logging wrapper set `umask 077`
  for its log and passed it on to every command, so a stage 5 build on 2026-10-06 came out root-only
  and the bridge (it runs as `foundry`) could not start. `lib.sh` now sets `umask 022` for every
  stage, and the wrapper keeps 077 for its own log and saved scripts only, giving each command the
  session's umask back (checked in an ARM64 Debian container).
