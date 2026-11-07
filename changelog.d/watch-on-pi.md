### Pi

- **Game-night watch on the Pi (stage 29):** `scripts/pi/remote/29-gamenight-watch.sh` installs the watch as a service
  that idles until a play session is marked, then checks Foundry, the dashboard's `/api/health`, the bridge link to
  Foundry's module, the Discord recorder and (with a Cloudflare Access service token read from an env file) the public
  address. It posts to `#gm-bot` when it starts, on every state change and when the session ends. A paper night is not
  watched. The stage has a dry run, a check and an undo, and an ARM64 container test.
- **No address in the watch's posts:** the PC watch's `--post` messages no longer name the Foundry address, and the
  address in its log drops the query string and fragment; every post goes through a scrub for http(s) addresses.

### MCP tools

- **`get-play-session` reports `mode`:** `live` or `paper` while a session is open, `null` when closed (the Pi watch skips
  paper nights, when Foundry is closed by design).
