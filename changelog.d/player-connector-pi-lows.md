### Orange Pi

- **Stage 30 (player connector) is stricter and safer to rerun:** a failed check at the end of a real run (the 401, the 421, the ports, the bridge control port) now makes the run exit 1 instead of only warning. The "players online or recording" refusal comes before the first write, not after. `DASHBOARD_ALLOWED_HOSTS` missing from `dashboard-access.env` stops the stage instead of writing a list with only the player host. `UNDO=1` restarts a service only when its own input changed, and takes out the exact host (dots are not wildcards). A container scenario now runs the stage against a fake systemd.
- **`control_port_check` ignores the Pi's own tailnet address:** a listener on 31414 bound to the Pi's own tailscale interface (ss prints the address with a `%tailscale0` scope) no longer gives a false "returned 2" in stages 12, 24 and 30.
- **Stage 13 pinned to Actor Studio `2.10.5-aitool.8`:** `13-player-creation.sh` installs the fork release `2.10.5-aitool.8` (checked against its `module.zip` sha256), which sends Take Average as a real change event. `aitool.8` never reached the Pi: its zip was packed with backslash paths, so it was replaced by `aitool.9`.
- **Cloudflare setup script for the player connector:** `--out` refuses an existing file and any folder under a `.git` (a checkout, a worktree, the vault) before it makes a token, creates the file with `wx`, and does not claim "mode 600" on Windows. `--host` must be a name inside `--zone`. The hook asks for the user's OK on `player-connector-cloudflare.mjs --apply`. The token list in the script header and the sitting note names Account Settings: Read and Zone: Read.

### Releases

- **The release lists the player files:** the release workflow builds `foundry-player.mcpb` and `foundry-dnd-helper-player.zip`, attaches them and lists them in `SHA256SUMS.txt`. Set the Actions variable `FOUNDRY_PLAYER_ENDPOINT` to pre-fill the extension's address field.
