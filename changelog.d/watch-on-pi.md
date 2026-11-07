### Pi

- **Game-night watch on the Pi (stage 28):** `scripts/pi/remote/28-gamenight-watch.sh` installs the watch as a service
  that idles until a play session is marked, then checks Foundry, the dashboard's `/api/health`, the bridge link to
  Foundry's module, the Discord recorder and (with a Cloudflare Access service token read from an env file) the public
  address. It posts to `#gm-bot` when it starts, on every state change and when the session ends. The stage has a dry
  run, a check and an undo, and an ARM64 container test.
- **The PC watch no longer posts an address with a query string:** `safeUrl` drops the query string and fragment, and
  every post and alert log line goes through a scrub for http(s) addresses.
